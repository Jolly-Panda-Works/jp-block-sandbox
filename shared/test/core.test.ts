import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR, BLOCKS, BlockGrid, blockId, getBlock, voxelRaycast, evaluatePlacement, evaluateRemoval, resolvePlacementCell,
  withinReach, playerAabb, intersects, cellAabb, moveBody, rleEncode, rleDecodeInto, createWorldGrid, generateIsland,
  SURFACE_Y, FACE_CORNERS, FACE_DIRS, buildChunkMesh, blockFaceUv, TILE_KEYS, paintTile, paintAtlas, renderIcon,
  ATLAS_WIDTH, ATLAS_HEIGHT, createProfile, purchase, sanitizeProfile, assignSlot, autoAssign, listings,
  sanitizeAppearance, DEFAULT_APPEARANCE, buildAvatarParts, sanitizeMessage, sanitizeName, cycle, HAIR_STYLES,
  randomAppearance, createRng, HOTBAR_SLOTS, isToolKind,
} from '../src/index';

const stone = blockId('stone'), grass = blockId('grass'), flower = blockId('white_flower'), lantern = blockId('lantern');

test('catalog: unique ids/keys, every tile key is painted, every price is 0', () => {
  assert.equal(new Set(BLOCKS.map((b) => b.id)).size, BLOCKS.length);
  assert.equal(new Set(BLOCKS.map((b) => b.key)).size, BLOCKS.length);
  for (const b of BLOCKS) for (const t of [b.top, b.side, b.bottom]) assert.ok((TILE_KEYS as readonly string[]).includes(t), `${b.key}:${t}`);
  assert.ok(BLOCKS.every((b) => b.price === 0));
  assert.equal(getBlock(AIR), undefined);
});

test('grid: bounds, set/get, events, protection', () => {
  const g = new BlockGrid(4, 4, 4);
  const events: number[][] = [];
  const off = g.onChange((x, y, z, o, n) => events.push([x, y, z, o, n]));
  assert.equal(g.get(-1, 0, 0), AIR);
  assert.equal(g.set(9, 0, 0, stone), false);
  assert.equal(g.set(1, 2, 3, stone), true);
  assert.equal(g.set(1, 2, 3, stone), false, 'no-op when unchanged');
  assert.deepEqual(events, [[1, 2, 3, AIR, stone]]);
  off();
  g.set(1, 2, 3, AIR);
  assert.equal(events.length, 1, 'unsubscribed');
  g.setProtected(0, 0, 0, true);
  assert.ok(g.isProtected(0, 0, 0));
});

test('rle roundtrip of the generated island', () => {
  const g = createWorldGrid();
  generateIsland(g, 1337);
  const rle = rleEncode(g.cells);
  const copy = new Uint16Array(g.cells.length);
  rleDecodeInto(rle, copy);
  assert.deepEqual(copy, g.cells);
  assert.ok(rle.length < g.cells.length / 4, `rle compresses (${rle.length} numbers)`);
  assert.throws(() => rleDecodeInto([1, 3], new Uint16Array(4)));
});

test('raycast: hits the first targetable cell with the correct face normal and skips the origin cell', () => {
  const solid = (x: number, y: number, z: number) => x === 5 && y === 0 && z === 0;
  const h = voxelRaycast(0.5, 0.5, 0.5, 1, 0, 0, 10, solid);
  assert.ok(h.hit);
  assert.deepEqual([h.x, h.y, h.z, h.nx, h.ny, h.nz], [5, 0, 0, -1, 0, 0]);
  assert.ok(Math.abs(h.distance - 4.5) < 1e-6);
  assert.equal(voxelRaycast(0.5, 0.5, 0.5, 1, 0, 0, 4, solid).hit, false, 'max distance respected');
  const down = voxelRaycast(0.5, 3.2, 0.5, 0, -1, 0, 10, (x, y, z) => y === 0 && x === 0 && z === 0);
  assert.deepEqual([down.x, down.y, down.z, down.ny], [0, 0, 0, 1]);
  assert.equal(voxelRaycast(0.5, 0.5, 0.5, 1, 0, 0, 10, (x) => x === 0).hit, false, 'origin cell skipped');
  const neg = voxelRaycast(-0.5, 0.5, 0.5, -1, 0, 0, 10, (x) => x === -3);
  assert.deepEqual([neg.x, neg.nx], [-3, 1]);
});

