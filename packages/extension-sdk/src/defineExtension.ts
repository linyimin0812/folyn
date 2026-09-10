/**
 * Dev helpers for extension authors: a manifest validator usable in extension
 * build/test, and a `defineExtension` type-guard for authoring a typed manifest.
 *
 * Runtime-free — safe to ship in the publishable SDK. The host's
 * `ExtensionHost.validateManifest` delegates here so extension and host share one
 * source of truth.
 */

import type { ExtensionManifest } from './types';

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)+$/;

/** Throw on invalid manifest. Strict-but-minimal; mirrors host install checks. */
export function validateManifest(manifest: ExtensionManifest): void {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest must be an object');
  }
  if (!manifest.id || !ID_RE.test(manifest.id)) {
    throw new Error(`manifest.id must be kebab-case, got: ${manifest.id}`);
  }
  if (!manifest.version) {
    throw new Error('manifest.version is required');
  }
  if (manifest.tier !== 'sandbox' && manifest.tier !== 'trusted') {
    throw new Error(`manifest.tier must be 'sandbox' | 'trusted', got: ${manifest.tier}`);
  }
  if (!manifest.main) {
    throw new Error('manifest.main is required');
  }
  if (manifest.tier === 'sandbox' && !manifest.html) {
    throw new Error('sandbox extensions require manifest.html');
  }
  if (manifest.permissions?.ai) {
    const { chat, agents, edit } = manifest.permissions.ai;
    if (chat !== undefined && typeof chat !== 'boolean') {
      throw new Error('permissions.ai.chat must be a boolean');
    }
    if (edit !== undefined && typeof edit !== 'boolean') {
      throw new Error('permissions.ai.edit must be a boolean');
    }
    if (agents !== undefined) {
      if (!Array.isArray(agents) || agents.some((a) => typeof a !== 'string' || !a)) {
        throw new Error('permissions.ai.agents must be a string[] of non-empty feature names');
      }
    }
  }
}

/**
 * Author a manifest with full type-checking against the SDK contract. Returns
 * the manifest unchanged (type-only narrowing) — useful so a extension's manifest
 * is validated at compile time and by `validateManifest` in its test step:
 *
 * ```ts
 * import { defineExtension, validateManifest } from 'folyn-extension-sdk';
 * export const manifest = defineExtension({ id: 'my-extension', ... });
 * validateManifest(manifest); // run in `test`
 * ```
 */
export function defineExtension<T extends ExtensionManifest>(manifest: T): T {
  validateManifest(manifest);
  return manifest;
}
