import { Stream } from 'stream';
import { CacheDeletion, CacheItem, InternalCacheItem } from './types';
import { streamToString } from './utils';

export class ProxyCache {
    private cache: Map<string, InternalCacheItem> = new Map<string, InternalCacheItem>();

    maxEntries: number;
    maxSize: number;
    expirationMs: number;

    constructor(maxEntries: number = 10, maxSize: number = 10 * 1024 * 1024, expirationMs: number = 5 * 60 * 1000) {
        this.maxEntries = maxEntries;
        this.maxSize = maxSize;
        this.expirationMs = expirationMs;
    }

    has(urlStr: string) {
        return this.cache.has(urlStr);
    }

    keys() {
        return this.cache.keys();
    }

    get(urlStr: string): CacheItem | null {
        const entry = this.cache.get(urlStr);
        if (!entry) return null;
        entry.hits++;
        return { text: entry.text, contentType: entry.contentType };
    }

    set(urlStr: string, text: string, contentType: string) {
        return this.cache.set(urlStr, { text, contentType, hits: 0, date: new Date() });
    }

    delete(urlStr: string) {
        return this.cache.delete(urlStr);
    }

    async pipe(urlStr: string, stream: Stream, contentType: string) {
        return await streamToString(stream).then(str => this.cache.set(urlStr, { text: str, contentType, hits: 0, date: new Date() }));
    }

    tryClear() {
        const $this = this;
        let cacheSize = 0;
        const entries = [...this.cache.entries()].sort((a, b) => b[1].hits - a[1].hits);

        const deleted: CacheDeletion[] = [];

        for (const i in entries) {
            const key = entries[i][0];
            const entry = entries[i][1];

            if (this.cache.has(key)) {
                cacheSize += cacheSize > this.maxSize ? cacheSize : Buffer.from(entry.text).length;

                const deleteBySize = cacheSize > this.maxSize;
                if (deleteBySize) deleteEntry(key, 'size');

                // delete by length
                const deleteByLength = this.cache.size > this.maxEntries;
                if (deleteByLength) deleteEntry(entries[this.maxEntries - +i][0], 'length');

                // delete by date
                const deleteByDate = new Date().getTime() - entry.date.getTime() > this.expirationMs;
                if (deleteByDate) deleteEntry(key, 'expired');
            }
        }

        return deleted;

        function deleteEntry(key: string, reason: string) {
            if ($this.delete(key)) deleted.push({ key, reason });
        }
    }
}