import { getToken, clearToken } from './session';
import { getOfflineReviews, saveOfflineReview, removeOfflineReview } from './offlineQueue';
import type { PictureItem, ReviewRecord, AppStats, AppSettings, ImportResult, ReviewStatus, DashboardFilterParams } from '../types';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

class AuthError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'AuthError';
  }
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token && !url.includes('/api/auth/me')) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options?.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${url}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.location.href = `/yunohost/sso/?r=${encodeURIComponent(window.location.pathname)}`;
    throw new AuthError();
  }
  return res.json() as Promise<T>;
}

export async function logoutUser(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  clearToken();
}

export async function fetchPictureQueue(limit = 10, instance?: string): Promise<{ queue: PictureItem[]; totalPending: number; totalPictures: number; cacheSize: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (instance) params.set('instance', instance);
  return apiFetch(`/api/pictures/queue?${params.toString()}`);
}

export async function fetchNextPicture(instance?: string): Promise<{ picture: PictureItem | null; queueExhausted: boolean }> {
  const params = new URLSearchParams();
  if (instance) params.set('instance', instance);
  const qs = params.toString();
  return apiFetch(`/api/pictures/next${qs ? `?${qs}` : ''}`);
}

export async function importPictureIds(
  pictureIds: string[],
  instanceUrl?: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<ImportResult> {
  const batchSize = 200;
  let allAdded = 0;
  let allDuplicates = 0;
  let totalInDb = 0;
  const allAddedIds: string[] = [];

  for (let i = 0; i < pictureIds.length; i += batchSize) {
    const batch = pictureIds.slice(i, i + batchSize);
    const result = await apiFetch<ImportResult>('/api/pictures/import', {
      method: 'POST',
      body: JSON.stringify({ pictureIds: batch, instanceUrl }),
    });
    allAdded += result.added;
    allDuplicates += result.duplicatesSkipped;
    totalInDb = result.totalInDatabase;
    allAddedIds.push(...result.addedIds);
    onProgress?.(Math.min(i + batchSize, pictureIds.length), pictureIds.length);
  }

  return { added: allAdded, duplicatesSkipped: allDuplicates, totalInDatabase: totalInDb, addedIds: allAddedIds };
}

export async function fetchPanoramaxApiPictures(instanceUrl?: string, fetchLimit = 20): Promise<{ success: boolean; added: number; duplicatesSkipped: number; totalInDatabase: number }> {
  return apiFetch('/api/pictures/fetch-panoramax', {
    method: 'POST',
    body: JSON.stringify({ instanceUrl, limit: fetchLimit }),
  });
}

export async function submitPictureReview(
  pictureId: string,
  status: ReviewStatus,
  errorReason?: string,
  comment?: string,
  user?: { id: string; username: string },
  currentPicture?: PictureItem,
): Promise<{ success: boolean; review: ReviewRecord; picture: PictureItem }> {
  if (!navigator.onLine) {
    const review = saveOfflineReview({ pictureId, status, errorReason, comment });
    const now = new Date().toISOString();
    const nextStatus = status === 'ok' ? 'reviewed_ok' as const : 'flagged' as const;
    const synthReview: ReviewRecord = {
      id: review.id,
      pictureId,
      userId: user?.id || '',
      userName: user?.username || '',
      status,
      errorReason,
      comment,
      reviewedAt: now,
    };
    const synthPicture: PictureItem = {
      ...currentPicture!,
      status: nextStatus,
      reviewCount: (currentPicture?.reviewCount || 0) + 1,
      lastReviewedAt: now,
      lastErrorReason: errorReason,
      lastComment: comment,
      lastReviewer: user?.username,
    };
    return { success: true, review: synthReview, picture: synthPicture };
  }

  try {
    const result = await apiFetch<{ success: boolean; review: ReviewRecord; picture: PictureItem }>('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({ pictureId, status, errorReason, comment: comment?.trim() || undefined }),
    });
    return result;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const review = saveOfflineReview({ pictureId, status, errorReason, comment });
    const now = new Date().toISOString();
    const nextStatus = status === 'ok' ? 'reviewed_ok' as const : 'flagged' as const;
    const synthReview: ReviewRecord = {
      id: review.id,
      pictureId,
      userId: user?.id || '',
      userName: user?.username || '',
      status,
      errorReason,
      comment,
      reviewedAt: now,
    };
    const synthPicture: PictureItem = {
      ...currentPicture!,
      status: nextStatus,
      reviewCount: (currentPicture?.reviewCount || 0) + 1,
      lastReviewedAt: now,
      lastErrorReason: errorReason,
      lastComment: comment,
      lastReviewer: user?.username,
    };
    return { success: true, review: synthReview, picture: synthPicture };
  }
}

