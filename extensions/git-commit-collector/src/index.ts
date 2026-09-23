/**
 * Host-realm entry for the Git Commit Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`git-commit`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['git-commit']`.
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { collectGitCommits } from './gitCommit';

const module: ExtensionModule = {
  collectors: {
    'git-commit': {
      id: 'git-commit',
      collect: collectGitCommits,
    },
  },
};

export default module;
