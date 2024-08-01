const os = require('os');
const path = require('path');
const { SsrProxy } = require('ssr-proxy-js-local'); // ssr-proxy-js or ssr-proxy-js-local

const BASE_PROXY_PORT = '8080';
const BASE_PROXY_ROUTE = `http://localhost:${BASE_PROXY_PORT}`;
const STATIC_FILES_PATH = path.join(process.cwd(), 'public');
const LOGGING_PATH = path.join(os.tmpdir(), 'ssr-proxy/logs');

console.log(`\nLogging at: ${LOGGING_PATH}`);

const ssrProxy = new SsrProxy({
    httpPort: 8081,
    hostname: '0.0.0.0',
    targetRoute: BASE_PROXY_ROUTE,
    proxyOrder: ['SsrProxy', 'StaticProxy', 'HttpProxy'],
    isBot: (method, url, headers) => true,
    failStatus: params => 404,
    customError: err => err.toString(),
    ssr: {
        shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl.pathname) || !/\./.test(params.targetUrl.pathname)),
        browserConfig: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], timeout: 60000 },
        queryParams: [{ key: 'headless', value: 'true' }],
        allowedResources: ['document', 'script', 'xhr', 'fetch'],
        waitUntil: 'networkidle0',
        timeout: 60000,
    },
    httpProxy: {
        shouldUse: params => true,
        timeout: 60000,
    },
    static: {
        shouldUse: params => true,
        dirPath: STATIC_FILES_PATH,
        useIndexFile: path => path.endsWith('/'),
        indexFile: 'index.html',
    },
    log: {
        level: 3,
        console: {
            enabled: true,
        },
        file: {
            enabled: true,
            dirPath: LOGGING_PATH,
        },
    },
    cache: {
        shouldUse: params => params.proxyType === 'SsrProxy',
        maxEntries: 50,
        maxByteSize: 50 * 1024 * 1024, // 50MB
        expirationMs: 25 * 60 * 60 * 1000, // 25h
        autoRefresh: {
            enabled: true,
            shouldUse: () => true,
            proxyOrder: ['SsrProxy'],
            initTimeoutMs: 5 * 1000, // 5s
            intervalCron: '0 0 3 * * *', // every day at 3am
            intervalTz: 'Etc/UTC',
            retries: 3,
            parallelism: 5,
            isBot: true,
            routes: [
                { method: 'GET', url: '/' },
                { method: 'GET', url: '/login' },
            ],
        },
    },
});

ssrProxy.start();



// Server

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/301', (req, res) => {
    res.redirect(301, '/');
});

app.get('/302', (req, res) => {
    res.redirect(302, '/');
});

app.listen(BASE_PROXY_PORT, () => {
  console.log(`Express listening at http://localhost:${BASE_PROXY_PORT}`);
});