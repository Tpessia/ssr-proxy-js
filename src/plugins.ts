import { SsrBuild } from './ssr-build';
import { SsrBuildConfig } from './types';

type Apply = 'serve' | 'build';
type Enforce = 'pre' | 'post' | undefined;

export const ssrBuildVitePlugin = (config: SsrBuildConfig, pluginOverride?: { event?: string, enforce?: Enforce, [key: string]: any; }) => {
  pluginOverride ||= {};
  const pluginEvent = pluginOverride.event || 'buildEnd'; // writeBundle, buildEnd, closeBundle
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
};