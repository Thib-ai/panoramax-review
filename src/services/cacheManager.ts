import type { PictureItem } from '../types';

const CACHE_NAME = 'panoramax-images-v1';

class CacheManager {
  private cachedUrls: Set<string> = new Set();
  // Insertion-order list mirroring `cachedUrls`. Used to evict the oldest
  // entries when the cache exceeds the configured limit. The Cache API's
  // `keys()` returns entries in insertion order, so on init we get the
  // historical order for free; thereafter we maintain it on add/delete.
  private cachedUrlsOrder: string[] = [];
  private cellularSaverActive = false;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private listeners: Set<(count: number) => void> = new Set();
  // Serializes prefetch runs so that two concurrent callers can't both
  // schedule downloads beyond the limit before either enforceLimit runs.
  private prefetchChain: Promise<unknown> = Promise.resolve();

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
        this.cachedUrlsOrder.push(req.url);
      }
    } catch {
      // Cache API not available
    }
    this.initialized = true;
    this.notify();
  }

  private notify() {
    const count = this.cachedUrls.size;
    this.listeners.forEach((l) => l(count));
  }

  subscribe(listener: (count: number) => void): () => void {
    this.listeners.add(listener);
    if (this.initialized) {
      // Push the real count immediately if init has already completed.
      listener(this.cachedUrls.size);
    }
    // If init is still in flight, the listener will be notified when init()
    // calls notify() — so the subscriber never needs a separate fetch and
    // never sees a stale 0 unless the cache is genuinely empty.
    return () => this.listeners.delete(listener);
  }

  async evictUrls(urls: string[]): Promise<number> {
    if (urls.length === 0) return 0;
    await this.ensureInit();
    let removed = 0;
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const url of urls) {
        const deleted = await cache.delete(url);
        if (deleted) removed++;
        const proxyUrl = this.proxyUrlFor(url);
        const deletedProxy = await cache.delete(proxyUrl);
        if (deletedProxy) removed++;
      }
      this.removeFromOrder(urls);
      this.removeFromOrder(urls.map((u) => this.proxyUrlFor(u)));
    } catch {
      // Cache API not available
    }
    return removed;
  }

  private removeFromOrder(urls: string[]) {
    const toRemove = new Set(urls);
    this.cachedUrls = new Set([...this.cachedUrls].filter((u) => !toRemove.has(u)));
    this.cachedUrlsOrder = this.cachedUrlsOrder.filter((u) => !toRemove.has(u));
    this.notify();
  }

  private proxyUrlFor(url: string): string {
    return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/proxy-image?url=${encodeURIComponent(url)}`;
  }

  async prefetchPictures(pictures: PictureItem[], maxCount = 10): Promise<number> {
    if (this.cellularSaverActive) return 0;
    await this.ensureInit();

    // Serialize against any in-flight prefetch so two concurrent callers
    // (e.g. SettingsModal save + a background refill) don't both download
    // up to `maxCount` images before either enforceLimit runs and the
    // cache balloons to ~2x the configured limit.
    const prev = this.prefetchChain;
    let release!: () => void;
    this.prefetchChain = new Promise<void>((res) => { release = res; });
    await prev;

    try {
      // Re-check the limit against the *current* cache size now that any
      // prior prefetch has settled. We only fetch the shortfall.
      const limit = Math.min(maxCount, 500);
      const shortfall = Math.max(0, limit - this.cachedUrlsOrder.length);
      if (shortfall === 0) return 0;
      const candidates = pictures
        .slice(0, limit)
        .filter((p) => !this.cachedUrls.has(p.sdUrl))
        .slice(0, shortfall);
      if (candidates.length === 0) return 0;

      let fetched = 0;
      const batchSize = 8;
      const shouldDelay = candidates.length > 25;

      for (let i = 0; i < candidates.length; i += batchSize) {
        if (this.cellularSaverActive) break;
        const batch = candidates.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((pic) => this.fetchAndCache(pic.sdUrl))
        );
        fetched += results.filter((r) => r.status === 'fulfilled' && r.value).length;
        if (shouldDelay && i + batchSize < candidates.length) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      return fetched;
    } finally {
      release();
    }
  }

  private async fetchAndCache(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(url, response.clone());
        this.addUrl(url);
        return true;
      }
    } catch {
      // CORS or network error - try proxy
    }

    try {
      const proxyUrl = this.proxyUrlFor(url);
      const response = await fetch(proxyUrl);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(proxyUrl, response.clone());
        this.addUrl(proxyUrl);
        return true;
      }
    } catch {
      // Both failed
    }
    return false;
  }

  private addUrl(url: string) {
    if (!this.cachedUrls.has(url)) {
      this.cachedUrls.add(url);
      this.cachedUrlsOrder.push(url);
    }
    this.notify();
  }

  /**
   * Evict the oldest cached entries until the cache contains at most
   * `maxCount` entries. Called after each prefetch to keep the on-disk
   * cache bounded by the configured `cacheSize` setting. Returns the
   * number of entries removed.
   */
  async enforceLimit(maxCount: number): Promise<number> {
    if (maxCount <= 0) return 0;
    await this.ensureInit();
    if (this.cachedUrlsOrder.length <= maxCount) return 0;
    const toEvict = this.cachedUrlsOrder.slice(0, this.cachedUrlsOrder.length - maxCount);
    if (toEvict.length === 0) return 0;
    let removed = 0;
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const url of toEvict) {
        if (await cache.delete(url)) removed++;
        this.cachedUrls.delete(url);
      }
      this.cachedUrlsOrder = this.cachedUrlsOrder.slice(toEvict.length);
      this.notify();
    } catch {
      // Cache API not available
    }
    return removed;
  }

  isCached(url: string): boolean {
    if (this.cachedUrls.has(url)) return true;
    return this.cachedUrls.has(this.proxyUrlFor(url));
  }

  async isUrlCached(url: string): Promise<boolean> {
    await this.ensureInit();
    if (this.isCached(url)) return true;
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url) || await cache.match(this.proxyUrlFor(url));
      if (hit) {
        this.cachedUrls.add(url);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  async getCachedPictureUrls(urls: string[]): Promise<Set<string>> {
    await this.ensureInit();
    const result = new Set<string>();
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const url of urls) {
        if (this.cachedUrls.has(url) || this.cachedUrls.has(this.proxyUrlFor(url))) {
          result.add(url);
          continue;
        }
        const hit = await cache.match(url) || await cache.match(this.proxyUrlFor(url));
        if (hit) {
          this.cachedUrls.add(url);
          result.add(url);
        }
      }
    } catch { /* ignore */ }
    return result;
  }

  async getCachedCount(): Promise<number> {
    await this.ensureInit();
    return this.cachedUrls.size;
  }

  /** Kick off cache enumeration eagerly (e.g. on app boot). Safe to call repeatedly. */
  warmUp(): Promise<void> {
    return this.ensureInit();
  }

  async clearCache(): Promise<void> {
    try {
      await caches.delete(CACHE_NAME);
      this.cachedUrls.clear();
      this.cachedUrlsOrder = [];
      this.notify();
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
