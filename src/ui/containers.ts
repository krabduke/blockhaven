// Inventory and container screens: player inventory with 2x2 crafting,
// crafting table, furnace, chest and the creative item palette.

import { sfx } from '../audio';
import { SMELTING, craft } from '../crafting';
import type { Inventory, Slot } from '../inventory';
import { BREW_TICKS, brewFuel, isBrewIngredient } from '../brewing';
import { ENCHANT_NAMES, I, creativeCategory, creativeItems, itemDef, maxDurability, maxStack, type CreativeTab, type ItemStack } from '../items';

const TABS: [CreativeTab, string][] = [['all', 'All'], ['building', 'Building'], ['nature', 'Nature'], ['decor', 'Decoration'], ['power', 'Power'], ['tools', 'Tools & combat'], ['food', 'Food & farming'], ['misc', 'Other']];
import { offers, roman } from '../enchanting';
import { PROFESSION_NAMES, type TradeOffer } from '../trading';
import type { Player } from '../player';
import type { BrewingBE, FurnaceBE, HopperBE } from '../world/world';
import { slotHTML } from './hud';

export type ContainerKind = 'player' | 'crafting' | 'furnace' | 'chest' | 'creative' | 'enchant' | 'trade' | 'brewing' | 'hopper';

interface SlotRef {
  get(): Slot;
  set(s: Slot): void;
  /** 'result' slots can only be taken from; 'palette' slots hand out infinite stacks. */
  role: 'normal' | 'result' | 'output' | 'palette';
  group: 'player' | 'hotbar' | 'container' | 'craft' | 'armor';
  /** Armor slots accept only their piece type. */
  accepts?: (s: ItemStack) => boolean;
  el?: HTMLElement;
}

