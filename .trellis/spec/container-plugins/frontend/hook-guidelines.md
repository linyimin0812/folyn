# Hook Guidelines

> Hooks in the container-plugins package.

---

## Overview

**Not applicable.** This package contains no React hooks.

Plugin components are pure render functions — they receive `ContainerProps` and return JSX. Any state (e.g., active tab in `TabsPlugin`) uses local `useState` inside the component.

Hooks that interact with the plugin registry live in the desktop app:
- `apps/desktop/src/components/editor/SlashMenu.tsx` — reads from `ContainerRegistry` for the slash menu
