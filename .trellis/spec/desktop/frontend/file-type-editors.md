# File Type Editor Patterns

> Patterns for building custom editors for file types beyond plain text/markdown.

---

## Custom Editor Registration

File types that need non-CodeMirror editors register a custom `Editor` component:

```typescript
// src/components/file-types/<type>/index.ts
import type { FileTypeHandler } from '../types';

const handler: FileTypeHandler = {
  id: 'html',
  extensions: ['html', 'htm'],
  supportedViewModes: ['edit', 'preview'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,        // ← Disables CodeMirror in WorkArea
  Editor: HtmlVisualEditor,    // ← Custom component receives EditorProps
  Preview: HtmlPreview,        // ← Optional read-only preview
};
```

**Contract**: The `Editor` component receives `EditorProps`:
```typescript
interface EditorProps {
  content: string;          // Current file content
  tabId: string;            // Unique tab ID (for key prop)
  filePath: string;         // File path on disk
  onChange: (content: string) => void;  // MUST call on each change
  onSave: () => void;       // Called when save completes
}
```

**Dispatch**: `WorkArea.tsx` renders `handler.Editor` when `useCodeMirror === false && Editor` is defined. It does NOT render CodeMirror in this case — the custom editor owns the edit experience entirely.

**View mode hiding**: Add the file type ID to `HIDE_VIEW_MODE_FILE_TYPES` in `Topbar.tsx` so the split/edit/preview toggle is hidden. The custom editor manages its own mode switching internally.

Reference: `src/components/file-types/html/index.ts`, `src/components/file-types/excalidraw/index.ts`

---

## Internal Mode Switching

Custom editors can provide multiple internal modes (visual/source/preview) via a tab toolbar:

```tsx
// HtmlVisualEditor.tsx
type EditorMode = 'visual' | 'source' | 'preview';

function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const [mode, setMode] = useState<EditorMode>('visual');
  const currentContentRef = useRef(content);

  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    onChange(newContent);
  }, [onChange]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mode toolbar */}
      <div className="shrink-0 bg-panel border-b border-brd flex gap-1 p-1">
        {(['visual', 'source', 'preview'] as EditorMode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)} ...>{MODE_LABELS[m]}</button>
        ))}
      </div>
      {/* Canvas area — conditional render */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === 'visual' && <VisualEditCanvas content={currentContentRef.current} onChange={handleChange} />}
        {mode === 'source' && <SourceEditCanvas content={currentContentRef.current} onChange={handleChange} />}
      </div>
    </div>
  );
}
```

**Key**: Use `currentContentRef.current` to pass the latest content when switching modes, preventing content loss between canvases.

---

## iframe Bridge Architecture

For editing rendered content (HTML, SVG, etc.), use an iframe with an injected bridge script.

### Architecture

```
Host (React)                    iframe (contentDocument)
┌──────────────────┐            ┌──────────────────────┐
│ VisualEditCanvas │            │                      │
│                  │  postMsg   │  bridge.ts (IIFE)    │
│  callBridge() ───┼───────────►│  window.__bridge     │
│                  │  direct    │    .setAttr()        │
│                  │  access    │    .getStyle()       │
│  handleMessage() ◄┼───────────│    .removeElement()  │
│                  │            │                      │
│  stripArtifacts()│  outerHTML │  MutationObserver    │
│  onChange()      │◄───────────│  → notifyChange()    │
└──────────────────┘            └──────────────────────┘
```

### Bridge Script Design

```typescript
// bridge.ts — exported as string, injected into iframe
export function getBridgeScript(): string {
  return `
(function() {
  'use strict';
  if (window.__bridge) return; // Guard against double injection

  // Assign unique IDs for element targeting
  let nextId = 1;
  function assignIds(root) {
    root.querySelectorAll('*').forEach(el => {
      if (!el.getAttribute('data-quill-id')) {
        el.setAttribute('data-quill-id', String(nextId++));
      }
    });
  }

  // Inject edit-mode CSS (hover outline, selection highlight)
  function injectStyles() { /* ... */ }

  // Post messages to host
  function post(msg) {
    window.parent.postMessage({ ...msg, source: 'quill-bridge' }, '*');
  }

  // MutationObserver with pause/resume to avoid self-triggered notifications
  let paused = 0;
  function pause() { paused++; }
  function resume() { if (paused > 0) paused--; }

  // Public API
  window.__bridge = {
    setAttr(quillId, name, value) { /* pause/resume wrapped */ },
    removeElement(quillId) { /* pause/resume wrapped */ },
    moveElement(quillId, direction) { /* pause/resume wrapped */ },
    getAttrs(quillId) { /* non-mutating getter */ },
    getStyle(quillId) { /* non-mutating getter */ },
    setStyle(quillId, prop, val) { /* pause/resume wrapped */ },
    removeAttr(quillId, name) { /* pause/resume wrapped */ },
  };

  // Init
  assignIds(document.body);
  injectStyles();
  // ... event listeners, observer setup
})();`;
}
```

### Host-side Bridge Communication

**Injection** (on iframe load):
```tsx
const handleLoad = useCallback(() => {
  const doc = iframe.contentDocument;
  if (!doc) return;
  const script = doc.createElement('script');
  script.id = 'quill-bridge-script';
  script.textContent = getBridgeScript();
  doc.head.appendChild(script);
}, []);
```

**Calling bridge functions** (direct contentWindow access, NOT script injection):
```tsx
const callBridge = useCallback((fn: string, ...args: unknown[]): unknown => {
  const win = iframe.contentWindow as (Window & {
    __bridge?: Record<string, (...a: unknown[]) => unknown>
  }) | null;
  if (!win?.__bridge?.[fn]) return undefined;
  return win.__bridge[fn](...args);
}, []);
```

