# Blocksy — Architecture

```mermaid
flowchart LR
  subgraph shared["@jp/block-sandbox-shared (pure TS)"]
    G[BlockGrid] --- R[voxelRaycast]
    G --- P[placement rules]
    G --- PH[moveBody physics]
    G --- M[mesher]
    I[generateIsland] --> G
    E[economy / profile] --- A[appearance + avatarParts]
  end
  subgraph server["Colyseus server"]
    IR[IslandRoom] --> G
    IR --> PS[ProfileStore JSON]
    IR --> ST[(IslandState schema: players)]
  end
  subgraph client["React Three Fiber client"]
    NET[network.ts] -->|init snapshot, blockSet| CW[ClientWorld grid]
    CW -->|dirty chunks| WM[WorldMesh]
    LP[LocalPlayer] -->|place/remove (optimistic), move| NET
    LP --> CW
    NET -->|state patches| RP[RemotePlayers]
    UI[React DOM HUD + panels] --> STORE[zustand store]
  end
  NET <-->|WebSocket| IR
```

## Single source of truth for blocks

The **server's `BlockGrid`** is authoritative. On join the client receives an RLE-encoded snapshot of all cells and the protection mask (`init`), plus the island layout and the player's profile. Sending the snapshot avoids depending on floating-point determinism across JavaScript engines.

Block edits flow like this:

1. The client validates the edit locally with the same shared rules.
2. It applies the edit to its own grid optimistically and sends `place` or `remove`.
3. The server re-validates the edit:
   - bounds;
   - protection (island base layer, stalls, plaza, sign posts);
   - ownership of the block;
   - reach from the server-side player position, plus 1 m tolerance;
   - overlap with any player;
   - rate limit of 12 edits per second.
4. If it is valid, the server broadcasts `blockSet` to everyone. If not, it sends `editRejected` with the cell's real id, and the client rolls back and shows a toast.

Rendering never stores block data. `ClientWorld` subscribes to grid changes and marks the affected 16³ chunk dirty, plus any neighbour chunk when the cell is on a border. `WorldMesh` rebuilds dirty chunks once per frame, building everything on the first frame and then at most 8 chunks per frame. Because meshes are always derived from the grid, they cannot drift and no stale references exist.

## Player, camera and physics

`LocalPlayer.tsx` runs once per frame in this order:

1. Read input.
2. Apply mouse look. Mouse deltas are per frame and are not scaled by `dt`.
3. Accelerate horizontally, apply jump buffer and coyote time, then gravity.
4. Move with `moveBody`, the shared axis-separated AABB sweep against solid cells.
5. Position the camera.
6. Target, place and remove blocks.
7. Update the first-person arm.
8. Check stall proximity.
9. Send `move` at 15 Hz.

Both camera poses (eye and third person) are computed every frame from the same yaw and pitch and blended with a smoothstep, so switching never snaps.

Third-person collision uses the voxel ray cast in two steps:

- from the head to the shoulder pivot;
- from the pivot backwards to the camera.

The camera pulls in instantly when blocked and recovers smoothly.

In first person the body is moved to render layer 1. The camera does not see that layer, but the sun's shadow camera does, so the body still casts a shadow.

## Avatars

`buildAvatarParts(appearance)` (in shared) turns an appearance into a list of boxes attached to joints (legs, torso, head, arms). Each clothing model and accessory adds or changes its own boxes. For example, a T-shirt has short sleeves, a hoodie adds a hood and pocket, cargo pants add pockets, a top hat replaces the hair top, and a smart watch adds a glowing face.

`Avatar.tsx` renders the boxes and animates the joints procedurally:

- walk cycle;
- idle sway;
- airborne pose;
- use swing;
- emotes: **Happy** (arms up and hop), **Cry** (sit with hands to face) and **Wave**.

Moving cancels an emote.

## Networking model

| Data | Channel |
|---|---|
| Player transform, name, appearance (sanitised JSON), held block, action counter | Colyseus schema state (`PlayerState`), patched at 20 Hz |
| Blocks | `init` snapshot + `blockSet` / `editRejected` messages |
| Chat, emoji, emotes | Broadcast messages (server sanitises text, rate-limits chat, validates ids) |
| Profile (owned blocks, hotbar, appearance) | `profile` message; persisted by `ProfileStore` (debounced atomic JSON writes) |

Remote players are interpolated toward the latest replicated transform. A change in the `action` counter triggers the arm swing.

## Shop model

Implemented in `economy.ts`:

- `purchase()` is a one-time unlock. It checks the price against coins (always 0 for now), adds the block to `owned` and auto-assigns it to the first empty hotbar slot.
- Re-buying is a no-op (`already_owned`).
- There are no counts. Placing a block never consumes anything.

## Reference-image mapping

| Reference detail | Implementation |
|---|---|
| Grass island, layered cliffs, sea and floating islets | `generateIsland`, `Sea` |
| Plaza with central lantern pillar and big oak | plaza + 2×2 oak in the generator |
| "Blocks"/"Decor" stalls with striped awnings and shopkeepers | `stall()` + `Shopkeepers` + canvas-texture signs |
| Fenced plots with "Build Here" signs | `plot()` + signs |
| Lanterns on posts | fence + emissive lantern blocks + point lights |
| Teal outline and translucent ghost on targeted block | `Outline` + ghost mesh |
| Hotbar with block names, selected slot in teal | `Hud` hotbar |
| Island card "Sunny Isle · n/8 players", top-right buttons | `Hud` |
| Key-hint bar (WASD Move · Space Jump · E Interact · V Camera) | `Hud` hints |
| Name tags and speech/emoji bubbles above heads | `Label` (drei `Html`) |
| Social panel with Emojis / Messages / Emotes tabs | `SocialPanel` |
| Happy / Cry / Wave emotes | `Avatar` animation |
| Square sun, blocky clouds, seagulls | `Environment` |

Not reproduced:

- the night scene (reference 3);
- touch controls;
- chests and workbenches as non-cube models (they are textured cubes);
- doors and windows.
