// Chat commands. Each command declares its usage and how to complete its
// arguments, so /help and Tab completion come from the same table.

import { B, BLOCKS } from '../blocks';
import { MOBS } from '../entities/entities';
import { ITEMS, maxStack, type ItemDef } from '../items';
import { WorldGen } from '../world/worldgen';
import { nearestStructure, type StructureKind } from '../world/structures';
import { nearestVillage } from '../world/villages';
import type { Game } from '../game';

export interface Command {
  name: string;
  aliases?: string[];
  usage: string;
  help: string;
  /** Suggestions for argument `i` (0-based, after the command name). */
  complete?: (i: number, g: Game, args: string[]) => string[];
  run(g: Game, args: string[]): void;
}

const MAX_FILL = 32768;

/** Item keys (for /give) and block keys (for /setblock and /fill). */
function itemKeys(): string[] {
  return ITEMS.filter((it): it is ItemDef => !!it).map((it) => it.key);
}
function blockKeys(): string[] {
  return Object.keys(B).filter((k) => k !== 'air');
}
export function findItem(name: string): ItemDef | undefined {
  const n = name.toLowerCase();
  return ITEMS.find((it): it is ItemDef => !!it && (it.key === n || it.name.toLowerCase() === n.replace(/_/g, ' ')));
}
export function findBlock(name: string): number | undefined {
  const n = name.toLowerCase();
  if (n === 'air') return 0;
  if (n in B) return (B as Record<string, number>)[n];
  const i = BLOCKS.findIndex((d) => d?.name.toLowerCase() === n.replace(/_/g, ' '));
  return i >= 0 ? i : undefined;
}

/** Parse a coordinate: a number, or ~ / ~n relative to the player's block position. */
function coord(v: string | undefined, base: number): number {
  if (v === undefined) return NaN;
  if (v.startsWith('~')) return Math.floor(base) + (v.length > 1 ? Number(v.slice(1)) : 0);
  return Math.floor(Number(v));
}
function coords3(g: Game, a: string[], at = 0): [number, number, number] | null {
  const p = g.player.body.pos;
  const r: [number, number, number] = [coord(a[at], p[0]), coord(a[at + 1], p[1]), coord(a[at + 2], p[2])];
  return r.every(Number.isFinite) ? r : null;
}

