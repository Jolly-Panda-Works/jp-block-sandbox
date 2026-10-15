import { AIR, blockId } from './blocks';
import { SURFACE_Y, WATER_LEVEL, WORLD_SIZE } from './constants';
import { BlockGrid } from './grid';
import { createRng, randInt } from './rng';
import type { ShopCategory } from './blocks';
import type { GameCenterNpc, MiniGameKind } from './minigames';
import type { Biome } from './animals';

export interface Vec3 { x: number; y: number; z: number }
export interface StallInfo {
  category: ShopCategory;
  title: string;
  min: Vec3;
  max: Vec3;
  keeper: Vec3 & { yaw: number };
  interact: Vec3;
  sign: Vec3 & { yaw: number };
}
export interface SignInfo extends Vec3 { text: string; yaw: number }
export interface IslandLayout {
  spawn: Vec3 & { yaw: number };
  center: Vec3;
  waterLevel: number;
  stalls: StallInfo[];
  signs: SignInfo[];
  lanterns: [number, number, number][];
  /** Fenced area with NPCs that play the popup mini-games. */
  gameCenter: { x: number; y: number; z: number; npcs: GameCenterNpc[] };
  /** Animal homes: centre and radius of each biome that was built. */
  biomes: { biome: Biome; x: number; y: number; z: number; r: number }[];
}

export const createWorldGrid = (): BlockGrid => new BlockGrid(WORLD_SIZE.x, WORLD_SIZE.y, WORLD_SIZE.z);

/**
 * Deterministically builds "Sunny Isle" after the reference images: grass plateau with layered cliffs,
 * stone plaza with a lantern pillar and a big oak, dirt paths with stepping stones, two shop stalls
 * (Blocks, Decor) with striped awnings, fenced "Build Here" plots, trees, lantern posts, a dock and
 * floating islets. Yaw is in radians; yaw 0 faces +Z.
 */