export class ContainerScreen {
  root: HTMLElement;
  open = false;
  kind: ContainerKind = 'player';
  cursor: Slot = null;
  private refs: SlotRef[] = [];
  private craftGrid: Slot[] = [];
  private craftW = 2;
  private furnace: FurnaceBE | null = null;
  private brewing: BrewingBE | null = null;
  private hopper: HopperBE | null = null;
  private chest: Inventory | null = null;
  private cursorEl: HTMLElement;
  private tooltip: HTMLElement;
  private hovered: SlotRef | null = null;
  private progressEls: { cook?: HTMLElement; burn?: HTMLElement } = {};
  private search = '';
  private tab: CreativeTab = 'all';
  /** Dragging a held stack across slots to share it out (left) or drop one in each (right). */
  private drag: { button: number; refs: SlotRef[] } | null = null;
  onClose: () => void = () => {};
  private openedAt = 0;
  onDrop: (stack: ItemStack) => void = () => {};
  /** Taking smelted items out of a furnace gives experience. */
  onSmeltTaken: (stack: ItemStack) => void = () => {};
  onCrafted: (stack: ItemStack) => void = () => {};
  onEnchanted: () => void = () => {};
  private enchantSlot: ItemStack | null = null;
  private bookshelves = 0;
  enchantSeed = Math.floor(Math.random() * 1e9);
  private optsEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, private player: Player) {
    this.root = document.createElement('div');
    this.root.className = 'screen dim';
    this.root.id = 'container';
    parent.appendChild(this.root);
    this.cursorEl = document.createElement('div');
    this.cursorEl.id = 'cursor-item';
    document.body.appendChild(this.cursorEl);
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'tooltip';
    document.body.appendChild(this.tooltip);
    window.addEventListener('mousemove', (e) => {
      if (!this.open) return;
      this.cursorEl.style.left = e.clientX + 'px';
      this.cursorEl.style.top = e.clientY + 'px';
      this.tooltip.style.left = e.clientX + 14 + 'px';
      this.tooltip.style.top = e.clientY - 30 + 'px';
    });
    // Clicking the empty backdrop closes the screen (when you aren't holding a stack; then it drops it).
    let downOnBackdrop = false;
    // (Ignore the first moments after opening: on touch screens the tap that opened the screen
    // is followed by a delayed click at the same spot.)
    this.root.addEventListener('click', (e) => { if (e.target === this.root && downOnBackdrop && performance.now() - this.openedAt > 400) this.close(); });
    this.root.addEventListener('mousedown', (e) => {
      downOnBackdrop = e.target === this.root && !this.cursor && e.button === 0;
      if (e.target === this.root && this.cursor) {
        // Clicking outside the panel drops the held stack.
        const drop = e.button === 2 ? { ...this.cursor, count: 1 } : this.cursor;
        this.onDrop(drop);
        if (e.button === 2 && this.cursor.count > 1) this.cursor.count--;
        else this.cursor = null;
        this.render();
      }
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mouseup', () => this.endDrag());
  }

  private villager: { offers: TradeOffer[]; profession: string } | null = null;
  onTraded: () => void = () => {};

  show(kind: ContainerKind, opts: { furnace?: FurnaceBE; chest?: Inventory; bookshelves?: number; villager?: { offers: TradeOffer[]; profession: string }; brewing?: BrewingBE; hopper?: HopperBE } = {}): void {
    this.brewing = opts.brewing ?? null;
    this.hopper = opts.hopper ?? null;
    this.kind = kind;
    this.villager = opts.villager ?? null;
    this.bookshelves = opts.bookshelves ?? 0;
    this.furnace = opts.furnace ?? null;
    this.chest = opts.chest ?? null;
    this.craftW = kind === 'crafting' ? 3 : 2;
    this.craftGrid = new Array(this.craftW * this.craftW).fill(null);
    this.open = true;
    this.openedAt = performance.now();
    // An inventory needs the mouse pointer; however it was opened, release the captured mouse.
    document.exitPointerLock?.();
    this.build();
    this.root.classList.add('show');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    // Return crafting grid and cursor items to the inventory (drop what doesn't fit).
    for (const s of [...this.craftGrid, this.cursor, this.enchantSlot]) {
      if (!s) continue;
      const left = this.player.inv.add(s);
      if (left) this.onDrop(left);
    }
    this.craftGrid = [];
    this.cursor = null;
    this.enchantSlot = null;
    this.root.classList.remove('show');
    this.cursorEl.innerHTML = '';
    this.tooltip.style.display = 'none';
    this.onClose();
  }

  /** Number key pressed while hovering: swap with that hotbar slot. */
  hotkey(n: number): boolean {
    if (!this.open || !this.hovered || this.hovered.role === 'palette' || this.hovered.role === 'result') return false;
    const h = this.hovered;
    const a = h.get(), b = this.player.inv.slots[n];
    h.set(b ? { ...b } : null);
    this.player.inv.slots[n] = a ? { ...a } : null;
    this.render();
    return true;
  }

  private slot(ref: SlotRef, big = false): HTMLElement {
    const el = document.createElement('div');
    el.className = 'slot' + (big ? ' big' : '');
    ref.el = el;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this.cursor && !e.shiftKey && (e.button === 0 || e.button === 2) && this.canSpread(ref)) {
        this.drag = { button: e.button, refs: [ref] };
        el.classList.add('drag');
        return;
      }
      this.click(ref, e.button, e.shiftKey);
    });
    el.addEventListener('dblclick', (e) => { e.preventDefault(); this.gather(ref); });
    el.addEventListener('mouseenter', () => {
      this.hovered = ref;
      this.showTip(ref);
      if (this.drag && this.canSpread(ref) && !this.drag.refs.includes(ref)) { this.drag.refs.push(ref); el.classList.add('drag'); this.previewSpread(); }
    });
    el.addEventListener('mouseleave', () => { if (this.hovered === ref) this.hovered = null; this.tooltip.style.display = 'none'; });
    this.refs.push(ref);
    return el;
  }

  private showTip(ref: SlotRef): void {
    const s = ref.get();
    if (!s || this.cursor) { this.tooltip.style.display = 'none'; return; }
    const d = itemDef(s.id);
    const max = maxDurability(s.id);
    let html = escapeHtml(d?.name ?? '');
    for (const e of s.ench ?? []) html += `<br><span style="color:#b8a0f0">${ENCHANT_NAMES[e.id]} ${roman(e.level)}</span>`;
    if (d?.armor) html += `<br><span style="color:#8ab0f0">+${d.armor.points} armor</span>`;
    if (max && s.damage) html += `<br><span style="color:#b9ad95">Durability ${max - s.damage} / ${max}</span>`;
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = 'block';
  }

  private grid(cols: number, refs: SlotRef[]): HTMLElement {
    const g = document.createElement('div');
    g.className = 'grid';
    g.style.gridTemplateColumns = `repeat(${cols}, auto)`;
    for (const r of refs) g.appendChild(this.slot(r));
    return g;
  }

  private invRef(inv: Inventory, i: number, group: SlotRef['group']): SlotRef {
    return { get: () => inv.slots[i], set: (s) => { inv.slots[i] = s; }, role: 'normal', group };
  }

  private build(): void {
    this.refs = [];
    this.root.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'panel inv';
    this.root.appendChild(panel);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-x';
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (E or Esc)';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());
    panel.appendChild(closeBtn);
    const inv = this.player.inv;

    if (this.kind === 'creative') {
      const title = document.createElement('h3');
      title.textContent = 'All blocks and items';
      panel.appendChild(title);
      const search = document.createElement('input');
      search.className = 'field search';
      search.placeholder = 'Search items';
      search.value = this.search;
      search.addEventListener('input', () => { this.search = search.value; if (search.value) this.tab = 'all'; this.build(); const s = this.root.querySelector('input.search') as HTMLInputElement; s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
      // Typing goes to the search box, but Escape still closes the screen and Enter leaves the box.
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        else if (e.key === 'Enter') search.blur();
      });
      panel.appendChild(search);
      const tabs = document.createElement('div');
      tabs.className = 'tabs';
      tabs.setAttribute('role', 'tablist');
      for (const [id, label] of TABS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tab' + (this.tab === id ? ' on' : '');
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(this.tab === id));
        b.textContent = label;
        b.addEventListener('click', () => { this.tab = id; this.search = ''; this.build(); });
        tabs.appendChild(b);
      }
      panel.appendChild(tabs);
      const q = this.search.trim().toLowerCase();
      const ids = creativeItems().filter((id) => (q ? itemDef(id)?.name.toLowerCase().includes(q) ?? false : this.tab === 'all' || creativeCategory(id) === this.tab));
      const refs: SlotRef[] = ids.map((id) => ({ get: () => ({ id, count: 1 }), set: () => {}, role: 'palette', group: 'container' }));
      const wrap = this.grid(9, refs);
      wrap.classList.add('creative-grid');
      panel.appendChild(wrap);
      if (!ids.length) {
        const e = document.createElement('div');
        e.className = 'empty';
        e.textContent = 'No items match that search.';
        panel.appendChild(e);
      }
      panel.appendChild(Object.assign(document.createElement('div'), { className: 'gap' }));
      panel.appendChild(this.grid(9, Array.from({ length: 9 }, (_, i) => this.invRef(inv, i, 'hotbar'))));
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Click an item to pick up a full stack. Click the palette while holding something to delete it.';
      panel.appendChild(hint);
      this.render();
      return;
    }

    const top = document.createElement('div');
    top.className = 'inv-top';
    if (this.kind === 'player') {
      const col = document.createElement('div');
      col.className = 'player-col';
      ['Head', 'Chest', 'Legs', 'Feet'].forEach((hint, i) => {
        const ref = this.invRef(this.player.armor, i, 'armor');
        ref.accepts = (st) => itemDef(st.id)?.armor?.slot === i;
        const el = this.slot(ref);
        el.classList.add('armor-slot');
        el.dataset.hint = hint;
        col.appendChild(el);
      });
      top.appendChild(col);
    }
    if (this.kind === 'trade' && this.villager) {
      const t = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = `${PROFESSION_NAMES[this.villager.profession] ?? 'Villager'}: trades`;
      t.appendChild(h);
      const list = document.createElement('div');
      list.className = 'enchant-opts trade-list';
      t.appendChild(list);
      top.appendChild(t);
      this.optsEl = list;
    }
    if (this.kind === 'enchant') {
      const ref: SlotRef = { get: () => this.enchantSlot, set: (s) => { this.enchantSlot = s; this.renderOffers(); }, role: 'normal', group: 'container' };
      top.appendChild(this.slot(ref, true));
      const opts = document.createElement('div');
      opts.className = 'enchant-opts';
      top.appendChild(opts);
      this.optsEl = opts;
    }
    if (this.kind === 'player' || this.kind === 'crafting') {
      const w = this.craftW;
      const craftRefs: SlotRef[] = Array.from({ length: w * w }, (_, i) => ({ get: () => this.craftGrid[i], set: (s) => { this.craftGrid[i] = s; }, role: 'normal', group: 'craft' }));
      top.appendChild(this.grid(w, craftRefs));
      top.appendChild(Object.assign(document.createElement('div'), { className: 'arrow', textContent: '⇨' }));
      const result: SlotRef = { get: () => craft(this.craftGrid, w), set: () => {}, role: 'result', group: 'craft' };
      top.appendChild(this.slot(result, true));
    } else if (this.kind === 'furnace' && this.furnace) {
      const f = this.furnace;
      const col = document.createElement('div');
      col.className = 'furnace-col';
      col.appendChild(this.slot(this.invRef(f.inv, 0, 'container')));
      const flame = document.createElement('div');
      flame.className = 'flame';
      flame.innerHTML = '<i></i>';
      col.appendChild(flame);
      col.appendChild(this.slot(this.invRef(f.inv, 1, 'container')));
      top.appendChild(col);
      const prog = document.createElement('div');
      prog.className = 'progress';
      prog.innerHTML = '<i></i>';
      top.appendChild(prog);
      const out = this.invRef(f.inv, 2, 'container');
      out.role = 'output';
      top.appendChild(this.slot(out, true));
      this.progressEls = { cook: prog.firstElementChild as HTMLElement, burn: flame.firstElementChild as HTMLElement };
    } else if (this.kind === 'brewing' && this.brewing) {
      // Ingredient on top, fuel to the left, three bottles along the bottom.
      const bw = this.brewing;
      const stand = document.createElement('div');
      stand.className = 'brew';
      const ing = this.invRef(bw.inv, 0, 'container');
      ing.accepts = (s) => isBrewIngredient(s.id);
      const fuel = this.invRef(bw.inv, 1, 'container');
      fuel.accepts = (s) => brewFuel(s.id) > 0;
      const bottles = [2, 3, 4].map((i) => { const r = this.invRef(bw.inv, i, 'container'); r.accepts = (s) => s.id === I.water_bottle || !!itemDef(s.id)?.potion; return r; });
      const head = document.createElement('h3'); head.textContent = 'Brewing Stand';
      const fuelBar = document.createElement('div'); fuelBar.className = 'brew-fuel'; fuelBar.innerHTML = '<i></i>';
      const bubbles = document.createElement('div'); bubbles.className = 'brew-progress'; bubbles.innerHTML = '<i></i>';
      const fuelCol = document.createElement('div'); fuelCol.className = 'brew-col';
      fuelCol.append(this.slot(fuel), fuelBar);
      const mid = document.createElement('div'); mid.className = 'brew-col';
      mid.append(this.slot(ing), bubbles);
      const row = document.createElement('div'); row.className = 'brew-bottles';
      for (const b of bottles) row.appendChild(this.slot(b));
      const top2 = document.createElement('div'); top2.className = 'brew-top';
      top2.append(fuelCol, mid);
      stand.append(head, top2, row);
      top.appendChild(stand);
      this.progressEls = { cook: bubbles.firstElementChild as HTMLElement, burn: fuelBar.firstElementChild as HTMLElement };
    } else if (this.kind === 'hopper' && this.hopper) {
      const inv = this.hopper.inv;
      const t = document.createElement('div');
      const h = document.createElement('h3'); h.textContent = 'Hopper';
      t.append(h, this.grid(5, Array.from({ length: 5 }, (_, i) => this.invRef(inv, i, 'container'))));
      top.appendChild(t);
    } else if (this.kind === 'chest' && this.chest) {
      const chest = this.chest;
      const t = document.createElement('div');
      const h = document.createElement('h3'); h.textContent = 'Chest';
      t.appendChild(h);
      t.appendChild(this.grid(9, Array.from({ length: 27 }, (_, i) => this.invRef(chest, i, 'container'))));
      top.appendChild(t);
    }
    panel.appendChild(top);
    if (this.kind === 'enchant') this.renderOffers();
    if (this.kind === 'trade') this.renderTrades();
    const label = document.createElement('h3');
    label.textContent = 'Inventory';
    panel.appendChild(label);
    panel.appendChild(this.grid(9, Array.from({ length: 27 }, (_, i) => this.invRef(inv, i + 9, 'player'))));
    panel.appendChild(Object.assign(document.createElement('div'), { className: 'gap' }));
    panel.appendChild(this.grid(9, Array.from({ length: 9 }, (_, i) => this.invRef(inv, i, 'hotbar'))));
    this.render();
  }

  private invKey(): string {
    return this.player.inv.slots.map((s) => (s ? s.id + ':' + s.count : '-')).join(',');
  }

  private renderTrades(): void {
    const el = this.optsEl, v = this.villager;
    if (!el || !v) return;
    el.innerHTML = '';
    const inv = this.player.inv;
    const icon = (s: ItemStack) => `<span class="trade-item">${slotHTML(s.id, s.count, undefined, !!s.ench?.length)}</span>`;
    v.offers.forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn trade-opt';
      const affordable = o.give.every((g) => inv.count(g.id) >= g.count);
      const soldOut = o.uses >= o.maxUses;
      b.disabled = !affordable || soldOut;
      b.innerHTML = `${o.give.map(icon).join('')}<span class="arrow">⇨</span>${icon(o.get)}${soldOut ? '<span class="lv">Sold out</span>' : ''}`;
      b.title = `${o.give.map((g) => `${g.count} ${itemDef(g.id)?.name}`).join(' + ')} for ${o.get.count} ${itemDef(o.get.id)?.name}`;
      b.addEventListener('click', () => {
        if (!o.give.every((g) => inv.count(g.id) >= g.count) || o.uses >= o.maxUses) return;
        for (const g of o.give) {
          let left = g.count;
          for (let i = 0; i < inv.size && left > 0; i++) {
            const s = inv.slots[i];
            if (!s || s.id !== g.id) continue;
            const n = Math.min(left, s.count);
            s.count -= n; left -= n;
            if (s.count <= 0) inv.slots[i] = null;
          }
        }
        const got = { ...o.get, ench: o.get.ench ? o.get.ench.map((e) => ({ ...e })) : undefined };
        const rest = inv.add(got);
        if (rest) this.onDrop(rest);
        o.uses++;
        this.player.addXp(1 + Math.floor(Math.random() * 3));
        sfx.pop();
        this.onTraded();
        this.render();
        this.renderTrades();
      });
      el.appendChild(b);
    });
  }

  private renderOffers(): void {
    const el = this.optsEl;
    if (!el || this.kind !== 'enchant') return;
    el.innerHTML = '';
    const list = offers(this.enchantSlot, this.bookshelves, this.enchantSeed);
    if (!this.enchantSlot) {
      el.innerHTML = '<p class="hint">Put a tool, weapon or piece of armor in the slot to see what it can become.</p>';
      return;
    }
    if (!list.length) {
      el.innerHTML = '<p class="hint">This item can\'t be enchanted.</p>';
      return;
    }
    const p = this.player;
    list.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'btn enchant-opt';
      b.type = 'button';
      const can = p.creative || p.xpLevel >= o.required;
      b.disabled = !can;
      b.innerHTML = `<span>${ENCHANT_NAMES[o.enchant.id]} ${roman(o.enchant.level)}</span><span class="lv">${p.creative ? '' : `Level ${o.required} · costs ${o.cost}`}</span>`;
      b.addEventListener('click', () => {
        if (!this.enchantSlot || (!p.creative && p.xpLevel < o.required)) return;
        this.enchantSlot.ench = [o.enchant];
        // A second, weaker enchant sometimes comes along.
        if (o.cost === 3 && o.enchant.id !== 'unbreaking' && Math.random() < 0.5) this.enchantSlot.ench.push({ id: 'unbreaking', level: 1 + Math.floor(Math.random() * 2) });
        if (!p.creative) p.spendLevels(o.cost);
        this.enchantSeed = Math.floor(Math.random() * 1e9);
        sfx.levelUp();
        this.onEnchanted();
        this.render();
        this.renderOffers();
      });
      el.appendChild(b);
    });
  }

  render(): void {
    if (this.kind === 'trade' && this.optsEl && this.optsEl.dataset.inv !== this.invKey()) { this.optsEl.dataset.inv = this.invKey(); this.renderTrades(); }
    for (const r of this.refs) {
      const s = r.get();
      const html = s ? slotHTML(s.id, r.role === 'palette' ? 1 : s.count, s.damage, !!s.ench?.length) : '';
      if (r.el && r.el.dataset.k !== html) { r.el.innerHTML = html; r.el.dataset.k = html; }
    }
    this.cursorEl.innerHTML = this.cursor ? slotHTML(this.cursor.id, this.cursor.count, this.cursor.damage, !!this.cursor.ench?.length) : '';
    if (this.brewing && this.progressEls.cook) {
      this.progressEls.cook.style.height = `${(this.brewing.brew / BREW_TICKS) * 100}%`;
      this.progressEls.burn!.style.width = `${Math.min(100, (this.brewing.fuel / 10) * 100)}%`;
    }
    if (this.furnace && this.progressEls.cook) {
      this.progressEls.cook.style.width = `${(this.furnace.cook / 200) * 100}%`;
      this.progressEls.burn!.style.height = `${this.furnace.burnMax ? (this.furnace.burn / this.furnace.burnMax) * 100 : 0}%`;
    }
  }

  private consumeCraft(): void {
    for (let i = 0; i < this.craftGrid.length; i++) {
      const s = this.craftGrid[i];
      if (!s) continue;
      // Buckets come back empty.
      if (s.id === 276 || s.id === 278) { this.craftGrid[i] = { id: 275, count: 1 }; continue; }
      s.count--;
      if (s.count <= 0) this.craftGrid[i] = null;
    }
  }

  private click(ref: SlotRef, button: number, shift: boolean): void {
    sfx.click();
    const inv = this.player.inv;
    if (ref.role === 'palette') {
      const s = ref.get()!;
      if (this.cursor) this.cursor = null;
      else this.cursor = { id: s.id, count: shift ? maxStack(s.id) : button === 2 ? 1 : maxStack(s.id) };
      this.render();
      return;
    }
    if (ref.role === 'result') {
      const res = ref.get();
      if (!res) return;
      if (shift) {
        // Craft as many as fit.
        for (let n = 0; n < 64; n++) {
          const r = craft(this.craftGrid, this.craftW);
          if (!r) break;
          this.onCrafted(r);
          const left = inv.add(r);
          this.consumeCraft();
          if (left) { this.onDrop(left); break; }
        }
      } else if (!this.cursor) {
        this.cursor = res;
        this.consumeCraft();
        this.onCrafted(res);
      } else if (this.cursor.id === res.id && this.cursor.count + res.count <= maxStack(res.id)) {
        this.cursor.count += res.count;
        this.consumeCraft();
        this.onCrafted(res);
      }
      this.render();
      return;
    }
    const cur = ref.get();
    if (shift && cur) {
      this.quickMove(ref, cur);
      this.render();
      return;
    }
    if (ref.role === 'output') {
      if (!cur) return;
      if (!this.cursor) { this.cursor = cur; ref.set(null); this.onSmeltTaken(cur); }
      else if (this.cursor.id === cur.id && this.cursor.count + cur.count <= maxStack(cur.id)) { this.cursor.count += cur.count; ref.set(null); this.onSmeltTaken(cur); }
      this.render();
      return;
    }
    if (this.cursor && ref.accepts && !ref.accepts(this.cursor)) return;
    if (button === 2) {
      if (!this.cursor && cur) {
        const take = Math.ceil(cur.count / 2);
        this.cursor = { ...cur, count: take };
        cur.count -= take;
        if (cur.count <= 0) ref.set(null);
      } else if (this.cursor && (!cur || (cur.id === this.cursor.id && cur.count < maxStack(cur.id) && !cur.damage))) {
        if (!cur) ref.set({ ...this.cursor, count: 1 });
        else cur.count++;
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      }
    } else {
      if (!this.cursor) {
        if (cur) { this.cursor = cur; ref.set(null); }
      } else if (!cur) {
        ref.set(this.cursor); this.cursor = null;
      } else if (cur.id === this.cursor.id && maxStack(cur.id) > 1) {
        const n = Math.min(this.cursor.count, maxStack(cur.id) - cur.count);
        cur.count += n; this.cursor.count -= n;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        ref.set(this.cursor); this.cursor = cur;
      }
    }
    this.render();
    this.showTip(ref);
  }

  /** A slot the held stack could be shared into (empty, or the same item with room). */
  private canSpread(ref: SlotRef): boolean {
    if (ref.role !== 'normal' || !this.cursor) return false;
    if (ref.accepts && !ref.accepts(this.cursor)) return false;
    const cur = ref.get();
    return !cur || (cur.id === this.cursor.id && !cur.damage && !cur.ench && cur.count < maxStack(cur.id));
  }

  private previewSpread(): void {
    if (!this.drag || !this.cursor) return;
    const n = this.drag.refs.length;
    const each = this.drag.button === 2 ? 1 : Math.floor(this.cursor.count / n);
    this.cursorEl.dataset.spread = each > 0 ? `${each} each` : '';
  }

  /** Mouse released after a drag: share the stack out over the slots it crossed. */
  endDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    delete this.cursorEl.dataset.spread;
    for (const r of d.refs) r.el?.classList.remove('drag');
    if (d.refs.length === 1) { this.click(d.refs[0], d.button, false); return; }
    const c = this.cursor;
    if (!c) return;
    const each = d.button === 2 ? 1 : Math.floor(c.count / d.refs.length);
    if (each <= 0) return;
    for (const r of d.refs) {
      if (!this.cursor || this.cursor.count <= 0) break;
      const cur = r.get();
      const room = cur ? maxStack(cur.id) - cur.count : maxStack(c.id);
      const n = Math.min(each, room, this.cursor.count);
      if (n <= 0) continue;
      if (cur) cur.count += n; else r.set({ ...c, count: n });
      this.cursor.count -= n;
    }
    if (this.cursor && this.cursor.count <= 0) this.cursor = null;
    sfx.click();
    this.render();
  }

  /** Double-click: collect every stack of this item into the held one. */
  private gather(ref: SlotRef): void {
    if (ref.role !== 'normal') return;
    if (!this.cursor) {
      const cur = ref.get();
      if (!cur) return;
      this.cursor = cur;
      ref.set(null);
    }
    const c = this.cursor;
    if (c.damage || c.ench) { this.render(); return; }
    const max = maxStack(c.id);
    for (const r of this.refs) {
      if (c.count >= max) break;
      if (r.role !== 'normal') continue;
      const s = r.get();
      if (!s || s.id !== c.id || s.damage || s.ench) continue;
      const n = Math.min(s.count, max - c.count);
      c.count += n; s.count -= n;
      if (s.count <= 0) r.set(null);
    }
    sfx.click();
    this.render();
  }

  private quickMove(ref: SlotRef, stack: ItemStack): void {
    const inv = this.player.inv;
    let left: ItemStack | null = stack;
    ref.set(null);
    const armorSlot = itemDef(stack.id)?.armor?.slot;
    if (this.kind === 'player' && armorSlot !== undefined && ref.group !== 'armor' && !this.player.armor.slots[armorSlot]) {
      this.player.armor.slots[armorSlot] = stack;
      return;
    }
    if (ref.group === 'container' || ref.group === 'craft' || ref.group === 'armor') {
      left = inv.add(stack, 0, 36);
    } else if (this.kind === 'chest' && this.chest) {
      left = this.chest.add(stack);
    } else if (this.kind === 'hopper' && this.hopper) {
      left = this.hopper.inv.add(stack);
    } else if (this.kind === 'brewing' && this.brewing) {
      const bw = this.brewing.inv;
      const target = brewFuel(stack.id) > 0 && !isBrewIngredient(stack.id) ? [1] : isBrewIngredient(stack.id) ? [0] : stack.id === I.water_bottle || itemDef(stack.id)?.potion ? [2, 3, 4] : [];
      left = stack;
      for (const t of target) {
        if (!left) break;
        const cur = bw.slots[t];
        if (!cur) { bw.slots[t] = t >= 2 ? { ...left, count: 1 } : left; left = t >= 2 && left.count > 1 ? { ...left, count: left.count - 1 } : null; }
        else if (cur.id === left.id && t < 2) { const n = Math.min(left.count, maxStack(left.id) - cur.count); cur.count += n; left = left.count - n > 0 ? { ...left, count: left.count - n } : null; }
      }
    } else if (this.kind === 'furnace' && this.furnace) {
      const f = this.furnace.inv;
      const target = itemDef(stack.id)?.fuelTicks && !isSmeltable(stack.id) ? 1 : 0;
      const cur = f.slots[target];
      if (!cur) { f.slots[target] = stack; left = null; }
      else if (cur.id === stack.id) {
        const n = Math.min(stack.count, maxStack(stack.id) - cur.count);
        cur.count += n;
        left = stack.count - n > 0 ? { ...stack, count: stack.count - n } : null;
      }
    } else if (ref.group === 'hotbar') {
      left = inv.add(stack, 9, 36);
    } else {
      left = inv.add(stack, 0, 9);
    }
    if (left) {
      // Put back whatever didn't move.
      const back = ref.get();
      if (!back) ref.set(left);
      else { const l2 = inv.add(left); if (l2) this.onDrop(l2); }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function isSmeltable(id: number): boolean {
  return SMELTING[id] !== undefined;
}