export const COMMANDS: Command[] = [
  {
    name: 'help', usage: '/help [command]', help: 'Lists commands, or explains one',
    complete: (i) => (i === 0 ? COMMANDS.map((c) => c.name) : []),
    run(g, a) {
      const c = a[0] && lookup(a[0]);
      if (c) { g.chat.say(`${c.usage} — ${c.help}`); return; }
      g.chat.say('Commands: ' + COMMANDS.map((c) => '/' + c.name).join(', ') + '. Type /help <command> for details; Tab completes.');
    },
  },
  {
    name: 'gamemode', aliases: ['gm'], usage: '/gamemode survival|creative', help: 'Switches between Survival and Creative',
    complete: (i) => (i === 0 ? ['survival', 'creative'] : []),
    run(g, a) {
      const m = a[0]?.toLowerCase(), p = g.player;
      if (m === 'creative' || m === 'c' || m === '1') { p.creative = true; g.chat.say('Game mode set to Creative'); }
      else if (m === 'survival' || m === 's' || m === '0') { p.creative = false; p.flying = false; g.chat.say('Game mode set to Survival'); }
      else g.chat.say('Usage: ' + this.usage);
    },
  },
  {
    name: 'time', usage: '/time set day|noon|sunset|night|midnight|<ticks>', help: 'Sets the time of day',
    complete: (i) => (i === 0 ? ['set'] : i === 1 ? ['day', 'noon', 'sunset', 'night', 'midnight'] : []),
    run(g, a) {
      const v = a[1]?.toLowerCase();
      const t = v === 'day' ? 1000 : v === 'noon' ? 6000 : v === 'sunset' ? 12000 : v === 'night' ? 13000 : v === 'midnight' ? 18000 : Number(v);
      if (a[0] === 'set' && Number.isFinite(t) && g.world) { g.world.time = ((t % 24000) + 24000) % 24000; g.chat.say(`Time set to ${g.world.time}`); }
      else g.chat.say('Usage: ' + this.usage);
    },
  },
  {
    name: 'weather', usage: '/weather clear|rain|thunder', help: 'Changes the weather',
    complete: (i) => (i === 0 ? ['clear', 'rain', 'thunder'] : []),
    run(g, a) {
      const v = a[0]?.toLowerCase();
      if ((v === 'clear' || v === 'rain' || v === 'thunder') && g.world) { g.world.weather = v; g.world.weatherTimer = 12000 + Math.floor(Math.random() * 12000); g.chat.say(`Weather set to ${v}`); }
      else g.chat.say('Usage: ' + this.usage);
    },
  },
  {
    name: 'give', usage: '/give <item> [count]', help: 'Gives you an item',
    complete: (i) => (i === 0 ? itemKeys() : i === 1 ? ['1', '16', '64'] : []),
    run(g, a) {
      const it = findItem(a[0] ?? '');
      if (!it) { g.chat.say(`No item called "${a[0] ?? ''}"`); return; }
      const n = Math.max(1, Math.min(2304, Number(a[1]) || 1));
      let left = n;
      while (left > 0) {
        const c = Math.min(left, maxStack(it.id));
        const rest = g.player.inv.add({ id: it.id, count: c });
        if (rest) g.actions.throwStack(rest);
        left -= c;
      }
      g.chat.say(`Gave ${n} × ${it.name}`);
    },
  },
  {
    name: 'tp', aliases: ['teleport'], usage: '/tp <x> <y> <z> | /tp <waypoint>', help: 'Teleports you (~ means your current position)',
    complete: (i, g) => (i === 0 ? ['~', ...g.waypoints.names()] : ['~']),
    run(g, a) {
      const wp = a.length === 1 ? g.waypoints.get(a[0]) : undefined;
      const c = wp ? wp.pos : coords3(g, a);
      if (!c) { g.chat.say('Usage: ' + this.usage); return; }
      g.player.body.pos = [c[0] + (wp ? 0 : 0.5), c[1], c[2] + (wp ? 0 : 0.5)];
      g.player.body.vel = [0, 0, 0];
      g.chat.say(`Teleported to ${c.map((v) => Math.floor(v)).join(', ')}`);
    },
  },
  {
    name: 'spawn', aliases: ['summon'], usage: '/spawn <creature>', help: 'Spawns a creature in front of you',
    complete: (i) => (i === 0 ? Object.keys(MOBS) : []),
    run(g, a) {
      const kind = a[0]?.toLowerCase();
      if (!kind || !MOBS[kind]) { g.chat.say(`Creatures: ${Object.keys(MOBS).join(', ')}`); return; }
      const p = g.player, d = p.lookDir();
      g.entities!.spawnMob(kind, p.body.pos[0] + d[0] * 3, p.body.pos[1] + 0.5, p.body.pos[2] + d[2] * 3);
    },
  },
  {
    name: 'speed', usage: '/speed <0.1-20>', help: 'Walk and fly faster (/speed 1 resets)',
    complete: (i) => (i === 0 ? ['1', '2', '4', '8'] : []),
    run(g, a) {
      const v = a[0] === undefined ? NaN : Number(a[0]);
      if (!Number.isFinite(v) || v < 0.1 || v > 20) { g.chat.say(`Usage: /speed <0.1-20> (now ${g.player.speed}x). /speed 1 resets it.`); return; }
      g.player.speed = v;
      g.chat.say(`Speed set to ${v}x`);
    },
  },
  {
    name: 'locate', usage: '/locate village|temple|shipwreck|mine|sanctum', help: 'Finds the nearest village or structure',
    complete: (i) => (i === 0 ? ['village', 'temple', 'shipwreck', 'mine', 'sanctum'] : []),
    run(g, a) {
      const w = g.world!, p = g.player;
      const what = a[0];
      const kinds = ['temple', 'shipwreck', 'mine', 'sanctum'];
      if (what !== 'village' && !kinds.includes(what)) { g.chat.say('Usage: ' + this.usage); return; }
      if (w.dimension !== 'overworld') { g.chat.say('There are none in this dimension.'); return; }
      const gen = new WorldGen(w.seed);
      const [px, , pz] = p.body.pos;
      const found = what === 'village' ? nearestVillage(gen, px, pz) : nearestStructure(gen, what as StructureKind, px, pz);
      if (!found) { g.chat.say(`No ${what} found nearby.`); return; }
      const fx = 'cx' in found ? found.cx : found.x, fz = 'cz' in found ? found.cz : found.z;
      const name = { village: 'village', temple: 'sun temple', shipwreck: 'shipwreck', mine: 'abandoned mine', sanctum: 'sanctum' }[what];
      g.chat.say(`Nearest ${name} is at ${fx}, ${'y' in found && what !== 'temple' && what !== 'shipwreck' ? found.y + ', ' : ''}${fz} (${Math.round(Math.hypot(fx - px, fz - pz))} blocks away)`);
    },
  },
  {
    name: 'music', usage: '/music', help: 'Plays a new piece of music now',
    run(g) {
      if (g.settings.music <= 0) { g.chat.say('Music is off. Turn it up in Settings > Sound.'); return; }
      g.music.playNow();
      g.chat.say('Composing something…');
    },
  },
  {
    name: 'raid', usage: '/raid start|stop', help: 'Starts or calls off a raid on the village you are in',
    complete: (i) => (i === 0 ? ['start', 'stop'] : []),
    run(g, a) {
      if (a[0] === 'start') { const why = g.raids.start(); if (why) g.chat.say(why); }
      else if (a[0] === 'stop') { if (g.raids.active) g.raids.stop('The raid is called off.'); else g.chat.say('There is no raid.'); }
      else g.chat.say('Usage: ' + this.usage);
    },
  },
  {
    name: 'dimension', usage: '/dimension overworld|ember|hollow', help: 'Travels to another dimension',
    complete: (i) => (i === 0 ? ['overworld', 'ember', 'hollow'] : []),
    run(g, a) {
      const d = a[0];
      if (d === 'ember' || d === 'overworld' || d === 'hollow') { if (d !== g.world!.dimension) g.travel(d); }
      else g.chat.say('Usage: ' + this.usage);
    },
  },
  { name: 'seed', usage: '/seed', help: 'Shows the world seed', run(g) { g.chat.say(`Seed: ${g.meta?.seedText ?? g.world!.seed}`); } },
  {
    name: 'xp', usage: '/xp <amount>', help: 'Gives you experience',
    run(g, a) {
      const n = Number(a[0]);
      if (Number.isFinite(n)) { g.player.addXp(n); g.chat.say(`Gave ${n} experience`); } else g.chat.say('Usage: ' + this.usage);
    },
  },
  { name: 'kill', usage: '/kill', help: 'Ends your life', run(g) { const p = g.player; p.creative = false; p.invulnerable = 0; p.damage(1000, 'command'); } },
  {
    name: 'setblock', usage: '/setblock <x> <y> <z> <block>', help: 'Places one block (~ means your position)',
    complete: (i) => (i < 3 ? ['~'] : i === 3 ? blockKeys() : []),
    run(g, a) {
      const c = coords3(g, a), id = findBlock(a[3] ?? '');
      if (!c || id === undefined) { g.chat.say('Usage: ' + this.usage); return; }
      g.history.begin();
      g.history.set(c[0], c[1], c[2], id);
      g.chat.say(`Placed ${id ? BLOCKS[id].name : 'air'} at ${c.join(', ')}`);
    },
  },
  {
    name: 'fill', usage: '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block> [replace <block>|hollow|outline]', help: 'Fills a box with a block (up to 32,768 blocks)',
    complete: (i) => (i < 6 ? ['~'] : i === 6 ? blockKeys() : i === 7 ? ['replace', 'hollow', 'outline'] : i === 8 ? blockKeys() : []),
    run(g, a) {
      const p1 = coords3(g, a, 0), p2 = coords3(g, a, 3), id = findBlock(a[6] ?? '');
      if (!p1 || !p2 || id === undefined) { g.chat.say('Usage: ' + this.usage); return; }
      const mode = a[7]?.toLowerCase();
      const only = mode === 'replace' ? findBlock(a[8] ?? '') : undefined;
      if (mode === 'replace' && only === undefined) { g.chat.say(`No block called "${a[8] ?? ''}"`); return; }
      const lo = [0, 1, 2].map((k) => Math.min(p1[k], p2[k])), hi = [0, 1, 2].map((k) => Math.max(p1[k], p2[k]));
      lo[1] = Math.max(0, lo[1]); hi[1] = Math.min(255, hi[1]);
      const vol = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (vol > MAX_FILL) { g.chat.say(`That's ${vol} blocks; the limit is ${MAX_FILL}.`); return; }
      const w = g.world!;
      g.history.begin();
      let n = 0;
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        if (!w.isLoaded(x, z)) continue;
        const edge = x === lo[0] || x === hi[0] || y === lo[1] || y === hi[1] || z === lo[2] || z === hi[2];
        let put = id;
        if (mode === 'hollow' && !edge) put = 0;
        if (mode === 'outline' && !edge) continue;
        if (only !== undefined && w.getBlock(x, y, z) !== only) continue;
        if (w.getBlock(x, y, z) === put) continue;
        g.history.set(x, y, z, put);
        n++;
      }
      g.chat.say(`Changed ${n} blocks. /undo reverts it.`);
    },
  },
  {
    name: 'undo', usage: '/undo', help: 'Reverts your last /fill, /setblock, or block you placed or broke in Creative',
    run(g) {
      const n = g.history.undo();
      g.chat.say(n ? `Reverted ${n} block${n === 1 ? '' : 's'}.` : 'Nothing to undo.');
    },
  },
  {
    name: 'waypoint', aliases: ['wp'], usage: '/waypoint add|remove|list [name]', help: 'Marks places; waypoints show on screen and on the map',
    complete: (i, g) => (i === 0 ? ['add', 'remove', 'list'] : i === 1 ? g.waypoints.names() : []),
    run(g, a) {
      const sub = a[0]?.toLowerCase(), name = a.slice(1).join(' ').trim();
      if (sub === 'add' && name) { g.waypoints.add(name, [...g.player.body.pos] as [number, number, number], g.dimension); g.chat.say(`Waypoint "${name}" set here.`); }
      else if (sub === 'remove' && name) g.chat.say(g.waypoints.remove(name) ? `Removed "${name}".` : `No waypoint called "${name}".`);
      else if (sub === 'list' || !sub) {
        const list = g.waypoints.list(g.dimension);
        g.chat.say(list.length ? list.map((w) => `${w.name} (${w.pos.map(Math.floor).join(', ')})`).join('; ') : 'No waypoints yet. /waypoint add <name> marks this spot.');
      } else g.chat.say('Usage: ' + this.usage);
    },
  },
];