test('placement rules', () => {
  const g = new BlockGrid(8, 8, 8);
  g.set(2, 0, 2, stone);
  assert.equal(evaluatePlacement(g, 2, 1, 2, stone, []), 'ok');
  assert.equal(evaluatePlacement(g, 2, 0, 2, stone, []), 'occupied');
  assert.equal(evaluatePlacement(g, 9, 0, 0, stone, []), 'out_of_bounds');
  assert.equal(evaluatePlacement(g, 2, 1, 2, AIR, []), 'not_placeable');
  const player = playerAabb(2.5, 1, 2.5);
  assert.equal(evaluatePlacement(g, 2, 1, 2, stone, [player]), 'blocked_by_actor');
  assert.equal(evaluatePlacement(g, 2, 2, 2, stone, [player]), 'blocked_by_actor', 'head height');
  assert.equal(evaluatePlacement(g, 3, 1, 2, stone, [player]), 'ok', 'adjacent cell is fine (touching ≠ overlapping)');
  assert.equal(evaluatePlacement(g, 2, 1, 2, lantern, [player]), 'ok', 'non-solid blocks may overlap the player');
  g.set(4, 1, 4, flower);
  assert.deepEqual(resolvePlacementCell(g, 4, 1, 4, 0, 1, 0), [4, 1, 4], 'plants are replaced in place');
  assert.deepEqual(resolvePlacementCell(g, 2, 0, 2, 0, 1, 0), [2, 1, 2]);
  assert.equal(evaluatePlacement(g, 4, 1, 4, stone, []), 'ok');
  assert.ok(intersects(cellAabb(0, 0, 0), cellAabb(0, 0, 0)));
  assert.ok(!intersects(cellAabb(0, 0, 0), cellAabb(1, 0, 0)));
});

test('removal rules and protection', () => {
  const g = new BlockGrid(4, 4, 4);
  assert.equal(evaluateRemoval(g, 0, 0, 0), 'empty');
  g.set(0, 0, 0, blockId('island_core'));
  assert.equal(evaluateRemoval(g, 0, 0, 0), 'not_removable');
  g.set(1, 0, 0, grass); g.setProtected(1, 0, 0, true);
  assert.equal(evaluateRemoval(g, 1, 0, 0), 'protected');
  g.set(2, 0, 0, grass);
  assert.equal(evaluateRemoval(g, 2, 0, 0), 'ok');
  assert.equal(evaluateRemoval(g, -1, 0, 0), 'out_of_bounds');
});

test('reach is measured to the nearest point of the cell', () => {
  assert.ok(withinReach(0, 0, 0, 5, 0, 0, 5.5));
  assert.ok(!withinReach(0, 0, 0, 6, 0, 0, 5.5));
});

test('repeated place/remove keeps grid consistent', () => {
  const g = new BlockGrid(8, 8, 8);
  const rng = createRng(4);
  const expected = new Map<number, number>();
  for (let i = 0; i < 2000; i++) {
    const x = Math.floor(rng() * 8), y = Math.floor(rng() * 8), z = Math.floor(rng() * 8);
    if (evaluatePlacement(g, x, y, z, stone, []) === 'ok') { g.set(x, y, z, stone); expected.set(g.index(x, y, z), stone); }
    else if (evaluateRemoval(g, x, y, z) === 'ok') { g.set(x, y, z, AIR); expected.delete(g.index(x, y, z)); }
  }
  assert.equal(g.count(stone), expected.size);
});

test('physics: falls, lands on top of blocks, cannot walk through walls, bumps ceilings', () => {
  const g = new BlockGrid(10, 10, 10);
  for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) g.set(x, 0, z, stone);
  g.set(5, 1, 4, stone); g.set(5, 2, 4, stone);
  const body = { x: 2.5, y: 3, z: 4.5, vx: 0, vy: 0, vz: 0, grounded: false };
  for (let i = 0; i < 120; i++) { body.vy -= 26 / 60; moveBody(g, body, 1 / 60, 0.3, 1.8); }
  assert.ok(Math.abs(body.y - 1) < 1e-6, `landed at ${body.y}`);
  assert.ok(body.grounded);
  for (let i = 0; i < 120; i++) { body.vx = 4; body.vy -= 26 / 60; moveBody(g, body, 1 / 60, 0.3, 1.8); }
  assert.ok(Math.abs(body.x - (5 - 0.3)) < 1e-6, `stopped at wall: ${body.x}`);
  g.set(2, 3, 2, stone);
  const b2 = { x: 2.5, y: 1, z: 2.5, vx: 0, vy: 8, vz: 0, grounded: true };
  const r = moveBody(g, b2, 0.1, 0.3, 1.8);
  assert.ok(r.hitCeiling && b2.vy === 0 && Math.abs(b2.y + 1.8 - 3) < 1e-6);
});

test('island: spawn is free and standing on solid ground; base layer protected', () => {
  const g = createWorldGrid();
  const layout = generateIsland(g, 1337);
  const sx = Math.floor(layout.spawn.x), sy = Math.floor(layout.spawn.y), sz = Math.floor(layout.spawn.z);
  assert.equal(sy, SURFACE_Y + 1);
  assert.ok(getBlock(g.get(sx, sy - 1, sz))?.solid, 'ground under spawn');
  assert.ok(!getBlock(g.get(sx, sy, sz))?.solid && !getBlock(g.get(sx, sy + 1, sz))?.solid, 'room for the player');
  assert.ok(g.isProtected(sx, 0, sz));
  assert.equal(layout.stalls.length, 2);
  assert.deepEqual(layout.stalls.map((s) => s.title), ['Blocks', 'Decor']);
  const again = createWorldGrid();
  generateIsland(again, 1337);
  assert.deepEqual(again.cells, g.cells, 'deterministic for a seed');
});

