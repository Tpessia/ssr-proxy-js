const os = require('os');
const path = require('path');
const SsrProxy = require('ssr-proxy-js');

console.log('SsrProxy',SsrProxy)

const BASE_PROXY_ROUTE = 'http://localhost:3000';
const STATIC_FILES_PATH = '../dist';

const loggingPath = path.join(os.tmpdir(), 'ssr-proxy/logs');

console.log(`Logging at: ${loggingPath}`);

const ssrProxy = new SsrProxy.default({ // TODO: fix default
    port: 8080,
    hostname: '0.0.0.0',
    targetRoute: BASE_PROXY_ROUTE,
    proxyOrder: ['SsrProxy', 'StaticProxy', 'HttpProxy'],
    failStatus: params => 404,
    cache: {
        enabled: true,
        shouldUse: params => params.proxyType === 'SsrProxy',
        maxEntries: 50,
        maxByteSize: 50 * 1024 * 1024, // 50MB
        expirationMs: 10 * 60 * 1000, // 10 minutes
        autoRenovation: {
            enabled: true,
            shouldUse: () => true,
            proxyOrder: ['SsrProxy'],
            initTimeoutMs: 5 * 1000, // 5 seconds
            intervalMs: 5 * 60 * 1000, // 4 minutes
            parallelism: 5,
            routes: [
                { method: 'GET', url: `http://${BASE_PROXY_ROUTE}/` },
                { method: 'GET', url: `http://${BASE_PROXY_ROUTE}/login` },
            ],
            isBot: true,
        },
    },
    ssr: {
        shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl) || !/\./.test(params.targetUrl)),
        browserConfig: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
    },
    httpProxy: {
        shouldUse: params => true,
    },
    static: {
        shouldUse: params => true,
        filesPath: STATIC_FILES_PATH,
    },
    log: {
        level: 3,
        console: {
            enabled: true,
        },
        file: {
            enabled: true,
            dirPath: path.join(os.tmpdir(), 'ssr-proxy/logs'),
        },
    },
});

ssrProxy.start();