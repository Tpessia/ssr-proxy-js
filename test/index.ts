import { LogLevel, SsrProxy, SsrProxyConfig } from 'ssr-proxy-js-local'; // ssr-proxy-js or ssr-proxy-js-local

const config: SsrProxyConfig = {
    port: 8081,
    hostname: '0.0.0.0',
    targetRoute: 'localhost:3000',
    log: { level: LogLevel.Info },
};

const ssrProxy = new SsrProxy(config);

ssrProxy.start();