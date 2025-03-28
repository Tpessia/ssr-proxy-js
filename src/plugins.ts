import { SsrBuild } from './ssr-build';
import { SsrBuildConfig } from './types';

type Apply = 'serve' | 'build';
type Enforce = 'pre' | 'post' | undefined;
type Event = 'writeBundle' | 'buildEnd' | 'closeBundle' | (string & {});

export const ssrBuildVitePlugin = (config: SsrBuildConfig, pluginOverride?: { event?: Event, enforce?: Enforce, [key: string]: any; }) => {
  pluginOverride ||= {};
  const pluginEvent: Event = pluginOverride.event || 'buildEnd';
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