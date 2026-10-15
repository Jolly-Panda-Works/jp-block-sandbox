# Blocksy — Testing

## Automated tests

`npm test` runs `shared/test/core.test.ts` with Node's test runner through `tsx`. There are 17 tests, covering:

- block catalog integrity and that every tile is painted;
- grid set/get, change events and protection;
- RLE round-trip of the generated island;
- voxel ray cast: hit cell, face normal, max distance, origin skip, negative axes;
- placement rules: occupied, out of bounds, inside the player (feet and head), touching-but-not-overlapping is allowed, non-solid blocks, replaceable plants;
- removal rules: empty, protected, not removable;
- reach;
- 2000 random place/remove operations keep the grid consistent;
- physics: landing exactly on blocks, stopping at walls, ceiling bumps;
- island: spawn is free and grounded, base layer protected, two stalls, deterministic per seed;
- mesher: counter-clockwise face winding for three.js, hidden-face culling, layer grouping;
- textures: atlas size, determinism, non-empty icons;
- shop: buy once and own forever, no duplicates, not-for-sale and unknown ids, hotbar auto-assign and swap;
- profile sanitising;
- avatar accessory parts;
- appearance sanitising and style cycling;
- message and name sanitising, including Persian text and ZWNJ.

## Results in the authoring environment

What was run and what passed:

- `tsx --test shared/test/*.test.ts`: **17 / 17 passed**.
- `tsc --noEmit` on `shared`: **no errors**.

What was only partly checked: `client` and `server`. The authoring environment had no network access, so `three`, `@react-three/fiber`, `@react-three/drei`, `colyseus`, `colyseus.js`, `zustand` and the React type packages could **not be installed**. Instead, both projects were type-checked against stub declarations that type every library as `any`.

- That check found no errors in project code. The only reports were caused by the stubs themselves.
- It catches syntax errors and mistakes in the project's own types.
- It does **not** verify correct use of library APIs.

What was not run at all:

- The client has never been built.
- The server has never been started.
- The game has not been played or seen on screen.
- Visual fidelity to the references is therefore **unverified**.

Library versions are pinned to the Colyseus **0.15** line (`colyseus@0.15`, `@colyseus/schema@2`, `colyseus.js@0.15`) and React Three Fiber **8** with React 18. Expect possible small fixes on the first `npm install && npm run dev`.

## Manual verification checklist

Run `npm run dev`, then open two browser windows and check each item:

1. Join from both windows. The island card shows 2 / 8 players and each player sees the other with a name tag.
2. WASD and Shift movement; jump onto a 1-block mound; walk into walls (no tunnelling); jump under a ceiling.
3. Press V repeatedly. The transition blends smoothly, the body is hidden in first person (shadow remains) and the arm with the held block appears.
4. In third person, back up against a wall or tree. The camera pulls in and does not clip.
5. Walk to the Blocks stall and press E (or press B). Get several blocks and confirm they appear in the hotbar. Get the same block again and confirm nothing changes.
6. With empty hands, click around: nothing is edited. Press T, put blocks in slots 1–9, press 1 and place blocks. Try to place inside yourself or the other player (refused), place with no target, and place beyond reach. Press 1 again: hands empty.
7. Press 0 (hammer) and remove blocks. Try to remove the bottom island layer, a stall or the plaza pillar (refused with a toast).
8. Place again into a cell you just emptied.
9. Repeat several placements and removals in both windows and confirm both views stay identical.
10. Customisation: change every style and colour. The preview and your character update live, and the other window sees the change after Done.
11. Social (G): emoji and text bubbles show above your head in both windows; Happy, Cry and Wave animations play.
12. Reload the page. Owned blocks, hotbar and appearance persist; world edits persist while the room is alive.
13. Press Esc: the pause menu opens. Resume re-captures the cursor.
14. The browser console shows no errors.
