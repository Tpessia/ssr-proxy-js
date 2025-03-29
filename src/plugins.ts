// https://rollupjs.org/plugin-development/#writebundle
// https://vite.dev/guide/api-plugin

import { SsrBuild } from './ssr-build';
import { SsrBuildConfig } from './types';

type Apply = 'serve' | 'build';
type Enforce = 'pre' | 'post' | undefined;
type Order = 'pre' | 'post' | undefined;
type Event = 'writeBundle' | 'buildEnd' | 'closeBundle' | (string & {});

export const ssrBuildVitePlugin = (config: SsrBuildConfig, pluginOverride?: { apply?: Apply, enforce?: Enforce, [key: string]: any; }) => {
  return {
    name: 'ssr-build-js',
    apply: 'build' as Apply,
    // enforce: 'pre' as Enforce,
    writeBundle: {
      sequential: true,
      // order: 'pre' as Order,
      async handler(outputOptions: any, bundle: any) {
        const ssrBuild = new SsrBuild(config);
        const result = await ssrBuild.start();
        result.forEach(e => {
          const fileName = e.urlPath.replace(/^\/+/, '');
          const duplicate = Object.keys(bundle).find(e => e === fileName);
          if (duplicate) delete bundle[duplicate];
          (this as any).emitFile({ type: 'asset', fileName, source: e.text });
        });
      },
    },
    ...(pluginOverride || {}),
  };
};