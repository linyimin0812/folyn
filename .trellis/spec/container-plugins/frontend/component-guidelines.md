# Plugin Implementation Guidelines

> How container plugins are built in this package.

---

## Overview

Container plugins are Markdown directive renderers. Each plugin maps a `:::directive` syntax to a React component rendered in the preview pane. Plugins also appear in the `/` slash command menu in the editor.

---

## Plugin Implementation Pattern

**Step 1** — Define variant config (optional, for plugins with variants):
```tsx
const CALLOUT_VARIANTS: Record<string, { border: string; bg: string; icon: string; label: string }> = {
  info:    { border: '#3498db', bg: 'rgba(52, 152, 219, 0.08)', icon: 'ℹ️', label: 'Info' },
  warning: { border: '#f39c12', bg: 'rgba(243, 156, 18, 0.08)', icon: '⚠️', label: 'Warning' },
  tip:     { border: '#2ecc71', bg: 'rgba(46, 204, 113, 0.08)', icon: '💡', label: 'Tip' },
};
```

**Step 2** — Component reads attributes from `ContainerProps`:
```tsx
function CalloutComponent({ children, attributes }: ContainerProps) {
  const type = attributes?.type || 'info';
  const variant = CALLOUT_VARIANTS[type] || CALLOUT_VARIANTS.info;
  const title = attributes?.title || variant.label;

  return (
    <div className="docmd-callout" style={{...}}>
      <div>{variant.icon} {title}</div>
      <div>{children}</div>
    </div>
  );
}
```

**Step 3** — Export plugin object implementing `ContainerPlugin`:
```tsx
export const calloutPlugin: ContainerPlugin = {
  name: 'callout',           // matches the directive name
  icon: '💡',               // emoji for slash menu
  label: '提示框',           // display label
  category: 'layout',       // 'layout' | 'media' | 'ai' | 'data' | 'custom'
  component: CalloutComponent,
  template: ':::callout{type="info" title="提示"}\n在此输入内容\n:::',
  description: '支持 info / warning / tip / danger / error / note 类型',
};
```

Reference: `packages/container-plugins/src/plugins/CalloutPlugin.tsx`

---

## Styling in Plugins

- **Inline styles** — plugins render inside the Markdown preview pane which has its own CSS context; Tailwind classes are not available
- **CSS variables** for theme-aware colors: `var(--t2, #3f3f46)`, `var(--acc, #6366f1)`
- **CSS class prefix**: `docmd-<name>` for plugin root elements (e.g., `docmd-callout`, `docmd-tabs`, `docmd-card`)

---

## Plugin Categories

| Category | Plugins |
|----------|---------|
| `layout` | callout, tabs, steps, collapsible, card, grid |
| `media` | mermaid, file-preview |
| `ai` | ai-result |
| `data` | status-tag, timeline |
| `custom` | button |

---

## Common Mistakes

- Using Tailwind classes in plugin components — preview pane has its own CSS context
- Not handling missing `attributes` — always provide defaults
- Side effects in plugin components — no API calls, no store access
- Importing from `@quill/desktop` — this package is a leaf dependency
