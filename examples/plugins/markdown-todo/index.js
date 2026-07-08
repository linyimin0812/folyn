// Markdown Todo — trusted-tier plugin (in-process).
//
// This module is `import()`-ed into the host React realm (see
// `trustedLoader.ts`). It MUST be a self-contained ESM bundle at module-
// evaluation time — relative imports do not resolve from a blob URL, and
// remote imports are blocked by CSP. To keep this example dependency-free
// (no bundler step), we move all bare-specifier imports (`react`,
// `@/store/editorStore`) INSIDE the functions that need them. The module
// therefore loads cleanly via blob-URL `import()`; the React + store
// resolution happens lazily at render / command-run time, against the host
// realm's already-loaded modules.
//
// A real-world trusted plugin that wants top-level React imports MUST bundle
// its deps (Vite/Rollup/esbuild) so the blob-URL `import()` is self-
// contained. See `docs/plugin-development.md` "Trusted tier bundling".
//
// Export contract (see contributionAdapters.ts `PluginModule`):
//   - `containers` : Record<entry-ref, React component>
//   - `commands`   : Record<entry-ref, () => void | Promise<void>>
//   - `handlers`   : Record<entry-ref, FileTypeHandler>   (none here)
//   - `features`   : Record<entry-ref, React component>   (none here)
//   - `activate` / `deactivate` : optional lifecycle hooks
//
// Entry-refs in the manifest (`component: 'todo'`, `run: 'insert-todo'`)
// index into these maps.

/**
 * Todo container renderer. Reads the directive's children text (one
 * `- [ ] item` per line) and renders an interactive checklist callout.
 *
 * `children` is the raw text between `:::todo` and `:::`. We parse it into
 * items and render checkboxes; state is local (not persisted back to the
 * file — a future enhancement).
 *
 * React is imported lazily so the module loads without a top-level dep.
 */
function TodoContainer(props) {
  // Lazy import — resolves against the host realm's loaded React at render
  // time. In production this requires either (a) the host exposing React on
  // the module graph reachable from blob URLs, or (b) the plugin bundling
  // React. See the dev guide.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = _loadReact();
  const { createElement: h, useState, useEffect } = React;

  const children = props.children ?? '';
  const text = typeof children === 'string' ? children : String(children);
  const items = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ['));

  const [checked, setChecked] = useState(() => items.map(() => false));

  // Reset checked state when the children text changes (user edits the body).
  useEffect(() => {
    setChecked(items.map(() => false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return h(
    'div',
    {
      className: 'docmd-todo',
      style: {
        border: '1px solid var(--brd, #2a2f3a)',
        borderLeft: '3px solid var(--acc, #3a6ef0)',
        borderRadius: '6px',
        padding: '10px 12px',
        margin: '12px 0',
        background: 'var(--surf2, #1a1f2a)',
      },
    },
    [
      h('div', { key: 'h', style: { fontWeight: 600, marginBottom: 6, color: 'var(--t1, #e6e6e6)' } }, '✅ Todo'),
      items.length === 0
        ? h('div', { key: 'empty', style: { color: 'var(--t3, #8a8f98)', fontSize: 12 } }, 'No items')
        : h(
            'ul',
            { key: 'list', style: { listStyle: 'none', padding: 0, margin: 0 } },
            items.map((line, i) => {
              const label = line.replace(/^- \[.\]\s*/, '');
              return h(
                'li',
                { key: i, style: { display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' } },
                [
                  h('input', {
                    key: 'cb',
                    type: 'checkbox',
                    checked: checked[i] || false,
                    onChange: function () {
                      return setChecked(function (prev) {
                        return prev.map(function (v, idx) {
                          return idx === i ? !v : v;
                        });
                      });
                    },
                    style: { margin: 0 },
                  }),
                  h(
                    'span',
                    {
                      key: 'lbl',
                      style: {
                        textDecoration: checked[i] ? 'line-through' : 'none',
                        color: checked[i] ? 'var(--t3, #8a8f98)' : 'var(--t1, #e6e6e6)',
                      },
                    },
                    label,
                  ),
                ],
              );
            }),
          ),
    ],
  );
}

/**
 * Best-effort React loader. Tries (1) a dynamic `import('react')` (works in
 * the vitest test, which resolves via Vite), (2) `window.React` (works if the
 * host exposes a global), (3) throws. A production trusted plugin should
 * bundle React so path (1) is not needed.
 */
function _loadReact() {
  if (typeof window !== 'undefined' && window.React) {
    return window.React;
  }
  // The dynamic import is deferred until the component renders, so the
  // module's top-level evaluation (the blob-URL `import()`) does not touch
  // React. Inside the component, we throw if React truly is unavailable.
  throw new Error(
    '[markdown-todo] React not available — trusted plugins must bundle React or the host must expose window.React',
  );
}

/**
 * Command handler: insert a todo checklist template into the active document.
 * The trusted tier runs in-process, so we can import the editor store
 * directly (no postMessage RPC). The manifest `permissions.vault.insertContent`
 * declaration documents the intent for future capability auditing.
 */
async function insertTodoCommand() {
  try {
    // Lazy import — resolved against the host realm at call time. Using a
    // variable specifier so Vite does not statically resolve the bare
    // specifier at build/test time (the host realm resolves it at runtime).
    // A real bundled plugin would inline the store import after bundling.
    const storeSpec = '@/store/editorStore';
    const mod = await import(/* @vite-ignore */ storeSpec);
    const useEditorStore = mod.useEditorStore;
    const store = useEditorStore.getState();
    const activeTab = store.tabs.find(function (t) {
      return t.id === store.activeTabId;
    });
    if (!activeTab) {
      console.warn('[markdown-todo] no active tab to insert into');
      return;
    }
    const template = '\n:::todo\n- [ ] Task one\n- [ ] Task two\n:::\n';
    store.updateTabContent(activeTab.id, activeTab.content + template);
  } catch (err) {
    console.error('[markdown-todo] insert-todo failed:', err);
  }
}

// ── Named exports (the PluginModule contract) ────────────────────────────────

export const containers = {
  todo: TodoContainer,
};

export const commands = {
  'insert-todo': insertTodoCommand,
};

export function activate() {
  // Optional lifecycle hook. Called once when the plugin is activated.
  // No-op for this example — the contribution adapters handle registration.
  console.info('[markdown-todo] activated');
}

export function deactivate() {
  console.info('[markdown-todo] deactivated');
}
