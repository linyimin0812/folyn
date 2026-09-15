import type { ExtensionModule } from 'folyn-extension-sdk';
import { GithubJsdelivrForm } from './GithubJsdelivrForm';
import { isConfigured, uploadImage, uploadHtml } from './upload';

/**
 * Trusted ExtensionModule. The host's `storageProviderAdapter` resolves the
 * entry-refs in `contributes.storageProviders[]` (`form` / `isConfigured` /
 * `uploadImage`) against this map.
 */
const module: ExtensionModule = {
  storageProviders: {
    form: GithubJsdelivrForm,
    isConfigured,
    uploadImage,
    uploadHtml,
  },
};

export default module;
