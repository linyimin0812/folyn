import React from 'react';
import ReactDOM from 'react-dom/client';
import * as ReactDOMFull from 'react-dom';
import './i18n';
import App from './App';

// Expose the host's React instance globally so trusted-tier plugins (import()'d
// into this realm via a blob URL) can share it via `window.React`. A blob URL
// can't resolve `import 'react'`, and bundling React into every plugin would
// break hooks (two React instances → "Invalid hook call"). This is the
// established-but-missing pattern the example plugins already assume
// (`markdown-todo` / `ai-chat-demo` `_loadReact` read `window.React`). Set
// before `createRoot` so plugins activate against the live instance.
// `window.ReactDOM` exposes the full react-dom API (createPortal/flushSync/…)
// for plugins that render inline; main.tsx itself still uses the client import
// above for `createRoot` (the modern entrypoint).
window.React = React;
window.ReactDOM = ReactDOMFull;

import { PetApp } from './components/pet/PetApp';
import { PetPanelApp } from './components/pet/PetPanelApp';
import { PetBubbleApp } from './components/pet/PetBubbleApp';
import { PetCornerApp } from './components/pet/PetCornerApp';
import { PetMenuApp } from './components/pet/PetMenuApp';
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
const isPetPanelWindow = petLoc.indexOf('#/pet-panel') !== -1;
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
    {isPetWindow ? (
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
