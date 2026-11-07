/**
 * DITUNE Application Entry Point
 */
import './style.css';
import { AudioEngine } from './modules/player/audio.js';
import { renderAppShell } from './modules/ui/components.js';
import { UIController, refreshLucideIcons } from './modules/ui/events.js';
import { initGoogleAuth } from './modules/auth/gdrive.js';

// 1. Mount App Shell
const appRoot = document.getElementById('app');
if (appRoot) {
  appRoot.innerHTML = renderAppShell();
}

// 2. Initialize Core Engines
const audioEngine = new AudioEngine();
const uiController = new UIController(audioEngine);

// 3. Kick off UI and background services
async function startApp() {
  await uiController.init();
  refreshLucideIcons();

  // Lazy-init Google Auth library in background
  initGoogleAuth().catch((err) => {
    console.debug('Background Google Auth init deferred:', err.message);
  });

  // Register PWA Service Worker
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[PWA] Service Worker registered:', reg.scope))
      .catch((err) => console.warn('[PWA] Service Worker registration failed:', err));
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
