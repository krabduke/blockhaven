// A direct browser-to-browser link (WebRTC data channel) set up by copying two codes between
// players: the host's invite and the guest's reply. There is no game server: the codes carry the
// connection details, compressed so they paste easily into a chat app.
//
// Messages are JSON or binary. Anything larger than one data-channel frame is sent in pieces and
// put back together on arrival.

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const PIECE = 60_000;

async function pack(obj: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const z = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of z) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unpack(code: string): Promise<unknown> {
  const clean = code.trim().replace(/\s+/g, '').replace(/^BH[12]:/, '');
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const z = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([z]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

/** Wait until the browser has gathered its connection candidates (or a few seconds pass). */
function gathered(pc: RTCPeerConnection, ms = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export type Message = Record<string, unknown> & { op: string };

/** One end of a link, with a message API over the data channel. */
export class Link {
  onMessage: (m: Message, bin?: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  private parts = new Map<number, { n: number; got: Uint8Array[]; header: Message }>();
  private seq = 0;
  closed = false;

  constructor(readonly pc: RTCPeerConnection, readonly ch: RTCDataChannel) {
    ch.binaryType = 'arraybuffer';
    ch.onmessage = (e) => this.receive(e.data as string | ArrayBuffer);
    const close = () => { if (this.closed) return; this.closed = true; this.onClose(); };
    ch.onclose = close;
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') close(); };
  }

  get open(): boolean { return this.ch.readyState === 'open'; }
  /** Bytes queued and not yet sent (to avoid flooding a slow link). */
  get backlog(): number { return this.ch.bufferedAmount; }

  send(m: Message, bin?: Uint8Array): void {
    if (!this.open) return;
    if (!bin) { this.ch.send(JSON.stringify(m)); return; }
    // Binary payloads go as a JSON header, then numbered pieces.
    const id = ++this.seq, n = Math.max(1, Math.ceil(bin.length / PIECE));
    this.ch.send(JSON.stringify({ ...m, _bin: id, _n: n }));
    for (let i = 0; i < n; i++) {
      const piece = bin.subarray(i * PIECE, (i + 1) * PIECE);
      const buf = new Uint8Array(piece.length + 8);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, id); dv.setUint32(4, i);
      buf.set(piece, 8);
      this.ch.send(buf);
    }
  }

  private receive(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const m = JSON.parse(data) as Message & { _bin?: number; _n?: number };
      if (m._bin) { this.parts.set(m._bin, { n: m._n!, got: [], header: m }); return; }
      this.onMessage(m);
      return;
    }
    const dv = new DataView(data);
    const id = dv.getUint32(0), i = dv.getUint32(4);
    const p = this.parts.get(id);
    if (!p) return;
    p.got[i] = new Uint8Array(data, 8);
    if (p.got.filter(Boolean).length < p.n) return;
    this.parts.delete(id);
    const total = p.got.reduce((a, b) => a + b.length, 0);
    const all = new Uint8Array(total);
    let o = 0;
    for (const g of p.got) { all.set(g, o); o += g.length; }
    const { _bin: _a, _n: _b, ...header } = p.header;
    this.onMessage(header as Message, all);
  }

  close(): void {
    this.closed = true;
    try { this.ch.close(); } catch { /* already closed */ }
    this.pc.close();
  }
}

/** Host side: make an invite code, then finish with the guest's reply code. */
export async function createInvite(): Promise<{ code: string; accept: (reply: string) => Promise<Link> }> {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const ch = pc.createDataChannel('game', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const code = 'BH1:' + (await pack({ sdp: pc.localDescription!.sdp }));
  return {
    code,
    accept: async (reply: string) => {
      const r = (await unpack(reply)) as { sdp?: string };
      if (!r?.sdp) throw new Error('That is not a reply code.');
      await pc.setRemoteDescription({ type: 'answer', sdp: r.sdp });
      await opened(ch);
      return new Link(pc, ch);
    },
  };
}

/** Guest side: turn the host's invite into a reply code; `link` resolves once connected. */
export async function answerInvite(invite: string): Promise<{ code: string; link: Promise<Link> }> {
  const o = (await unpack(invite)) as { sdp?: string };
  if (!o?.sdp) throw new Error('That is not an invite code.');
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const link = new Promise<Link>((resolve, reject) => {
    pc.ondatachannel = (e) => { opened(e.channel).then(() => resolve(new Link(pc, e.channel)), reject); };
    setTimeout(() => reject(new Error('No connection after 2 minutes.')), 120_000);
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  return { code: 'BH2:' + (await pack({ sdp: pc.localDescription!.sdp })), link };
}

function opened(ch: RTCDataChannel): Promise<void> {
  if (ch.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    ch.addEventListener('open', () => resolve(), { once: true });
    setTimeout(() => reject(new Error('The connection did not open.')), 60_000);
  });
}
