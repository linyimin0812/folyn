import { createContext } from 'react';

/**
 * Resolves an image reference found in a markdown document (`![](a.png)`) to
 * a URL the preview can load. Provided when the document does not live on
 * disk — an extension showing a remote file supplies one, so relative
 * references load from where the document really lives. Resolves to
 * `undefined` when the reference cannot be loaded.
 */
export type AssetResolver = (ref: string) => Promise<string | undefined>;

export const AssetResolverContext = createContext<AssetResolver | null>(null);
