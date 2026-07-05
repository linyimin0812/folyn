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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPetWindow ? <PetApp /> : <App />}
  </React.StrictMode>,
);
