const os = require('os');
const path = require('path');
const { SsrProxy } = require('ssr-proxy-js-local'); // ssr-proxy-js or ssr-proxy-js-local

const BASE_PROXY_ROUTE = 'http://localhost:3000';
const STATIC_FILES_PATH = path.join(process.cwd(), 'public');
const LOGGING_PATH = path.join(os.tmpdir(), 'ssr-proxy/logs');

console.log(`\nLogging at: ${LOGGING_PATH}`);

const ssrProxy = new SsrProxy({
    httpPort: 8080,
    hostname: '0.0.0.0',
    targetRoute: BASE_PROXY_ROUTE,
    proxyOrder: ['SsrProxy', 'StaticProxy', 'HttpProxy'],
    failStatus: params => 404,
    // customError: err => err.toString(),
    // isBot: (method, url, headers) => true,
    ssr: {
        shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl) || !/\./.test(params.targetUrl)),
        browserConfig: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
        queryParams: [{
            key: 'headless',
            value: 'true',
        }],
        allowedResources: ['document', 'script', 'xhr', 'fetch'],
        waitUntil: 'networkidle0',
    },
    httpProxy: {
        shouldUse: params => true,
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
        enabled: true,
        shouldUse: params => params.proxyType === 'SsrProxy',
        maxEntries: 50,
        maxByteSize: 50 * 1024 * 1024, // 50MB
        expirationMs: 10 * 60 * 1000, // 10 minutes
        autoRefresh: {
            enabled: true,
            shouldUse: () => true,
            proxyOrder: ['SsrProxy'],
            initTimeoutMs: 5 * 1000, // 5 seconds
            intervalMs: 5 * 60 * 1000, // 5 minutes
            parallelism: 5,
            isBot: true,
            routes: [
                { method: 'GET', url: `${BASE_PROXY_ROUTE}/` },
                { method: 'GET', url: `${BASE_PROXY_ROUTE}/login` },
            ],
        },
    },
});

ssrProxy.start();



// Server

const express = require('express');
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/301', (req, res) => {
    res.redirect(301, '/');
});

app.get('/302', (req, res) => {
    res.redirect(302, '/');
});

app.listen(port, () => {
  console.log(`Express listening at http://localhost:${port}`);
});