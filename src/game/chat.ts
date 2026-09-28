// The chat / command bar: open and close, a message log, command history
// (Up and Down) and Tab completion with a suggestion strip.

import { completions, runCommand } from './commands';
import type { Game } from '../game';

const HISTORY_KEY = 'blockhaven.chatHistory';

export class Chat {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private log: HTMLElement;
  private suggest: HTMLElement;
  openedAt = 0;
  private history: string[] = [];
  private histIdx = -1;
  private draft = '';
  private cycle: { base: string; list: string[]; i: number } | null = null;

  constructor(private g: Game, root: HTMLElement) {
    this.el = root.querySelector('#cmd')!;
    this.input = this.el.querySelector('input')!;
    this.log = root.querySelector('#chatlog')!;
    this.suggest = document.createElement('div');
    this.suggest.id = 'cmd-suggest';
    this.el.appendChild(this.suggest);
    try { this.history = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { this.history = []; }
    this.el.querySelector('.close-x')!.addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('input', () => { this.cycle = null; this.showSuggestions(); });
  }

  get isOpen(): boolean { return this.el.classList.contains('show'); }

  open(prefix: string): void {
    this.openedAt = performance.now();
    document.exitPointerLock();
    this.el.classList.add('show');
    this.input.value = prefix;
    this.histIdx = -1;
    this.cycle = null;
    this.showSuggestions();
    setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    this.el.classList.remove('show');
    this.suggest.textContent = '';
    this.input.blur();
    this.g.input.lockPointer();
  }

  say(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    this.log.appendChild(d);
    setTimeout(() => d.remove(), 8000);
    while (this.log.childElementCount > 8) this.log.firstElementChild!.remove();
  }

  private key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const v = this.input.value.trim();
      this.close();
      if (!v) return;
      if (this.history[this.history.length - 1] !== v) this.history.push(v);
      this.history = this.history.slice(-50);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history)); } catch { /* storage unavailable */ }
      if (v.startsWith('/')) runCommand(this.g, v);
      else { this.say(`<${this.g.playerName}> ${v}`); this.g.net?.say(v); }
    } else if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.history.length) return;
      if (this.histIdx === -1) { this.draft = this.input.value; this.histIdx = this.history.length; }
      this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + (e.key === 'ArrowUp' ? -1 : 1)));
      this.input.value = this.histIdx === this.history.length ? this.draft : this.history[this.histIdx];
      this.cycle = null;
      this.showSuggestions();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      this.complete(e.shiftKey ? -1 : 1);
    }
  }

  /** Everything before the word being completed (the command's "/" counts as part of the head). */
  private static head(line: string): string {
    const sp = line.lastIndexOf(' ');
    return sp >= 0 ? line.slice(0, sp + 1) : line.startsWith('/') ? '/' : '';
  }

  /** Replace the word being typed with the next (or previous) completion. */
  private complete(dir: number): void {
    const v = this.input.value;
    if (!this.cycle || v !== Chat.head(this.cycle.base) + this.cycle.list[this.cycle.i]) {
      const list = completions(this.g, v);
      if (!list.length) return;
      this.cycle = { base: v, list, i: dir > 0 ? -1 : list.length };
    }
    const c = this.cycle;
    c.i = (c.i + dir + c.list.length) % c.list.length;
    this.input.value = Chat.head(c.base) + c.list[c.i];
    // A single match completes the word and moves on to the next argument.
    if (c.list.length === 1) { this.input.value += ' '; this.cycle = null; }
    this.showSuggestions(c.list, c.i);
  }

  private showSuggestions(list = completions(this.g, this.input.value), active = -1): void {
    this.suggest.textContent = '';
    if (!this.input.value.startsWith('/') || !list.length) return;
    const shown = list.slice(0, 12);
    for (let i = 0; i < shown.length; i++) {
      const s = document.createElement('span');
      s.textContent = shown[i];
      if (i === active) s.className = 'on';
      this.suggest.appendChild(s);
    }
    if (list.length > shown.length) this.suggest.appendChild(Object.assign(document.createElement('span'), { textContent: `+${list.length - shown.length} more`, className: 'more' }));
  }
}
