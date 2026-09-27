// Keyboard, mouse, pointer lock and gamepad. Keys are rebindable; movement
// from keys, the touch stick and a gamepad stick is combined here.

import { initAudio } from '../audio';
import type { Game } from '../game';

/** Rebindable actions, in the order they appear in the controls screen. */
export const BINDABLE = [
  ['forward', 'Walk forward'], ['back', 'Walk backward'], ['left', 'Strafe left'], ['right', 'Strafe right'],
  ['jump', 'Jump / fly up'], ['sneak', 'Sneak / fly down'], ['sprint', 'Sprint'],
  ['inventory', 'Inventory'], ['drop', 'Drop item'], ['chat', 'Chat'], ['command', 'Command'],
  ['perspective', 'Change camera'], ['map', 'World map'], ['screenshot', 'Screenshot'], ['hideHud', 'Hide HUD'], ['debug', 'Debug info'],
] as const;
export type Bindable = (typeof BINDABLE)[number][0];

export const DEFAULT_KEYS: Record<Bindable, string[]> = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  jump: ['Space'], sneak: ['ShiftLeft', 'ShiftRight'], sprint: ['ControlLeft', 'KeyR'],
  inventory: ['KeyE'], drop: ['KeyQ'], chat: ['KeyT'], command: ['Slash'],
  perspective: ['F5'], map: ['KeyM'], screenshot: ['F2'], hideHud: ['F1'], debug: ['F3'],
};

