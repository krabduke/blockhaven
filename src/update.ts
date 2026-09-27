// Offline support and update notices. In production a service worker caches
// the game so it starts without a connection, and the page checks whether a
// newer build has been published; if so it offers a reload (saving first).

import type { Game } from './game';

export function setupOffline(game: Game): void {
  if (!import.meta.env.PROD) return;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline support unavailable', e));
  }
  let shown = false;
  const check = async () => {
    if (shown || !navigator.onLine) return;
    try {
      const res = await fetch('./version.json', { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = await res.json();
      if (build && build !== __BUILD_ID__) { shown = true; offerReload(game); }
    } catch { /* offline or blocked: try again later */ }
  };
  setInterval(check, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setTimeout(check, 30 * 1000);
}

function offerReload(game: Game): void {
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = 'A new version of Blockhaven is ready.';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn primary';
  reload.textContent = 'Save and reload';
  reload.addEventListener('click', async () => {
    reload.disabled = true;
    reload.textContent = 'Saving…';
    await game.save().catch(() => {});
    location.reload();
  });
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn';
  later.textContent = 'Later';
  later.addEventListener('click', () => bar.remove());
  bar.append(text, reload, later);
  document.body.appendChild(bar);
}
