/**
 * Host-realm entry for the generic Webhook Collector — trusted tier, webhook
 * mode. `onWebhook` maps one inbound payload to at most one event; the host's
 * webhook server (activity_webhook.rs) routes `POST /webhook` here.
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { mapWebhookPayload } from './webhookMap';

const module: ExtensionModule = {
  collectors: {
    webhook: {
      id: 'webhook',
      onWebhook: (payload, config) => Promise.resolve(mapWebhookPayload(payload, config)),
    },
  },
};

export default module;
