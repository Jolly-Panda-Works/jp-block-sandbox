/**
 * Blocksy — multiplayer block-building sandbox for the Rastaar game platform.
 * Game key / room name: "blocksy". Base class: raw Room (a sandbox has no score race or round timer).
 *
 * Client:
 *   const room = await new Client(wsUrl).joinOrCreate("blocksy", { jwt, multiplayerId, username, avatarUrl, protocolVersion });
 *   room.onMessage("state", (state) => render(state));
 *
 * The "SHARED RULES" section is a copy of the game client's shared/ folder (blocks, grid, placement,
 * island, appearance, economy, social, protocol types). Keep it identical to the client copy;
 * PROTOCOL_VERSION must match or joins are refused with "Game version mismatch".
 */
import {
  Room, authorizeJoin, fetchRoomConfig, getGameSettings, isPlaygroundMatch, postMatchResult,
  sanitizeAvatarUrl, sanitizeUsername, type Client, type Delayed,
} from '@rastaar/game-sdk';

// =====================================================================================================
// SHARED RULES (copy of shared/src — keep in sync with the game client)
// =====================================================================================================

// ---------- shared/constants.ts ----------
/** World and gameplay constants shared by client and server. */
const WORLD_SIZE = { x: 112, y: 32, z: 112 } as const;
const SURFACE_Y = 5;
const WATER_LEVEL = 3.45;
const MAX_PLAYERS = 8;
const REACH = 5.5;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.3;
const EYE_HEIGHT = 1.62;
/** Colyseus room name on the game server. */
const ROOM_NAME = 'blocksy';
/**
 * Bump on any breaking change to messages or shared rules. Client and server each carry a copy of
 * `shared/`; the server refuses clients whose version differs, with a clear error.
 */
const PROTOCOL_VERSION = 2;
/** Players joining with the same multiplayerId share a room; this is used when none is given. */
const DEFAULT_MULTIPLAYER_ID = 'public';
const HOTBAR_SLOTS = 9;

// ---------- shared/rng.ts ----------
/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


/** Integer in [0, n). */
const randInt = (rng: () => number, n: number): number => Math.floor(rng() * n);

// ---------- shared/blocks.ts ----------
/** Block definitions. Id 0 is air. */
type BlockShape = 'cube' | 'cross' | 'fence' | 'lantern';
/** 0 opaque, 1 cutout (alpha-test), 2 transparent, 3 emissive. */
type RenderLayer = 0 | 1 | 2 | 3;
type ShopCategory = 'blocks' | 'decor';

interface BlockDef {
  id: number;
  key: string;
  name: string;
  shape: BlockShape;
  layer: RenderLayer;
  solid: boolean;
  removable: boolean;
  replaceable: boolean;
  targetable: boolean;
  purchasable: boolean;
  /** Price in coins. Every price is 0 in phase one; the field exists for a later economy. */
  price: number;
  category: ShopCategory;
  top: string;
  side: string;
  bottom: string;
}

const AIR = 0;

function def(id: number, key: string, name: string, tiles: [string, string?, string?], opts: Partial<BlockDef> = {}): BlockDef {
  const [top, side = top, bottom = top] = tiles;
  return {
    id, key, name, shape: 'cube', layer: 0, solid: true, removable: true, replaceable: false,
    targetable: true, purchasable: true, price: 0, category: 'blocks', top, side, bottom, ...opts,
  };
}

const plant = (extra: Partial<BlockDef> = {}): Partial<BlockDef> =>
  ({ category: 'decor', shape: 'cross', layer: 1, solid: false, replaceable: true, ...extra });

const BLOCKS: readonly BlockDef[] = [
  def(1, 'grass', 'Grass', ['grass_top', 'grass_side', 'dirt']),
  def(2, 'dirt', 'Dirt', ['dirt']),
  def(3, 'stone', 'Stone', ['stone']),
  def(4, 'cobblestone', 'Cobblestone', ['cobblestone']),
  def(5, 'stone_bricks', 'Stone Bricks', ['stone_bricks']),
  def(6, 'bricks', 'Bricks', ['bricks']),
  def(7, 'oak_planks', 'Wood', ['oak_planks']),
  def(8, 'dark_planks', 'Dark Wood', ['dark_planks']),
  def(9, 'oak_log', 'Log', ['log_top', 'log_side', 'log_top']),
  def(10, 'leaves', 'Leaves', ['leaves'], { layer: 1 }),
  def(11, 'glass', 'Glass', ['glass'], { layer: 2 }),
  def(12, 'sand', 'Sand', ['sand']),
  def(13, 'dirt_path', 'Path', ['path_top', 'dirt', 'dirt']),
  def(14, 'gravel', 'Gravel', ['gravel']),
  def(15, 'farmland', 'Farmland', ['farmland_top', 'dirt', 'dirt']),
  def(16, 'white_wool', 'White Wool', ['wool_white']),
  def(17, 'teal_wool', 'Teal Wool', ['wool_teal']),
  def(18, 'red_wool', 'Red Wool', ['wool_red']),
  def(19, 'yellow_wool', 'Yellow Wool', ['wool_yellow']),
  def(20, 'blue_wool', 'Blue Wool', ['wool_blue']),
  def(21, 'crafting_table', 'Workbench', ['crafting_top', 'crafting_side', 'oak_planks'], { category: 'decor' }),
  def(22, 'chest', 'Chest', ['chest_top', 'chest_side', 'chest_top'], { category: 'decor' }),
  def(23, 'lantern', 'Lantern', ['lantern'], { category: 'decor', shape: 'lantern', layer: 3, solid: false }),
  def(24, 'fence', 'Fence', ['oak_planks'], { category: 'decor', shape: 'fence' }),
  def(25, 'white_flower', 'Daisy', ['flower_white'], plant()),
  def(26, 'yellow_flower', 'Buttercup', ['flower_yellow'], plant()),
  def(27, 'tall_grass', 'Grass Tuft', ['tall_grass'], plant()),
  // Indestructible base layer of the island. Never sold, never removable.
  def(28, 'island_core', 'Island Core', ['island_core'], { purchasable: false, removable: false }),
];

