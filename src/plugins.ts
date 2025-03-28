import { SsrBuild } from './ssr-build';
import { SsrBuildConfig } from './types';

type Apply = 'serve' | 'build';
type Enforce = 'pre' | 'post' | undefined;

export const ssrBuildVitePlugin = (config: SsrBuildConfig, pluginEvent?: string, pluginOverride?: any) => {
  pluginEvent ||= 'writeBundle';
  return {
    name: 'ssr-build',
    apply: 'build' as Apply,
    enforce: 'post' as Enforce,
    [pluginEvent]: async () => {
      const ssrBuild = new SsrBuild(config);
      await ssrBuild.start();
    },
    ...(pluginOverride || {}),
  };
}