export function generateIsland(grid: BlockGrid, seed: number, opts: { biomes?: readonly Biome[] } = {}): IslandLayout {
  const rng = createRng(seed);
  const CX = Math.floor(grid.sx / 2), CZ = Math.floor(grid.sz / 2);
  const S = SURFACE_Y;
  const B = {
    grass: blockId('grass'), dirt: blockId('dirt'), stone: blockId('stone'), core: blockId('island_core'),
    path: blockId('dirt_path'), gravel: blockId('gravel'), bricks: blockId('stone_bricks'), cobble: blockId('cobblestone'),
    planks: blockId('oak_planks'), dark: blockId('dark_planks'), log: blockId('oak_log'), leaves: blockId('leaves'),
    fence: blockId('fence'), lantern: blockId('lantern'), farmland: blockId('farmland'), tall: blockId('tall_grass'),
    flowerW: blockId('white_flower'), flowerY: blockId('yellow_flower'), sand: blockId('sand'),
    teal: blockId('teal_wool'), red: blockId('red_wool'), white: blockId('white_wool'), glass: blockId('glass'),
    craft: blockId('crafting_table'), chest: blockId('chest'),
    water: blockId('water'), hay: blockId('hay'), hive: blockId('beehive'), spruceLog: blockId('spruce_log'),
    spruceLeaves: blockId('spruce_leaves'), bamboo: blockId('bamboo'),
  };
  const island = new Uint8Array(grid.sx * grid.sz);
  const reserved = new Uint8Array(grid.sx * grid.sz);
  const layout: IslandLayout = {
    spawn: { x: CX + 0.5, y: S + 1, z: CZ - 15 + 0.5, yaw: 0 },
    center: { x: CX + 0.5, y: S + 1, z: CZ + 0.5 },
    waterLevel: WATER_LEVEL, stalls: [], signs: [], lanterns: [], gameCenter: { x: 0, y: 0, z: 0, npcs: [] }, biomes: [],
  };

  const col = (x: number, z: number) => z * grid.sx + x;
  const inXZ = (x: number, z: number) => x >= 0 && z >= 0 && x < grid.sx && z < grid.sz;
  const set = (dx: number, y: number, dz: number, id: number) => grid.setSilent(CX + dx, y, CZ + dz, id);
  const get = (dx: number, y: number, dz: number) => grid.get(CX + dx, y, CZ + dz);
  const prot = (dx: number, y: number, dz: number) => grid.setProtected(CX + dx, y, CZ + dz, true);
  const inIsland = (dx: number, dz: number) => inXZ(CX + dx, CZ + dz) && island[col(CX + dx, CZ + dz)] === 1;
  const reserve = (dx: number, dz: number) => { if (inXZ(CX + dx, CZ + dz)) reserved[col(CX + dx, CZ + dz)] = 1; };
  const isReserved = (dx: number, dz: number, m: number) => {
    for (let ox = -m; ox <= m; ox++) for (let oz = -m; oz <= m; oz++) {
      const x = CX + dx + ox, z = CZ + dz + oz;
      if (!inXZ(x, z) || reserved[col(x, z)]) return true;
    }
    return false;
  };
  const replaceTop = (dx: number, dz: number, id: number) => { if (inIsland(dx, dz) && get(dx, S, dz) === B.grass) set(dx, S, dz, id); };

  // --- main island ---
  const p1 = rng() * 6.28, p2 = rng() * 6.28, p3 = rng() * 6.28;
  for (let x = 0; x < grid.sx; x++) for (let z = 0; z < grid.sz; z++) {
    const dx = x - CX, dz = z - CZ;
    const dist = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    const r = 47 + 1.6 * Math.sin(3 * a + p1) + 1.0 * Math.sin(5 * a + p2) + 0.6 * Math.sin(7 * a + p3);
    if (dist > r) continue;
    island[col(x, z)] = 1;
    grid.setSilent(x, 0, z, B.core);
    grid.setProtected(x, 0, z, true); // base ground: never removable
    grid.setSilent(x, 1, z, B.stone); grid.setSilent(x, 2, z, B.stone);
    grid.setSilent(x, 3, z, B.dirt); grid.setSilent(x, 4, z, B.dirt);
    grid.setSilent(x, 5, z, B.grass);
    if (dist > r - 1.3 && rng() < 0.4) { grid.setSilent(x, 5, z, AIR); grid.setSilent(x, 4, z, B.grass); } // stepped cliff rim
  }

  // --- plaza with lantern pillar and big oak ---
  for (let dx = -3; dx <= 3; dx++) for (let dz = 4; dz <= 10; dz++) {
    set(dx, S, dz, B.bricks); reserve(dx, dz);
    if (Math.max(Math.abs(dx), Math.abs(dz - 7)) === 1) { set(dx, S + 1, dz, B.bricks); prot(dx, S + 1, dz); }
  }
  set(0, S + 1, 7, B.bricks); set(0, S + 2, 7, B.bricks); set(0, S + 3, 7, B.lantern);
  prot(0, S + 1, 7); prot(0, S + 2, 7); prot(0, S + 3, 7);
  layout.lanterns.push([CX, S + 3, CZ + 7]);

  const canopy = (cx: number, cy: number, cz: number, radius: number, height: number) => {
    const r = Math.ceil(radius), h = Math.ceil(height);
    for (let dx = -r - 1; dx <= r + 1; dx++) for (let dy = -1; dy <= h; dy++) for (let dz = -r - 1; dz <= r + 1; dz++) {
      const px = Math.floor(cx) + dx + 0.5 - cx, pz = Math.floor(cz) + dz + 0.5 - cz;
      const nd = (px * px + pz * pz) / (radius * radius) + (dy * dy) / (height * height);
      if (nd > 1 || (nd > 0.7 && rng() < 0.35)) continue;
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz;
      if (grid.get(x, y, z) === AIR) grid.setSilent(x, y, z, B.leaves);
    }
  };
  const trunkTop = S + 8;
  for (let y = S + 1; y <= trunkTop; y++) for (let ox = 0; ox <= 1; ox++) for (let oz = 0; oz <= 1; oz++) set(ox, y, 14 + oz, B.log);
  for (let ox = -2; ox <= 3; ox++) for (let oz = 12; oz <= 17; oz++) reserve(ox, oz);
  canopy(CX + 0.5, trunkTop - 1, CZ + 14.5, 4.3, 3.2);

  // --- paths ---
  const carve = (x0: number, z0: number, x1: number, z1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const px = Math.round(x0 + (x1 - x0) * t), pz = Math.round(z0 + (z1 - z0) * t);
      for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
        const core = Math.abs(ox) <= 1 && Math.abs(oz) <= 1;
        if (!core && rng() > 0.12) continue;
        replaceTop(px + ox, pz + oz, B.path); reserve(px + ox, pz + oz);
      }
    }
  };
  carve(0, -22, 0, 3); carve(0, -1, 8, -1); carve(8, -9, 8, 6); carve(0, -1, -18, -1);
  for (let dx = -20; dx <= 20; dx++) for (let dz = -24; dz <= 8; dz++) if (get(dx, S, dz) === B.path && rng() < 0.09) set(dx, S, dz, B.gravel);

  // --- stalls (front row x0 faces -X toward the path) ---
  const stall = (x0: number, z0: number, title: string, category: ShopCategory, awningA: number) => {
    for (let dx = x0 - 1; dx <= x0 + 3; dx++) for (let dz = z0; dz <= z0 + 4; dz++) {
      reserve(dx, dz);
      for (let y = S + 1; y <= S + 6; y++) set(dx, y, dz, AIR);
    }
    for (let dx = x0; dx <= x0 + 3; dx++) for (let dz = z0; dz <= z0 + 4; dz++) set(dx, S, dz, B.dark);
    for (const px of [x0, x0 + 3]) for (const pz of [z0, z0 + 4]) for (let y = S + 1; y <= S + 3; y++) set(px, y, pz, B.log);
    for (let dz = z0 + 1; dz <= z0 + 3; dz++) {
      set(x0, S + 1, dz, B.planks);
      for (let y = S + 1; y <= S + 3; y++) set(x0 + 3, y, dz, B.planks);
      set(x0, S + 3, dz, dz % 2 === 0 ? awningA : B.white);
    }
    for (let dx = x0 + 1; dx <= x0 + 2; dx++) { set(dx, S + 1, z0, B.planks); set(dx, S + 1, z0 + 4, B.planks); }
    for (let dz = z0; dz <= z0 + 4; dz++) {
      set(x0 - 1, S + 3, dz, dz % 2 === 0 ? awningA : B.white);
      for (let dx = x0 - 1; dx <= x0 + 3; dx++) set(dx, S + 4, dz, B.dark);
    }
    set(x0, S + 2, z0 + 3, B.lantern);
    layout.lanterns.push([CX + x0, S + 2, CZ + z0 + 3]);
    if (category === 'blocks') { set(x0 + 2, S + 1, z0 + 1, B.glass); set(x0 + 2, S + 1, z0 + 3, B.cobble); set(x0 + 2, S + 2, z0 + 3, B.planks); }
    else { set(x0, S + 2, z0 + 1, B.flowerY); set(x0 + 2, S + 1, z0 + 1, B.chest); set(x0 + 2, S + 1, z0 + 3, B.craft); }
    for (let dx = x0 - 1; dx <= x0 + 3; dx++) for (let dz = z0; dz <= z0 + 4; dz++) for (let y = S; y <= S + 5; y++)
      if (get(dx, y, dz) !== AIR) prot(dx, y, dz);
    layout.stalls.push({
      category, title,
      min: { x: CX + x0 - 1, y: S, z: CZ + z0 }, max: { x: CX + x0 + 3, y: S + 4, z: CZ + z0 + 4 },
      keeper: { x: CX + x0 + 1.5, y: S + 1, z: CZ + z0 + 2.5, yaw: -Math.PI / 2 },
      interact: { x: CX + x0 - 0.5, y: S + 1, z: CZ + z0 + 2.5 },
      sign: { x: CX + x0 - 0.4, y: S + 5.55, z: CZ + z0 + 2.5, yaw: -Math.PI / 2 },
    });
  };
  stall(10, -8, 'Blocks', 'blocks', B.teal);
  stall(10, 0, 'Decor', 'decor', B.red);

  // --- fenced build plots ---
  for (let dx = -19; dx <= -9; dx++) for (let dz = -10; dz <= 8; dz++) {
    reserve(dx, dz);
    const edge = dx === -19 || dx === -9 || dz === -10 || dz === 8;
    const gate = dx === -9 && dz >= -2 && dz <= 0;
    if (edge && !gate && inIsland(dx, dz)) set(dx, S + 1, dz, B.fence);
  }
  const plot = (x0: number, z0: number, x1: number, z1: number) => {
    for (let dx = x0; dx <= x1; dx++) for (let dz = z0; dz <= z1; dz++) {
      const border = dx === x0 || dx === x1 || dz === z0 || dz === z1;
      if (border) { set(dx, S, dz, B.cobble); set(dx, S + 1, dz, B.bricks); } else set(dx, S, dz, B.farmland);
    }
  };
  plot(-17, -8, -11, -4); plot(-17, 2, -11, 6);
  const sign = (dx: number, dz: number, text: string, yaw: number) => {
    set(dx, S + 1, dz, B.fence); prot(dx, S + 1, dz); reserve(dx, dz);
    layout.signs.push({ text, x: CX + dx + 0.5, y: S + 2.35, z: CZ + dz + 0.5, yaw });
  };
  sign(-14, -3, 'Build Here', 0);
  sign(-14, 1, 'Build Here', Math.PI);

  // --- game center: stone floor, fence with a gate toward the plaza, lanterns, 4 NPC players ---
  {
    const x0 = 4, x1 = 12, z0 = 7, z1 = 15, cxg = 8, czg = 11;
    for (let dx = x0; dx <= x1; dx++) for (let dz = z0; dz <= z1; dz++) {
      if (!inIsland(dx, dz)) continue;
      reserve(dx, dz);
      for (let y = S + 1; y <= S + 5; y++) set(dx, y, dz, AIR);
      set(dx, S, dz, B.bricks);
      prot(dx, S, dz);
      const edge = dx === x0 || dx === x1 || dz === z0 || dz === z1;
      const gate = dx === x0 && dz >= czg - 1 && dz <= czg + 1;
      if (edge && !gate) { set(dx, S + 1, dz, B.fence); prot(dx, S + 1, dz); }
    }
    for (const [dx, dz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      set(dx, S + 2, dz, B.lantern); prot(dx, S + 2, dz);
      layout.lanterns.push([CX + dx, S + 2, CZ + dz]);
    }
    sign(x0 - 1, czg + 2, 'Game Center', -Math.PI / 2);
    const spots: [string, string, MiniGameKind, number, number][] = [
      ['npc:rps', 'Rocky', 'rps', 6, 9], ['npc:ttt', 'Tessa', 'ttt', 10, 9],
      ['npc:chess', 'Magnus', 'chess', 6, 13], ['npc:ludo', 'Lulu', 'ludo', 10, 13],
    ];
    layout.gameCenter = {
      x: CX + cxg + 0.5, y: S + 1, z: CZ + czg + 0.5,
      npcs: spots.map(([id, name, kind, dx, dz]) => ({
        id, name, kind, x: CX + dx + 0.5, y: S + 1, z: CZ + dz + 0.5, yaw: Math.atan2(cxg - dx, czg - dz),
      })),
    };
  }

  // --- animal biomes around the village (only the ones requested) ---
  const want = new Set<Biome>(opts.biomes ?? ['village', 'farm', 'bamboo', 'forest', 'pond', 'flowers', 'highlands']);
  const home = (biome: Biome, dx: number, dz: number, r: number) =>
    layout.biomes.push({ biome, x: CX + dx + 0.5, y: S + 1, z: CZ + dz + 0.5, r });
  const clearAbove = (dx: number, dz: number, h = 6) => { for (let y = S + 1; y <= S + h; y++) set(dx, y, dz, AIR); };
  home('village', 0, -4, 16);

  if (want.has('farm')) {               // fenced pasture with hay bales and a chicken coop
    const fx = -29, fz = 15, R = 8;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const x = fx + dx, z = fz + dz;
      if (!inIsland(x, z)) continue;
      reserve(x, z); clearAbove(x, z);
      const edge = Math.abs(dx) === R || Math.abs(dz) === R, gate = dx === R && Math.abs(dz) <= 1;
      if (edge && !gate) set(x, S + 1, z, B.fence);
    }
    for (const [dx, dz, h] of [[3, -4, 2], [4, -4, 1], [-2, 3, 1], [5, 4, 2]]) for (let k = 1; k <= h; k++) set(fx + dx, S + k, fz + dz, B.hay);
    const cx0 = fx - R + 1, cz0 = fz + R - 4;   // coop
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
      set(cx0 + dx, S, cz0 + dz, B.planks);
      set(cx0 + dx, S + 3, cz0 + dz, B.dark);
      if (dz === 2 || dx === 0) for (let y = S + 1; y <= S + 2; y++) set(cx0 + dx, y, cz0 + dz, B.planks);
    }
    set(cx0 + 2, S + 1, cz0, B.hay);
    home('farm', fx, fz, R - 1);
  }

  if (want.has('bamboo')) {             // dense bamboo grove
    const bx = 29, bz = 23, R = 8;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const x = bx + dx, z = bz + dz;
      if (dx * dx + dz * dz > R * R || !inIsland(x, z)) continue;
      reserve(x, z); clearAbove(x, z, 8);
      if (rng() < 0.3 && get(x, S, z) === B.grass) { const h = 3 + randInt(rng, 4); for (let k = 1; k <= h; k++) set(x, S + k, z, B.bamboo); }
    }
    home('bamboo', bx, bz, R);
  }

  if (want.has('forest')) {             // spruce forest
    const sx0 = 31, sz0 = -17, R = 10;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (dx * dx + dz * dz <= R * R) reserve(sx0 + dx, sz0 + dz);
    const placed: [number, number][] = [];
    for (let i = 0; i < 120 && placed.length < 14; i++) {
      const dx = randInt(rng, 2 * R + 1) - R, dz = randInt(rng, 2 * R + 1) - R;
      const x = sx0 + dx, z = sz0 + dz;
      if (dx * dx + dz * dz > (R - 1) ** 2 || !inIsland(x, z) || get(x, S, z) !== B.grass) continue;
      if (placed.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 12)) continue;
      placed.push([x, z]);
      const h = 5 + randInt(rng, 3);
      set(x, S, z, B.dirt);
      for (let k = 1; k <= h; k++) set(x, S + k, z, B.spruceLog);
      const radii = [2, 2, 1, 1, 0];
      radii.forEach((rad, i2) => {
        const y = S + h - 2 + i2;
        for (let ox = -rad; ox <= rad; ox++) for (let oz = -rad; oz <= rad; oz++) {
          if (Math.abs(ox) + Math.abs(oz) > rad + 1) continue;
          if (grid.get(CX + x + ox, y, CZ + z + oz) === AIR) set(x + ox, y, z + oz, B.spruceLeaves);
        }
      });
      set(x, S + h + 1, z, B.spruceLeaves);
    }
    home('forest', sx0, sz0, R);
  }

  if (want.has('pond')) {               // pond with a sandy shore
    const px = -27, pz = -23, rx = 7, rz = 5;
    for (let dx = -rx - 2; dx <= rx + 2; dx++) for (let dz = -rz - 2; dz <= rz + 2; dz++) {
      const x = px + dx, z = pz + dz, d = (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz);
      if (d > 1.5 || !inIsland(x, z)) continue;
      reserve(x, z); clearAbove(x, z);
      if (d <= 1) { set(x, S, z, B.water); set(x, S - 1, z, B.water); set(x, S - 2, z, B.sand); }
      else set(x, S, z, B.sand);
    }
    home('pond', px, pz, Math.max(rx, rz) + 1);
  }

  if (want.has('flowers')) {            // flower meadow with beehives on posts
    const mx = 0, mz = -37, R = 8;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const x = mx + dx, z = mz + dz;
      if (dx * dx + dz * dz > R * R || !inIsland(x, z)) continue;
      reserve(x, z); clearAbove(x, z);
      if (get(x, S, z) === B.grass && rng() < 0.5) set(x, S + 1, z, rng() < 0.5 ? B.flowerW : rng() < 0.7 ? B.flowerY : B.tall);
    }
    for (const [dx, dz] of [[-3, 2], [3, 3], [0, -4]]) { set(mx + dx, S + 1, mz + dz, B.fence); set(mx + dx, S + 2, mz + dz, B.hive); }
    home('flowers', mx, mz, R);
  }

  if (want.has('highlands')) {          // stepped grassy hills with boulders
    const hx = 0, hz = 37, R = 9;
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const x = hx + dx, z = hz + dz, d = Math.hypot(dx, dz) / R;
      if (d > 1 || !inIsland(x, z)) continue;
      reserve(x, z); clearAbove(x, z, 8);
      const levels = d < 0.3 ? 3 : d < 0.6 ? 2 : d < 0.85 ? 1 : 0;
      for (let k = 0; k < levels; k++) set(x, S + k, z, k === 0 ? B.dirt : B.stone);
      set(x, S + levels, z, B.grass);
      if (levels > 0 && rng() < 0.04) set(x, S + levels + 1, z, B.cobble);
    }
    home('highlands', hx, hz, R);
  }

  // --- dock ---
  const dz0 = -14;
  let shore = 0;
  while (shore < 40 && inIsland(shore + 1, dz0)) shore++;
  for (let dx = shore - 2; dx <= shore + 7; dx++) for (let dz = dz0 - 1; dz <= dz0 + 1; dz++) {
    set(dx, S, dz, B.planks); reserve(dx, dz);
    for (let y = S + 1; y <= S + 3; y++) set(dx, y, dz, AIR);
  }
  for (let dx = shore + 2; dx <= shore + 7; dx += 3) for (const dz of [dz0 - 1, dz0 + 1]) {
    for (let y = 1; y < S; y++) set(dx, y, dz, B.log);
    set(dx, S + 1, dz, B.fence);
  }
  set(shore + 7, S + 1, dz0 - 1, B.fence); set(shore + 7, S + 2, dz0 - 1, B.lantern);
  layout.lanterns.push([CX + shore + 7, S + 2, CZ + dz0 - 1]);
  set(shore + 3, S + 1, dz0, B.sand);

  // --- lantern posts ---
  const post = (dx: number, dz: number) => {
    if (!inIsland(dx, dz)) return;
    set(dx, S + 1, dz, B.fence); set(dx, S + 2, dz, B.lantern); reserve(dx, dz);
    layout.lanterns.push([CX + dx, S + 2, CZ + dz]);
  };
  let left = true;
  for (let dz = -20; dz <= -6; dz += 6) { post(left ? -3 : 3, dz); left = !left; }
  post(6, -6); post(6, 3); post(-8, -3); post(-8, 1);

  // --- grass mounds for jumping ---
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, r = 16 + rng() * 5;
    const bx = Math.round(Math.cos(a) * r), bz = Math.round(Math.sin(a) * r);
    if (isReserved(bx, bz, 2)) continue;
    const w = 1 + randInt(rng, 2), d = 1 + randInt(rng, 2);
    for (let dx = 0; dx <= w; dx++) for (let dz = 0; dz <= d; dz++) {
      if (!inIsland(bx + dx, bz + dz) || get(bx + dx, S, bz + dz) !== B.grass) continue;
      set(bx + dx, S, bz + dz, B.dirt); set(bx + dx, S + 1, bz + dz, B.grass); reserve(bx + dx, bz + dz);
    }
  }

  // --- trees ---
  const oak = (x: number, y: number, z: number) => {
    const h = 4 + randInt(rng, 2);
    if (grid.get(x, y - 1, z) === B.grass) grid.setSilent(x, y - 1, z, B.dirt);
    for (let i = 0; i < h; i++) grid.setSilent(x, y + i, z, B.log);
    const top = y + h - 1;
    for (let yy = top - 2; yy <= top + 1; yy++) {
      const rad = yy >= top ? 1 : 2;
      for (let ox = -rad; ox <= rad; ox++) for (let oz = -rad; oz <= rad; oz++) {
        const corner = Math.abs(ox) === rad && Math.abs(oz) === rad;
        if (corner && (yy === top + 1 || rng() < 0.6)) continue;
        if (grid.get(x + ox, yy, z + oz) === AIR) grid.setSilent(x + ox, yy, z + oz, B.leaves);
      }
    }
  };
  const trees: [number, number][] = [[0, 14]];
  for (let attempt = 0; trees.length < 34 && attempt < 900; attempt++) {
    const a = rng() * Math.PI * 2, r = 6 + rng() * 36;
    const tx = Math.round(Math.cos(a) * r), tz = Math.round(Math.sin(a) * r);
    if (!inIsland(tx, tz) || isReserved(tx, tz, 2) || get(tx, S, tz) !== B.grass) continue;
    if (trees.some(([px, pz]) => (px - tx) ** 2 + (pz - tz) ** 2 < 36)) continue;
    oak(CX + tx, S + 1, CZ + tz); reserve(tx, tz); trees.push([tx, tz]);
  }

  // --- floating islets ---
  for (const a of [0.7, 2.1, 3.7, 5.1]) {
    const ix = CX + Math.round(Math.cos(a) * 70), iz = CZ + Math.round(Math.sin(a) * 70);
    const top = 8 + randInt(rng, 5), radius = 4 + rng() * 2;
    for (let layer = 0; layer <= 6; layer++) {
      const r = radius - layer * 0.85;
      if (r <= 0.4) break;
      const ri = Math.ceil(r);
      for (let dx = -ri; dx <= ri; dx++) for (let dz = -ri; dz <= ri; dz++) {
        if (dx * dx + dz * dz > r * r) continue;
        grid.setSilent(ix + dx, top - layer, iz + dz, layer === 0 ? B.grass : layer <= 1 ? B.dirt : B.stone);
      }
    }
    oak(ix, top + 1, iz);
  }

  // --- plants ---
  for (let x = 0; x < grid.sx; x++) for (let z = 0; z < grid.sz; z++) {
    if (reserved[col(x, z)]) continue;
    for (let y = grid.sy - 2; y >= 1; y--) {
      const id = grid.get(x, y, z);
      if (id === AIR) continue;
      if (id === B.grass && grid.get(x, y + 1, z) === AIR) {
        const roll = rng();
        const p = roll < 0.075 ? B.tall : roll < 0.095 ? B.flowerW : roll < 0.105 ? B.flowerY : AIR;
        if (p !== AIR) grid.setSilent(x, y + 1, z, p);
      }
      break;
    }
  }
  return layout;
}
