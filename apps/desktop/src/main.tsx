import React from 'react';
import ReactDOM from 'react-dom/client';
import * as ReactDOMFull from 'react-dom';
import './i18n';
import App from './App';

// Expose the host's React instance globally so trusted-tier extensions (import()'d
// into this realm via a blob URL) can share it via `window.React`. A blob URL
// can't resolve `import 'react'`, and bundling React into every extension would
// break hooks (two React instances → "Invalid hook call"). This is the
// established-but-missing pattern the example extensions already assume
// (`markdown-todo` / `ai-chat-demo` `_loadReact` read `window.React`). Set
// before `createRoot` so extensions activate against the live instance.
// `window.ReactDOM` exposes the full react-dom API (createPortal/flushSync/…)
// for extensions that render inline; main.tsx itself still uses the client import
// above for `createRoot` (the modern entrypoint).
window.React = React;
window.ReactDOM = ReactDOMFull;

// Expose the host's @codemirror/language instance so trusted-tier blob extensions
// (e.g. folyn-extension-plantuml) can share it via `window.codemirrorLanguage`.
// Same reason as React above: a blob URL can't resolve `import '@codemirror/language'`,
// and bundling it into the extension would produce a second module instance whose
// `LanguageSupport` extension the host's `EditorState` won't reliably apply
// (module-instance mismatch). Set before extension import() so extensions resolve the
// live instance.
// ponytail: local cast — `declare global` in vite-env.d.ts (a script-level file)
// doesn't merge onto Window. A local cast is the smallest diff that typechecks.
// React/ReactDOM on window work via the UMD `export as namespace` globals from
// @types/react(-dom), not via vite-env.d.ts.
import * as cmLanguage from '@codemirror/language';
(window as unknown as { codemirrorLanguage: typeof cmLanguage }).codemirrorLanguage = cmLanguage;

// ponytail: expose the host's react-i18next instance so trusted-tier blob
// extensions (e.g. @folyn/extension-rich-text) can share the SAME initialized
// i18next via window.reactI18next (mirrors the React shim pattern above).
// Without this, the extension would bundle its own react-i18next singleton —
// useTranslation would return the key verbatim (no translations load).
import * as reactI18next from 'react-i18next';
(window as unknown as { reactI18next: typeof reactI18next }).reactI18next = reactI18next;

// ponytail: expose the host's lucide-react instance so trusted-tier blob
// extensions (e.g. @folyn/extension-rich-text) can share it via
// window.lucideReact. esbuild bundles lucide-react itself when aliasing is
// absent, but its tree-shaking mangles the namespace re-export pattern in
// lucide-react/dist/esm/lucide-react.mjs (`export { index as icons };
// export { default as Bold } from './icons/bold.mjs'; ...`) — the named
// imports resolve to undefined or to the per-icon __iconNode SVG-data
// array instead of the React Component, so <b.icon /> renders the array's
// indices as text ("0,1,2,3"). Sharing the host's already-initialized
// instance (mirrors the React/ReactDOM/react-i18next pattern above) avoids
// the bundler bug entirely.
import * as lucideReact from 'lucide-react';
(window as unknown as { lucideReact: typeof lucideReact }).lucideReact = lucideReact;

// ponytail: KaTeX CSS used to be imported by the rich-text editor inside the
// builtin handler dir. With rich-text relocated to an extension (esbuild-built,
// no Vite CSS pipeline), import the stylesheet here so the host's single CSS
// bundle carries it — the rich-text NodeViews render in the host React tree.
import 'katex/dist/katex.min.css';

import { PetApp } from './components/pet/PetApp';
import { PetPanelApp } from './components/pet/PetPanelApp';
import { PetBubbleApp } from './components/pet/PetBubbleApp';
import { PetCornerApp } from './components/pet/PetCornerApp';
import { PetMenuApp } from './components/pet/PetMenuApp';
import { ExtensionToolApp } from './components/pet/ExtensionToolApp';
import { VoiceOrbApp } from './components/ai/VoiceOrbApp';
import './index.css';
import './components/pet/pet.css';

