import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Image, Upload, Layers, Settings, LogOut, User as UserIcon, Sparkles, Wifi,
} from 'lucide-react';
import type { User, PictureItem, AppStats, AppSettings, UndoItem } from './types';
import { bootstrapSession } from './services/session';
import {
  fetchPictureQueue, fetchAppStats, fetchAppSettings, updateAppSettings,
  submitPictureReview, undoPictureReview, syncOfflineQueue, logoutUser,
} from './services/api';
import { getOfflineCount, cachePictureQueue } from './services/offlineQueue';
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
  const [stats, setStats] = useState<AppStats | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
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
  const [undoStack, setUndoStack] = useState<UndoItem[]>([]);
  const [isUndoLoading, setIsUndoLoading] = useState(false);

  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    (async () => {
      const bootUser = await bootstrapSession();
      if (bootUser) {
        setUser(bootUser as User);
      }
      setAuthChecking(false);
    })();

    const handleOnline = () => setIsOnline(true);
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
    } catch { /* ignore */ }
  }, []);

  const loadInitialAppData = useCallback(async (instanceFilter?: string) => {
    try {
      const instance = instanceFilter || settings.activeInstance || undefined;
      const [s, st, q] = await Promise.all([
        fetchAppStats(),
        fetchAppSettings(),
        fetchPictureQueue(settings.cacheSize, instance),
      ]);
      setStats(s);
      setSettings(st);
      setQueue(q.queue);
      if (q.queue.length > 0) {
        setCurrentPicture(q.queue[0]);
        setQueue(q.queue.slice(1));
      }
      cacheManager.setCellularSaver(st.cellularSaverMode || false);
      cacheManager.prefetchPictures(q.queue, st.cacheSize);
      cachePictureQueue(q.queue);
    } catch { /* ignore */ }
  }, [settings.cacheSize, settings.activeInstance]);

  useEffect(() => {
    if (user) {
      loadInitialAppData();
    }
  }, [user, loadInitialAppData]);

  const advanceToNextPicture = useCallback(async () => {
    const q = queue;
    if (q.length > 0) {
      const next = q[0];
      setCurrentPicture(next);
      setQueue(q.slice(1));
      cacheManager.prefetchPictures(q.slice(1), settings.cacheSize);
    } else {
      setLoadingPicture(true);
      try {
        const instance = settings.activeInstance || undefined;
        const result = await fetchPictureQueue(settings.cacheSize, instance);
        if (result.queue.length > 0) {
          setCurrentPicture(result.queue[0]);
          setQueue(result.queue.slice(1));
          cacheManager.prefetchPictures(result.queue, settings.cacheSize);
          cachePictureQueue(result.queue);
        } else {
          setCurrentPicture(null);
        }
      } catch {
        setCurrentPicture(null);
      } finally {
        setLoadingPicture(false);
      }
    }
    loadStats();
  }, [queue, settings.cacheSize, settings.activeInstance, loadStats]);

  const handlePassOk = useCallback(async () => {
    if (!currentPicture || !user) return;
    setSubmittingReview(true);
    try {
      const result = await submitPictureReview(
        currentPicture.pictureId, 'ok', undefined, undefined,
        { id: user.id, username: user.username }, currentPicture,
      );
      const undoItem: UndoItem = {
        id: `undo_${Date.now()}`,
        reviewId: result.review.id,
        pictureId: currentPicture.pictureId,
        label: 'OK',
        createdAt: Date.now(),
      };
      setUndoStack((prev) => [undoItem, ...prev].slice(0, 3));
    } finally {
      setSubmittingReview(false);
      advanceToNextPicture();
    }
  }, [currentPicture, user, advanceToNextPicture]);

  const handleFlagErrorSubmit = useCallback(async (reasonId: string, comment: string) => {
    if (!currentPicture || !user) return;
    setSubmittingReview(true);
    setIsErrorModalOpen(false);
    try {
      const result = await submitPictureReview(
        currentPicture.pictureId, 'error', reasonId, comment,
        { id: user.id, username: user.username }, currentPicture,
      );
      const undoItem: UndoItem = {
        id: `undo_${Date.now()}`,
        reviewId: result.review.id,
        pictureId: currentPicture.pictureId,
        label: `Flag: ${reasonId}`,
        createdAt: Date.now(),
      };
      setUndoStack((prev) => [undoItem, ...prev].slice(0, 3));
    } finally {
      setSubmittingReview(false);
      advanceToNextPicture();
    }
  }, [currentPicture, user, advanceToNextPicture]);

  const handleUndoReview = useCallback(async (item: UndoItem) => {
    setIsUndoLoading(true);
    try {
      await undoPictureReview(item.reviewId, item.pictureId);
      setUndoStack((prev) => prev.filter((u) => u.id !== item.id));
      loadStats();
    } finally {
      setIsUndoLoading(false);
    }
  }, [loadStats]);

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
        if (undoStack.length > 0 && !isUndoLoading) {
          e.preventDefault();
          handleUndoReview(undoStack[0]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isErrorModalOpen, isImportModalOpen, isHistoryOpen, isSettingsOpen, submittingReview, currentPicture, handlePassOk, handleUndoReview, undoStack, isUndoLoading]);

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
                setSettings({ ...settings, activeInstance: newVal });
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
            id="btn-header-cellular-saver"
            type="button"
            onClick={() => {
              const next = !settings.cellularSaverMode;
              setSettings({ ...settings, cellularSaverMode: next });
              cacheManager.setCellularSaver(next);
            }}
            title="Cellular Data Saver"
            className={`p-1.5 flex items-center gap-1 rounded-lg sm:rounded-xl text-[11px] font-medium border transition-all ${
              settings.cellularSaverMode
                ? 'bg-amber-500/15 text-amber-900 border-amber-300'
                : 'bg-slate-100 text-slate-600 border-slate-200/80 hover:bg-slate-200'
            }`}
          >
            <Wifi className={`w-3.5 h-3.5 ${settings.cellularSaverMode ? 'text-amber-700' : 'text-slate-500'}`} />
            <span className="hidden lg:inline">{settings.cellularSaverMode ? 'Data Saver: ON' : 'Data Saver'}</span>
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
        items={undoStack}
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
