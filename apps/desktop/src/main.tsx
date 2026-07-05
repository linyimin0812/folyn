import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PetApp } from './components/pet/PetApp';
import './index.css';
import './components/pet/pet.css';

// The `pet` Tauri window loads `/#/pet` (see tauri.conf.json). When that hash
// is present we mount only the mascot — not the full editor app — so the pet
// window stays tiny and cheap. Everything else mounts the main editor.
const isPetWindow = typeof window !== 'undefined' && window.location.hash === '#/pet';

// The pet window shares the same CSS entry (`index.css`) as the main editor,
// which sets `html, body { background: var(--bg) }` — an opaque theme color.
// For a transparent always-on-top pet window that opaque body bg would show
// up as a 120x120 light-gray square behind the mascot (R1 violation). Tag the
// root element so `pet.css` can scope a `transparent !important` override to
// the pet window only, leaving the main editor's theming untouched.
if (isPetWindow) {
  document.documentElement.classList.add('is-pet-window');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPetWindow ? <PetApp /> : <App />}
  </React.StrictMode>,
);