// The `pet` Tauri window loads `/#/pet` (see tauri.conf.json) and mounts only
// the mascot — not the full editor app — so the pet window stays tiny and
// cheap. The `pet-panel` window loads `/#/pet-panel` and mounts only the
// quick-action panel shell. The `pet-bubble` window loads `/#/pet-bubble`
// and mounts only the notification bubble. The `pet-corner` window loads
// `/#/pet-corner` and mounts only the corner toast stack. The `pet-menu`
// window loads `/#/pet-menu` and mounts only the HTML right-click menu
// (replaces the native NSMenu so the menu can be positioned adaptively
// outside the pet view). The `voice-orb` window loads `/#/voice-orb` and
// mounts only the SiriGL waveform canvas (a floating always-on-top
// transparent indicator shown while the global voice hotkey is recording).
// Everything else mounts the main editor.
//
// Hash detection: `window.location.hash` is normally set by the time this
// module evaluates, but in some Tauri webview builds the hash can lag a tick
// (the URL is `/#/pet` but `location.hash` reads `''` at first paint). When
// that happens the `.is-pet-window` class never lands on <html>, the
// `html, body { background: var(--bg) }` rule from index.css wins, and the
// transparent mascot renders with an opaque `#f0f2f8` square behind it (the
// "white square" bug). Fall back to scanning `location.hash || location.href`
// for the `#/pet` segment so the class is applied even when `location.hash`
// is momentarily empty. Route check order matters: `#/pet-panel`,
// `#/pet-bubble`, `#/pet-corner`, `#/pet-menu` are checked before `#/pet`
// because `#/pet` is a prefix of all of them — a stale prefix match would
// route the panel/bubble/corner/menu to the mascot.
const petLoc =
  typeof window !== 'undefined'
    ? (window.location.hash || window.location.href || '')
    : '';
const isExtensionToolWindow = petLoc.indexOf('#/extension-tool') !== -1;
const isPetPanelWindow = !isExtensionToolWindow && petLoc.indexOf('#/pet-panel') !== -1;
const isPetBubbleWindow = !isPetPanelWindow && petLoc.indexOf('#/pet-bubble') !== -1;
const isPetCornerWindow = !isPetPanelWindow && !isPetBubbleWindow && petLoc.indexOf('#/pet-corner') !== -1;
const isPetMenuWindow =
  !isPetPanelWindow && !isPetBubbleWindow && !isPetCornerWindow && petLoc.indexOf('#/pet-menu') !== -1;
const isVoiceOrbWindow =
  !isPetPanelWindow && !isPetBubbleWindow && !isPetCornerWindow && !isPetMenuWindow && petLoc.indexOf('#/voice-orb') !== -1;
const isPetWindow =
  !isPetPanelWindow && !isPetBubbleWindow && !isPetCornerWindow && !isPetMenuWindow && !isVoiceOrbWindow && petLoc.indexOf('#/pet') !== -1;

// The pet + pet-panel + pet-bubble + pet-corner + pet-menu + voice-orb
// windows share `index.css` with the main editor, which sets
// `html, body { background: var(--bg) }` — an opaque theme color. For the
// transparent always-on-top pet + pet-bubble + pet-corner + pet-menu +
// voice-orb windows that opaque body bg would show up as a light-gray
// square behind the sprite / bubble card / corner stack / menu card /
// waveform canvas (R1 violation). For the pet-panel window the body bg is
// fine (panel is opaque) but we still tag the root so `pet.css` can scope
// panel-specific overrides. Tag the root element per route so the override
// leaves the main editor window untouched.
if (isPetWindow) {
  document.documentElement.classList.add('is-pet-window');
  // Debug marker: confirms the transparency class landed on <html>. If this
  // log is absent in the pet window, the hash detection failed and the
  // `html, body { background: var(--bg) }` rule will paint the opaque square.
  // eslint-disable-next-line no-console
  console.log('[pet] is-pet-window class applied');
}
if (isExtensionToolWindow) {
  document.documentElement.classList.add('is-extension-tool-window');
}
if (isPetPanelWindow) {
  document.documentElement.classList.add('is-pet-panel-window');
}
if (isPetBubbleWindow) {
  document.documentElement.classList.add('is-pet-bubble-window');
}
if (isPetCornerWindow) {
  document.documentElement.classList.add('is-pet-corner-window');
}
if (isPetMenuWindow) {
  document.documentElement.classList.add('is-pet-menu-window');
}
if (isVoiceOrbWindow) {
  document.documentElement.classList.add('is-voice-orb-window');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isExtensionToolWindow ? (
      <ExtensionToolApp />
    ) : isPetWindow ? (
      <PetApp />
    ) : isPetPanelWindow ? (
      <PetPanelApp />
    ) : isPetBubbleWindow ? (
      <PetBubbleApp />
    ) : isPetCornerWindow ? (
      <PetCornerApp />
    ) : isPetMenuWindow ? (
      <PetMenuApp />
    ) : isVoiceOrbWindow ? (
      <VoiceOrbApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
