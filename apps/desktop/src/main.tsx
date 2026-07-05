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
const isPetWindow = typeof window !== 'undefined' && window.location.hash === '#/pet';
const isPetPanelWindow =
  typeof window !== 'undefined' && window.location.hash === '#/pet-panel';

// The pet + pet-panel windows share `index.css` with the main editor, which
// sets `html, body { background: var(--bg) }` — an opaque theme color. For
// the transparent always-on-top pet window that opaque body bg would show up
// as a 120x120 light-gray square behind the mascot (R1 violation). For the
// pet-panel window the body bg is fine (panel is opaque) but we still tag
// the root so `pet.css` can scope panel-specific overrides. Tag the root
// element per route so the override leaves the main editor window untouched.
if (isPetWindow) {
  document.documentElement.classList.add('is-pet-window');
}
if (isPetPanelWindow) {
  document.documentElement.classList.add('is-pet-panel-window');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPetWindow ? <PetApp /> : isPetPanelWindow ? <PetPanelApp /> : <App />}
  </React.StrictMode>,
);
