# Sunny Isle — Block Sandbox (React Three Fiber + Colyseus)

A Minecraft-inspired multiplayer building game in the browser, modelled on the supplied reference images.
All textures, characters and icons are original and generated in code. No Minecraft assets are used.

## Features (phase one)

- **World**: a voxel island ("Sunny Isle"). It has layered cliffs, a stone plaza with a lantern pillar and a large oak, dirt paths with stepping stones, two shop stalls (Blocks / Decor) with striped awnings and shopkeepers, fenced "Build Here" plots, trees, lantern posts, a dock, floating islets, sea, square sun, clouds and seagulls.
- **Player**: walk, sprint, jump (coyote time and jump buffering, no double jumps), gravity, and voxel collision with walls and ceilings. Falling into the sea respawns you.
- **Camera**: first and third person (**V**). The transition is blended, so it never snaps. The third-person camera has shoulder offset and collision. In first person your body is hidden but still casts a shadow, and a first-person arm holds the selected block.
- **Building**: the crosshair targets blocks with a voxel ray cast. A teal outline marks the target and a ghost preview shows where the block will go. **Right click** places, **left click** removes, and holding a button repeats. The game:
  - checks reach;
  - stops you placing inside any player;
  - replaces flowers and grass when you build on them;
  - protects the island base and the stalls.
- **Shop**: blocks are bought at the stalls (**E**) or with **B**. A block is bought once and owned forever, with no item counts. Every price is currently 0. Prices and a coin balance already exist for a later economy.
- **Hotbar**: 9 slots. Use 1–9 or the mouse wheel. Click an owned block in the shop to put it in the selected slot.
- **Character customisation** (**C**): skin colour, plus a model and a colour for hair, shirt, pants and shoes. Accessories are hat, glasses and watch. A live 3D preview is included.
- **Social** (**T**):
  - **text** messages and **emoji**, both shown in a bubble above your head;
  - **emotes**: character animations Happy, Cry and Wave.
- **Multiplayer**: up to 8 players per room. The Colyseus server is authoritative for blocks, ownership and chat. Every edit is validated for bounds, protection, ownership, reach, player overlap and rate.
- **Profiles**: owned blocks, hotbar and appearance are stored on the server against an anonymous id kept in the browser.

## Quick start

Requirements: **Node.js 18.18+** (20 or 22 recommended).

```bash
npm install
npm run dev        # server on ws://localhost:2567 and client on http://localhost:5173
```

Open http://localhost:5173 and enter a name. To test multiplayer, open a second browser window.

Production (one port):

```bash
npm run build      # builds client/dist
npm start          # Colyseus server also serves client/dist on http://localhost:2567
```

| Variable | Where | Default |
|---|---|---|
| `PORT` | server | `2567` |
| `PROFILE_FILE` | server | `server/data/profiles.json` |
| `VITE_SERVER_URL` | client (build time) | `ws://<host>:2567` in dev, same origin in production |

## Controls

| Action | Input |
|---|---|
| Move / Sprint | W A S D / Shift (by physical key, so it works with Persian and other layouts) |
| Jump | Space |
| Look | Mouse (click the game to capture the cursor) |
| Remove / Place block | Left / Right mouse button (hold to repeat) |
| Select hotbar slot | 1–9, mouse wheel |
| First / third person | V |
| Open the shop at a stall | E |
| Shop / Style / Social | B / C / T |
| Hide hints | H |
| Menu, close panels | Esc |

## Project structure

```
shared/   Engine-free TypeScript used by both client and server (unit-tested)
  src/blocks.ts       block catalog (all prices 0)
  src/grid.ts         BlockGrid + RLE snapshot encoding
  src/raycast.ts      voxel DDA ray cast
  src/placement.ts    placement / removal / reach rules
  src/physics.ts      axis-separated voxel AABB collision
  src/island.ts       deterministic "Sunny Isle" generator
  src/avatar.ts       appearance data, palettes, sanitising
  src/avatarParts.ts  appearance → list of boxes (clothing models, accessories)
  src/economy.ts      profile, one-time purchases, hotbar
  src/social.ts       emoji, emotes, preset messages, message sanitising
  src/textures.ts     procedural pixel-art tiles, atlas, isometric icons
  src/mesher.ts       chunk mesher (face culling, per-layer groups)
  src/protocol.ts     typed client/server messages
  test/core.test.ts
server/   Colyseus server (rooms/IslandRoom.ts, schema.ts, profiles.ts)
client/   Vite + React + React Three Fiber
  src/game/   input, pointer lock, local player controller, client world copy
  src/render/ world chunks, avatar, characters and labels, environment, textures
  src/ui/     HUD, shop, customisation, social panel, pause menu, join screen
  src/net/    Colyseus client
docs/     ARCHITECTURE.md, TESTING.md
```

The project uses the scoped namespace `@jp/...` for all packages (the JP root namespace).

## Known limitations

See [docs/TESTING.md](docs/TESTING.md) for what was and wasn't verified.

- **Not saved**: the world lives in server memory. Edits are lost when the room closes (save/load is out of scope for phase one). Profiles *are* saved.
- **Movement trust**: movement is client-authoritative with a server speed check, which is enough for friendly play but not cheat-proof.
- **Accounts**: profiles use an anonymous id with no authentication.
- **Input**: desktop keyboard and mouse only. The mobile joystick and buttons shown in the references are not implemented yet.
- **Lighting and terrain**: daytime only (reference 3 shows a night scene), and there are no stairs or slabs, so 1-block steps are climbed by jumping.
- **Rendering**: point lights are limited to the 6 lanterns closest to the spawn.

## Next steps (phase two)

1. World persistence (snapshot plus edit log per room).
2. Touch controls.
3. Day/night cycle.
4. Server-side movement simulation using the shared physics.
5. Coins and real prices.
6. More shapes (stairs, slabs, doors, glass panes).
7. Greedy meshing.
8. Room browser.
9. Authentication.
