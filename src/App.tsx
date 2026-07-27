import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Image, Upload, Layers, Settings, LogOut, User as UserIcon, Sparkles,
} from 'lucide-react';
import type { User, PictureItem, AppStats, AppSettings, UndoState } from './types';
import { bootstrapSession } from './services/session';
import {
  fetchPictureQueue, fetchAppStats, fetchAppSettings, updateAppSettings,
  submitPictureReview, undoPictureReview, syncOfflineQueue, logoutUser,
  fetchReviewedPictureIds,
} from './services/api';
import {
  getOfflineCount, mergeCachedPictureQueue, getCachedPictureQueue,
  newSessionId, getSessionId, setSessionId,
  getSessionReviewedUrls, addSessionReviewedUrl, clearSessionReviewedUrls,
  removeFromCachedPictureQueue, pruneReviewedFromCachedQueue, getOfflineReviewPictureIds,
  cacheStats, getCachedStats, cacheAppSettings, getCachedAppSettings,
} from './services/offlineQueue';
import { cacheManager } from './services/cacheManager';
import AuthScreen from './components/AuthScreen';
import ImageStage from './components/ImageStage';
import ReviewControls from './components/ReviewControls';
import ErrorModal from './components/ErrorModal';
import ImportModal from './components/ImportModal';
import HistoryExplorer from './components/HistoryExplorer';
import SettingsModal from './components/SettingsModal';
import UndoToast from './components/UndoToast';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [currentPicture, setCurrentPicture] = useState<PictureItem | null>(null);
  const [queue, setQueue] = useState<PictureItem[]>([]);
  const [loadingPicture, setLoadingPicture] = useState(false);
  const [stats, setStats] = useState<AppStats | null>(() => getCachedStats());
  const [settings, setSettings] = useState<AppSettings>(() =>
    getCachedAppSettings() ?? {
      cacheSize: 10,
      instances: [],
      activeInstance: '',
      autoFetchApi: true,
      cellularSaverMode: false,
    });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [offlinePendingCount, setOfflinePendingCount] = useState(getOfflineCount());
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [isUndoLoading, setIsUndoLoading] = useState(false);

  const userRef = useRef(user);
  userRef.current = user;

  // PictureIds reviewed or skipped this session. Used to pick the next picture
  // from the cached list without re-showing ones the user has already acted on.
  // Reset on reload (new session boundary).
  const actedThisSessionRef = useRef<Set<string>>(new Set());

  // Refill coordination: a single in-flight background refill prevents the
  // app from hammering /api/pictures/queue on every advance.
  const refillingRef = useRef(false);

  useEffect(() => {
    // Eagerly enumerate the Cache API so the cached-count badge in Settings
    // is correct on first open (fixes the "shows 0 after refresh" bug).
    cacheManager.warmUp();
  }, []);

  useEffect(() => {
    (async () => {
      const bootUser = await bootstrapSession();
      if (bootUser) {
        setUser(bootUser as User);
      }
      setAuthChecking(false);
    })();

    const handleOnline = () => {
      setIsOnline(true);
      // Reconnect: immediately re-fetch stats + settings (which were 503'd
      // while offline) and flush the offline review queue instead of
      // waiting up to 2.5s for the interval tick. The offline indicator
      // otherwise stays amber until the next interval.
      loadStats();
      if (userRef.current) {
        void (async () => {
          try {
            const st = await fetchAppSettings();
            setSettings(st);
            cacheAppSettings(st);
            cacheManager.setCellularSaver(st.cellularSaverMode || false);
          } catch { /* ignore */ }
          const count = getOfflineCount();
          setOfflinePendingCount(count);
          if (count > 0) {
            const result = await syncOfflineQueue();
            if (result.syncedCount > 0) {
              setOfflinePendingCount(getOfflineCount());
              if (result.syncedPictureIds.length > 0) {
                pruneReviewedFromCachedQueue(result.syncedPictureIds);
              }
              loadStats();
            }
          }
        })();
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const beforeinstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', beforeinstall);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', beforeinstall);
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const count = getOfflineCount();
      setOfflinePendingCount(count);
      if (navigator.onLine && count > 0) {
        syncOfflineQueue().then((result) => {
          if (result.syncedCount > 0) {
            setOfflinePendingCount(getOfflineCount());
            // Prune synced picture IDs from the cached queue so a later
            // reload (or the same session's cache-first path) doesn't
            // re-serve them.
            if (result.syncedPictureIds.length > 0) {
              pruneReviewedFromCachedQueue(result.syncedPictureIds);
            }
            loadStats();
          }
        });
      }
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchAppStats();
      setStats(s);
      cacheStats(s);
    } catch { /* ignore */ }
  }, []);

  // Session-boundary cache eviction: on each app boot, if the stored session
  // id differs from a freshly generated one, delete cached responses for URLs
  // that were reviewed during the *previous* session, then clear the list and
  // stamp the new session id. Within a session, reviewed images stay cached
  // (undo needs them).
  const enforceSessionBoundary = useCallback(async () => {
    const stored = getSessionId();
    const fresh = newSessionId();
    if (stored && stored !== fresh) {
      const reviewedUrls = getSessionReviewedUrls();
      if (reviewedUrls.length > 0) {
        await cacheManager.evictUrls(reviewedUrls);
      }
      clearSessionReviewedUrls();
    }
    setSessionId(fresh);
  }, []);

  // Filter the given pictures down to those whose image bytes are actually in
  // the Cache API. Used so that offline operation never lands on a picture
  // whose metadata is cached but whose image was never prefetched.
  const filterViewable = useCallback(async (pictures: PictureItem[]): Promise<PictureItem[]> => {
    if (pictures.length === 0) return pictures;
    if (navigator.onLine) return pictures;
    const urls = pictures.map((p) => p.sdUrl);
    const cached = await cacheManager.getCachedPictureUrls(urls);
    return pictures.filter((p) => cached.has(p.sdUrl));
  }, []);

  const loadInitialAppData = useCallback(async (instanceFilter?: string) => {
    await enforceSessionBoundary();
    const instance = instanceFilter || settings.activeInstance || undefined;

    // Prune the cached picture queue of pictures that already have a review.
    // Offline reviews (in the offline queue) are always pruned; when online we
    // also fetch the user's reviewed picture IDs from the server and prune
    // those, so a reload never re-serves an already-reviewed picture.
    pruneReviewedFromCachedQueue(getOfflineReviewPictureIds());
    if (navigator.onLine) {
      try {
        const serverReviewedIds = await fetchReviewedPictureIds();
        pruneReviewedFromCachedQueue(serverReviewedIds);
      } catch { /* offline or auth hiccup: offline prune is still in effect */ }
    }

    // Settings MUST be awaited before any refill/prefetch/enforceLimit call,
    // otherwise they run against the default cacheSize (10) and a subsequent
    // enforceLimit(10) would evict the user's real cache down to 10 entries.
    if (navigator.onLine) {
      try {
        const st = await fetchAppSettings();
        setSettings(st);
        cacheAppSettings(st);
        cacheManager.setCellularSaver(st.cellularSaverMode || false);
      } catch { /* offline: keep cached/defaults */ }
    }
    loadStats();

    const cached = getCachedPictureQueue() || [];
    const acted = actedThisSessionRef.current;
    const fresh = cached.filter((p) => !acted.has(p.pictureId));
    const viewable = await filterViewable(fresh);
    if (viewable.length > 0) {
      const [first, ...rest] = viewable;
      setCurrentPicture(first);
      setQueue(rest);
    } else if (navigator.onLine) {
      // Nothing usable locally — fall back to a network fetch (which will
      // also populate the cache for next time).
      await refillQueueFromServer(instance, true);
    } else {
      setCurrentPicture(null);
    }

    // Background refill to keep the cache topped up regardless of where the
    // initial queue came from.
    maybeRefillInBackground(instance);
  }, [settings.activeInstance, enforceSessionBoundary, loadStats]);

  useEffect(() => {
    if (user) {
      loadInitialAppData();
    }
  }, [user, loadInitialAppData]);

  const refillQueueFromServer = useCallback(async (instance: string | undefined, showFirst: boolean): Promise<boolean> => {
    if (refillingRef.current) return false;
    refillingRef.current = true;
    let supplied = false;
    try {
      const exclude = Array.from(actedThisSessionRef.current);
      // Fetch only the number of pictures needed to refill the *in-memory*
      // queue back to cacheSize — not the full cacheSize every time. This
      // prevents the in-memory queue from growing without bound across
      // repeated refills and keeps the network cost of a refill proportional
      // to how many pictures were actually consumed since the last refill.
      const refillAmount = Math.max(1, settings.cacheSize - queue.length);
      const result = await fetchPictureQueue(refillAmount, instance, exclude);
      if (result.queue.length > 0) {
        // Don't (re-)merge pictures that have a pending offline review —
        // they're already reviewed, just not yet synced.
        const offlineReviewed = new Set(getOfflineReviewPictureIds());
        const eligible = result.queue.filter((p) => !offlineReviewed.has(p.pictureId));
        if (eligible.length > 0) {
          mergeCachedPictureQueue(eligible);
          // Prefetch + enforceLimit in the background: don't block the UI
          // (and the queue state update below) on image downloads.
          void cacheManager.prefetchPictures(eligible, settings.cacheSize)
            .then(() => cacheManager.enforceLimit(settings.cacheSize));
        }
        const fresh = eligible.filter((p) => !actedThisSessionRef.current.has(p.pictureId));
        if (fresh.length > 0) {
          supplied = true;
          if (showFirst) {
            const [first, ...rest] = fresh;
            setCurrentPicture(first);
            setQueue(rest);
          } else {
            // Cap the in-memory queue at the configured cache size so it
            // never grows unbounded across many refills.
            setQueue((prev) => {
              const combined = [...prev, ...fresh];
              if (combined.length <= settings.cacheSize) return combined;
              return combined.slice(combined.length - settings.cacheSize);
            });
          }
        }
      }
    } catch {
      // Offline or auth issue — the cached list is the fallback, handled by callers.
    } finally {
      refillingRef.current = false;
    }
    return supplied;
  }, [settings.cacheSize, queue.length]);

  const maybeRefillInBackground = useCallback((instance: string | undefined, remainingOverride?: number) => {
    if (!navigator.onLine) return;
    const remaining = remainingOverride ?? queue.length;
    if (remaining >= settings.cacheSize) return;
    void refillQueueFromServer(instance, false);
  }, [queue.length, settings.cacheSize, refillQueueFromServer]);

  const advanceToNextPicture = useCallback(async () => {
    // Mark the picture we're leaving as acted-upon this session (skip counts),
    // so it won't be re-served from the cache on a later refill.
    if (currentPicture) actedThisSessionRef.current.add(currentPicture.pictureId);

    const acted = actedThisSessionRef.current;
    const instance = settings.activeInstance || undefined;

    // 1. In-memory queue (sourced from the cache).
    const q = queue;
    let remainingAfterAdvance = q.length > 0 ? q.length - 1 : 0;
    if (q.length > 0) {
      const candidates = navigator.onLine ? q : await filterViewable(q);
      if (candidates.length > 0) {
        const next = candidates[0];
        const consumedId = next.pictureId;
        setCurrentPicture(next);
        const nextQueue = q.filter((p) => p.pictureId !== consumedId);
        setQueue(nextQueue);
        remainingAfterAdvance = nextQueue.length;
      } else {
        // All in-memory entries are uncached offline — fall through to the
        // persistent localStorage queue (which may have cached entries).
        const cached = getCachedPictureQueue() || [];
        const fresh = cached.filter((p) => !acted.has(p.pictureId));
        const viewable = await filterViewable(fresh);
        if (viewable.length > 0) {
          const [first, ...rest] = viewable;
          setCurrentPicture(first);
          setQueue(rest);
          remainingAfterAdvance = rest.length;
        } else {
          setCurrentPicture(null);
          remainingAfterAdvance = 0;
        }
      }
    } else {
      // 2. Drain from the persistent cached-picture list in localStorage.
      const cached = getCachedPictureQueue() || [];
      const fresh = cached.filter((p) => !acted.has(p.pictureId));
      const viewable = await filterViewable(fresh);
      if (viewable.length > 0) {
        const [first, ...rest] = viewable;
        setCurrentPicture(first);
        setQueue(rest);
        remainingAfterAdvance = rest.length;
      } else if (navigator.onLine) {
        // 3. Last resort: ask the server for a fresh batch (also refills cache).
        setLoadingPicture(true);
        try {
          const supplied = await refillQueueFromServer(instance, true);
          if (!supplied) {
            setCurrentPicture(null);
          }
        } finally {
          setLoadingPicture(false);
        }
      } else {
        setCurrentPicture(null);
      }
    }

    // Background refill keeps the cache topped up while online. Pass the
    // post-consume queue length so the check uses the up-to-date value
    // instead of the stale closure value.
    maybeRefillInBackground(instance, remainingAfterAdvance);
    loadStats();
  }, [currentPicture, queue, settings.cacheSize, settings.activeInstance, loadStats, refillQueueFromServer, maybeRefillInBackground, filterViewable]);

  const handlePassOk = useCallback(async () => {
    if (!currentPicture || !user) return;
    setSubmittingReview(true);
    const reviewedPicture = currentPicture;
    const previousUndo = undo;
    try {
      const result = await submitPictureReview(
        reviewedPicture.pictureId, 'ok', undefined, undefined,
        { id: user.id, username: user.username }, reviewedPicture,
      );
      markReviewedAndTrackCache(reviewedPicture);
      setUndo({
        picture: reviewedPicture,
        reviewId: result.review.id,
        label: 'OK',
        createdAt: Date.now(),
        previousUndo,
      });
    } finally {
      setSubmittingReview(false);
      advanceToNextPicture();
    }
  }, [currentPicture, user, undo, advanceToNextPicture]);

  const handleFlagErrorSubmit = useCallback(async (reasonId: string, comment: string) => {
    if (!currentPicture || !user) return;
    setSubmittingReview(true);
    setIsErrorModalOpen(false);
    const reviewedPicture = currentPicture;
    const previousUndo = undo;
    try {
      const result = await submitPictureReview(
        reviewedPicture.pictureId, 'error', reasonId, comment,
        { id: user.id, username: user.username }, reviewedPicture,
      );
      markReviewedAndTrackCache(reviewedPicture);
      setUndo({
        picture: reviewedPicture,
        reviewId: result.review.id,
        label: `Flag: ${reasonId}`,
        createdAt: Date.now(),
        previousUndo,
      });
    } finally {
      setSubmittingReview(false);
      advanceToNextPicture();
    }
  }, [currentPicture, user, undo, advanceToNextPicture]);

  const markReviewedAndTrackCache = useCallback((pic: PictureItem) => {
    actedThisSessionRef.current.add(pic.pictureId);
    addSessionReviewedUrl(pic.sdUrl);
    removeFromCachedPictureQueue(pic.pictureId);
  }, []);

  const handleUndoReview = useCallback(async () => {
    const item = undo;
    if (!item) return;
    setIsUndoLoading(true);
    const displaced = currentPicture;
    try {
      await undoPictureReview(item.reviewId, item.picture.pictureId);
      // Undoing removes the review; the picture is eligible to be shown again
      // this session (e.g. if the user skips forward past it).
      actedThisSessionRef.current.delete(item.picture.pictureId);
      // Put the displaced current picture back at the front of the queue so
      // the user returns to where they were before stepping back.
      if (displaced && displaced.pictureId !== item.picture.pictureId) {
        setQueue((prev) => [displaced, ...prev]);
      }
      setCurrentPicture(item.picture);
      // Walk back one more step: the undo chain's previous entry becomes the
      // new "previous image" target, so repeated undo presses keep walking
      // back through the session history until it bottoms out (session first).
      setUndo(item.previousUndo);
      loadStats();
    } finally {
      setIsUndoLoading(false);
    }
  }, [undo, currentPicture, loadStats]);

  const handleLogout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    window.location.href = '/yunohost/sso/?action=logout';
  }, []);

  const handleInstallPwa = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleImportComplete = useCallback(() => {
    loadStats();
    advanceToNextPicture();
  }, [loadStats, advanceToNextPicture]);

  const handleSettingsSaved = useCallback((s: AppSettings) => {
    const instanceChanged = s.activeInstance !== settings.activeInstance;
    setSettings(s);
    cacheAppSettings(s);
    cacheManager.setCellularSaver(s.cellularSaverMode || false);
    if (instanceChanged) loadInitialAppData(s.activeInstance || undefined);
  }, [settings.activeInstance, loadInitialAppData]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isErrorModalOpen || isImportModalOpen || isHistoryOpen || isSettingsOpen) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;
      const key = e.key;
      if ((key === 'Enter' || key === 'o' || key === 'O') && !submittingReview) {
        e.preventDefault();
        handlePassOk();
      } else if ((key === 'e' || key === 'E' || key === 'f' || key === 'F' || key === 'Delete') && !submittingReview) {
        e.preventDefault();
        if (currentPicture) setIsErrorModalOpen(true);
      } else if ((key === 's' || key === 'S' || key === 'ArrowRight' || key === 'ArrowLeft' || key === 'ArrowUp' || key === 'ArrowDown' || key === ' ') && !submittingReview) {
        e.preventDefault();
        advanceToNextPicture();
      } else if (key === 'z' || key === 'Z' || key === 'u' || key === 'U' || ((e.ctrlKey || e.metaKey) && key === 'z')) {
        if (undo && !isUndoLoading) {
          e.preventDefault();
          handleUndoReview();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isErrorModalOpen, isImportModalOpen, isHistoryOpen, isSettingsOpen, submittingReview, currentPicture, handlePassOk, handleUndoReview, undo, isUndoLoading]);

  if (authChecking) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center">
        <div className="w-9 h-9 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin mb-3" />
        <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">Initializing Panoramax Review...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const headerBtnBase = 'p-1.5 sm:px-3 sm:py-1.5 text-xs font-medium flex items-center gap-1.5 shadow-xs active:scale-[0.98] transition-all';
  const headerIconBtn = 'p-1.5 sm:p-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg sm:rounded-xl border border-slate-200/80 active:scale-[0.98] transition-all';

  return (
    <div className="flex flex-col h-[100dvh] w-screen bg-slate-50 text-slate-900 font-sans overflow-hidden select-none">
      <header className="shrink-0 w-full min-h-[3.25rem] sm:h-14 bg-white/95 border-b border-slate-200/80 px-2.5 sm:px-5 py-1.5 flex items-center justify-between z-30 backdrop-blur-md shadow-xs gap-2 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 sm:p-2 bg-slate-900 text-white rounded-lg sm:rounded-xl shadow-xs shrink-0">
            <Image className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight leading-tight truncate">Panoramax</h1>
            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 font-mono whitespace-nowrap">
              Q: <strong className="text-slate-900 font-bold">{stats?.pendingQueue ?? 0}</strong>
              <span className="text-slate-300">&bull;</span>
              Rev: <strong className="text-emerald-600 font-bold">{stats?.userReviewCount ?? 0}</strong>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {(!isOnline || offlinePendingCount > 0) && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold ${
              !isOnline
                ? 'bg-amber-500/15 text-amber-900 border-amber-300'
                : 'bg-emerald-500/15 text-emerald-900 border-emerald-300'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${!isOnline ? 'bg-amber-500 animate-ping' : 'bg-emerald-500 animate-pulse'}`} />
              <span className="hidden sm:inline">{!isOnline ? `Offline (${offlinePendingCount})` : `Syncing ${offlinePendingCount}...`}</span>
            </div>
          )}

          {deferredPrompt && (
            <button
              type="button"
              onClick={handleInstallPwa}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-lg sm:rounded-xl text-[11px] sm:text-xs flex items-center gap-1 shadow-xs active:scale-[0.98] transition-all animate-pulse px-1.5 sm:px-2.5 py-1"
            >
              <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
              <span className="hidden sm:inline">Install App</span>
            </button>
          )}

          {settings.instances.length > 0 && (
            <select
              value={settings.instances.includes(settings.activeInstance) ? settings.activeInstance : ''}
              onChange={async (e) => {
                const newVal = e.target.value;
                const next = { ...settings, activeInstance: newVal };
                setSettings(next);
                cacheAppSettings(next);
                await updateAppSettings({ activeInstance: newVal });
                loadInitialAppData(newVal || undefined);
              }}
              className="max-w-[140px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-800 focus:outline-none focus:border-slate-900 truncate"
              title="Filter by instance"
            >
              <option value="">All Instances</option>
              {settings.instances.map((url) => (
                <option key={url} value={url}>{url.replace('https://', '')}</option>
              ))}
            </select>
          )}

          <button
            id="btn-header-import"
            type="button"
            onClick={() => setIsImportModalOpen(true)}
            title="Import pictures"
            className={`${headerBtnBase} bg-slate-900 hover:bg-slate-800 text-white rounded-lg sm:rounded-xl`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Import</span>
          </button>

          <button
            id="btn-header-history"
            type="button"
            onClick={() => setIsHistoryOpen(true)}
            title="Dashboard"
            className={`${headerBtnBase} bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-lg sm:rounded-xl border border-slate-200/80`}
          >
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-900" />
            <span className="hidden md:inline">Dashboard</span>
          </button>

          <button
            id="btn-header-settings"
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            title="Settings"
            className={headerIconBtn}
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <div className="w-px h-3.5 bg-slate-200 my-auto mx-0.5 hidden sm:block" />

          <div className="flex items-center gap-1 bg-slate-100 px-1.5 sm:px-2.5 py-1 rounded-lg sm:rounded-xl border border-slate-200/80">
            <UserIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[11px] sm:text-xs font-medium text-slate-700 max-w-[60px] sm:max-w-[80px] truncate hidden xs:inline sm:inline">
              {user.username}
            </span>
            <button
              id="btn-header-logout"
              type="button"
              onClick={handleLogout}
              title="Logout"
              className="p-0.5 sm:p-1 hover:text-rose-600 text-slate-400 rounded-md transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {settings.instances.length === 0 && (
        <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-900 font-medium">
            No Panoramax instances configured.{' '}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="underline font-semibold hover:text-amber-950"
            >
              Add one in Settings
            </button>{' '}
            to start importing and reviewing pictures.
          </p>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="shrink-0 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg transition-all active:scale-95"
          >
            Open Settings
          </button>
        </div>
      )}

      <main className="flex-1 w-full relative overflow-hidden flex flex-col bg-slate-950">
        <ImageStage
          picture={currentPicture}
          upcomingPictures={queue}
          loading={loadingPicture}
          onRefreshNext={advanceToNextPicture}
        />
      </main>

      <ReviewControls
        pendingCount={stats?.pendingQueue ?? 0}
        totalPictures={stats?.totalPictures ?? 0}
        canAct={!!currentPicture && !submittingReview}
        onOk={handlePassOk}
        onFlag={() => setIsErrorModalOpen(true)}
        onSkip={advanceToNextPicture}
      />

      <UndoToast
        undo={undo}
        canUndo={!!undo && !!undo.picture}
        isLoading={isUndoLoading}
        onUndo={handleUndoReview}
      />

      <ErrorModal
        pictureId={currentPicture?.pictureId || ''}
        isOpen={isErrorModalOpen}
        submitting={submittingReview}
        onClose={() => setIsErrorModalOpen(false)}
        onSubmit={handleFlagErrorSubmit}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={handleImportComplete}
        instances={settings.instances}
        activeInstance={settings.activeInstance}
      />

      <HistoryExplorer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        stats={stats}
        knownInstances={settings.instances}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSettingsSaved}
      />
    </div>
  );
}
