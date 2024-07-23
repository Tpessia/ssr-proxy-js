#!/usr/bin/env node

// cd test && npx ssr-proxy-js-local

// npx ssr-proxy-js
// npx ssr-proxy-js -c ./ssr-proxy-js.config.json
// npx ssr-proxy-js --port=8080 --targetRoute=localhost:3000 --static.dirPath=./public --proxyOrder=SsrProxy --proxyOrder=StaticProxy --log.level=3

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const deepmerge = require('deepmerge');
const { SsrProxy } = require('../dist/index');

const argv = minimist(process.argv.slice(2));

const { _: argv_, c: argv_c, config: argv_config, ...argv_rest } = argv;
const explicitConfig = !!(argv_c || argv_config);

const options = { };
options.configPath = argv_c || argv_config || './ssr-proxy-js1.config.json';
options.configPath = path.resolve(process.cwd(), options.configPath);

try {
    if (options.configPath)
        options.configJson = fs.readFileSync(options.configPath, { encoding: 'utf8' });
} catch (err) {
    if (explicitConfig)
        logWarn(`Unable to find the config, looking for: ${options.configPath}`, err);
}

try {
    if (options.configJson) options.config = JSON.parse(options.configJson);
    else options.config = {};
} catch (err) {
    logWarn('Unable to parse the config', err);
}

options.config = deepmerge(options.config, argv_rest, {
    arrayMerge: (destArray, srcArray, opts) => srcArray,
});

if (isEmpty(options.config)) {
    logWarn('No config file or cli arguments found!');
}

const ssrProxy = new SsrProxy(options.config);
ssrProxy.start();

function logWarn(...msg) {
    if (!msg || !msg.length) return;
    msg[0] = '\x1b[33m' + msg[0];
    msg[msg.length - 1] += '\x1b[0m';
    console.log(...msg);
}

function isEmpty(obj) {
    return obj && Object.keys(obj).length === 0 && Object.getPrototypeOf(obj) === Object.prototype;
}