test('mesher: face winding is counter-clockwise from outside (three.js front faces)', () => {
  FACE_CORNERS.forEach((c, f) => {
    const e1 = c[1].map((v, i) => v - c[0][i]), e2 = c[2].map((v, i) => v - c[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    assert.deepEqual(n.map((v) => Math.sign(v) + 0), FACE_DIRS[f].map((v) => Math.sign(v) + 0), `face ${f}`);
  });
});

test('mesher: hidden faces culled, layers grouped', () => {
  const g = new BlockGrid(4, 4, 4);
  g.set(0, 0, 0, stone);
  assert.equal(buildChunkMesh(g, 0, 0, 0, 4, blockFaceUv).indices.length, 36);
  g.set(1, 0, 0, stone);
  assert.equal(buildChunkMesh(g, 0, 0, 0, 4, blockFaceUv).indices.length, 60, 'shared face removed from both');
  g.set(0, 1, 0, blockId('glass'));
  const m = buildChunkMesh(g, 0, 0, 0, 4, blockFaceUv);
  assert.deepEqual(m.groups.map((x) => x.layer), [0, 2]);
  assert.equal(m.positions.length / 3, m.uvs.length / 2);
});

test('textures: atlas and icons have the expected size and are deterministic', () => {
  assert.equal(paintAtlas().length, ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  assert.deepEqual(paintTile('grass_top'), paintTile('grass_top'));
  const icon = renderIcon(getBlock(grass)!, 64);
  let opaque = 0;
  for (let i = 3; i < icon.length; i += 4) if (icon[i] > 0) opaque++;
  assert.ok(opaque > 64 * 64 * 0.4, 'icon is mostly filled');
  assert.ok(renderIcon(getBlock(flower)!, 64).some((v, i) => i % 4 === 3 && v > 0));
});

test('shop: buy once, own forever, no quantities; hotbar auto-assign and swap', () => {
  const p = createProfile();
  assert.equal(p.hotbar.length, HOTBAR_SLOTS);
  assert.equal(purchase(p, stone), 'purchased');
  assert.equal(purchase(p, stone), 'already_owned');
  assert.equal(p.owned.filter((id) => id === stone).length, 1);
  assert.equal(p.hotbar[0], stone);
  assert.equal(purchase(p, blockId('island_core')), 'not_for_sale');
  assert.equal(purchase(p, 999), 'unknown_item');
  purchase(p, grass);
  assignSlot(p.hotbar, 0, grass);
  assert.deepEqual(p.hotbar.slice(0, 2), [grass, stone], 'swap keeps ids unique');
  assert.equal(autoAssign(p.hotbar, grass), 0);
  assert.ok(listings('blocks').length > 10 && listings('decor').length >= 6);
});

test('tool kinds', () => {
  assert.ok(isToolKind('none') && isToolKind('block') && isToolKind('destroy'));
  assert.ok(!isToolKind('hammer') && !isToolKind(2));
});

test('profile sanitising drops invalid data', () => {
  const p = sanitizeProfile({ coins: -5, owned: [stone, 999, blockId('island_core'), stone], hotbar: [stone, grass, stone], appearance: { hair: 'mohawk', skin: 'red' } });
  assert.equal(p.coins, 0);
  assert.deepEqual(p.owned, [stone]);
  assert.deepEqual(p.hotbar.slice(0, 3), [stone, AIR, AIR]);
  assert.equal(p.appearance.hair, DEFAULT_APPEARANCE.hair);
  assert.equal(p.appearance.skin, DEFAULT_APPEARANCE.skin);
});

test('avatar: accessories add parts; sanitise and cycle', () => {
  const base = buildAvatarParts({ ...DEFAULT_APPEARANCE });
  const fancy = buildAvatarParts({ ...DEFAULT_APPEARANCE, hat: 'tophat', glasses: 'round', watch: 'smart' });
  assert.ok(fancy.length > base.length);
  assert.ok(fancy.some((p) => p.name === 'crown') && fancy.some((p) => p.name === 'watchFace'));
  assert.ok(!fancy.some((p) => p.name === 'hairTop'), 'hat replaces hair top');
  assert.deepEqual(sanitizeAppearance(randomAppearance(createRng(9))), sanitizeAppearance(sanitizeAppearance(randomAppearance(createRng(9)))));
  assert.equal(cycle(HAIR_STYLES, 'bald', 1), 'short');
});

test('social: message and name sanitising', () => {
  assert.equal(sanitizeMessage('  hi\n\nthere\u0007 '), 'hi there');
  assert.equal(sanitizeMessage('x'.repeat(200)).length, 60);
  assert.equal(sanitizeMessage(42), '');
  assert.equal(sanitizeName('   '), 'Player');
  assert.equal(sanitizeMessage('سلام دوستان'), 'سلام دوستان');
  assert.equal(sanitizeMessage('می\u200cخواهم'), 'می\u200cخواهم', 'Persian ZWNJ is preserved');
});
