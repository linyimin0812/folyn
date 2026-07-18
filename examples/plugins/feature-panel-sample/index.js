// Feature Panel Sample — trusted-tier plugin (in-process).
//
// Demonstrates the `contributes.features[]` contribution point: a React
// component mounted into the sidebar (left activity-bar slot). The panel is a
// tiny scratchpad — typed text stays in component state for the session. The
// "Insert into doc" button writes the scratchpad into the active markdown doc
// via the in-process editor store (trusted tier = direct store access, no
// postMessage RPC).
//
// This module is `import()`-ed into the host React realm (see
// `trustedLoader.ts`). It MUST be a self-contained ESM bundle at module-
// evaluation time — relative imports do not resolve from a blob URL, and
// remote imports are blocked by CSP. To keep this example dependency-free
// (no bundler step), React + the editor store are imported LAZILY inside the
// component / command handlers, resolving against the host realm's already-
// loaded modules at render/call time. A real-world trusted plugin that wants
// top-level React imports MUST bundle its deps (Vite/Rollup/esbuild) so the
// blob-URL `import()` is self-contained. See `docs/plugin-development.md`
// "Trusted tier bundling".
//
// Export contract (see contributionAdapters.ts `PluginModule`):
//   - `features` : Record<entry-ref, React component>   ← used here
//   - `commands` : Record<entry-ref, () => void | Promise<void>>
//   - `activate` / `deactivate` : optional lifecycle hooks

/**
 * Notes panel — a minimal sidebar scratchpad. Renders a textarea + an "Insert
 * into doc" button. State is component-local (not persisted); the example
 * focuses on the mounting path, not persistence.
 */
function NotesPanel() {
  const React = _loadReact();
  const { createElement: h, useState } = React;

  const [text, setText] = useState('');

  async function insertIntoDoc() {
    try {
      // Lazy import — resolved against the host realm at call time. Using a
      // variable specifier so Vite does not statically resolve the bare
      // specifier at build/test time.
      const storeSpec = '@/store/editorStore';
      const mod = await import(/* @vite-ignore */ storeSpec);
      const useEditorStore = mod.useEditorStore;
      const store = useEditorStore.getState();
      const activeTab = store.tabs.find(function (t) {
        return t.id === store.activeTabId;
      });
      if (!activeTab) {
        console.warn('[feature-panel-sample] no active tab to insert into');
        return;
      }
      const block = `\n\n${text}\n`;
      store.updateTabContent(activeTab.id, activeTab.content + block);
      setText('');
    } catch (err) {
      console.error('[feature-panel-sample] insert failed:', err);
    }
  }

  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '8px',
        gap: '8px',
        boxSizing: 'border-box',
      },
    },
    [
      h(
        'div',
        {
          key: 'title',
          style: {
            fontSize: '12px',
            color: 'var(--t2, #8a8f98)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          },
        },
        'Notes (sample plugin)',
      ),
      h('textarea', {
        key: 'ta',
        value: text,
        onChange: function (e) {
          setText(e.target.value);
        },
        placeholder: 'Type a note, then click Insert…',
        style: {
          flex: 1,
          resize: 'none',
          border: '1px solid var(--brd, #2a2a2a)',
          background: 'var(--panel, #1e1e1e)',
          color: 'var(--t1, #e6e6e6)',
          borderRadius: '4px',
          padding: '6px',
          fontSize: '13px',
          fontFamily: 'inherit',
          outline: 'none',
        },
      }),
      h(
        'button',
        {
          key: 'btn',
          onClick: insertIntoDoc,
          disabled: !text.trim(),
          style: {
            alignSelf: 'flex-start',
            padding: '4px 10px',
            border: '1px solid var(--brd, #2a2a2a)',
            background: 'var(--accdim, #2a2a3a)',
            color: 'var(--acc, #6366f1)',
            borderRadius: '4px',
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            fontSize: '12px',
          },
        },
        'Insert into doc',
      ),
    ],
  );
}

/**
 * Command handler: open the notes panel by setting editorStore.activePanel to
 * the panel id. The registerBuiltinPanels mirror propagates it to
 * featurePanelStore, which makes ActivityBar + Sidebar switch. The manifest
 * `permissions.vault.insertContent` declaration documents the intent for
 * future capability auditing (the button in the panel uses it).
 */
async function openNotesPanelCommand() {
  try {
    const storeSpec = '@/store/editorStore';
    const mod = await import(/* @vite-ignore */ storeSpec);
    const useEditorStore = mod.useEditorStore;
    useEditorStore.getState().setActivePanel('notes-panel');
  } catch (err) {
    console.error('[feature-panel-sample] open-notes-panel failed:', err);
  }
}

/**
 * Best-effort React loader. A production trusted plugin should bundle React
 * so the blob-URL `import()` is self-contained. See `docs/plugin-development.md`
 * "Trusted tier bundling".
 */
function _loadReact() {
  if (typeof window !== 'undefined' && window.React) {
    return window.React;
  }
  throw new Error(
    '[feature-panel-sample] React not available — trusted plugins must bundle React or the host must expose window.React',
  );
}

// ── Named exports (the PluginModule contract) ────────────────────────────────

export const features = {
  'notes-panel': NotesPanel,
};

export const commands = {
  'open-notes-panel': openNotesPanelCommand,
};

export function activate() {
  // Optional lifecycle hook. Called once when the plugin is activated.
  console.info('[feature-panel-sample] activated');
}

export function deactivate() {
  console.info('[feature-panel-sample] deactivated');
}
