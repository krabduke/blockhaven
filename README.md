# Blockhaven

A blocky survival sandbox that runs in your browser. Dig into an endless world, craft tools, build a home, farm, fish, enchant your gear, and make it through the night.

![Title screen, with the live world orbiting behind the logo](docs/screenshots/title.png)

Blockhaven plays like the classic block-building survival games: the same block size, movement physics, crafting grid, mining times, hunger and day/night rhythm. Every texture, sound, creature and line of code is original to this project. There are no image or audio files at all: textures are painted procedurally at startup and sounds are synthesized with the Web Audio API.

Blockhaven is an independent fan project. It is not affiliated with or endorsed by Mojang Studios or Microsoft, and it contains none of their assets.

## Play

**In your browser:** once GitHub Pages has deployed, the game is at <https://krabduke.github.io/blockhaven/>.

**Locally:**

```bash
git clone https://github.com/krabduke/blockhaven.git
cd blockhaven
npm install
npm run dev
```

Then open the address Vite prints (usually <http://localhost:5173>). You need a browser with WebGL2: any recent Chrome, Edge, Firefox or Safari.

Worlds save automatically to your browser's storage (IndexedDB) every 30 seconds and when you quit to the title screen.

## Screenshots

All taken in-game at render distance 16 with the default Fancy graphics.

| | |
|---|---|
| ![A village of timber-framed houses at golden hour](docs/screenshots/village.png) | ![A village well and houses from the street](docs/screenshots/village-street.png) |
| ![Sunset over rolling hills](docs/screenshots/sunset.png) | ![A moonlit night over the sea](docs/screenshots/night.png) |
| ![A blossom grove of pink trees](docs/screenshots/blossom.png) | ![Terraced badlands with banded cliffs](docs/screenshots/badlands.png) |
| ![Snowy mountain peaks with icy tops](docs/screenshots/mountains.png) | ![A snowy spruce forest by a frozen lake](docs/screenshots/snowy-taiga.png) |
| ![Boars, woolbacks, hens and a fox in a meadow](docs/screenshots/animals.png) | ![A torch-lit cave with glowmoss, dripstone and lava](docs/screenshots/cave.png) |
| ![Monsters closing in on a torch-lit clearing at night](docs/screenshots/night-raid.png) | ![A glowstone-lit cavern in the Emberdeep](docs/screenshots/emberdeep.png) |
| ![A line-up of monsters: frostling, zombie, brambler, witch, skeleton, blastcap, mirewalker and shellcrawler](docs/screenshots/creatures.png) | ![Villagers of different trades beside a stonewarden](docs/screenshots/villagers.png) |
| ![The crafting table screen](docs/screenshots/crafting.png) | ![The enchanting table screen](docs/screenshots/enchanting.png) |

## Features

**World**
- Endless, seeded terrain in 16×16×256 chunks, streamed around you by background workers
- Biomes: plains, forest, birch forest, snowy taiga, desert, savanna, swamp, jungle, blossom grove, badlands with banded terracotta terraces, winding rivers, beach, ocean and mountains with icy peaks, each with its own grass and foliage tint
- Varied rock: granite, limestone, chalk and basalt veins through the stone, turning into dark deepstone near the bottom of the world
- Caves with dripstone regions, moss caves lit by hanging glowmoss, crystal geodes and long ravines; seagrass and kelp on the sea floor; boulders, fallen logs, bushes, ferns, berry bushes, cattails, bamboo and snow on cold ground
- **Villages** of timber-framed houses with gable roofs, chimneys and furnished interiors, farms, a smithy, a library, lamp posts and a well with a bell, joined by dirt paths. Villagers trade with you in amber, and a Stonewarden guards each village. Find the nearest one with `/locate village`
- **The Emberdeep**, a second dimension beneath the world: cinderstone caverns over a lava sea, glowstone hanging from the ceiling, ashsand that slows you down, magma rock, emberquartz, eternal fires and ruined cinder keeps with loot. Build a 4×5 obsidian frame, light it with flint and steel, and stand in the gate. Distances there are one-eighth of the overworld's
- Winding tunnel caves and large caverns, lava lakes deep down, and coal, iron, gold and diamond ore at their usual depths
- Oak, birch and spruce trees, cacti, sugar cane, flowers, tall grass and pumpkins
- Dungeons: mossy rooms with a monster cage that keeps spawning creatures, and chests of loot
- Day and night on a 20-minute cycle, with sun, moon, stars, drifting clouds, and rain, snow and thunderstorms

**Blocks and building**
- 159 blocks, including stairs, slabs, fences, fence gates, doors, trapdoors, ladders, glass and glass panes, iron bars, lanterns, signs you can write on, carpets, six colours of wool, slate, marble, terracotta, hay bales, cake, bookshelves, TNT and lamps
- Power: buttons, pressure plates and levers send power along spark dust wire to light lamps, open doors, trapdoors and gates, and set off TNT
- Fire that spreads through wood, wool and leaves and burns out on its own, and puts itself out in the rain
- Smooth lighting with ambient occlusion; sunlight and torchlight both flood-fill through the world
- Flowing water and lava (water plus lava makes obsidian or cobblestone), sand and gravel that fall, leaves that decay when their tree is cut down

**Survival**
- Health, hunger, saturation and air, with fall, drowning, lava, fire and starvation damage
- Mining times that depend on the tool, with wooden, stone, iron, golden and diamond pickaxes, axes, shovels, swords and hoes, and tool durability
- The crafting grid (2×2 in your inventory, 3×3 at a crafting table) with the standard recipes, including mirrored ones
- Furnaces that smelt ores, cook food and bake glass, with fuel burn times
- Chests, beds (sleep through the night and set your respawn point) and dropped-item pickup
- Armor in leather, gold, iron and diamond, with an armor bar and damage reduction
- Experience from mobs, ores, smelting, breeding and fishing, plus an enchanting table that uses it (Efficiency, Sharpness, Protection, Unbreaking, Power, Feather Falling). Bookshelves around the table unlock stronger enchantments
- Bows and arrows with a charge-up draw, snowballs, eggs and a fishing rod
- Farming: till with a hoe, then plant wheat and carrots, which grow in the light. Bone meal speeds up crops, saplings and grass
- Achievements for the classic milestones

**Graphics**
- Shaders: soft sun shadows, warm directional sunlight with cool shade, bloom around bright and glowing blocks, god rays through trees and clouds, planar water reflections with a sun-glitter path, puffy procedural clouds that cast moving shadows, moonlit blue nights, warm haze toward the sun and valley mist, a wet look in the rain, flickering torchlight and filmic tone mapping. Settings switch between Fancy and Fast graphics and turn the heavier effects off
- Procedurally painted textures with bevelled stones, wood grain, bark ridges and layered foliage, with several random variants per natural block and randomly rotated tops so large areas don't look tiled
- Blocks crack apart into shards as you mine them

**Creatures (all original designs)**

Every creature is built from hand-placed boxes with procedurally painted fur, wool, scales, bark and cloth, and animated by a small pose engine: walk cycles scaled to speed, breathing, eased turning that leans into corners, idle glances, blinking, landing squash, and behaviour poses for grazing, pecking, aiming, spitting, slamming and swelling. Each one also varies a little in size.

- **Boar**: a stocky wild boar with a bristly spine, tusks and a flat pink snout that roots at the grass. **Hen**: a speckled hen with an arched tail, slate-blue crest and wattle that pecks and bobs as she walks and flaps when startled. **Woolback**: a curly-horned ram in a thick fleece; shear it and its thin body shows until the wool grows back from grazing. All three follow you when you hold their food, breed into babies, and wag their tails when fed. Hens lay eggs
- **Zombie**: a pallid, bandaged shambler that limps, lolls its head, reaches for you and snaps its slack jaw; burns in daylight
- **Skeleton**: a bone archer in a hooded wine-red cloak that streams behind it as it runs; draws its recurve bow and shoots arrows from a distance
- **Witch**: a hedge-witch in a plum dress and mossy shawl, with brass spectacles, long grey hair and a tall crooked hat with a feather. She lobs splash potions, cackles after a throw and drinks a healing brew when hurt; most common in swamps
- **Blastcap**: a spotted mushroom creature that waddles up, hisses, trembles, swells and bursts
- **Mirewalker**: a hunched bog-dweller draped in hanging moss, with long pendulum arms and glowing mushrooms on its shoulder; comes out at night and burns in sunlight
- **Shellcrawler**: a long-legged cave crawler under a ridged teal shell, walking on jointed legs in a tripod gait; calm in daylight unless provoked
- **Brambler**: a walking thorn-rose on root feet whose crimson petals flare open when it spits barbs
- **Burrowfox**: a slender russet fox with black socks, tall ears and a huge brush tail that tilts its head at you. **Bogfrog** (swamps): a mottled frog that stretches out mid-leap and puffs its throat. **Streamfish** (water): a speckled trout with a pink band. **Cave moths**: big fuzzy moths with glowing cyan eyespots
- **Dune Scuttler**: a fast desert scorpion-thing with snapping pincers and a stinger that strikes. **Frostling**: a small ice imp with a crown of ice shards and an icicle beard that throws snowballs in snowy places
- **Villagers**: farmers, shepherds, fishers, butchers, clerics, smiths and librarians, each with their own clothes, hats, beards and tools (a straw hat, a crook, a pipe, a bandana, a hood, goggles, a book and quill) and their own trades. They wave when you come close, scratch their heads and look around. **Stonewarden**: a mossy stone guardian with a glowing amber heart and a sapling on its head that fights monsters near its village
- **Emberwisp**: a floating soot-black lantern skull with a flame crown that lobs fireballs. **Cinderbrute**: a hulking basalt ape with glowing seams and spines that knuckle-walks, slams and shrugs off fire

**Game modes**
- Survival, and Creative (fly, instant breaking, and every block and item in a searchable palette)
- Title screen, world list, create world with a seed, pause menu, settings (render distance, field of view, mouse sensitivity, brightness, volume, view bobbing, invert mouse), death screen and a debug overlay

## Play on a phone or tablet

Open the same link on your phone and turn it sideways. Touch controls appear automatically:

| Control | What it does |
|---|---|
| Left thumb | Drag anywhere on the left to walk; push all the way forward to sprint |
| Right side | Drag to look around |
| **Mine** | Hold to break blocks or attack |
| **Use** | Tap to place, eat, open doors and chests (hold to draw a bow) |
| **Jump** | Jump; double-tap to fly in Creative |
| **Sneak** | Toggles sneaking |
| Top buttons | Commands (`/`), drop item, inventory (▦) and pause. Screens close with their × button |
| Hotbar | Tap a slot to select it |

Phones start with lighter graphics (render distance 6, no sun shadows or bloom); you can raise them in Settings.

## Controls

| Key | Action |
|---|---|
| Mouse | Look around |
| W A S D | Move |
| Space | Jump (double-tap to fly in Creative) |
| Shift | Sneak (you won't walk off edges) |
| Ctrl or R, or double-tap W | Sprint (in flight it also speeds up climbing and descending) |
| Left click | Mine or attack |
| Right click | Place, use, eat, open, draw a bow, cast a rod |
| Middle click | Pick the block you're looking at |
| 1–9 or scroll wheel | Choose a hotbar slot |
| E | Inventory (E, Esc, the × button or a click outside the panel closes it) |
| Q | Drop one item (Ctrl+Q drops the stack) |
| T or / | Commands (Enter runs, Esc or × closes) |
| F3 | Debug info |
| F1 | Hide the HUD |
| Esc | Pause |

In inventories: click to pick up or place a stack, right-click to split or place one, shift-click to move a stack across, and press 1–9 while hovering a slot to swap it with the hotbar.

## Commands

`/gamemode survival|creative`, `/speed <multiplier>` (walk and fly faster; `/speed 1` resets), `/time set day|noon|sunset|night|midnight|<ticks>`, `/weather clear|rain|thunder`, `/give <item> [count]`, `/xp <amount>`, `/tp <x> <y> <z>`, `/spawn <mob>` (for example `zombie`, `skeleton`, `witch`, `blastcap`), `/locate village`, `/dimension overworld|ember`, `/seed`, `/kill`, `/help`

Item names for `/give` are the lowercase names with underscores, for example `/give diamond_pickaxe` or `/give oak_stairs 64`.

## How it's built

TypeScript, [Vite](https://vite.dev) and [Three.js](https://threejs.org), with no game engine.

| Area | Where |
|---|---|
| Block and item registry | `src/blocks.ts`, `src/items.ts` |
| Terrain, caves, ores, trees, dungeons | `src/world/worldgen.ts` |
| Villages | `src/world/villages.ts` |
| The Emberdeep | `src/world/embergen.ts` |
| Trading | `src/trading.ts` |
| Chunk meshing (face culling, smooth light, ambient occlusion) | `src/world/mesher.ts` |
| Sky light and block light flood-fill | `src/world/light.ts` |
| Chunk streaming, fluids, falling blocks, random ticks | `src/world/world.ts` |
| Background workers for generation and meshing | `src/world/worker.ts`, `src/world/pool.ts` |
| Tick-based physics, collision, raycasting | `src/physics.ts` |
| Mobs, projectiles, particles, explosions | `src/entities/` |
| Procedural textures | `src/textures.ts` |
| Synthesized sound | `src/audio.ts` |
| Menus, HUD and inventories | `src/ui/` |

Physics runs at 20 ticks per second using the classic constants (gravity 0.08, 0.98 drag, jump velocity 0.42, 0.6 × 0.91 ground friction), so walking speed, sprint-jumping, jump height and falling all feel familiar.

## Tests

```bash
npm test                          # unit tests: noise, world gen, lighting, physics, crafting, armor, enchanting...
npm run dev -- --port 5199        # then, in another terminal:
node scripts/playtest.mjs         # plays the real game in headless Chromium and checks mining, placing,
                                  # water, torches, combat, bows, shearing, breeding, bone meal, armor,
                                  # weather, dungeon loot, fishing, enchanting, power, fire, villages,
                                  # trading, Ember Gates, the Emberdeep, crafting and save/load
npm run screenshots               # regenerates docs/screenshots
```

## What's not in yet

An end dimension, redstone components beyond the basics (no repeaters, pistons or comparators yet), minecarts and boats, horses, maps and multiplayer.

## Licence

[MIT](LICENSE)
