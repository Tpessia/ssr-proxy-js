import { SsrBuild } from './ssr-build';
import { SsrBuildConfig } from './types';

export const ssrBuildVitePlugin = (config: SsrBuildConfig) => {
  return {
    name: 'ssr-build',
    apply: 'build',
    enforce: 'post',
    writeBundle: async (opts: any, bundle: any) => {
      const ssrBuild = new SsrBuild(config);
      await ssrBuild.start();
    },
  };
}