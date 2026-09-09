import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// A stale/invalidated dynamic-import chunk (e.g. after a Vite rebuild or a new
// deploy) throws `vite:preloadError` / a "Failed to fetch dynamically imported
// module" error at runtime. The only safe recovery is a full reload — do it
// once, then silently swallow further attempts.
let chunkReloadAttempted = false;
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (chunkReloadAttempted) return;
  chunkReloadAttempted = true;
  window.location.reload();
});
window.addEventListener('error', (event) => {
  const msg = event?.message || '';
  const isChunkLoad =
    event.target instanceof HTMLLinkElement &&
    event.target.tagName === 'LINK' &&
    event.target.rel === 'modulepreload';
  const isDynamicImport = /Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg);
  if ((isChunkLoad || isDynamicImport) && !chunkReloadAttempted) {
    chunkReloadAttempted = true;
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
