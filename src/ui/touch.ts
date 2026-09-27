// On-screen controls for phones and tablets: a movement stick on the left,
// drag anywhere else to look, and big buttons for mining, using, jumping and
// sneaking. Uses Pointer Events so it also works with a stylus.

export interface TouchCallbacks {
  mineStart(): void;
  mineEnd(): void;
  useStart(): void;
  useEnd(): void;
  jumpStart(): void;
  inventory(): void;
  chat(): void;
  pause(): void;
  drop(): void;
}

/** True on devices whose main pointer is a finger. `?touch=1` / `?touch=0` in the URL overrides it. */
export function isTouchDevice(): boolean {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  readonly root: HTMLElement;
  /** Stick position, -1..1 (x = strafe right, y = forward). */
  moveX = 0;
  moveY = 0;
  jump = false;
  sneak = false;
  private lookDX = 0;
  private lookDY = 0;
  private stickId = -1;
  private stickOrigin = [0, 0];
  private lookIds = new Map<number, [number, number]>();
  private knob: HTMLElement;
  private base: HTMLElement;
  private sneakBtn: HTMLElement;

  constructor(parent: HTMLElement, cb: TouchCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-look"></div>
      <div class="t-stick-zone"><div class="t-stick"><div class="t-knob"></div></div></div>
      <div class="t-top">
        <button type="button" class="t-btn small" data-a="chat" aria-label="Commands">/</button>
        <button type="button" class="t-btn small" data-a="drop" aria-label="Drop item">⇣</button>
        <button type="button" class="t-btn small" data-a="inventory" aria-label="Inventory">▦</button>
        <button type="button" class="t-btn small" data-a="pause" aria-label="Pause">❚❚</button>
      </div>
      <div class="t-actions">
        <button type="button" class="t-btn" data-a="use" aria-label="Use or place">Use</button>
        <button type="button" class="t-btn big" data-a="mine" aria-label="Mine or attack">Mine</button>
        <button type="button" class="t-btn" data-a="sneak" aria-label="Sneak">Sneak</button>
        <button type="button" class="t-btn big" data-a="jump" aria-label="Jump">Jump</button>
      </div>`;
    parent.appendChild(this.root);
    this.knob = this.root.querySelector('.t-knob')!;
    this.base = this.root.querySelector('.t-stick')!;
    this.sneakBtn = this.root.querySelector('[data-a=sneak]')!;

    // Movement stick: appears where the left thumb lands.
    const zone = this.root.querySelector('.t-stick-zone') as HTMLElement;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      this.stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const r = zone.getBoundingClientRect();
      this.stickOrigin = [e.clientX, e.clientY];
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('on');
      this.updateStick(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY); });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.moveX = this.moveY = 0;
      this.knob.style.transform = '';
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // Look: drag anywhere on the right of the screen.
    const look = this.root.querySelector('.t-look') as HTMLElement;
    look.addEventListener('pointerdown', (e) => { look.setPointerCapture(e.pointerId); this.lookIds.set(e.pointerId, [e.clientX, e.clientY]); });
    look.addEventListener('pointermove', (e) => {
      const last = this.lookIds.get(e.pointerId);
      if (!last) return;
      this.lookDX += e.clientX - last[0];
      this.lookDY += e.clientY - last[1];
      this.lookIds.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const endLook = (e: PointerEvent) => { this.lookIds.delete(e.pointerId); };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    // Buttons. Mine, use and jump act while held; the rest act on press.
    for (const btn of this.root.querySelectorAll<HTMLElement>('.t-btn')) {
      const a = btn.dataset.a!;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('down');
        // Holding a button can also steer the camera, like on a console.
        this.lookIds.set(e.pointerId, [e.clientX, e.clientY]);
        if (a === 'mine') cb.mineStart();
        else if (a === 'use') cb.useStart();
        else if (a === 'jump') { this.jump = true; cb.jumpStart(); }
        else if (a === 'sneak') { this.sneak = !this.sneak; this.sneakBtn.classList.toggle('active', this.sneak); }
        else if (a === 'inventory') cb.inventory();
        else if (a === 'chat') cb.chat();
        else if (a === 'pause') cb.pause();
        else if (a === 'drop') cb.drop();
      });
      btn.addEventListener('pointermove', (e) => {
        if (a !== 'mine' && a !== 'use') return;
        const last = this.lookIds.get(e.pointerId);
        if (!last) return;
        this.lookDX += e.clientX - last[0];
        this.lookDY += e.clientY - last[1];
        this.lookIds.set(e.pointerId, [e.clientX, e.clientY]);
      });
      const up = (e: PointerEvent) => {
        btn.classList.remove('down');
        this.lookIds.delete(e.pointerId);
        if (a === 'mine') cb.mineEnd();
        else if (a === 'use') cb.useEnd();
        else if (a === 'jump') this.jump = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private updateStick(x: number, y: number): void {
    const R = 56;
    let dx = x - this.stickOrigin[0], dy = y - this.stickOrigin[1];
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // A small dead zone so resting a thumb doesn't drift; output keeps the stick's direction.
    const mag = Math.min(1, len / R);
    const out = mag < 0.15 ? 0 : (mag - 0.15) / 0.85;
    this.moveX = len > 0 ? (dx / len) * out : 0;
    this.moveY = len > 0 ? (-dy / len) * out : 0;
  }

  /** Look movement since the last call, in pixels. */
  takeLook(): [number, number] {
    const d: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return d;
  }

  /** How far the stick is pushed forward, 0..1 (used for sprinting). */
  get push(): number {
    return Math.hypot(this.moveX, this.moveY);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('show', v);
    if (!v) {
      this.moveX = this.moveY = 0;
      this.jump = false;
      this.stickId = -1;
      this.lookIds.clear();
      this.base.classList.remove('on');
      this.knob.style.transform = '';
    }
  }
}