const byId: (BlockDef | undefined)[] = [];
const byKey = new Map<string, BlockDef>();
for (const b of BLOCKS) {
  if (b.id === AIR) throw new Error('Id 0 is reserved for air');
  if (byId[b.id] || byKey.has(b.key)) throw new Error(`Duplicate block ${b.id}/${b.key}`);
  byId[b.id] = b;
  byKey.set(b.key, b);
}

const getBlock = (id: number): BlockDef | undefined => byId[id];

function blockId(key: string): number {
  const b = byKey.get(key);
  if (!b) throw new Error(`Unknown block key ${key}`);
  return b.id;
}


// ---------- shared/grid.ts ----------
type ChangeListener = (x: number, y: number, z: number, oldId: number, newId: number) => void;

/**
 * Dense, bounded block storage covering [0, size) on every axis.
 * Single source of truth for world contents; meshes and collision are derived from it.
 */
class BlockGrid {
  readonly cells: Uint16Array;
  readonly protectedCells: Uint8Array;
  private readonly listeners = new Set<ChangeListener>();

  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    if (sx <= 0 || sy <= 0 || sz <= 0) throw new Error('Grid size must be positive');
    this.cells = new Uint16Array(sx * sy * sz);
    this.protectedCells = new Uint8Array(sx * sy * sz);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  index(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x;
  }

  /** Block id, or air outside the bounds. */
  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.cells[this.index(x, y, z)] : AIR;
  }

  /** Sets a block and notifies listeners. Returns false if nothing changed. */
  set(x: number, y: number, z: number, id: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    const old = this.cells[i];
    if (old === id) return false;
    this.cells[i] = id;
    for (const l of this.listeners) l(x, y, z, old, id);
    return true;
  }

  /** Sets without notification (bulk generation). */
  setSilent(x: number, y: number, z: number, id: number): void {
    if (this.inBounds(x, y, z)) this.cells[this.index(x, y, z)] = id;
  }

  isProtected(x: number, y: number, z: number): boolean {
    return this.inBounds(x, y, z) && this.protectedCells[this.index(x, y, z)] === 1;
  }

  setProtected(x: number, y: number, z: number, value: boolean): void {
    if (this.inBounds(x, y, z)) this.protectedCells[this.index(x, y, z)] = value ? 1 : 0;
  }

  /** Subscribes to changes; returns an unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  count(id: number): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === id) n++;
    return n;
  }
}

/** Run-length encoding of a typed array as [value, runLength, ...] (used for the join snapshot). */
function rleEncode(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}


