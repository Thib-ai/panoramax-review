import type { PictureItem } from '../types';

const CACHE_NAME = 'panoramax-images-v1';

class CacheManager {
  private cachedUrls: Set<string> = new Set();
  private cellularSaverActive = false;
  private initPromise: Promise<void> | null = null;

  private async ensureInit() {
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    return this.initPromise;
  }

  private async init() {
    try {
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      for (const req of keys) {
        this.cachedUrls.add(req.url);
      }
    } catch {
      // Cache API not available
    }
  }

  async prefetchPictures(pictures: PictureItem[], maxCount = 10): Promise<number> {
    if (this.cellularSaverActive) return 0;
    await this.ensureInit();

    const limit = Math.min(maxCount, 500);
    const toFetch = pictures.slice(0, limit).filter((p) => !this.cachedUrls.has(p.sdUrl));
    if (toFetch.length === 0) return 0;

    let fetched = 0;
    const batchSize = 8;
    const shouldDelay = toFetch.length > 25;

    for (let i = 0; i < toFetch.length; i += batchSize) {
      if (this.cellularSaverActive) break;
      const batch = toFetch.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((pic) => this.fetchAndCache(pic.sdUrl))
      );
      fetched += results.filter((r) => r.status === 'fulfilled' && r.value).length;
      if (shouldDelay && i + batchSize < toFetch.length) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return fetched;
  }

  private async fetchAndCache(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(url, response.clone());
        this.cachedUrls.add(url);
        return true;
      }
    } catch {
      // CORS or network error - try proxy
    }

    try {
      const proxyUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/proxy-image?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(proxyUrl, response.clone());
        this.cachedUrls.add(url);
        return true;
      }
    } catch {
      // Both failed
    }
    return false;
  }

  isCached(url: string): boolean {
    return this.cachedUrls.has(url);
  }

  async getCachedCount(): Promise<number> {
    await this.ensureInit();
    return this.cachedUrls.size;
  }

  async clearCache(): Promise<void> {
    try {
      await caches.delete(CACHE_NAME);
      this.cachedUrls.clear();
    } catch {
      // not available
    }
  }

  setCellularSaver(active: boolean) {
    this.cellularSaverActive = active;
  }

  getCellularSaver(): boolean {
    return this.cellularSaverActive;
  }
}

export const cacheManager = new CacheManager();
