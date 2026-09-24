/**
 * Host-realm entry for the Window Activity Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`window-activity`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['window-activity']`.
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { collectWindowActivity } from './windowActivity';

const module: ExtensionModule = {
  collectors: {
    'window-activity': {
      id: 'window-activity',
      collect: collectWindowActivity,
    },
  },
};

export default module;
