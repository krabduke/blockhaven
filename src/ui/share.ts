// The two shared-world screens. Connecting takes two codes passed by hand (in any chat app):
// the host makes an invite, the friend turns it into a reply, the host pastes the reply.
//
//   Invite a friend (pause menu)   1. your name  2. copy the invite  3. paste their reply -> Connect
//   Join a friend (title screen)   1. your name  2. paste the invite -> copy your reply  3. wait

import type { Game } from '../game';
import { saveSettings, button, el, type Menus } from './menus';

function stop(e: Event): void { e.stopPropagation(); }

/** A read-only code box with a copy button. */
function codeBox(label: string): { wrap: HTMLElement; set: (code: string) => void } {
  const wrap = el('div', { class: 'code-box stack', hidden: '' });
  const lab = el('span', { class: 'lbl' }, label);
  const area = el('textarea', { class: 'field code', readonly: '', rows: '3', spellcheck: 'false', 'aria-label': label });
  const copy = button('Copy', '', async () => {
    area.select();
    try { await navigator.clipboard.writeText(area.value); copy.textContent = 'Copied'; }
    catch { document.execCommand?.('copy'); copy.textContent = 'Copied'; }
    setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
  });
  wrap.append(lab, area, copy);
  return { wrap, set: (code) => { area.value = code; wrap.hidden = false; } };
}

function nameField(g: Game, id: string): HTMLInputElement {
  const input = el('input', { class: 'field', id, maxlength: '16', placeholder: 'Wanderer', autocomplete: 'nickname' });
  input.value = g.settings.name;
  input.addEventListener('keydown', stop);
  input.addEventListener('change', () => { g.settings.name = input.value.trim().slice(0, 16); saveSettings(g.settings); });
  return input;
}

export class ShareScreens {
  constructor(private g: Game, private menus: Menus) {
    menus.register('invite', this.buildInvite());
    menus.register('join', this.buildJoin());
  }

  // ---------------------------------------------------------------- Host
  private inviteReset: () => void = () => {};
  private buildInvite(): HTMLElement {
    const s = el('div', { class: 'screen dim', id: 'invite' });
    const p = el('div', { class: 'panel share stack' });
    const who = el('p', { class: 'hint' });
    const name = nameField(this.g, 'share-name');
    const status = el('p', { class: 'hint status', role: 'status' });
    const invite = codeBox('Your invite code: send it to your friend');
    const replyL = el('label', { class: 'lbl', for: 'share-reply', hidden: '' }, 'Their reply code');
    const reply = el('textarea', { class: 'field code', id: 'share-reply', rows: '3', spellcheck: 'false', placeholder: 'Paste the code your friend sends back', hidden: '' });
    reply.addEventListener('keydown', stop);
    let accept: ((r: string) => Promise<string>) | null = null;
    const make = button('Create an invite code', 'primary', async () => {
      make.disabled = true;
      status.textContent = 'Making a code…';
      try {
        const inv = await this.g.inviteFriend();
        accept = inv.accept;
        invite.set(inv.code);
        replyL.hidden = reply.hidden = connect.hidden = false;
        status.textContent = 'Send the invite to your friend. When they send a reply code back, paste it below.';
      } catch (e) { status.textContent = (e as Error).message; make.disabled = false; }
    });
    const connect = button('Connect', 'primary', async () => {
      if (!accept || !reply.value.trim()) { status.textContent = 'Paste your friend’s reply code first.'; return; }
      connect.disabled = true;
      status.textContent = 'Connecting…';
      try {
        const who2 = await accept(reply.value);
        status.textContent = `${who2} is in your world. Invite someone else, or go back to the game.`;
        this.refreshInvite(who);
        this.inviteReset();
      } catch (e) { status.textContent = `Couldn’t connect: ${(e as Error).message}`; connect.disabled = false; }
    });
    connect.hidden = true;
    this.inviteReset = () => {
      accept = null;
      make.disabled = false;
      invite.wrap.hidden = true;
      reply.value = '';
      replyL.hidden = reply.hidden = connect.hidden = true;
      connect.disabled = false;
    };
    p.append(
      el('h2', {}, 'Invite a friend'),
      el('p', { class: 'hint' }, 'Your friend joins this world from their own browser. You swap two codes by hand: yours, then their reply. Any chat app works.'),
      el('label', { class: 'lbl', for: 'share-name' }, 'Your name'), name,
      make, invite.wrap, replyL, reply, connect, status, who,
      button('Back', '', () => { this.inviteReset(); status.textContent = ''; this.menus.show('pause'); }),
    );
    s.appendChild(p);
    this.menus.onShow = (id) => {
      if (id === 'invite') { name.value = this.g.settings.name; this.refreshInvite(who); }
      if (id === 'join') this.joinShown();
    };
    return s;
  }

  private refreshInvite(who: HTMLElement): void {
    const net = this.g.net;
    const names = net && 'guestNames' in net ? net.guestNames : [];
    who.textContent = names.length ? `In your world now: ${names.join(', ')}.` : '';
  }

  // ---------------------------------------------------------------- Guest
  private joinShown: () => void = () => {};
  private buildJoin(): HTMLElement {
    const s = el('div', { class: 'screen dim', id: 'join' });
    const p = el('div', { class: 'panel share stack' });
    const name = nameField(this.g, 'join-name');
    const inviteL = el('label', { class: 'lbl', for: 'join-invite' }, 'Their invite code');
    const invite = el('textarea', { class: 'field code', id: 'join-invite', rows: '3', spellcheck: 'false', placeholder: 'Paste the code your friend sent you' });
    invite.addEventListener('keydown', stop);
    const reply = codeBox('Your reply code: send it back to your friend');
    const status = el('p', { class: 'hint status', role: 'status' });
    const go = button('Make my reply code', 'primary', async () => {
      if (!invite.value.trim()) { status.textContent = 'Paste your friend’s invite code first.'; return; }
      go.disabled = true;
      this.g.settings.name = name.value.trim().slice(0, 16);
      saveSettings(this.g.settings);
      status.textContent = 'Making your reply…';
      try {
        const { code, joined } = await this.g.joinFriend(invite.value);
        reply.set(code);
        status.textContent = 'Send the reply to your friend and keep this screen open. You’ll join as soon as they connect.';
        await joined;
      } catch (e) { status.textContent = `Couldn’t join: ${(e as Error).message}`; go.disabled = false; }
    });
    this.joinShown = () => { name.value = this.g.settings.name; go.disabled = false; status.textContent = ''; reply.wrap.hidden = true; invite.value = ''; };
    p.append(
      el('h2', {}, 'Join a friend'),
      el('p', { class: 'hint' }, 'Ask a friend to open their world and choose Invite a friend. They send you a code; you send one back.'),
      el('label', { class: 'lbl', for: 'join-name' }, 'Your name'), name,
      inviteL, invite, go, reply.wrap, status,
      button('Back', '', () => this.menus.show('title')),
    );
    s.appendChild(p);
    return s;
  }
}
