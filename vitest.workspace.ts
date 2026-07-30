import { defineWorkspace } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = __dirname;
const setupFile = path.resolve(root, 'test/setup.ts');

const tauriAlias = {
  '@tauri-apps/plugin-fs': path.resolve(root, 'test/mocks/@tauri-apps/plugin-fs.ts'),
  '@tauri-apps/plugin-shell': path.resolve(root, 'test/mocks/@tauri-apps/plugin-shell.ts'),
  '@tauri-apps/plugin-dialog': path.resolve(root, 'test/mocks/@tauri-apps/plugin-dialog.ts'),
  '@tauri-apps/plugin-clipboard-manager': path.resolve(root, 'test/mocks/@tauri-apps/plugin-clipboard-manager.ts'),
  '@tauri-apps/api/core': path.resolve(root, 'test/mocks/@tauri-apps/api/core.ts'),
  '@tauri-apps/api/path': path.resolve(root, 'test/mocks/@tauri-apps/api/path.ts'),
  '@tauri-apps/api/event': path.resolve(root, 'test/mocks/@tauri-apps/api/event.ts'),
};

export default defineWorkspace([
  {
    test: {
      name: 'desktop',
      environment: 'jsdom',
      root: path.resolve(root, 'apps/desktop'),
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      setupFiles: [setupFile, path.resolve(root, 'test/setup.desktop.ts')],
      server: {
        deps: {
          // Eagerly-loaded file-type handlers pull in @excalidraw, whose
          // transitive roughjs import needs Vite's resolver (not Node's).
          inline: [/@excalidraw\//, /roughjs/],
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(root, 'apps/desktop/src'),
        ...tauriAlias,
      },
    },
  },
  {
    test: {
      name: 'cli-adapter',
      environment: 'jsdom',
      root: path.resolve(root, 'packages/cli-adapter'),
      include: ['**/*.test.ts'],
      setupFiles: [setupFile],
    },
    resolve: { alias: tauriAlias },
  },
  {
    test: {
      name: 'container-plugins',
      environment: 'jsdom',
      root: path.resolve(root, 'packages/container-plugins'),
      include: ['**/*.test.ts'],
      setupFiles: [setupFile],
    },
    resolve: { alias: tauriAlias },
  },
  {
    test: {
      name: 'vault-provider',
      environment: 'jsdom',
      root: path.resolve(root, 'packages/vault-provider'),
      include: ['**/*.test.ts'],
      setupFiles: [setupFile],
    },
    resolve: { alias: tauriAlias },
  },
  {
    test: {
      name: 'plugin-host',
      environment: 'jsdom',
      root: path.resolve(root, 'packages/plugin-host'),
      include: ['**/*.test.ts'],
      setupFiles: [setupFile],
    },
    resolve: { alias: tauriAlias },
  },
  {
    test: {
      name: 'plugin-graphviz',
      environment: 'jsdom',
      root: path.resolve(root, 'plugins/plugin-graphviz'),
      include: ['src/**/*.test.ts'],
      setupFiles: [setupFile],
    },
    resolve: { alias: tauriAlias },
  },
]);