export function lookup(name: string): Command | undefined {
  const n = name.replace(/^\//, '').toLowerCase();
  return COMMANDS.find((c) => c.name === n || c.aliases?.includes(n));
}

const GUEST_COMMANDS = new Set(['help', 'seed', 'locate', 'waypoint', 'music', 'kill']);

export function runCommand(g: Game, line: string): void {
  const parts = line.trim().replace(/^\//, '').split(/\s+/);
  const c = lookup(parts[0] ?? '');
  if (!c) { g.chat.say(`Unknown command "${parts[0]}". Type /help for a list.`); return; }
  // In someone else's world, only commands that don't change it.
  if (g.net && 'guest' in g.net && !GUEST_COMMANDS.has(c.name)) { g.chat.say(`Only the host can use /${c.name} in a shared world.`); return; }
  c.run(g, parts.slice(1));
}

/** Completions for the word being typed at the end of `line`. */
export function completions(g: Game, line: string): string[] {
  if (!line.startsWith('/')) return [];
  const parts = line.slice(1).split(' ');
  const word = parts[parts.length - 1].toLowerCase();
  let pool: string[];
  if (parts.length === 1) pool = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  else pool = lookup(parts[0])?.complete?.(parts.length - 2, g, parts.slice(1)) ?? [];
  return [...new Set(pool)].filter((s) => s.toLowerCase().startsWith(word)).sort();
}
