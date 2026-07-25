import type { ReviewStatus, OfflineReview, PictureItem, AppStats } from '../types';

const QUEUE_KEY = 'panoramax_offline_reviews_queue';
const CACHED_QUEUE_KEY = 'panoramax_cached_picture_queue';
const CACHED_STATS_KEY = 'panoramax_cached_app_stats';

export function saveOfflineReview(data: { pictureId: string; status: ReviewStatus; errorReason?: string; comment?: string }): OfflineReview {
  const queue = getOfflineReviews();
  const existing = queue.findIndex((r) => r.pictureId === data.pictureId);
  const review: OfflineReview = {
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pictureId: data.pictureId,
    status: data.status,
    errorReason: data.errorReason,
    comment: data.comment,
    createdAt: new Date().toISOString(),
  };
  if (existing >= 0) {
    queue[existing] = review;
  } else {
    queue.push(review);
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return review;
}

export function removeOfflineReview(id: string) {
  const queue = getOfflineReviews().filter((r) => r.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getOfflineReviews(): OfflineReview[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function getOfflineCount(): number {
  return getOfflineReviews().length;
}

export function clearOfflineReviews() {
  localStorage.removeItem(QUEUE_KEY);
}

export function cachePictureQueue(data: PictureItem[]) {
  localStorage.setItem(CACHED_QUEUE_KEY, JSON.stringify(data));
}

export function getCachedPictureQueue(): PictureItem[] | null {
  try {
    return JSON.parse(localStorage.getItem(CACHED_QUEUE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function cacheStats(stats: AppStats) {
  localStorage.setItem(CACHED_STATS_KEY, JSON.stringify(stats));
}

export function getCachedStats(): AppStats | null {
  try {
    return JSON.parse(localStorage.getItem(CACHED_STATS_KEY) || 'null');
  } catch {
    return null;
  }
}