> **Don't**: Create `<script>` elements for each bridge call — this pollutes the DOM, triggers MutationObserver, and leaks into outerHTML serialization.

**Receiving messages**:
```tsx
useEffect(() => {
  function handleMessage(event: MessageEvent) {
    if (event.data?.source !== 'quill-bridge') return;
    switch (event.data.type) {
      case 'select': /* update selected element state */ break;
      case 'deselect': /* clear selection */ break;
      case 'change': /* debounce → extract outerHTML → strip → onChange */ break;
    }
  }
  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}, []);
```

---

## Serialization Hygiene

When injecting artifacts into an iframe (bridge script, edit CSS, theme vars), they MUST be stripped before saving to disk.

### stripBridgeArtifacts Pattern

```typescript
function stripBridgeArtifacts(html: string): string {
  let cleaned = html;
  // 1. Remove bridge script by ID
  cleaned = cleaned.replace(/<script\b[^>]*id=["']quill-bridge-script["'][\s\S]*?<\/script>/gi, '');
  // 2. Remove bridge styles by ID
  cleaned = cleaned.replace(/<style\b[^>]*id=["']quill-bridge-styles["'][\s\S]*?<\/style>/gi, '');
  // 3. Remove theme vars style by ID
  cleaned = cleaned.replace(/<style\b[^>]*id=["']quill-theme-vars["'][\s\S]*?<\/style>/gi, '');
  // 4. Remove tracking attributes
  cleaned = cleaned.replace(/\s+data-quill-id="[^"]*"/g, '');
  // 5. Remove edit-mode classes
  cleaned = cleaned.replace(/\s*quill-selected\b/g, '');
  cleaned = cleaned.replace(/\s*class=""\s*/g, ' ');
  // 6. Safety net: strip any remaining <script> tags
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  return cleaned;
}
```

**Rules**:
- Always give injected elements explicit `id` attributes for targeted removal
- Strip in order: scripts → styles → attributes → classes → safety net
- Apply stripping BEFORE calling `onChange()` to prevent artifacts from reaching disk
- Use `sanitizeHtml()` (DOMParser-based) to strip user `<script>` tags BEFORE injecting into iframe

Reference: `src/components/file-types/html/VisualEditCanvas.tsx`

---

## Security Model for iframe Editors

Editing arbitrary web pages requires freezing page scripts and isolating the bridge:

1. **Script stripping**: Use `DOMParser` to remove `<script>` tags from HTML before passing to iframe `srcDoc`
2. **Sandbox**: Use `sandbox="allow-scripts allow-same-origin"` — scripts are allowed because the bridge needs them, but page scripts are already stripped
3. **Bridge isolation**: Wrap bridge script in IIFE, expose only `window.__bridge` API
4. **Theme injection**: Inject CSS variables into iframe so bridge edit styles follow app theme

```typescript
function sanitizeHtml(htmlStr: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlStr, 'text/html');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  return doc.documentElement.outerHTML;
}
```

> **Warning**: Don't rely on regex for script stripping — `<script>` in attribute values or string literals can cause false matches. DOMParser handles edge cases correctly.

---

## Undo/Redo for iframe Editors

iframe contentEditable has its own undo stack that doesn't interop with the host. Use a snapshot-based approach:

```typescript
const MAX_HISTORY = 50;
const historyRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
const isUndoRedoRef = useRef(false);

// Push snapshot on each change (after debounce)
function pushSnapshot(rawHtml: string) {
  const snapshot = buildSnapshot(rawHtml);
  if (stack[index] === snapshot) return; // Skip duplicates
  const newStack = stack.slice(0, index + 1); // Truncate forward history
  newStack.push(snapshot);
  while (newStack.length > MAX_HISTORY) newStack.shift();
  historyRef.current = { stack: newStack, index: newStack.length - 1 };
}

// Keyboard shortcut (capture phase)
function handleKeyDown(e: KeyboardEvent) {
  // Guard: skip if focus is in INPUT/TEXTAREA/contentEditable
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    isUndoRedoRef.current = true;
    const newIndex = e.shiftKey ? index + 1 : index - 1;
    onChangeRef.current(stack[newIndex]); // React updates iframe srcDoc
    // Clear flag after iframe reload
    setTimeout(() => { isUndoRedoRef.current = false; }, 1000);
  }
}
```

**Key points**:
- Guard against INPUT/TEXTAREA targets to avoid intercepting native text-input undo in panels
- Set `isUndoRedoRef` flag to prevent the change handler from pushing undo-triggered snapshots
- Track setTimeout ID in a ref and clean up on unmount
- iframe reload after undo triggers `onLoad` → bridge re-injects → `isUndoRedoRef` cleared

---

## Panel Interaction Patterns

When editing elements via side panels (attributes, styles), coordinate panel/toolbar/selection interactions:

### data-quill-panel Attribute

Panels mark themselves with `data-quill-panel` so FloatingToolbar's click-outside handler doesn't deselect the element when the user clicks inside a panel:

```tsx
// FloatingToolbar.tsx
function handleClickOutside(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('[data-quill-panel]')) return;
  onClose();
}
```

### Mutual Exclusion

Only one panel can be open at a time:

```tsx
const handleEditAttrs = () => {
  setStylePanelOpen(false);
  setAttrPanelOpen(prev => !prev);
};
const handleEditStyle = () => {
  setAttrPanelOpen(false);
  setStylePanelOpen(prev => !prev);
};
```

### Panel Close Coordination

Panels close on: explicit close button, click outside (with `[data-quill-panel]` guard), element deselection, or undo/redo.
