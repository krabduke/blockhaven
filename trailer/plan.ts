// Works out where every trailer shot's subject stands in the chosen world, and writes trailer/plan.json.
import { writeFileSync } from 'node:fs';
import { nearestStructure } from '../src/world/structures';
import type { StructureKind } from '../src/world/structure-kinds';
import { nearestVillage } from '../src/world/villages';
import { WorldGen } from '../src/world/worldgen';

const SEED = Number(process.argv[2] ?? 384);
const g = new WorldGen(SEED);
const plan: Record<string, unknown> = { seed: SEED };
const v = nearestVillage(g, 0, 0)!;
plan.village = { x: v.cx, z: v.cz, y: g.column(v.cx, v.cz).height };
const kinds: StructureKind[] = ['frostkeep', 'manor', 'outpost', 'citadel', 'ziggurat', 'temple', 'vault', 'witchhut', 'stones', 'cabin', 'igloo', 'shipwreck', 'ruinedgate',
  'bastion', 'forge', 'spire', 'cathedral', 'shrine', 'monoliths', 'spires', 'observatory', 'garden', 'starforge', 'crater', 'statue', 'waystones'];
for (const k of kinds) {
  const s = nearestStructure(k === 'bastion' || k === 'forge' || k === 'spire' || k === 'cathedral' || k === 'shrine' || k === 'monoliths' || k === 'spires' || k === 'observatory' || k === 'garden' || k === 'starforge' || k === 'crater' || k === 'statue' || k === 'waystones' ? { seed: SEED } as WorldGen : g, k, 0, 0, 12);
  if (s) plan[k] = { x: s.x, y: s.y, z: s.z, rot: s.rot };
}
writeFileSync(new URL('./plan.json', import.meta.url), JSON.stringify(plan, null, 1));
console.log(JSON.stringify(plan));
