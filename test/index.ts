import SsrProxy from 'ssr-proxy-js';

const ssrProxy = new SsrProxy({
    port: 8080,
    hostname: '0.0.0.0',
    targetRoute: 'localhost:3000',
});

ssrProxy.start();