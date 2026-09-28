/**
 * Host-realm entry for the Email Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`email`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['email']`.
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { collectEmailEvents } from './emailEvents';

const module: ExtensionModule = {
  collectors: {
    email: {
      id: 'email',
      collect: collectEmailEvents,
    },
  },
};

export default module;