// ---------- shared/placement.ts ----------
interface Aabb { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

const cellAabb = (x: number, y: number, z: number): Aabb =>
  ({ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 });

/** Player collider box from the feet position. */
const playerAabb = (px: number, py: number, pz: number, r = PLAYER_RADIUS, h = PLAYER_HEIGHT): Aabb =>
  ({ minX: px - r, minY: py, minZ: pz - r, maxX: px + r, maxY: py + h, maxZ: pz + r });

/** Overlap by more than epsilon on every axis (touching faces don't count). */
function intersects(a: Aabb, b: Aabb, eps = 0.001): boolean {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps
    && a.minY < b.maxY - eps && a.maxY > b.minY + eps
    && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps;
}

type PlacementResult = 'ok' | 'out_of_bounds' | 'occupied' | 'blocked_by_actor' | 'not_placeable' | 'not_owned' | 'out_of_range';
type RemovalResult = 'ok' | 'out_of_bounds' | 'empty' | 'protected' | 'not_removable' | 'out_of_range';


function evaluatePlacement(grid: BlockGrid, x: number, y: number, z: number, id: number, blockers: readonly Aabb[]): PlacementResult {
  const def = getBlock(id);
  if (id === AIR || !def) return 'not_placeable';
  if (!grid.inBounds(x, y, z)) return 'out_of_bounds';
  const existing = grid.get(x, y, z);
  if (existing !== AIR) {
    const ex = getBlock(existing);
    if (!(ex?.replaceable && !grid.isProtected(x, y, z))) return 'occupied';
  }
  if (def.solid) {
    const box = cellAabb(x, y, z);
    for (const b of blockers) if (intersects(box, b)) return 'blocked_by_actor';
  }
  return 'ok';
}

function evaluateRemoval(grid: BlockGrid, x: number, y: number, z: number): RemovalResult {
  if (!grid.inBounds(x, y, z)) return 'out_of_bounds';
  const id = grid.get(x, y, z);
  if (id === AIR) return 'empty';
  if (grid.isProtected(x, y, z)) return 'protected';
  const def = getBlock(id);
  if (!def || !def.removable) return 'not_removable';
  return 'ok';
}

/** Distance from the eye to the nearest point of the cell is within reach. */
function withinReach(ex: number, ey: number, ez: number, x: number, y: number, z: number, reach: number): boolean {
  const cl = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const dx = cl(ex, x, x + 1) - ex, dy = cl(ey, y, y + 1) - ey, dz = cl(ez, z, z + 1) - ez;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

// ---------- shared/island.ts ----------
interface Vec3 { x: number; y: number; z: number }
interface StallInfo {
  category: ShopCategory;
  title: string;
  min: Vec3;
  max: Vec3;
  keeper: Vec3 & { yaw: number };
  interact: Vec3;
  sign: Vec3 & { yaw: number };
}
interface SignInfo extends Vec3 { text: string; yaw: number }
interface IslandLayout {
  spawn: Vec3 & { yaw: number };
  center: Vec3;
  waterLevel: number;
  stalls: StallInfo[];
  signs: SignInfo[];
  lanterns: [number, number, number][];
}

const createWorldGrid = (): BlockGrid => new BlockGrid(WORLD_SIZE.x, WORLD_SIZE.y, WORLD_SIZE.z);

/**
 * Deterministically builds "Sunny Isle" after the reference images: grass plateau with layered cliffs,
 * stone plaza with a lantern pillar and a big oak, dirt paths with stepping stones, two shop stalls
 * (Blocks, Decor) with striped awnings, fenced "Build Here" plots, trees, lantern posts, a dock and
 * floating islets. Yaw is in radians; yaw 0 faces +Z.
 */
function generateIsland(grid: BlockGrid, seed: number): IslandLayout {
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
  };
  const island = new Uint8Array(grid.sx * grid.sz);
  const reserved = new Uint8Array(grid.sx * grid.sz);
  const layout: IslandLayout = {
    spawn: { x: CX + 0.5, y: S + 1, z: CZ - 15 + 0.5, yaw: 0 },
    center: { x: CX + 0.5, y: S + 1, z: CZ + 0.5 },
    waterLevel: WATER_LEVEL, stalls: [], signs: [], lanterns: [],
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
    const r = 25.5 + 2.2 * Math.sin(3 * a + p1) + 1.5 * Math.sin(5 * a + p2) + 0.9 * Math.sin(7 * a + p3);
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
  for (let attempt = 0; trees.length < 14 && attempt < 400; attempt++) {
    const a = rng() * Math.PI * 2, r = 6 + rng() * 16;
    const tx = Math.round(Math.cos(a) * r), tz = Math.round(Math.sin(a) * r);
    if (!inIsland(tx, tz) || isReserved(tx, tz, 2) || get(tx, S, tz) !== B.grass) continue;
    if (trees.some(([px, pz]) => (px - tx) ** 2 + (pz - tz) ** 2 < 36)) continue;
    oak(CX + tx, S + 1, CZ + tz); reserve(tx, tz); trees.push([tx, tz]);
  }

  // --- floating islets ---
  for (const a of [0.7, 2.1, 3.7, 5.1]) {
    const ix = CX + Math.round(Math.cos(a) * 43), iz = CZ + Math.round(Math.sin(a) * 43);
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

// ---------- shared/avatar.ts ----------
const HAIR_STYLES = ['short', 'long', 'spiky', 'ponytail', 'bald'] as const;
const SHIRT_STYLES = ['tshirt', 'longsleeve', 'tank', 'hoodie'] as const;
const PANTS_STYLES = ['jeans', 'shorts', 'cargo'] as const;
const SHOE_STYLES = ['sneakers', 'boots', 'slipons'] as const;
const HAT_STYLES = ['none', 'cap', 'beanie', 'tophat'] as const;
const GLASSES_STYLES = ['none', 'square', 'round', 'sunglasses'] as const;
const WATCH_STYLES = ['none', 'classic', 'smart'] as const;

type HairStyle = typeof HAIR_STYLES[number];
type ShirtStyle = typeof SHIRT_STYLES[number];
type PantsStyle = typeof PANTS_STYLES[number];
type ShoeStyle = typeof SHOE_STYLES[number];
type HatStyle = typeof HAT_STYLES[number];
type GlassesStyle = typeof GLASSES_STYLES[number];
type WatchStyle = typeof WATCH_STYLES[number];

/** A character look: model + colour for each clothing slot, skin colour and accessories. */
interface Appearance {
  skin: string;
  hair: HairStyle; hairColor: string;
  shirt: ShirtStyle; shirtColor: string;
  pants: PantsStyle; pantsColor: string;
  shoes: ShoeStyle; shoeColor: string;
  hat: HatStyle; hatColor: string;
  glasses: GlassesStyle; glassesColor: string;
  watch: WatchStyle; watchColor: string;
}

const DEFAULT_APPEARANCE: Readonly<Appearance> = {
  skin: '#e0ac7e', hair: 'short', hairColor: '#5a3a22', shirt: 'tshirt', shirtColor: '#2bb3a8',
  pants: 'jeans', pantsColor: '#2e3a7a', shoes: 'sneakers', shoeColor: '#6b6f78',
  hat: 'none', hatColor: '#c0392b', glasses: 'none', glassesColor: '#222222', watch: 'none', watchColor: '#333333',
};


const HEX = /^#[0-9a-f]{6}$/i;
const pick = <T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] =>
  (typeof v === 'string' && (list as readonly string[]).includes(v) ? v : fallback) as T[number];
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

/** Validates untrusted input (network/save data) into a well-formed appearance. */
function sanitizeAppearance(input: unknown): Appearance {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  return {
    skin: color(o.skin, d.skin),
    hair: pick(HAIR_STYLES, o.hair, d.hair), hairColor: color(o.hairColor, d.hairColor),
    shirt: pick(SHIRT_STYLES, o.shirt, d.shirt), shirtColor: color(o.shirtColor, d.shirtColor),
    pants: pick(PANTS_STYLES, o.pants, d.pants), pantsColor: color(o.pantsColor, d.pantsColor),
    shoes: pick(SHOE_STYLES, o.shoes, d.shoes), shoeColor: color(o.shoeColor, d.shoeColor),
    hat: pick(HAT_STYLES, o.hat, d.hat), hatColor: color(o.hatColor, d.hatColor),
    glasses: pick(GLASSES_STYLES, o.glasses, d.glasses), glassesColor: color(o.glassesColor, d.glassesColor),
    watch: pick(WATCH_STYLES, o.watch, d.watch), watchColor: color(o.watchColor, d.watchColor),
  };
}



// ---------- shared/social.ts ----------
/** Emoji shown above a character's head. */
const EMOJIS = [
  { id: 'smile', char: '😊' }, { id: 'heart', char: '❤️' }, { id: 'thumbs', char: '👍' },
  { id: 'laugh', char: '😂' }, { id: 'wow', char: '😮' }, { id: 'wave', char: '👋' },
] as const;
type EmojiId = typeof EMOJIS[number]['id'];

/** Animated emotes. */
const EMOTES = [
  { id: 'happy', label: 'Happy', icon: '😄' }, { id: 'cry', label: 'Cry', icon: '😢' }, { id: 'wave', label: 'Wave', icon: '👋' },
] as const;
type EmoteId = typeof EMOTES[number]['id'];

const MAX_MESSAGE_LENGTH = 60;

const isEmojiId = (v: unknown): v is EmojiId => EMOJIS.some((e) => e.id === v);
const isEmoteId = (v: unknown): v is EmoteId => EMOTES.some((e) => e.id === v);

/** Removes control characters, collapses whitespace and truncates. Empty string = nothing to send. */
function sanitizeMessage(raw: unknown, max = MAX_MESSAGE_LENGTH): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e]/g, '').replace(/ {2,}/g, ' ').trim();
  return Array.from(cleaned).slice(0, max).join('').trim();
}

