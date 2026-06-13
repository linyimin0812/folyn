# State Management

> State management in the container-plugins package.

---

## Overview

**Not applicable at the library level.** Plugin components are stateless renderers by default.

When a plugin needs local interactive state (e.g., active tab index in `TabsPlugin`), use React `useState` inside the component — no global state or store access.

The `ContainerRegistry` singleton holds the plugin map but is not reactive state — it's populated once at startup via `registerBuiltinPlugins()` in `App.tsx`.
