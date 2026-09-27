// Title screen, world list, world creation, pause, settings and death screens.

import { deleteWorld, download, duplicateWorld, exportWorld, importWorld, listWorlds, renameWorld, type WorldMeta } from '../storage';
import { BINDABLE, DEFAULT_KEYS, keyName } from '../game/input';

export interface Settings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  brightness: number;
  volume: number;
  viewBobbing: boolean;
  invertY: boolean;
  fancy: boolean;
  shadows: boolean;
  post: boolean;
  /** Key overrides: action -> KeyboardEvent.code. */
  keys: Record<string, string>;
  toggleSprint: boolean;
  toggleSneak: boolean;
  /** Turns off view bobbing, the sprint zoom and hurt tilt. */
  reduceMotion: boolean;
  /** Interface size multiplier. */
  uiScale: number;
  showCoords: boolean;
  minimap: boolean;
  /** Frame-rate cap (0 = unlimited). */
  fpsCap: number;
  /** Lower the render resolution when frames get slow. */
  autoQuality: boolean;
  music: number;
}

const DEFAULTS: Settings = {
  renderDistance: 8, fov: 70, sensitivity: 1, brightness: 0.5, volume: 0.6, viewBobbing: true, invertY: false, fancy: true, shadows: true, post: true,
  keys: {}, toggleSprint: false, toggleSneak: false, reduceMotion: false, uiScale: 1, showCoords: false, minimap: true, fpsCap: 0, autoQuality: true, music: 0.4,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('blockhaven.settings');
    if (raw) { const v = JSON.parse(raw); return { ...DEFAULTS, ...v, keys: { ...v.keys } }; }
  } catch { /* storage unavailable: use defaults */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem('blockhaven.settings', JSON.stringify(s)); } catch { /* ignore */ }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else e.setAttribute(k, v);
  }
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, cls = '', onClick?: () => void): HTMLButtonElement {
  const b = el('button', { class: 'btn ' + cls, type: 'button' }, label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function timeAgo(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export interface MenuCallbacks {
  play(world: WorldMeta): void;
  create(name: string, seedText: string, gamemode: 'survival' | 'creative'): void;
  resume(): void;
  saveAndQuit(): void;
  respawn(): void;
  settingsChanged(s: Settings): void;
  exportCurrent(): void;
}

export class Menus {
  private screens = new Map<string, HTMLElement>();
  private selectedWorld: WorldMeta | null = null;
  current: string | null = null;
  private settingsBack = 'title';

  constructor(private parent: HTMLElement, private cb: MenuCallbacks, public settings: Settings) {
    this.buildTitle();
    this.buildWorlds();
    this.buildCreate();
    this.buildPause();
    this.buildSettings();
    this.buildControls();
    this.buildDeath();
    this.buildLoading();
  }

  private screen(id: string, dim = true): HTMLElement {
    const s = el('div', { class: 'screen' + (dim ? ' dim' : ''), id });
    this.parent.appendChild(s);
    this.screens.set(id, s);
    return s;
  }

  show(id: string | null): void {
    if (id) document.exitPointerLock?.();
    for (const [k, s] of this.screens) s.classList.toggle('show', k === id);
    this.current = id;
    if (id === 'worlds') this.refreshWorlds();
    if (id === 'settings') this.renderSettings();
    if (id === 'controls') this.renderControls();
    const first = id ? this.screens.get(id)?.querySelector<HTMLElement>('button, input') : null;
    first?.focus({ preventScroll: true });
  }

  private buildTitle(): void {
    const s = this.screen('title', false);
    s.appendChild(el('h1', { class: 'logo' }, 'Blockhaven'));
    s.appendChild(el('p', { class: 'tagline' }, 'Dig in. Build up. Make it through the night.'));
    const menu = el('div', { class: 'title-menu stack' });
    menu.append(
      button('Play', 'primary', () => this.show('worlds')),
      button('Settings', '', () => { this.settingsBack = 'title'; this.show('settings'); }),
    );
    s.appendChild(menu);
    const foot = el('div', { class: 'title-foot' });
    foot.append(el('span', {}, 'Blockhaven 0.1'), el('span', {}, 'Open source · MIT licence'));
    s.appendChild(foot);
  }

  private buildWorlds(): void {
    const s = this.screen('worlds');
    const p = el('div', { class: 'panel worlds' });
    p.append(el('h2', {}, 'Your worlds'), el('div', { class: 'world-list', role: 'listbox', 'aria-label': 'Worlds' }));
    const actions = el('div', { class: 'stack' });
    const row1 = el('div', { class: 'row' });
    const playBtn = button('Play selected world', 'primary', () => { if (this.selectedWorld) this.cb.play(this.selectedWorld); });
    playBtn.id = 'play-selected';
    row1.append(playBtn, button('Create new world', '', () => this.show('create')));
    const row2 = el('div', { class: 'row' });
    const del = button('Delete', 'danger', async () => {
      const w = this.selectedWorld;
      if (!w) return;
      if (!confirm(`Delete "${w.name}"? This can't be undone.`)) return;
      await deleteWorld(w.id);
      this.selectedWorld = null;
      this.refreshWorlds();
    });
    del.id = 'delete-world';
    const row3 = el('div', { class: 'row' });
    const rename = button('Rename', '', async () => {
      const w = this.selectedWorld;
      if (!w) return;
      const name = prompt('New name for this world:', w.name)?.trim().slice(0, 32);
      if (!name) return;
      await renameWorld(w.id, name);
      this.selectedWorld = { ...w, name };
      this.refreshWorlds();
    });
    const dup = button('Duplicate', '', async () => {
      if (!this.selectedWorld) return;
      try { this.selectedWorld = await duplicateWorld(this.selectedWorld.id); } catch (e) { this.status((e as Error).message); }
      this.refreshWorlds();
    });
    const exp = button('Export', '', async () => {
      if (!this.selectedWorld) return;
      try { const { blob, name } = await exportWorld(this.selectedWorld.id); download(blob, name); this.status(`Saved ${name}`); }
      catch (e) { this.status((e as Error).message); }
    });
    const fileIn = el('input', { type: 'file', accept: '.blockhaven,.json,application/json,application/gzip', 'aria-label': 'World file to import' });
    fileIn.style.display = 'none';
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (!f) return;
      try { this.selectedWorld = await importWorld(f); this.status(`Imported "${this.selectedWorld.name}"`); }
      catch (e) { this.status((e as Error).message); }
      this.refreshWorlds();
    });
    const imp = button('Import', '', () => fileIn.click());
    for (const [b, id] of [[rename, 'rename-world'], [dup, 'duplicate-world'], [exp, 'export-world']] as const) b.id = id;
    row3.append(rename, dup, exp, imp, fileIn);
    row2.append(del, button('Back', '', () => this.show('title')));
    const status = el('p', { class: 'hint', id: 'worlds-status', 'aria-live': 'polite' });
    actions.append(row1, row3, row2, status);
    p.appendChild(actions);
    s.appendChild(p);
  }

  private status(text: string): void {
    this.screens.get('worlds')!.querySelector('#worlds-status')!.textContent = text;
  }

  private async refreshWorlds(): Promise<void> {
    const list = this.screens.get('worlds')!.querySelector('.world-list')!;
    let worlds: WorldMeta[] = [];
    try { worlds = await listWorlds(); } catch { /* storage blocked */ }
    list.innerHTML = '';
    if (!worlds.length) {
      list.appendChild(el('div', { class: 'empty' }, 'No worlds yet. Create one to start playing.'));
    }
    if (this.selectedWorld && !worlds.some((w) => w.id === this.selectedWorld!.id)) this.selectedWorld = null;
    if (!this.selectedWorld && worlds.length) this.selectedWorld = worlds[0];
    for (const w of worlds) {
      const row = el('button', { class: 'world-row' + (this.selectedWorld?.id === w.id ? ' sel' : ''), type: 'button', role: 'option' });
      row.append(el('span', { class: 'name' }, w.name), el('span', { class: 'meta' }, `${w.gamemode === 'creative' ? 'Creative' : 'Survival'} · ${timeAgo(w.lastPlayed)}`));
      row.addEventListener('click', () => { this.selectedWorld = w; this.refreshWorlds(); });
      row.addEventListener('dblclick', () => this.cb.play(w));
      list.appendChild(row);
    }
    (this.screens.get('worlds')!.querySelector('#play-selected') as HTMLButtonElement).disabled = !this.selectedWorld;
    for (const id of ['#delete-world', '#rename-world', '#duplicate-world', '#export-world']) (this.screens.get('worlds')!.querySelector(id) as HTMLButtonElement).disabled = !this.selectedWorld;
  }

  private buildCreate(): void {
    const s = this.screen('create');
    const p = el('div', { class: 'panel worlds stack' });
    p.appendChild(el('h2', {}, 'Create a world'));
    const nameL = el('label', { class: 'lbl', for: 'wname' }, 'World name');
    const name = el('input', { class: 'field', id: 'wname', maxlength: '32', value: 'New World' });
    const seedL = el('label', { class: 'lbl', for: 'wseed' }, 'Seed (leave empty for a random world)');
    const seed = el('input', { class: 'field', id: 'wseed', maxlength: '40' });
    let mode: 'survival' | 'creative' = 'survival';
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Game mode' });
    const sb = el('button', { type: 'button', 'aria-pressed': 'true' }, 'Survival');
    const cbn = el('button', { type: 'button', 'aria-pressed': 'false' }, 'Creative');
    const desc = el('p', { class: 'hint' }, 'Gather resources, craft tools, keep yourself fed, and survive the monsters that come out at night.');
    const setMode = (m: typeof mode) => {
      mode = m;
      sb.setAttribute('aria-pressed', String(m === 'survival'));
      cbn.setAttribute('aria-pressed', String(m === 'creative'));
      desc.textContent = m === 'survival'
        ? 'Gather resources, craft tools, keep yourself fed, and survive the monsters that come out at night.'
        : 'Every block is yours to place. Fly with a double-tap of Space, and nothing can hurt you.';
    };
    sb.addEventListener('click', () => setMode('survival'));
    cbn.addEventListener('click', () => setMode('creative'));
    seg.append(sb, cbn);
    const row = el('div', { class: 'row' });
    row.append(
      button('Create world', 'primary', () => this.cb.create(name.value.trim() || 'New World', seed.value.trim(), mode)),
      button('Cancel', '', () => this.show('worlds')),
    );
    for (const i of [name, seed]) i.addEventListener('keydown', (e) => e.stopPropagation());
    p.append(el('div', {}, ''), nameL, name, seedL, seed, el('span', { class: 'lbl' }, 'Game mode'), seg, desc, row);
    s.appendChild(p);
  }

  private buildPause(): void {
    const s = this.screen('pause');
    const p = el('div', { class: 'panel title-menu stack' });
    p.append(
      el('h2', {}, 'Paused'),
      button('Back to game', 'primary', () => this.cb.resume()),
      button('Settings', '', () => { this.settingsBack = 'pause'; this.show('settings'); }),
      button('Export a backup', '', () => this.cb.exportCurrent()),
      button('Save and quit to title', '', () => this.cb.saveAndQuit()),
    );
    s.appendChild(p);
  }

  private buildSettings(): void {
    const s = this.screen('settings');
    s.appendChild(el('div', { class: 'panel settings stack' }));
  }

  private renderSettings(): void {
    const p = this.screens.get('settings')!.querySelector('.settings')!;
    p.innerHTML = '';
    p.appendChild(el('h2', {}, 'Settings'));
    const st = this.settings;
    const changed = () => { saveSettings(st); this.cb.settingsChanged(st); };
    const section = (title: string) => p.appendChild(el('h3', { class: 'set-head' }, title));
    const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const row = el('div', { class: 'setting' });
      const id = 'set-' + key;
      const lab = el('label', { for: id });
      const val = el('span', { class: 'v' }, fmt(st[key] as number));
      lab.append(label + ' ', val);
      const input = el('input', { type: 'range', id, min: String(min), max: String(max), step: String(step), value: String(st[key]) });
      input.addEventListener('input', () => {
        (st as unknown as Record<string, number>)[key] = Number(input.value);
        val.textContent = fmt(Number(input.value));
        changed();
      });
      row.append(lab, input);
      p.appendChild(row);
    };
    type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
    const toggle = (label: string, key: BoolKey, on = 'On', off = 'Off', note?: string) => {
      const row = el('div', { class: 'setting' });
      const lab = el('span', {}, label);
      if (note) lab.appendChild(el('small', { class: 'note' }, note));
      row.appendChild(lab);
      const b = button(st[key] ? on : off, '', () => {
        st[key] = !st[key];
        b.textContent = st[key] ? on : off;
        b.setAttribute('aria-pressed', String(st[key]));
        changed();
      });
      b.setAttribute('aria-pressed', String(st[key]));
      row.appendChild(b);
      p.appendChild(row);
    };
    section('Video');
    slider('Render distance', 'renderDistance', 2, 16, 1, (v) => `${v} chunks`);
    slider('Field of view', 'fov', 50, 110, 1, (v) => `${v}°`);
    slider('Brightness', 'brightness', 0, 1, 0.05, (v) => (v < 0.15 ? 'Moody' : v > 0.85 ? 'Bright' : `${Math.round(v * 100)}%`));
    toggle('Graphics', 'fancy', 'Fancy', 'Fast');
    toggle('Sun shadows', 'shadows');
    toggle('Bloom, sun rays and reflections', 'post');
    slider('Frame rate cap', 'fpsCap', 0, 144, 6, (v) => (v === 0 ? 'Unlimited' : `${v} fps`));
    toggle('Automatic quality', 'autoQuality', 'On', 'Off', 'Lowers the resolution when frames get slow');
    section('Controls');
    slider('Mouse sensitivity', 'sensitivity', 0.2, 2.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    toggle('Invert mouse', 'invertY');
    toggle('Sprint key', 'toggleSprint', 'Toggle', 'Hold');
    toggle('Sneak key', 'toggleSneak', 'Toggle', 'Hold');
    p.appendChild(button('Keys…', '', () => this.show('controls')));
    section('Interface');
    slider('Interface size', 'uiScale', 0.75, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
    toggle('Coordinates', 'showCoords', 'Shown', 'Hidden');
    toggle('Minimap', 'minimap', 'Shown', 'Hidden');
    section('Comfort');
    toggle('Reduce motion', 'reduceMotion', 'On', 'Off', 'No view bobbing, sprint zoom or hurt shake');
    toggle('View bobbing', 'viewBobbing');
    section('Sound');
    slider('Volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    slider('Music', 'music', 0, 1, 0.05, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`));
    p.appendChild(button('Done', 'primary', () => this.show(this.settingsBack)));
  }

  private buildControls(): void {
    const s = this.screen('controls');
    s.appendChild(el('div', { class: 'panel settings controls stack' }));
  }

  /** Key bindings: click an action, then press the key you want for it. */
  private renderControls(): void {
    const p = this.screens.get('controls')!.querySelector('.controls')!;
    p.innerHTML = '';
    p.appendChild(el('h2', {}, 'Keys'));
    p.appendChild(el('p', { class: 'hint' }, 'Click a key, then press the one you want. Escape cancels. Mouse buttons and number keys stay fixed.'));
    const st = this.settings;
    for (const [action, label] of BINDABLE) {
      const row = el('div', { class: 'setting' });
      row.appendChild(el('span', {}, label));
      const current = () => (st.keys[action] ? [st.keys[action]] : DEFAULT_KEYS[action]).map(keyName).join(' or ');
      const b = button(current(), 'keybind');
      b.addEventListener('click', () => {
        b.textContent = 'Press a key…';
        b.classList.add('waiting');
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', onKey, true);
          b.classList.remove('waiting');
          if (e.code !== 'Escape') {
            st.keys[action] = e.code;
            // One key, one action: take it away from anything else that had it.
            for (const [other] of BINDABLE) if (other !== action && st.keys[other] === e.code) delete st.keys[other];
            saveSettings(st);
            this.cb.settingsChanged(st);
          }
          this.renderControls();
        };
        window.addEventListener('keydown', onKey, true);
      });
      row.appendChild(b);
      p.appendChild(row);
    }
    p.appendChild(el('div', { class: 'row' }));
    const r = p.lastElementChild!;
    r.append(
      button('Reset all', '', () => { st.keys = {}; saveSettings(st); this.cb.settingsChanged(st); this.renderControls(); }),
      button('Done', 'primary', () => this.show('settings')),
    );
  }

  private buildDeath(): void {
    const s = this.screen('death');
    s.style.background = 'rgba(90, 16, 10, 0.55)';
    const p = el('div', { class: 'death title-menu stack' });
    p.append(el('h1', {}, 'You died'), el('p', { id: 'death-reason' }, ''), button('Respawn', 'primary', () => this.cb.respawn()), button('Quit to title', '', () => this.cb.saveAndQuit()));
    s.appendChild(p);
  }

  setDeathReason(text: string): void {
    this.screens.get('death')!.querySelector('#death-reason')!.textContent = text;
  }

  private buildLoading(): void {
    const s = this.screen('loading');
    s.style.flexDirection = 'column';
    s.style.gap = '16px';
    const err = el('div', { class: 'panel title-menu stack', id: 'load-error' });
    err.style.display = 'none';
    err.append(el('h2', {}, 'The world couldn’t load'), el('p', { class: 'hint', id: 'load-error-text' }, ''), button('Reload the page', 'primary', () => location.reload()));
    s.appendChild(err);
    s.appendChild(el('div', { class: 'loading', id: 'loading-text' }, 'Building terrain…'));
  }

  /** Show a load failure with a reload button (or hide it with null). */
  showLoadError(text: string | null): void {
    const box = this.screens.get('loading')!.querySelector('#load-error') as HTMLElement;
    box.style.display = text ? 'flex' : 'none';
    if (text) box.querySelector('#load-error-text')!.textContent = text;
    (this.screens.get('loading')!.querySelector('#loading-text') as HTMLElement).style.display = text ? 'none' : '';
  }

  setLoading(text: string): void {
    this.showLoadError(null);
    this.screens.get('loading')!.querySelector('#loading-text')!.textContent = text;
  }
}