/** Room/lobby ids from the backend: 1–64 chars of [A-Za-z0-9_-], otherwise the default lobby. */
function sanitizeMultiplayerId(raw: unknown, fallback = 'public'): string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : fallback;
}


// ---------- shared/economy.ts ----------
/**
 * Persistent per-player data. Ownership is permanent and unlimited: a block bought once is owned forever,
 * and there are no item counts. Coins exist for a future economy; every price is 0 for now.
 */
interface ProfileData {
  coins: number;
  owned: number[];
  hotbar: number[];
  appearance: Appearance;
}

const createProfile = (): ProfileData =>
  ({ coins: 0, owned: [], hotbar: new Array(HOTBAR_SLOTS).fill(AIR), appearance: { ...DEFAULT_APPEARANCE } });

/** Repairs untrusted profile data (unknown ids dropped, hotbar only holds owned blocks). */
function sanitizeProfile(input: unknown): ProfileData {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const owned = Array.isArray(o.owned)
    ? [...new Set(o.owned.filter((id): id is number => typeof id === 'number' && !!getBlock(id)?.purchasable))]
    : [];
  const hotbar = new Array<number>(HOTBAR_SLOTS).fill(AIR);
  if (Array.isArray(o.hotbar)) o.hotbar.slice(0, HOTBAR_SLOTS).forEach((id, i) => { if (owned.includes(id as number)) hotbar[i] = id as number; });
  for (let i = 0; i < hotbar.length; i++) if (hotbar.indexOf(hotbar[i]) !== i) hotbar[i] = AIR; // no duplicates
  const coins = typeof o.coins === 'number' && Number.isFinite(o.coins) && o.coins > 0 ? Math.floor(o.coins) : 0;
  return { coins, owned, hotbar, appearance: sanitizeAppearance(o.appearance) };
}

type PurchaseResult = 'purchased' | 'already_owned' | 'not_for_sale' | 'insufficient_funds' | 'unknown_item';

/** Buys a block once. Mutates the profile on success and auto-assigns it to the first empty hotbar slot. */
function purchase(profile: ProfileData, id: number): PurchaseResult {
  const def = getBlock(id);
  if (!def) return 'unknown_item';
  if (!def.purchasable) return 'not_for_sale';
  if (profile.owned.includes(id)) return 'already_owned';
  if (profile.coins < def.price) return 'insufficient_funds';
  profile.coins -= def.price;
  profile.owned.push(id);
  autoAssign(profile.hotbar, id);
  return 'purchased';
}


/** Puts a block in a slot; if it's already in another slot the two swap (a block never appears twice). */
function assignSlot(hotbar: number[], slot: number, id: number): void {
  if (slot < 0 || slot >= hotbar.length) return;
  const existing = id === AIR ? -1 : hotbar.indexOf(id);
  if (existing === slot) return;
  if (existing >= 0) hotbar[existing] = hotbar[slot];
  hotbar[slot] = id;
}

