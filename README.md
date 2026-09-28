# QubeCraft

A blocky survival sandbox that runs in your browser. Dig into an endless world, craft tools, build a home, farm, fish, enchant your gear, and make it through the night.

![Title screen, with the live world orbiting behind the logo](docs/screenshots/title.png)

QubeCraft plays like the classic block-building survival games: the same block size, movement physics, crafting grid, mining times, hunger and day/night rhythm. Every texture, sound, creature and line of code is original to this project. There are no image or audio files at all: textures are painted procedurally at startup and sounds are synthesized with the Web Audio API.

QubeCraft (formerly Blockhaven) is an independent fan project. It is not affiliated with or endorsed by Mojang Studios or Microsoft, and it contains none of their assets.

## Play

**In your browser:** once GitHub Pages has deployed, the game is at <https://krabduke.github.io/qubecraft/>.

**Locally:**

```bash
git clone https://github.com/krabduke/qubecraft.git
cd qubecraft
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
| ![A stepped sandstone sun temple in a dug-out courtyard](docs/screenshots/temple.png) | ![A shipwreck on the sea floor with a snapped mast](docs/screenshots/shipwreck.png) |
| ![Timbered tunnels of an abandoned mine with rails and cobwebs](docs/screenshots/mine.png) | ![A sanctum hall around the Astral Gate over lava](docs/screenshots/sanctum.png) |
| ![The Hollow: a pale island with obsidian pillars in a starry void](docs/screenshots/hollow.png) | ![The Hollow Colossus, mended by a beam from an anchor stone](docs/screenshots/colossus.png) |
| ![Crossbow raiders and their banner-carrying captain beside a bee and a mossback](docs/screenshots/raiders.png) | ![Potatoes, redroot and carrots at every stage beside bee nests and hives](docs/screenshots/farm.png) |
| ![A comparator, campfire, smoker, item frame, flower pot, barrel, composter and anvil at dusk](docs/screenshots/workshop.png) | |
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
- 180 blocks, including stairs, slabs, fences, fence gates, doors, trapdoors, ladders, glass and glass panes, iron bars, lanterns, signs you can write on, wool, carpets, stained glass and banners in all sixteen dye colours (mix dyes: red and white make pink, blue and green make cyan), sixteen original paintings to hang, slate, marble, terracotta, hay bales, cake, bookshelves, TNT and lamps
- Power: buttons, pressure plates and levers send power along spark dust wire to light lamps, open doors, trapdoors and gates, and set off TNT. Repeaters pass power one way after a delay you set by right-clicking them (they also boost it back to full strength); pistons push up to twelve blocks (and anything standing there), and sticky pistons pull a block back; hoppers move items from containers above into whatever they point at and pick up items dropped on them (a powered hopper pauses); and the Watcher, an original sensor block, sends a short pulse out of its back whenever the block in front of it changes
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
- Bows and arrows with a charge-up draw, a crossbow that you load by holding right click and fire with the next click, a shield that blocks hits from in front while raised, snowballs, eggs and a fishing rod
- Brewing: fill glass bottles at water and brew them on a brewing stand (fuelled by glow dust or an ember core) into potions of Swiftness (sugar), Healing (red berries), Regeneration (golden apple), Fire Resistance (emberquartz), Night Vision (carrot), Water Breathing (raw fish), Strength (crystal shard), Leaping (bog slime, dropped by bogfrogs), Slow Falling (feather) and Poison (rotten flesh). Add gunpowder to make any of them a splash potion that affects everything nearby. Active effects and their time left show on screen
- Living world: potatoes and redroot (seeds from tall grass) to farm and cook, bee nests in trees whose bees carry nectar home (harvest honey with a glass bottle or honeycomb with shears, with a torch below to keep them calm), salmon and a glowing glimmerfish on the line, and village raids: some nights a war horn sounds and raiders with crossbows march on the village in three waves, the last led by a captain. Beat them to become a Village Hero and pay less amber when trading (`/raid start` to try it)
- Structures to find in every dimension, each with its own loot (`/locate <name>` finds the nearest in the dimension you're in; `/locate list` names them):
  - **The overworld's landmarks**: villages; sun temples in the desert with a trapped vault under the floor; abandoned mines with old rails, webs and a crawler nest; buried sanctums of stone brick holding an Astral Gate; **raider outposts**, timber watchtowers over a camp of tents, cages and practice dummies; **Thornwood Manor**, a three-storey slate-roofed house in a hedged garden with a library, bedrooms, a sealed room behind the bookshelves, a witch's attic and a cellar; the **Tidewatch Citadel**, a drowned marble castle on the deep sea floor with towers, a domed keep and a heart of amber; the **Vinecrown Ziggurat**, a stepped jungle pyramid with a rooftop shrine and a trapped vault inside; the **Frost Keep**, a walled castle in the snow with ice-crowned towers, a throne room and a cold cellar; and the **Echo Vault**, a vast buried hall of deepstone around a great dark arch, far below everything else
  - **Smaller finds**: shipwrecks, buried treasure, dungeons, witch huts on stilts in the swamp, igloos (some hide a laboratory far below), desert wells, ruined Ember Gates in scorched ground, fossils in the rock, ocean ruins, travellers' camps, rings of standing stones with an offering buried at the centre, and hunters' log cabins with a hearth and a hen pen
  - **The Emberdeep**: the **Cinder Bastion**, a walled fortress on piers over the lava with four towers and a hoard of gold; the **Great Forge**, a smithy hall with a lava channel, anvils and a vast furnace; the **Ashen Spire**, an obsidian needle rising from the lava sea, reached by bridges; the **Ember Cathedral**, with burning windows, bell towers and an altar; plus ember shrines, basalt monoliths, ash camps, lava wells, hanging cages and ruined keeps
  - **The Hollow**: the **Astral Spires**, three towers joined by bridges; the **Floating Observatory** with its great telescope; the **Sky Garden**, a glass dome of blossom trees, starbloom and bees; the **Star Forge**, a ring of obsidian around a crucible with a star core burning above; plus crystal shrines, broken bridges, meteor craters, lantern waystones, a fallen statue and old watchtowers
- The endgame: craft Starseekers (crystal shard + ember core) and throw one to see which way the nearest sanctum lies. Set twelve into the Astral Gate's frame to open it onto the Hollow, pale islands adrift in a starry void. Its Colossus circles the central island, hurls void shards and dives at you, and it mends itself from anchor stones on tall pillars (shoot or break them first). Beat it for the way home and a glider: wear it in the chest slot and jump while falling to glide, dive for speed and pull up to climb. Mend a worn glider with leather
- Sound, all synthesized in the browser with no audio files: generative music that composes a new piece every few minutes in a mood that suits where you are (bright by day, modal at night, sparse in caves, dark in the Emberdeep, glassy in the Hollow; `/music` plays one now), wind that grows with height, surf, rain, birdsong, crickets, frogs, cave drips, and an echo on every sound when you're underground
- Conveniences: a recipe book beside the crafting grid (search it, show only what you can make, click to lay a recipe out or Shift-click for as many as you can), a Sort button for your inventory and chests, auto-jump for one-block steps (Settings > Controls), difficulty from Peaceful to Hard (chosen when you create a world, changed from the pause menu or with `/difficulty`), a keep-inventory rule (`/gamerule keepInventory true`), and an Achievements and stats screen in the pause menu
- Instruments and handling: a compass that points home, a clock with the day and time, paper maps that fill in as you explore, treasure maps (found in shipwrecks) that mark buried chests on the beach with an X, a spyglass (hold use to zoom), leads to walk animals and tie them to fences, and name tags (named creatures show their name and never wander off)
- Workshop and home blocks: comparators (they read how full a container is, or compare and subtract signals), an anvil (mend gear with its material, combine two of the same, merge enchantments, rename things), campfires that cook without fuel and calm bees, a smoker that cooks food twice as fast, barrels, composters that turn plants into bone meal, item frames and flower pots
- Farming: till with a hoe, then plant wheat and carrots, which grow in the light. Bone meal speeds up crops, saplings and grass
- Achievements for the classic milestones

**Graphics**
- Shaders: soft sun shadows, warm directional sunlight with cool shade, bloom around bright and glowing blocks, god rays through trees and clouds, planar water reflections with a sun-glitter path, puffy procedural clouds that cast moving shadows, moonlit blue nights, warm haze toward the sun and valley mist, a wet look in the rain, flickering torchlight and filmic tone mapping. Settings switch between Fancy and Fast graphics and turn the heavier effects off
- Procedurally painted textures with bevelled stones, wood grain, bark ridges and layered foliage, with several random variants per natural block and randomly rotated tops so large areas don't look tiled
- Blocks crack apart into shards as you mine them

**Creatures (all original designs)**

Every creature is built from hand-placed boxes with procedurally painted fur, wool, scales, bark and cloth at three texels to the model pixel (fine enough for irises, whiskers, stitching, split hooves and fingers), and animated by a small pose engine: walk cycles scaled to speed, breathing, eased turning that leans into corners, idle glances, blinking, landing squash, and behaviour poses for grazing, pecking, aiming, spitting, slamming and swelling. Each one also varies a little in size.

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

**Quality of life**
- A minimap in the corner and a full-screen world map (M), both showing waypoints and the last place you died
- Third-person camera (F5), screenshots (F2), a coordinates line, and an interface size setting
- Rebindable keys, hold-or-toggle sprint and sneak, gamepad support, and a reduce-motion option
- World backups: export any world to a file and import it on another browser or device; rename and duplicate worlds
- Installable as an app (Add to Home Screen) and playable offline; when a new version is published the game offers to save and reload
- A frame-rate cap, and automatic quality that lowers the resolution when frames get slow

**Getting around**
- Boats: place one on water, climb in, row with W and S and steer with A and D
- Rails and minecarts: track joins itself into straights, curves and slopes as you lay it; carts keep their speed through bends, speed up downhill, and powered rails (lit by spark dust, levers or buttons) push them along or brake them
- The **Mossback**, an original creature: a tall mossy-antlered deer that roams plains and forests. Feed it apples or wheat until it trusts you, put a saddle on it, and ride it: it goes where you look, gallops when you sprint and leaps when you jump
- Tame a **Burrowfox** with apples: it wears a red collar, follows you (catching up if you get far ahead), fights monsters that come near you, and sits or stands when you right-click it

**Game modes**
- Survival, and Creative (fly, instant breaking, and every block and item in a searchable palette)
- Title screen, world list, create world with a seed, pause menu, settings (render distance, field of view, mouse sensitivity, brightness, volume, view bobbing, invert mouse), death screen and a debug overlay

## Play with friends

Up to four friends can join your world, straight from their browsers, with no accounts and no game server.

1. In your world, open the pause menu and choose **Invite a friend**, then **Create an invite code**. Send the code to your friend in any chat app.
2. Your friend chooses **Join a friend** on the title screen, pastes your code, and sends you back the reply code it makes.
3. Paste their reply and choose **Connect**. They appear in your world a moment later.

Your game is the host: it runs the world, the creatures and the items, and your friends see every change. Their own building and digging comes back to you. You see each other with name tags, share chat, pick things up and get chased by the same monsters.

For now, guests can't open chests, furnaces, brewing stands or hoppers; nobody can use gates while friends are connected; and only the host can use commands that change the world. The world is saved on the host's side only.

Connecting uses public STUN servers (Google's and Cloudflare's) so the two browsers can find each other; nothing else leaves your machines. Some strict networks (certain workplaces, mobile carriers) block direct connections, and then joining won't work.

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
| 1–9 or scroll wheel | Choose a hotbar slot (in Creative flight, Ctrl+scroll changes flying speed) |
| E | Inventory (E, Esc, the × button or a click outside the panel closes it) |
| Q | Drop one item (Ctrl+Q drops the stack) |
| T or / | Chat and commands: Tab completes, Up and Down recall earlier commands, Esc or × closes |
| M | World map (drag to pan, scroll to zoom; in Creative, double-click to teleport) |
| F5 | Camera: first person, behind you, in front of you |
| F2 | Save a screenshot |
| F3 | Debug info |
| F1 | Hide the HUD |
| Esc | Pause |

Every key can be changed in **Settings → Keys**, and sprint and sneak can be set to toggle instead of hold.

In inventories: click to pick up or place a stack, right-click to split or place one, shift-click to move a stack across, and press 1–9 while hovering a slot to swap it with the hotbar. Holding a stack, drag across slots to share it out evenly (right-drag places one in each); double-click a slot to gather every stack of that item. The Creative inventory has category tabs and a search box.

### Controllers

Plug in a gamepad and it just works: left stick to move, right stick to look, right trigger to mine, left trigger to place, A to jump, B to sneak (and to close screens), Y for the inventory, bumpers for the hotbar, left stick click to sprint, Start to pause, Back for the map.

## Commands

`/gamemode survival|creative`, `/speed <multiplier>` (walk and fly faster; `/speed 1` resets), `/time set day|noon|sunset|night|midnight|<ticks>`, `/weather clear|rain|thunder`, `/give <item> [count]`, `/xp <amount>`, `/tp <x> <y> <z>` or `/tp <waypoint>`, `/spawn <mob>` (for example `zombie`, `skeleton`, `witch`, `blastcap`), `/locate <structure>` (`/locate list` for this dimension's), `/dimension overworld|ember|hollow`, `/raid start|stop`, `/music`, `/difficulty peaceful|easy|normal|hard`, `/gamerule keepInventory true|false`, `/seed`, `/kill`, `/help [command]`

Building: `/setblock <x> <y> <z> <block>`, `/fill <x1> <y1> <z1> <x2> <y2> <z2> <block> [replace <block>|hollow|outline]` (up to 32,768 blocks) and `/undo`, which also takes back blocks you placed or broke in Creative. Coordinates accept `~` for your own position, like `~ ~-1 ~`.

Waypoints: `/waypoint add <name>`, `/waypoint remove <name>`, `/waypoint list`. Waypoints show on screen with their distance and on both maps, and your last death position is marked automatically.

Item names for `/give` are the lowercase names with underscores, for example `/give diamond_pickaxe` or `/give oak_stairs 64`. Press Tab to complete command names, item and block names, creature names and waypoints.

## How it's built

TypeScript, [Vite](https://vite.dev) and [Three.js](https://threejs.org), with no game engine.

| Area | Where |
|---|---|
| Block and item registry | `src/blocks.ts`, `src/items.ts` |
| Terrain, caves, ores, trees, dungeons | `src/world/worldgen.ts` |
| Villages | `src/world/villages.ts` |
| The Emberdeep | `src/world/embergen.ts` |
| Structures in every dimension (catalogue, placement, and a builder that writes each one chunk by chunk) | `src/world/structure-kinds.ts`, `src/world/structures*.ts`, `src/world/builder.ts` |
| Trading | `src/trading.ts` |
| Chunk meshing (face culling, smooth light, ambient occlusion) | `src/world/mesher.ts` |
| Terrain draw batching (chunk sections merged into 64-high bands, rebuilt on a frame budget) | `src/render/renderer.ts` |
| The game loop, world lifecycle and saving | `src/game.ts` |
| Mining, placing and using things | `src/game/actions.ts` |
| Keyboard, mouse, pointer lock, gamepad and key bindings | `src/game/input.ts` |
| Chat, command table and completion, undo history, waypoints | `src/game/chat.ts`, `src/game/commands.ts`, `src/game/history.ts`, `src/game/waypoints.ts` |
| Minimap and world map | `src/ui/map.ts` |
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
npm run lint                      # oxlint
npm test                          # unit tests: noise, world gen, lighting, physics, crafting, armor, enchanting...
npm run dev -- --port 5199        # then, in another terminal:
npm run playtest                  # plays the real game in headless Chromium and checks mining, placing,
                                  # water, torches, combat, bows, shearing, breeding, bone meal, armor,
                                  # weather, dungeon loot, fishing, enchanting, power, fire, villages,
                                  # trading, Ember Gates, the Emberdeep, crafting, closing every screen,
                                  # commands and undo, chat completion, maps, camera, key bindings,
                                  # a gamepad, inventory dragging, brewing, rails, boats, taming, pistons,
                                  # bees and crops, raids, structures, the Astral Gate, the Hollow and
                                  # its Colossus, gliding, music and cave echo, world backups and save/load
npm run test:mobile               # the same on an emulated phone: touch walking, looking, mining, buttons
npm run test:multiplayer          # two players in one world: joining, block edits, creatures, items, chat
npm run screenshots               # regenerates docs/screenshots
```

Every push runs lint, the unit tests, the playtest, the phone test and the two-player test in CI before deploying. CI machines have no GPU, so there the game runs with `NORENDER=1` (the page is opened with `?norender`): everything updates normally but nothing is drawn.

## What's not in yet

More of multiplayer: shared chests and furnaces, travelling between dimensions together, and a way to connect through networks that block direct links.

## Licence

[MIT](LICENSE)
