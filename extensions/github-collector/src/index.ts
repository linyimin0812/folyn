/**
 * Host-realm entry for the GitHub Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`github`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['github']`.
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { collectGithubEvents } from './githubEvents';

const module: ExtensionModule = {
  collectors: {
    github: {
      id: 'github',
      collect: collectGithubEvents,
    },
  },
};

export default module;