/** First empty slot unless already present. Returns the slot or -1. */
function autoAssign(hotbar: number[], id: number): number {
  const existing = hotbar.indexOf(id);
  if (existing >= 0) return existing;
  const empty = hotbar.indexOf(AIR);
  if (empty >= 0) hotbar[empty] = id;
  return empty;
}

/** What the player has in hand: nothing, a block from the hotbar, or the destroy tool (key 0). */
const TOOLS = ['none', 'block', 'destroy'] as const;
type ToolKind = typeof TOOLS[number];
const isToolKind = (v: unknown): v is ToolKind => (TOOLS as readonly unknown[]).includes(v);


// ---------- shared/protocol.ts ----------
/**
 * Options for `client.joinOrCreate(ROOM_NAME, options)`.
 * `jwt` comes from the platform backend (POST /client/realtime/token { multiplayerId }) and is verified
 * by the game server. Players with the same `multiplayerId` share a room.
 */
interface JoinOptions {
  jwt?: string;
  multiplayerId: string;
  username: string;
  /** Anonymous id used only when the server runs without JWT verification (local development). */
  profileId?: string;
  protocolVersion: number;
}

/** Per-player transform sent in every `state` message. */
interface PlayerSnapshot {
  id: string;
  x: number; y: number; z: number; yaw: number;
  speed: number; grounded: boolean;
  held: number; tool: ToolKind;
  /** Incremented on every place/remove so others can play the arm swing. */
  action: number;
}

/** Rarely-changing player data, sent on join and when it changes. */
interface PlayerMeta { id: string; name: string; appearance: Appearance }

/** Client → server messages. */
interface ClientMessages {
  move: { x: number; y: number; z: number; yaw: number; speed: number; grounded: boolean };
  place: { x: number; y: number; z: number; id: number };
  remove: { x: number; y: number; z: number };
  buy: { id: number };
  hotbar: { slots: number[]; selected: number; tool: ToolKind };
  appearance: Appearance;
  chat: { text: string };
  emoji: { id: EmojiId };
  emote: { id: EmoteId };
}

/** Server → client messages. */
interface ServerMessages {
  /** Join snapshot: RLE-encoded grid + protection mask, layout, your profile and everyone's meta. */
  init: {
    protocolVersion: number;
    you: string;
    size: [number, number, number];
    cells: number[];
    protectedCells: number[];
    layout: IslandLayout;
    profile: ProfileData;
    spawn: { x: number; y: number; z: number; yaw: number };
    players: PlayerMeta[];
  };
  /** Broadcast at ~15 Hz: transforms of every player in the room (including you). */
  state: { t: number; players: PlayerSnapshot[] };
  playerMeta: PlayerMeta;
  playerLeft: { id: string };
  blockSet: { x: number; y: number; z: number; id: number };
  /** Sent only to the editing client when an edit was refused (includes the cell's real id). */
  editRejected: { x: number; y: number; z: number; id: number; reason: PlacementResult | RemovalResult };
  profile: { profile: ProfileData; result?: PurchaseResult };
  chat: { sessionId: string; text: string };
  emoji: { sessionId: string; id: EmojiId };
  emote: { sessionId: string; id: EmoteId };
  teleport: { x: number; y: number; z: number };
}

// =====================================================================================================
// SETTINGS (dashboard → Custom settings; every value is validated, with a default)
// =====================================================================================================

interface BlocksySettings {
  worldSeed: number;
  sessionMinutes: number;
  editsPerSecond: number;
  chatEnabled: boolean;
}

function readSettings(roomName: string): BlocksySettings {
  const raw = (getGameSettings<BlocksySettings>(roomName) ?? {}) as Partial<Record<keyof BlocksySettings, unknown>>;
  const int = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
  return {
    worldSeed: int(raw.worldSeed, 1337, 1, 2_147_483_647),
    sessionMinutes: int(raw.sessionMinutes, 0, 0, 240),
    editsPerSecond: int(raw.editsPerSecond, 12, 1, 30),
    chatEnabled: typeof raw.chatEnabled === 'boolean' ? raw.chatEnabled : true,
  };
}

// =====================================================================================================
// PROFILE CACHE — owned blocks, hotbar and appearance per userId.
// The platform gives games no storage, so this lives in process memory (shared by all Blocksy rooms)
// and is lost on restart. Clients may re-send their cached profile ("restore"); only free (price 0)
// blocks are accepted from it, so nothing of value can be forged.
// =====================================================================================================

const PROFILE_CACHE_LIMIT = 5000;
const profileCache = new Map<string, ProfileData>();

function loadProfile(userId: string): ProfileData {
  const p = profileCache.get(userId);
  if (p) {
    profileCache.delete(userId); // refresh LRU position
    profileCache.set(userId, p);
    return p;
  }
  const fresh = createProfile();
  profileCache.set(userId, fresh);
  if (profileCache.size > PROFILE_CACHE_LIMIT) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  return fresh;
}

// =====================================================================================================
// ROOM
// =====================================================================================================

type JoinAuth = Awaited<ReturnType<typeof authorizeJoin>>;
type Phase = 'playing' | 'finished';

interface Player {
  sessionId: string;
  userId: string;
  username: string;
  avatarUrl: string;
  connected: boolean;
  appearance: Appearance;
  profile: ProfileData;
  restored: boolean;
  /** Blocks placed this session (reported as the match score). */
  placed: number;
  x: number; y: number; z: number; yaw: number; speed: number; grounded: boolean;
  held: number; tool: ToolKind; action: number;
  lastMove: number;
}

