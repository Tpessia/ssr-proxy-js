import { SsrBuild } from './ssr-build';
import { SsrBuildConfig } from './types';

type Apply = 'serve' | 'build';
type Enforce = 'pre' | 'post' | undefined;

export const ssrBuildVitePlugin = (config: SsrBuildConfig, pluginOverride?: any) => {
  return {
    name: 'ssr-build',
    apply: 'build' as Apply,
    enforce: 'post' as Enforce,
    writeBundle: async (opts: any, bundle: any) => {
      const ssrBuild = new SsrBuild(config);
      await ssrBuild.start();
    },
    ...(pluginOverride || {}),
  };
}