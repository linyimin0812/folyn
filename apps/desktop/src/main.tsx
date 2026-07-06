import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PetApp } from './components/pet/PetApp';
import { PetPanelApp } from './components/pet/PetPanelApp';
import './index.css';
import './components/pet/pet.css';

// The `pet` Tauri window loads `/#/pet` (see tauri.conf.json) and mounts only
// the mascot — not the full editor app — so the pet window stays tiny and
// cheap. The `pet-panel` window loads `/#/pet-panel` and mounts only the
// quick-action panel shell. Everything else mounts the main editor.
//
// Hash detection: `window.location.hash` is normally set by the time this
// module evaluates, but in some Tauri webview builds the hash can lag a tick
// (the URL is `/#/pet` but `location.hash` reads `''` at first paint). When
// that happens the `.is-pet-window` class never lands on <html>, the
// `html, body { background: var(--bg) }` rule from index.css wins, and the
// transparent mascot renders with an opaque `#f0f2f8` square behind it (the
// "white square" bug). Fall back to scanning `location.hash || location.href`
// for the `#/pet` segment so the class is applied even when `location.hash`
// is momentarily empty. The `#/pet-panel` route is checked FIRST because
// `#/pet` is a prefix of `#/pet-panel` — order matters.
const petLoc =
  typeof window !== 'undefined'
    ? (window.location.hash || window.location.href || '')
    : '';
const isPetPanelWindow = petLoc.indexOf('#/pet-panel') !== -1;
const isPetWindow = !isPetPanelWindow && petLoc.indexOf('#/pet') !== -1;

// The pet + pet-panel windows share `index.css` with the main editor, which
// sets `html, body { background: var(--bg) }` — an opaque theme color. For
// the transparent always-on-top pet window that opaque body bg would show up
// as a 120x120 light-gray square behind the mascot (R1 violation). For the
// pet-panel window the body bg is fine (panel is opaque) but we still tag
// the root so `pet.css` can scope panel-specific overrides. Tag the root
// element per route so the override leaves the main editor window untouched.
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPetWindow ? <PetApp /> : isPetPanelWindow ? <PetPanelApp /> : <App />}
  </React.StrictMode>,
);
