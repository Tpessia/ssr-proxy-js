import { SsrProxy, SsrProxyConfig } from 'ssr-proxy-js';

const config: SsrProxyConfig = {
    port: 8081,
    hostname: '0.0.0.0',
    targetRoute: 'localhost:3000',
    log: { level: 2 },
}

const ssrProxy = new SsrProxy(config);

ssrProxy.start();