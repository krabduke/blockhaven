// A small "type a name" box, styled like the sign editor. Resolves to the text, or null if cancelled.

import type { Game } from '../game';

let el: HTMLElement | null = null;

export function askText(g: Game, title: string, initial = '', maxLength = 24): Promise<string | null> {
  document.exitPointerLock?.();
  if (!el) {
    el = document.createElement('div');
    el.className = 'screen dim';
    el.id = 'ask-text';
    el.innerHTML = '<div class="panel title-menu stack"><h2></h2><input class="field" aria-label="Name"><div class="row"><button class="btn primary" type="button">Done</button><button class="btn" type="button">Cancel</button></div></div>';
    g.root.appendChild(el);
  }
  const box = el;
  const input = box.querySelector('input')!;
  const [ok, cancel] = [...box.querySelectorAll('button')];
  box.querySelector('h2')!.textContent = title;
  input.value = initial;
  input.maxLength = maxLength;
  box.classList.add('show');
  g.menus.current = 'ask';
  setTimeout(() => { input.focus(); input.select(); }, 0);
  return new Promise((resolve) => {
    const finish = (v: string | null) => {
      box.classList.remove('show');
      g.menus.current = null;
      ok.onclick = cancel.onclick = null;
      input.onkeydown = null;
      g.input.lockPointer();
      resolve(v);
    };
    ok.onclick = () => finish(input.value.trim().slice(0, maxLength) || null);
    cancel.onclick = () => finish(null);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') ok.click();
      else if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
    };
  });
}