/** Messages per second per player. "move" is sent at 15 Hz by the client. */
const RATE_LIMITS: Record<string, number> = {
  move: 20, place: 12, remove: 12, hotbar: 10, buy: 5, appearance: 2, restore: 1, chat: 2, emoji: 2, emote: 1,
};
const STATE_INTERVAL_MS = 100;
const MAX_SPEED = 9;          // m/s, generous above sprint speed to absorb jitter
const RECONNECT_SECONDS = 30;
const LEADERBOARD_KEY = 'lb-blocksy';

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export default class BlocksyRoom extends Room {
  private readonly grid: BlockGrid = createWorldGrid();
  private layout!: IslandLayout;
  private settings!: BlocksySettings;
  private readonly players = new Map<string, Player>();
  /** Everyone who took part (for the result), keyed by userId. */
  private readonly participants = new Map<string, { userId: string; placed: number }>();
  private readonly buckets = new Map<string, Map<string, { tokens: number; at: number }>>();
  private multiplayerId = DEFAULT_MULTIPLAYER_ID;
  private configPromise: Promise<void> | null = null;
  private phase: Phase = 'playing';
  private startedAt = 0;
  private endsAt = 0;
  private finished = false;
  private stateTimer: Delayed | null = null;
  private sessionTimer: Delayed | null = null;

  onCreate(options: Record<string, unknown> = {}): void {
    this.settings = readSettings(this.roomName);
    this.multiplayerId = sanitizeMultiplayerId(options.multiplayerId, DEFAULT_MULTIPLAYER_ID);
    this.layout = generateIsland(this.grid, this.settings.worldSeed);
    this.startedAt = Date.now();
    this.stateTimer = this.clock.setInterval(() => this.broadcastState(), STATE_INTERVAL_MS);
    if (this.settings.sessionMinutes > 0) {
      this.endsAt = this.startedAt + this.settings.sessionMinutes * 60_000;
      this.sessionTimer = this.clock.setTimeout(() => { void this.finish('time'); }, this.settings.sessionMinutes * 60_000);
    }

    this.onMessage('move', (c: Client, m: ClientMessages['move']) => { if (this.guard(c, 'move')) this.handleMove(c, m); });
    this.onMessage('place', (c: Client, m: ClientMessages['place']) => { if (this.guard(c, 'place')) this.handlePlace(c, m); });
    this.onMessage('remove', (c: Client, m: ClientMessages['remove']) => { if (this.guard(c, 'remove')) this.handleRemove(c, m); });
    this.onMessage('hotbar', (c: Client, m: ClientMessages['hotbar']) => { if (this.guard(c, 'hotbar')) this.handleHotbar(c, m); });
    this.onMessage('buy', (c: Client, m: ClientMessages['buy']) => { if (this.guard(c, 'buy')) this.handleBuy(c, m); });
    this.onMessage('appearance', (c: Client, m: ClientMessages['appearance']) => { if (this.guard(c, 'appearance')) this.handleAppearance(c, m); });
    this.onMessage('restore', (c: Client, m: unknown) => { if (this.guard(c, 'restore')) this.handleRestore(c, m); });
    this.onMessage('chat', (c: Client, m: ClientMessages['chat']) => { if (this.guard(c, 'chat')) this.handleChat(c, m); });
    this.onMessage('emoji', (c: Client, m: ClientMessages['emoji']) => {
      if (this.guard(c, 'emoji') && isEmojiId(m?.id)) this.broadcast('emoji', { sessionId: c.sessionId, id: m.id });
    });
    this.onMessage('emote', (c: Client, m: ClientMessages['emote']) => {
      if (this.guard(c, 'emote') && isEmoteId(m?.id)) this.broadcast('emote', { sessionId: c.sessionId, id: m.id });
    });
    this.onMessage('*', (c: Client, type: string | number) => { this.checkRate(c, 'other'); void type; });
    if (this.roomName !== ROOM_NAME) console.warn(`[blocksy] game key is "${this.roomName}", client expects "${ROOM_NAME}"`);
    console.log(`[blocksy] room ${this.roomId} created (mp=${this.multiplayerId}, seed=${this.settings.worldSeed})`);
  }

  async onAuth(_client: Client, options: Partial<JoinOptions> & Record<string, unknown>): Promise<JoinAuth> {
    if (options?.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Game version mismatch (client ${String(options?.protocolVersion)}, server ${PROTOCOL_VERSION}). Please reload the game.`);
    }
    return await authorizeJoin(options);
  }

  async onJoin(client: Client, options: Partial<JoinOptions> & Record<string, unknown>, auth: JoinAuth): Promise<void> {
    if (!this.configPromise) {
      this.configPromise = fetchRoomConfig(auth.multiplayerId, this.roomName)
        .then((cfg) => { if (isInt(cfg?.maxPlayers) && cfg.maxPlayers > 0) this.maxClients = Math.min(cfg.maxPlayers, MAX_PLAYERS); })
        .catch((err: unknown) => { console.warn('[blocksy] fetchRoomConfig failed, using defaults', err); });
    }
    await this.configPromise;
    if (this.phase === 'finished') throw new Error('This session has ended.');

    const profile = loadProfile(auth.userId);
    const i = this.players.size, a = (i / MAX_PLAYERS) * Math.PI * 2, s = this.layout.spawn;
    const spawn = { ...s, x: s.x + Math.cos(a) * (i ? 1.5 : 0), z: s.z + Math.sin(a) * (i ? 1.5 : 0) };
    const p: Player = {
      sessionId: client.sessionId, userId: auth.userId,
      username: sanitizeUsername(options?.username), avatarUrl: sanitizeAvatarUrl(options?.avatarUrl),
      connected: true, appearance: profile.appearance, profile, restored: false, placed: 0,
      x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, speed: 0, grounded: true, held: AIR, tool: 'none', action: 0,
      lastMove: Date.now(),
    };
    this.players.set(client.sessionId, p);
    if (!this.participants.has(auth.userId)) this.participants.set(auth.userId, { userId: auth.userId, placed: 0 });

    client.send('welcome', { sessionId: client.sessionId, userId: auth.userId });
    this.sendInit(client, p, spawn);
    this.broadcast('playerMeta', this.metaOf(p), { except: client });
    console.log(`[blocksy] ${p.username} joined ${this.roomId} (${this.players.size}/${this.maxClients})`);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    if (!consented && !this.finished) {
      p.connected = false;
      try {
        await this.allowReconnection(client, RECONNECT_SECONDS);
        p.connected = true;
        p.lastMove = Date.now();
        // The world may have changed while away: resend the full snapshot.
        this.sendInit(client, p, { x: p.x, y: p.y, z: p.z, yaw: p.yaw });
        return;
      } catch {
        // reconnection window expired
      }
    }
    this.players.delete(client.sessionId);
    this.buckets.delete(client.sessionId);
    this.broadcast('playerLeft', { id: client.sessionId });
  }

  async onDispose(): Promise<void> {
    await this.finish('empty');
  }

  // ---------------- lifecycle ----------------

  /** Ends the session once: lock, report results, notify and close. */
  private async finish(reason: 'time' | 'empty'): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.phase = 'finished';
    this.stateTimer?.clear();
    this.sessionTimer?.clear();
    if (reason === 'time') {
      await this.lock();
      this.broadcastState();
      this.broadcast('sessionEnded', { reason });
    }
    if (this.participants.size > 0) {
      try {
        const result = await postMatchResult({
          multiplayerId: this.multiplayerId,
          roomId: this.roomId,
          startedAt: new Date(this.startedAt).toISOString(),
          endedAt: new Date().toISOString(),
          players: [...this.participants.values()].map((pp) => ({
            userId: pp.userId, score: pp.placed, isWinner: false, metadata: { leaderboardKey: LEADERBOARD_KEY },
          })),
        });
        console.log(`[blocksy] result for ${this.roomId}: ${isPlaygroundMatch(this.multiplayerId) ? 'playground' : String(result)}`);
      } catch (err) {
        console.error('[blocksy] postMatchResult failed', err);
      }
    }
    if (reason === 'time') this.clock.setTimeout(() => { void this.disconnect(); }, 5000);
  }

  // ---------------- rate limiting ----------------

  /** Token bucket per player and message type (raw Room has no built-in limiter). */
  private checkRate(client: Client, type: string): boolean {
    const limit = type === 'place' || type === 'remove' ? this.settings.editsPerSecond : RATE_LIMITS[type] ?? 20;
    let perClient = this.buckets.get(client.sessionId);
    if (!perClient) { perClient = new Map(); this.buckets.set(client.sessionId, perClient); }
    const now = Date.now();
    const b = perClient.get(type) ?? { tokens: limit, at: now };
    b.tokens = Math.min(limit, b.tokens + ((now - b.at) / 1000) * limit);
    b.at = now;
    perClient.set(type, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Rate limit + session phase + known, connected player. */
  private guard(client: Client, type: string): boolean {
    return this.checkRate(client, type) && this.phase === 'playing' && !!this.players.get(client.sessionId)?.connected;
  }

  // ---------------- outgoing ----------------

  private metaOf(p: Player): PlayerMeta {
    return { id: p.sessionId, name: p.username, appearance: p.appearance };
  }

  private sendInit(client: Client, p: Player, spawn: { x: number; y: number; z: number; yaw: number }): void {
    const init: ServerMessages['init'] = {
      protocolVersion: PROTOCOL_VERSION,
      you: client.sessionId,
      size: [WORLD_SIZE.x, WORLD_SIZE.y, WORLD_SIZE.z],
      cells: rleEncode(this.grid.cells),
      protectedCells: rleEncode(this.grid.protectedCells),
      layout: this.layout,
      profile: p.profile,
      spawn,
      players: [...this.players.values()].map((pl) => this.metaOf(pl)),
    };
    client.send('init', init);
  }

  /** Public snapshot only (no user secrets); disconnected players are left out until they return. */
  private broadcastState(): void {
    if (this.players.size === 0) return;
    const players: (PlayerSnapshot & { userId: string; username: string; avatarUrl: string })[] = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      players.push({
        id: p.sessionId, userId: p.userId, username: p.username, avatarUrl: p.avatarUrl,
        x: round3(p.x), y: round3(p.y), z: round3(p.z), yaw: round3(p.yaw), speed: round3(p.speed),
        grounded: p.grounded, held: p.held, tool: p.tool, action: p.action,
      });
    }
    this.broadcast('state', {
      t: Date.now(),
      phase: this.phase,
      timeLeftMs: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : 0,
      players,
    });
  }

  private reject(client: Client, x: number, y: number, z: number, reason: ServerMessages['editRejected']['reason']): void {
    client.send('editRejected', { x, y, z, id: this.grid.get(x, y, z), reason });
  }

  // ---------------- handlers ----------------

  private handleMove(client: Client, m: ClientMessages['move']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m) || ![m.x, m.y, m.z, m.yaw, m.speed].every(isNum)) return;
    const now = Date.now();
    const dt = Math.max(0.05, (now - p.lastMove) / 1000);
    p.lastMove = now;
    // Falling/respawning legitimately moves fast vertically; only horizontal speed is limited.
    if (Math.hypot(m.x - p.x, m.z - p.z) > MAX_SPEED * dt + 1.5 && !(m.y > p.y + 1)) {
      client.send('teleport', { x: p.x, y: p.y, z: p.z });
      return;
    }
    p.x = Math.max(-50, Math.min(WORLD_SIZE.x + 50, m.x));
    p.y = Math.max(-50, Math.min(200, m.y));
    p.z = Math.max(-50, Math.min(WORLD_SIZE.z + 50, m.z));
    p.yaw = m.yaw;
    p.speed = Math.max(0, Math.min(2, m.speed));
    p.grounded = m.grounded === true;
  }

  private inReach(p: Player, x: number, y: number, z: number): boolean {
    return withinReach(p.x, p.y + EYE_HEIGHT, p.z, x, y, z, REACH + 1); // +1 m latency tolerance
  }

  private handlePlace(client: Client, m: ClientMessages['place']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m) || ![m.x, m.y, m.z, m.id].every(isInt)) return;
    const { x, y, z, id } = m;
    if (!p.profile.owned.includes(id)) return this.reject(client, x, y, z, 'not_owned');
    if (!this.inReach(p, x, y, z)) return this.reject(client, x, y, z, 'out_of_range');
    const blockers: Aabb[] = [];
    for (const pl of this.players.values()) if (pl.connected) blockers.push(playerAabb(pl.x, pl.y, pl.z));
    const result = evaluatePlacement(this.grid, x, y, z, id, blockers);
    if (result !== 'ok') return this.reject(client, x, y, z, result);
    this.grid.set(x, y, z, id);
    p.action = (p.action + 1) % 65535;
    p.placed += 1;
    const part = this.participants.get(p.userId);
    if (part) part.placed += 1;
    this.broadcast('blockSet', { x, y, z, id });
  }

  private handleRemove(client: Client, m: ClientMessages['remove']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m) || ![m.x, m.y, m.z].every(isInt)) return;
    const { x, y, z } = m;
    if (!this.inReach(p, x, y, z)) return this.reject(client, x, y, z, 'out_of_range');
    const result = evaluateRemoval(this.grid, x, y, z);
    if (result !== 'ok') return this.reject(client, x, y, z, result);
    this.grid.set(x, y, z, AIR);
    p.action = (p.action + 1) % 65535;
    this.broadcast('blockSet', { x, y, z, id: AIR });
  }

  private handleHotbar(client: Client, m: ClientMessages['hotbar']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m) || !Array.isArray(m.slots)) return;
    const next = p.profile.hotbar.map(() => AIR);
    m.slots.slice(0, next.length).forEach((id, i) => { if (isInt(id) && p.profile.owned.includes(id)) assignSlot(next, i, id); });
    p.profile.hotbar = next;
    const selected = isInt(m.selected) && m.selected >= 0 && m.selected < next.length ? m.selected : 0;
    p.tool = isToolKind(m.tool) ? m.tool : 'none';
    p.held = p.tool === 'block' && getBlock(next[selected]) ? next[selected] : AIR;
  }

  private handleBuy(client: Client, m: ClientMessages['buy']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m) || !isInt(m.id)) return;
    const result = purchase(p.profile, m.id);
    client.send('profile', { profile: p.profile, result });
  }

  private handleAppearance(client: Client, m: ClientMessages['appearance']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m)) return;
    p.appearance = p.profile.appearance = sanitizeAppearance(m);
    this.broadcast('playerMeta', this.metaOf(p));
  }

  /**
   * Optional, once per session: the client re-sends its locally cached profile after a server restart.
   * Only FREE blocks are accepted (a paid block can never be granted this way).
   */
  private handleRestore(client: Client, m: unknown): void {
    const p = this.players.get(client.sessionId);
    if (!p || p.restored || !isObj(m)) return;
    p.restored = true;
    const claimed = sanitizeProfile(m);
    for (const id of claimed.owned) {
      const def = getBlock(id);
      if (def && def.purchasable && def.price === 0 && !p.profile.owned.includes(id)) p.profile.owned.push(id);
    }
    claimed.hotbar.forEach((id, i) => { if (id !== AIR && p.profile.owned.includes(id)) assignSlot(p.profile.hotbar, i, id); });
    if (isObj(m.appearance)) {
      p.appearance = p.profile.appearance = sanitizeAppearance(m.appearance);
      this.broadcast('playerMeta', this.metaOf(p));
    }
    client.send('profile', { profile: p.profile });
  }

  private handleChat(client: Client, m: ClientMessages['chat']): void {
    if (!this.settings.chatEnabled) return;
    const text = sanitizeMessage(isObj(m) ? m.text : undefined);
    if (text) this.broadcast('chat', { sessionId: client.sessionId, text });
  }
}