/** Human-readable name for a KeyboardEvent.code. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = { Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Slash: '/', Backquote: '`', Tab: 'Tab', CapsLock: 'Caps Lock', Enter: 'Enter', Backspace: 'Backspace' };
  return names[code] ?? code;
}

const PAD_DEAD = 0.18;

export class Input {
  readonly keys = new Set<string>();
  readonly mouse = [false, false, false];
  private lastSpace = 0;
  private lastW = 0;
  /** Set once the mouse has been captured this session (the resume hint only makes sense after that). */
  everLocked = false;
  /** Latched states for the toggle-sprint and toggle-sneak options. */
  sprintLatch = false;
  sneakLatch = false;
  /** A gamepad is being used (it steers without pointer lock). */
  padActive = false;
  private padPrev: boolean[] = [];
  padMove: [number, number] = [0, 0];
  padLook: [number, number] = [0, 0];
  private padJump = false;
  private padSneak = false;
  private padSprint = false;

  constructor(private g: Game) {}

  /** Keys bound to an action (the player's overrides, else the defaults). */
  codes(a: Bindable): string[] {
    const o = this.g.settings.keys?.[a];
    return o ? [o] : DEFAULT_KEYS[a];
  }
  isKey(a: Bindable, code: string): boolean { return this.codes(a).includes(code); }
  private held(a: Bindable): boolean { return this.codes(a).some((c) => this.keys.has(c)); }

  lockPointer(): void {
    const g = this.g;
    if (g.touchMode || this.padActive) return;
    if (g.mode !== 'playing' || g.containers.open || g.menus.current || g.chat.isOpen) return;
    const p = g.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  get locked(): boolean {
    return document.pointerLockElement === this.g.canvas;
  }

  /** The player is steering the game: pointer locked on desktop, or no screen open with touch or a gamepad. */
  get controlling(): boolean {
    if (this.locked) return true;
    const g = this.g;
    return (g.touchMode || this.padActive) && g.mode === 'playing' && !g.containers.open && !g.menus.current && !g.chat.isOpen;
  }

  // ---------- Per-tick movement state ----------
  movement(): { forward: number; strafe: number; jump: boolean; sneak: boolean; sprint: boolean } {
    const g = this.g, active = this.controlling && g.player.alive;
    const k = (a: Bindable) => active && this.held(a);
    const t = active ? g.touch : null;
    const pad = active ? this.padMove : [0, 0];
    const forward = Math.max(-1, Math.min(1, (k('forward') ? 1 : 0) - (k('back') ? 1 : 0) + (t?.moveY ?? 0) + pad[1]));
    const strafe = Math.max(-1, Math.min(1, (k('right') ? 1 : 0) - (k('left') ? 1 : 0) + (t?.moveX ?? 0) + pad[0]));
    const toggleSneak = g.settings.toggleSneak, toggleSprint = g.settings.toggleSprint;
    const sneak = active && ((toggleSneak ? this.sneakLatch : this.held('sneak')) || !!t?.sneak || this.padSneak);
    const sprint = active && ((toggleSprint ? this.sprintLatch : this.held('sprint')) || (t ? t.moveY > 0.9 : false) || this.padSprint);
    const jump = active && (this.held('jump') || !!t?.jump || this.padJump);
    return { forward, strafe, jump, sneak, sprint };
  }

  // ---------- DOM events ----------
  bind(): void {
    const g = this.g;
    g.canvas.addEventListener('click', () => {
      initAudio();
      this.padActive = false;
      // Clicking back into the world closes an open chat bar (but not the delayed click that
      // follows the tap which opened it on a touch screen).
      if (g.chat.isOpen) { if (performance.now() - g.chat.openedAt > 400) g.chat.close(); }
      else this.lockPointer();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) this.everLocked = true;
      if (!this.locked && g.mode === 'playing' && !g.containers.open && !g.menus.current && !g.chat.isOpen && g.player.alive && !this.padActive) {
        g.menus.show('pause');
      }
      if (!this.locked) { this.mouse.fill(false); this.keys.clear(); }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022 * g.settings.sensitivity;
      g.turn(-e.movementX * s, -e.movementY * s * (g.settings.invertY ? -1 : 1));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse[e.button] = true;
      if (e.button === 0) g.actions.attack();
      if (e.button === 2) { g.actions.useCooldown = 0; g.actions.use(); }
      if (e.button === 1) g.actions.pickBlock();
    });
    document.addEventListener('mouseup', (e) => {
      this.mouse[e.button] = false;
      if (e.button === 0) { g.actions.breakProgress = 0; g.actions.breakPos = null; }
      if (e.button === 2) { g.actions.eating = 0; g.actions.releaseBow(); }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      const d = Math.sign(e.deltaY);
      // In Creative flight, Ctrl+scroll (or scroll while sprinting) changes flying speed.
      if (g.player.flying && (e.ctrlKey || this.held('sprint'))) { g.adjustFlySpeed(-d); return; }
      g.player.selected = (g.player.selected + d + 9) % 9;
    }, { passive: true });
    document.addEventListener('keydown', (e) => this.keyDown(e));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.fill(false); });
    window.addEventListener('gamepadconnected', () => g.toast('Controller connected. Left stick moves, right stick looks, triggers mine and place.', 5));
  }

  private keyDown(e: KeyboardEvent): void {
    const g = this.g;
    if (g.mode !== 'playing') return;
    const code = e.code;
    // The chat bar is open but its text box lost focus (you clicked elsewhere): Escape still
    // closes it, and typing goes back into it.
    if (g.chat.isOpen) {
      if (code === 'Escape') { e.preventDefault(); g.chat.close(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) g.chat.input.focus();
      return;
    }
    if (['F1', 'F2', 'F3', 'F5', 'Tab'].includes(code) || this.isKey('screenshot', code) || this.isKey('perspective', code)) e.preventDefault();
    if (g.containers.open) {
      if (this.isKey('inventory', code) || code === 'Escape') { e.preventDefault(); g.containers.close(); }
      else if (code.startsWith('Digit')) { const n = Number(code.slice(5)) - 1; if (n >= 0 && n < 9) g.containers.hotkey(n); }
      return;
    }
    if (g.map.open) {
      if (this.isKey('map', code) || code === 'Escape') { e.preventDefault(); g.map.close(); }
      return;
    }
    if (g.menus.current) {
      if (code === 'Escape' && g.menus.current === 'pause') { g.menus.show(null); this.lockPointer(); }
      return;
    }
    if (this.isKey('command', code) || this.isKey('chat', code)) {
      e.preventDefault();
      g.chat.open(this.isKey('command', code) ? '/' : '');
      return;
    }
    // Any key other than Escape counts as a gesture, so it can take the mouse back after a screen
    // was closed with Escape.
    if (!this.controlling && code !== 'Escape') { this.padActive = false; this.lockPointer(); }
    if (!this.controlling) return;
    if (e.repeat && this.keys.has(code)) return;
    this.keys.add(code);
    if (this.isKey('jump', code)) this.jumpPressed();
    if (this.isKey('forward', code)) {
      const now = performance.now();
      if (now - this.lastW < 280) g.player.sprinting = true;
      this.lastW = now;
    }
    if (this.isKey('sprint', code) && g.settings.toggleSprint) this.sprintLatch = !this.sprintLatch;
    if (this.isKey('sneak', code) && g.settings.toggleSneak) this.sneakLatch = !this.sneakLatch;
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5)) - 1;
      if (n >= 0 && n < 9) g.player.selected = n;
    }
    if (this.isKey('inventory', code) && g.player.alive) g.openInventory();
    if (this.isKey('drop', code)) g.actions.dropHeld(e.ctrlKey || e.metaKey);
    if (this.isKey('debug', code)) g.toggleDebug();
    if (this.isKey('hideHud', code)) g.toggleHud();
    if (this.isKey('screenshot', code)) g.screenshot();
    if (this.isKey('perspective', code)) g.cyclePerspective();
    if (this.isKey('map', code)) { document.exitPointerLock(); g.map.show(); }
  }

  /** Jump pressed: double-tap toggles flight in Creative. */
  jumpPressed(): void {
    const g = this.g, now = performance.now();
    if (g.player.creative && now - this.lastSpace < 300) { g.player.flying = !g.player.flying; this.lastSpace = 0; }
    else this.lastSpace = now;
  }

  // ---------- Gamepad ----------
  /** Poll the first connected gamepad; call once per frame. */
  pollGamepad(dt: number): void {
    const g = this.g;
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected);
    if (!pad) { this.padMove = [0, 0]; this.padLook = [0, 0]; return; }
    const ax = (i: number) => { const v = pad.axes[i] ?? 0; return Math.abs(v) < PAD_DEAD ? 0 : (v - Math.sign(v) * PAD_DEAD) / (1 - PAD_DEAD); };
    const btn = (i: number) => !!pad.buttons[i]?.pressed;
    const pressed = (i: number) => btn(i) && !this.padPrev[i];
    const anyInput = pad.buttons.some((b) => b.pressed) || pad.axes.some((a) => Math.abs(a) > 0.4);
    if (anyInput && !this.padActive) { this.padActive = true; document.exitPointerLock?.(); }
    if (!this.padActive) { this.padPrev = pad.buttons.map((b) => b.pressed); return; }

    this.padMove = [ax(0), -ax(1)];
    const look = 2.6 * g.settings.sensitivity * dt;
    const lx = ax(2), ly = ax(3);
    // Squared response gives fine aim near the centre and fast turns at the edge.
    this.padLook = [-Math.sign(lx) * lx * lx * look, -Math.sign(ly) * ly * ly * look * (g.settings.invertY ? -1 : 1)];

    // Screens: B or Start closes whatever is open.
    const uiOpen = g.containers.open || g.menus.current || g.chat.isOpen || g.map.open;
    if (uiOpen) {
      if (pressed(1) || pressed(9) || (pressed(3) && g.containers.open)) {
        if (g.containers.open) g.containers.close();
        else if (g.map.open) g.map.close();
        else if (g.chat.isOpen) g.chat.close();
        else if (g.menus.current === 'pause') g.menus.show(null);
      }
      this.padPrev = pad.buttons.map((b) => b.pressed);
      return;
    }
    if (g.mode === 'playing') {
      this.padJump = btn(0);
      if (pressed(0)) this.jumpPressed();
      this.padSneak = btn(1);
      if (pressed(10)) this.padSprint = !this.padSprint;
      if (this.padMove[1] <= 0.1) this.padSprint = false;
      // Triggers: right mines/attacks, left uses/places.
      if (pressed(7)) { this.mouse[0] = true; g.actions.attack(); }
      if (!btn(7) && this.padPrev[7]) { this.mouse[0] = false; g.actions.breakProgress = 0; g.actions.breakPos = null; }
      if (pressed(6)) { this.mouse[2] = true; g.actions.useCooldown = 0; g.actions.use(); }
      if (!btn(6) && this.padPrev[6]) { this.mouse[2] = false; g.actions.eating = 0; g.actions.releaseBow(); }
      if (pressed(4)) g.player.selected = (g.player.selected + 8) % 9;
      if (pressed(5)) g.player.selected = (g.player.selected + 1) % 9;
      if (pressed(3)) g.openInventory();
      if (pressed(2)) g.actions.dropHeld(false);
      if (pressed(9)) g.menus.show('pause');
      if (pressed(8)) g.map.show();
      if (pressed(11)) g.actions.pickBlock();
      if (pressed(12)) g.cyclePerspective();
    }
    this.padPrev = pad.buttons.map((b) => b.pressed);
  }
}
