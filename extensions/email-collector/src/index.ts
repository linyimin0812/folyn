/**
 * Host-realm entry for the Email Collector — trusted tier, poll mode.
 *
 * Exports the collector impl under the manifest's `contributes.collectors[].id`
 * key (`email`); the host's collector adapter + poll runtime resolve
 * `collect` through `module.collectors['email']`, and the collector's settings
 * card mounts `configForm`.
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { collectEmailEvents } from './emailEvents';
import { EmailConfigForm } from './EmailConfigForm';

const module: ExtensionModule = {
  collectors: {
    email: {
      id: 'email',
      collect: collectEmailEvents,
      configForm: EmailConfigForm,
    },
  },
};

export default module;
