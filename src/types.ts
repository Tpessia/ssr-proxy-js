import { BrowserConnectOptions, BrowserLaunchArgumentOptions, LaunchOptions, Product } from 'puppeteer';
import { Stream } from 'stream';

// SSR Proxy

export enum ProxyType {
    SsrProxy = 'SsrProxy',
    HttpProxy = 'HttpProxy',
    StaticProxy = 'StaticProxy',
}

export interface SsrRenderResult {
    text?: string;
    error?: string;
    ttRenderMs: number;
}

export interface ProxyResult {
    text?: string;
    stream?: Stream;
    contentType?: string;
    error?: any;
    headers?: any;
}

export interface ProxyParams {
    isBot: boolean;
    sourceUrl: string;
    targetUrl: string;
}

export interface ProxyTypeParams extends ProxyParams {
    proxyType: ProxyType;
}

export type SsrBrowerConfig = LaunchOptions & BrowserLaunchArgumentOptions & BrowserConnectOptions & {
    product?: Product;
    extraPrefsFirefox?: Record<string, unknown>;
};

/**
 * Proxy config
 * @public
 */
export interface SsrProxyConfig {
    /**
     * Proxy server port
     * @defaultValue 8080
     */
    port?: number;
    hostname?: string,
    targetRoute?: string;
    proxyOrder?: ProxyType[];
    failStatus?: (params: ProxyTypeParams) => number;
    cache?: {
        enabled?: boolean;
        shouldUse?: (params: ProxyTypeParams) => boolean;
        maxEntries?: number;
        maxByteSize?: number;
        expirationMs?: number;
        autoRenovation?: {
            enabled?: boolean;
            shouldUse?: () => boolean;
            proxyOrder?: ProxyType[];
            initTimeoutMs?: number;
            intervalMs?: number;
            parallelism?: number;
            routes?: {
                method: string,
                url: string,
                headers?: any,
            }[];
            isBot?: boolean;
        };
    };
    ssr?: {
        shouldUse?: (params: ProxyParams) => boolean;
        browserConfig?: SsrBrowerConfig;
    };
    httpProxy?: {
        shouldUse?: (params: ProxyParams) => boolean;
    };
    static?: {
        shouldUse?: (params: ProxyParams) => boolean;
        filesPath?: string;
    };
    log?: {
        level?: number;
        console?: {
            enabled?: boolean;
        };
        file?: {
            enabled?: boolean;
            dirPath?: string;
        };
    };
}

// Proxy Cache

export interface CacheItem {
    text: string;
    contentType: string;
}

export interface CacheDeletion {
    key: string;
    reason: string;
}

export interface InternalCacheItem {
    text: string;
    contentType: string;
    hits: number;
    date: Date;
}

// Logger

export enum LogLevel {
    None = 0,
    Error = 1,
    Info = 2,
    Debug = 3
}