export async function undoPictureReview(reviewId?: string, pictureId?: string): Promise<{ success: boolean; removedReview: ReviewRecord; picture: PictureItem }> {
  if (reviewId?.startsWith('offline_')) {
    const reviews = getOfflineReviews();
    const review = reviews.find((r) => r.id === reviewId);
    removeOfflineReview(reviewId);
    if (review) {
      const removedReview: ReviewRecord = {
        id: review.id, pictureId: review.pictureId, userId: '', userName: '',
        status: review.status, errorReason: review.errorReason, comment: review.comment, reviewedAt: review.createdAt,
      };
      return { success: true, removedReview, picture: null as unknown as PictureItem };
    }
    return { success: true, removedReview: null as unknown as ReviewRecord, picture: null as unknown as PictureItem };
  }

  return apiFetch('/api/reviews/undo', {
    method: 'POST',
    body: JSON.stringify(reviewId ? { reviewId } : { pictureId }),
  });
}

export async function fetchReviewHistory(status?: string, search?: string): Promise<ReviewRecord[]> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  const qs = params.toString();
  const res = await apiFetch<{ reviews: ReviewRecord[] }>(`/api/reviews${qs ? `?${qs}` : ''}`);
  return res.reviews;
}

export async function fetchAppStats(): Promise<AppStats> {
  return apiFetch('/api/stats');
}

export async function fetchAppSettings(): Promise<AppSettings> {
  return apiFetch('/api/settings');
}

export async function updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return apiFetch('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function fetchDashboardPictures(params: DashboardFilterParams): Promise<{ pictures: PictureItem[]; totalCount: number; filteredCount: number }> {
  const sp = new URLSearchParams();
  if (params.status && params.status !== 'all') sp.set('status', params.status);
  if (params.search) sp.set('search', params.search);
  if (params.instance) sp.set('instance', params.instance);
  if (params.reason) sp.set('reason', params.reason);
  if (params.checkedOff && params.checkedOff !== 'all') sp.set('checkedOff', params.checkedOff);
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  return apiFetch(`/api/dashboard/pictures?${sp.toString()}`);
}

export async function togglePictureCheckoff(pictureIds: string[], checked: boolean): Promise<{ success: boolean; updatedCount: number }> {
  return apiFetch('/api/pictures/toggle-checkoff', {
    method: 'POST',
    body: JSON.stringify({ pictureIds, checked }),
  });
}

export async function deleteBatchPictures(pictureIds: string[]): Promise<{ success: boolean; removedCount: number; remainingPictures: number }> {
  return apiFetch('/api/pictures/delete-batch', {
    method: 'POST',
    body: JSON.stringify({ pictureIds }),
  });
}

export async function syncOfflineQueue(): Promise<{ syncedCount: number; failedCount: number }> {
  const reviews = getOfflineReviews();
  if (reviews.length === 0) return { syncedCount: 0, failedCount: 0 };

  let syncedCount = 0;
  let failedCount = 0;

  for (const review of reviews) {
    try {
      const res = await fetch(`${BASE}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          pictureId: review.pictureId,
          status: review.status,
          errorReason: review.errorReason,
          comment: review.comment,
        }),
      });
      if (res.ok) {
        removeOfflineReview(review.id);
        syncedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return { syncedCount, failedCount };
}

export function getProxyImageUrl(url: string): string {
  return `${BASE}/api/proxy-image?url=${encodeURIComponent(url)}`;
}
