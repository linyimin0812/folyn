import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';

// Mock the heavy builtin hosts (TranslationPanel / PetInbox + the
// realm-mirror effects) so this test focuses purely on ExtensionToolApp's
// branch switching — the same discipline PetPanelApp.test.tsx applies to
// AiPanel. Each stub's root class name matches the contract its branch
// asserts on.
vi.mock('@/components/translation/TranslationToolHost', () => ({
  TranslationToolHost: () => <div className="translation-tool-host" />,
}));
vi.mock('./InboxToolHost', () => ({
  InboxToolHost: () => <div className="inbox-tool-host" />,
}));

import { ExtensionToolApp } from './ExtensionToolApp';

// The tool payload arrives via Rust `webview.eval` seeding
// `window.__extensionToolOpen` (the `extension-tool-open` CustomEvent itself
// carries no payload — its handler re-reads the window global). Tests seed
// the global directly before render, mirroring the "eval landed before
// mount" ordering; the switch test re-seeds + dispatches the CustomEvent to
// drive the "eval landed after mount" ordering.
interface ToolPayload {
  extensionId: string;
  toolId: string;
  entry: string;
  title: string;
}

const GLOBAL_KEY = '__extensionToolOpen';

function seedToolPayload(p: ToolPayload) {
  (window as unknown as Record<string, unknown>)[GLOBAL_KEY] = p;
}

function clearToolPayload() {
  delete (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
}

beforeEach(() => {
  clearToolPayload();
});

afterEach(() => {
  cleanup();
  clearToolPayload();
});

describe('ExtensionToolApp', () => {
  // Builtin payload (pet-panel search → petHostRouter →
  // open_extension_tool_window): React content, never the sandbox iframe.
  it('renders the builtin translation host (no iframe) for builtin:translation', () => {
    seedToolPayload({
      extensionId: 'builtin:translation',
      toolId: 'translation',
      entry: 'builtin',
      title: 'Translation',
    });
    const { container } = render(<ExtensionToolApp />);
    expect(container.querySelector('.translation-tool-host')).toBeTruthy();
    // The builtin branch must NOT render the sandboxed extension iframe.
    expect(container.querySelector('iframe')).toBeNull();
  });

  // Builtin inbox payload (action.open-inbox command →
  // open_extension_tool_window, PRD 09-19-inbox-command-popup): same React
  // branch as translation — the popup hosts PetInbox via InboxToolHost.
  it('renders the builtin inbox host (no iframe) for builtin:inbox', () => {
    seedToolPayload({
      extensionId: 'builtin:inbox',
      toolId: 'inbox',
      entry: 'builtin',
      title: 'Inbox',
    });
    const { container } = render(<ExtensionToolApp />);
    expect(container.querySelector('.inbox-tool-host')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.translation-tool-host')).toBeNull();
  });

  // Third-party payload: the origin-isolated sandbox iframe, never the
  // builtin React host.
  it('renders the sandboxed iframe for a third-party tool', () => {
    seedToolPayload({
      extensionId: 'carousel',
      toolId: 'main',
      entry: 'index.html',
      title: 'Carousel',
    });
    const { container } = render(<ExtensionToolApp />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    // Same URL shape as the main-window sandbox loader.
    expect(iframe!.getAttribute('src')).toBe(
      'folyn-extension://localhost/carousel/index.html',
    );
    expect(container.querySelector('.translation-tool-host')).toBeNull();
  });

  // Payload switch while the window stays mounted (reopen with a different
  // tool): the builtin host must UNMOUNT — which is exactly the path where
  // its listener effects hit the unmount race the `disposed` flag guards —
  // and the iframe takes over the body.
  it('switches from the builtin host to the iframe when a new payload arrives', async () => {
    seedToolPayload({
      extensionId: 'builtin:translation',
      toolId: 'translation',
      entry: 'builtin',
      title: 'Translation',
    });
    const { container } = render(<ExtensionToolApp />);
    expect(container.querySelector('.translation-tool-host')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();

    // Rust re-evals the open payload for a third-party tool: the window
    // global is swapped first, then the `extension-tool-open` CustomEvent
    // fires (the handler reads the global, not the event detail).
    seedToolPayload({
      extensionId: 'carousel',
      toolId: 'main',
      entry: 'index.html',
      title: 'Carousel',
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent('extension-tool-open'));
    });

    // The host unmounts (disposed-flag path) and the iframe appears.
    const iframe = await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(iframe.getAttribute('src')).toBe(
      'folyn-extension://localhost/carousel/index.html',
    );
    expect(container.querySelector('.translation-tool-host')).toBeNull();
  });
});
