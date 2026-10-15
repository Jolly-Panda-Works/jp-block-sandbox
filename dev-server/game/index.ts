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
/** Default world: a bigger island (radius ≈ 46) with a village and animal biomes around it. */
const WORLD_SIZE = { x: 176, y: 40, z: 176 } as const;
const CHUNK_SIZE = 16;
const SURFACE_Y = 5;
const WATER_LEVEL = 3.45;
const MAX_PLAYERS = 8;
const REACH = 5.5;
const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.3;
const EYE_HEIGHT = 1.62;
const RESPAWN_BELOW_Y = 0.5;
/** Colyseus room name on the game server. */
const ROOM_NAME = 'blocksy';
/**
 * Bump on any breaking change to messages or shared rules. Client and server each carry a copy of
 * `shared/`; the server refuses clients whose version differs, with a clear error.
 */
const PROTOCOL_VERSION = 6;
/** Players joining with the same multiplayerId share a room; this is used when none is given. */
const DEFAULT_MULTIPLAYER_ID = 'public';
const GAME_NAME = 'Blocksy';
const ISLAND_NAME = 'Sunny Isle';
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

/** FNV-1a string hash (stable across engines). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
  // Biome blocks
  def(29, 'water', 'Water', ['water'], { layer: 2, solid: false, removable: false, targetable: false, purchasable: false, replaceable: true }),
  def(30, 'hay', 'Hay Bale', ['hay_top', 'hay_side', 'hay_top']),
  def(31, 'beehive', 'Beehive', ['hive_top', 'hive_side', 'hive_top'], { category: 'decor' }),
  def(32, 'spruce_log', 'Spruce Log', ['spruce_log_top', 'spruce_log_side', 'spruce_log_top']),
  def(33, 'spruce_leaves', 'Spruce Leaves', ['spruce_leaves'], { layer: 1 }),
  def(34, 'bamboo', 'Bamboo', ['bamboo'], plant({ replaceable: false })),
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

/** Full opaque cubes hide neighbouring faces. */
const occludes = (b: BlockDef | undefined): boolean => !!b && b.shape === 'cube' && b.layer === 0;

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

/** Decodes {@link rleEncode} output into a target array; throws if the length doesn't match. */
function rleDecodeInto(rle: readonly number[], target: Uint16Array | Uint8Array): void {
  let o = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i], n = rle[i + 1];
    if (o + n > target.length) throw new Error('RLE overflow');
    target.fill(v, o, o + n);
    o += n;
  }
  if (o !== target.length) throw new Error(`RLE length mismatch: ${o} != ${target.length}`);
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

/** Replaceable blocks (plants) are replaced in place; otherwise the block goes beside the hit face. */
function resolvePlacementCell(grid: BlockGrid, hx: number, hy: number, hz: number, nx: number, ny: number, nz: number): [number, number, number] {
  const hit = getBlock(grid.get(hx, hy, hz));
  if (hit?.replaceable && !grid.isProtected(hx, hy, hz)) return [hx, hy, hz];
  return [hx + nx, hy + ny, hz + nz];
}

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
  /** Fenced area with NPCs that play the popup mini-games. */
  gameCenter: { x: number; y: number; z: number; npcs: GameCenterNpc[] };
  /** Animal homes: centre and radius of each biome that was built. */
  biomes: { biome: Biome; x: number; y: number; z: number; r: number }[];
}

const createWorldGrid = (): BlockGrid => new BlockGrid(WORLD_SIZE.x, WORLD_SIZE.y, WORLD_SIZE.z);

/**
 * Deterministically builds "Sunny Isle" after the reference images: grass plateau with layered cliffs,
 * stone plaza with a lantern pillar and a big oak, dirt paths with stepping stones, two shop stalls
 * (Blocks, Decor) with striped awnings, fenced "Build Here" plots, trees, lantern posts, a dock and
 * floating islets. Yaw is in radians; yaw 0 faces +Z.
 */
function generateIsland(grid: BlockGrid, seed: number, opts: { biomes?: readonly Biome[] } = {}): IslandLayout {
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

const PALETTES = {
  skin: ['#f6d3b3', '#edb98a', '#e0ac7e', '#c68642', '#9e6b43', '#7a4a2a', '#5a3825', '#3d2616'],
  hair: ['#1e1e1e', '#3b2416', '#5a3a22', '#8a5a30', '#c89b5a', '#e8d29a', '#b5452f', '#8c8c8c', '#3f6fd8', '#d85aa0'],
  clothing: ['#2bb3a8', '#e8584b', '#f2c230', '#9b6bd6', '#3e78d6', '#2e3a7a', '#3a9e4f', '#f28c38', '#f2f2f2', '#2a2a2e', '#8a6a4a', '#e87db0'],
  accessory: ['#222222', '#c9a227', '#c0c0c8', '#c0392b', '#2e86de', '#f2f2f2', '#8e44ad', '#16a085'],
} as const;

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

/** Cycles through a style list. */
function cycle<T extends string>(list: readonly T[], value: T, delta: number): T {
  const i = Math.max(0, list.indexOf(value));
  return list[(((i + delta) % list.length) + list.length) % list.length];
}

/** A random look; accessories are rarer than clothing so crowds don't look noisy. */
function randomAppearance(rng: () => number): Appearance {
  const p = <T>(l: readonly T[]) => l[randInt(rng, l.length)];
  return {
    skin: p(PALETTES.skin), hair: p(HAIR_STYLES), hairColor: p(PALETTES.hair),
    shirt: p(SHIRT_STYLES), shirtColor: p(PALETTES.clothing), pants: p(PANTS_STYLES), pantsColor: p(PALETTES.clothing),
    shoes: p(SHOE_STYLES), shoeColor: p(PALETTES.clothing),
    hat: rng() < 0.3 ? p(HAT_STYLES) : 'none', hatColor: p(PALETTES.clothing),
    glasses: rng() < 0.25 ? p(GLASSES_STYLES) : 'none', glassesColor: p(PALETTES.accessory),
    watch: rng() < 0.3 ? p(WATCH_STYLES) : 'none', watchColor: p(PALETTES.accessory),
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

const PRESET_MESSAGES = ['Hi!', 'Goodbye!', "What's up?", "I'm happy", "I'm sad", 'Nice build!', 'Follow me!'] as const;
const MAX_MESSAGE_LENGTH = 60;
const MAX_NAME_LENGTH = 16;

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

/** Player display names: sanitised, never empty. */
function sanitizeName(raw: unknown): string {
  const n = sanitizeMessage(raw, MAX_NAME_LENGTH);
  return n.length > 0 ? n : 'Player';
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

const owns = (profile: ProfileData, id: number): boolean => profile.owned.includes(id);

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

const listings = (category: ShopCategory): BlockDef[] => BLOCKS.filter((b) => b.purchasable && b.category === category);

// ---------- shared/animals.ts ----------
/**
 * Island animals: kinds, home biomes, realistic colour variants, sounds and the server setting parser.
 */

const ANIMAL_KINDS = [
  'cow', 'sheep', 'pig', 'chicken', 'rooster', 'chick', 'panda', 'fox', 'duck', 'bee', 'dog', 'cat', 'llama', 'rabbit',
] as const;
type AnimalKind = typeof ANIMAL_KINDS[number];
const isAnimalKind = (v: unknown): v is AnimalKind => (ANIMAL_KINDS as readonly unknown[]).includes(v);

/** Biomes of the island. The village always exists; the others are only built if one of their animals is enabled. */
const BIOMES = ['village', 'farm', 'bamboo', 'forest', 'pond', 'flowers', 'highlands'] as const;
type Biome = typeof BIOMES[number];

const ANIMAL_BIOME: Record<AnimalKind, Biome> = {
  cow: 'farm', sheep: 'farm', pig: 'farm', chicken: 'farm', rooster: 'farm', chick: 'farm',
  panda: 'bamboo', fox: 'forest', rabbit: 'forest', duck: 'pond', bee: 'flowers', llama: 'highlands',
  dog: 'village', cat: 'village',
};

/** Biomes needed for a set of animals (the village is always included). */
function biomesFor(kinds: readonly AnimalKind[]): Biome[] {
  const set = new Set<Biome>(['village']);
  for (const k of kinds) set.add(ANIMAL_BIOME[k]);
  return BIOMES.filter((b) => set.has(b));
}

/**
 * Reads the "animals" custom setting:
 *  true / missing → all animals;  false → none;  ["cow", "duck", …] → only those (unknown names ignored).
 */
function parseAnimalSetting(v: unknown): AnimalKind[] {
  if (v === false) return [];
  if (Array.isArray(v)) return ANIMAL_KINDS.filter((k) => v.includes(k));
  return [...ANIMAL_KINDS];
}

const ANIMAL_SOUND: Record<AnimalKind, string> = {
  cow: 'Moo!', sheep: 'Baa!', pig: 'Oink!', chicken: 'Cluck!', rooster: 'Cock-a-doodle-doo!', chick: 'Peep!',
  panda: '*munch*', fox: 'Yip!', duck: 'Quack!', bee: 'Bzzz', dog: 'Woof!', cat: 'Meow!', llama: 'Hmmm', rabbit: '*twitch*',
};
const ANIMAL_ICON: Record<AnimalKind, string> = {
  cow: '🐄', sheep: '🐑', pig: '🐖', chicken: '🐔', rooster: '🐓', chick: '🐥', panda: '🐼', fox: '🦊',
  duck: '🦆', bee: '🐝', dog: '🐕', cat: '🐈', llama: '🦙', rabbit: '🐇',
};
/** How many of each kind spawn (multiplied by the animalsPerKind setting / 2). */
const ANIMAL_BASE_COUNT: Partial<Record<AnimalKind, number>> = { chick: 3, bee: 4, rooster: 1 };

/** Colour roles used by the models: main body, accent (spots/patches), and detail. */
interface AnimalColors { main: string; accent: string; detail: string }
/** Realistic colour variants per kind (weight, colours). */
const ANIMAL_VARIANTS: Record<AnimalKind, { name: string; weight: number; colors: AnimalColors }[]> = {
  cow: [
    { name: 'holstein', weight: 3, colors: { main: '#f4f1ea', accent: '#2b2b2b', detail: '#f2b5b5' } },
    { name: 'brown', weight: 2, colors: { main: '#7a4e2d', accent: '#f4f1ea', detail: '#e8b0a0' } },
    { name: 'black', weight: 1, colors: { main: '#2e2c2b', accent: '#2e2c2b', detail: '#d9a3a3' } },
  ],
  sheep: [
    { name: 'white', weight: 6, colors: { main: '#f1f0e9', accent: '#3d3a38', detail: '#f5f5f5' } },
    { name: 'grey', weight: 2, colors: { main: '#a3a3a0', accent: '#3d3a38', detail: '#f5f5f5' } },
    { name: 'brown', weight: 1, colors: { main: '#7d5a3c', accent: '#3d3a38', detail: '#f5f5f5' } },
    { name: 'black', weight: 1, colors: { main: '#353333', accent: '#262424', detail: '#f5f5f5' } },
  ],
  pig: [
    { name: 'pink', weight: 4, colors: { main: '#f2a7a7', accent: '#f2a7a7', detail: '#e48787' } },
    { name: 'spotted', weight: 2, colors: { main: '#f2b4a8', accent: '#3a2a26', detail: '#e48787' } },
    { name: 'black', weight: 1, colors: { main: '#3a3434', accent: '#f0e6e0', detail: '#6b5a5a' } },
  ],
  chicken: [
    { name: 'white', weight: 2, colors: { main: '#f6f4ee', accent: '#d9352b', detail: '#f2b632' } },
    { name: 'brown', weight: 2, colors: { main: '#a0632e', accent: '#d9352b', detail: '#f2b632' } },
  ],
  rooster: [
    { name: 'red', weight: 2, colors: { main: '#b5452f', accent: '#1f3b2a', detail: '#f2b632' } },
    { name: 'white', weight: 1, colors: { main: '#f6f4ee', accent: '#2b2b2b', detail: '#f2b632' } },
  ],
  chick: [{ name: 'yellow', weight: 1, colors: { main: '#f7d64a', accent: '#f29b32', detail: '#2b2b2b' } }],
  panda: [{ name: 'giant', weight: 1, colors: { main: '#f2f2ee', accent: '#202020', detail: '#202020' } }],
  fox: [
    { name: 'red', weight: 6, colors: { main: '#d9682b', accent: '#f6f1e8', detail: '#2b2b2b' } },
    { name: 'arctic', weight: 1, colors: { main: '#eef2f4', accent: '#ffffff', detail: '#3a3a3a' } },
  ],
  duck: [
    { name: 'mallard', weight: 3, colors: { main: '#8a7a63', accent: '#2f7d4f', detail: '#f2a332' } },
    { name: 'hen', weight: 2, colors: { main: '#8a6a48', accent: '#7a5a3a', detail: '#e0902e' } },
    { name: 'white', weight: 2, colors: { main: '#f4f4f0', accent: '#f4f4f0', detail: '#f2a332' } },
  ],
  bee: [{ name: 'honeybee', weight: 1, colors: { main: '#f2c02e', accent: '#2b2b2b', detail: '#dff3ff' } }],
  dog: [
    { name: 'golden', weight: 3, colors: { main: '#d9a441', accent: '#e8c27a', detail: '#2b2b2b' } },
    { name: 'brown', weight: 2, colors: { main: '#7a4e2d', accent: '#a0704a', detail: '#2b2b2b' } },
    { name: 'black', weight: 2, colors: { main: '#2b2b2b', accent: '#4a4040', detail: '#1a1a1a' } },
    { name: 'white', weight: 1, colors: { main: '#efefea', accent: '#d6cfc4', detail: '#2b2b2b' } },
  ],
  cat: [
    { name: 'orange', weight: 3, colors: { main: '#e0893c', accent: '#c06a26', detail: '#3fa34d' } },
    { name: 'black', weight: 2, colors: { main: '#2a2a2a', accent: '#1d1d1d', detail: '#e8c547' } },
    { name: 'grey', weight: 2, colors: { main: '#8f9296', accent: '#6f7276', detail: '#3fa34d' } },
    { name: 'white', weight: 1, colors: { main: '#f2f2ee', accent: '#e2dcd2', detail: '#5aa3e0' } },
    { name: 'calico', weight: 1, colors: { main: '#f2efe8', accent: '#d9822b', detail: '#3fa34d' } },
  ],
  llama: [
    { name: 'white', weight: 2, colors: { main: '#f1ece2', accent: '#d8cbb3', detail: '#2b2b2b' } },
    { name: 'beige', weight: 2, colors: { main: '#d8c3a0', accent: '#b8a07a', detail: '#2b2b2b' } },
    { name: 'brown', weight: 2, colors: { main: '#8a6142', accent: '#6e4a30', detail: '#2b2b2b' } },
  ],
  rabbit: [
    { name: 'white', weight: 2, colors: { main: '#f4f2ec', accent: '#f2b5c0', detail: '#d94a5a' } },
    { name: 'brown', weight: 3, colors: { main: '#8a6142', accent: '#d9c2a8', detail: '#2b2b2b' } },
    { name: 'grey', weight: 2, colors: { main: '#8f8f8f', accent: '#d6d6d6', detail: '#2b2b2b' } },
  ],
};

function pickVariant(kind: AnimalKind, rng: () => number): string {
  const list = ANIMAL_VARIANTS[kind];
  let r = rng() * list.reduce((n, v) => n + v.weight, 0);
  for (const v of list) { r -= v.weight; if (r <= 0) return v.name; }
  return list[0].name;
}
const variantColors = (kind: AnimalKind, variant: string): AnimalColors =>
  (ANIMAL_VARIANTS[kind].find((v) => v.name === variant) ?? ANIMAL_VARIANTS[kind][0]).colors;

/** Animals that fly (bees) or swim (ducks) move differently. */
const FLYING: readonly AnimalKind[] = ['bee'];
const SWIMMING: readonly AnimalKind[] = ['duck'];
/** Distance (m) within which a player can pet an animal. */
const PET_RADIUS = 2.6;

// ---------- shared/daynight.ts ----------
/**
 * Day / night cycle. The server owns the clock (hour 0–24 + day number); the client turns the hour into
 * sun / moon direction, sky, fog and light colours with skyAt().
 */

interface WorldClock { hour: number; day: number }

/** Clock after `elapsedMs` of play. dayLengthMs = length of a full 24-hour day; 0 = time stands still. */
function clockAt(startHour: number, dayLengthMs: number, elapsedMs: number): WorldClock {
  if (dayLengthMs <= 0) return { hour: startHour, day: 1 };
  const total = startHour + (elapsedMs / dayLengthMs) * 24;
  return { hour: ((total % 24) + 24) % 24, day: 1 + Math.floor(total / 24) };
}

const isNight = (hour: number): boolean => hour < 5.5 || hour >= 20.5;

const formatClock = (hour: number): string => {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

interface SkyState {
  /** Direction toward the light (sun by day, moon by night), normalised. */
  lightDir: [number, number, number];
  /** Direction toward the sun (may be below the horizon). */
  sunDir: [number, number, number];
  lightColor: string;
  lightIntensity: number;
  background: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  /** 0..1 */
  stars: number;
  /** 0..1, how strongly lanterns glow. */
  lanterns: number;
  /** Cloud tint. */
  cloud: string;
}

type Key = Omit<SkyState, 'lightDir' | 'sunDir'> & { h: number };
const KEYS: Key[] = [
  { h: 0, lightColor: '#9fb4ff', lightIntensity: 0.35, background: '#0b1330', fog: '#101a38', hemiSky: '#34447a', hemiGround: '#151520', hemiIntensity: 0.45, ambient: 0.22, stars: 1, lanterns: 1, cloud: '#4a5578' },
  { h: 4.8, lightColor: '#9fb4ff', lightIntensity: 0.35, background: '#141c46', fog: '#18224a', hemiSky: '#3a4a80', hemiGround: '#18182a', hemiIntensity: 0.5, ambient: 0.24, stars: 0.9, lanterns: 1, cloud: '#56608a' },
  { h: 6, lightColor: '#ffb070', lightIntensity: 1.3, background: '#f0a27a', fog: '#f1b892', hemiSky: '#ffd7b0', hemiGround: '#6a5040', hemiIntensity: 0.85, ambient: 0.38, stars: 0.15, lanterns: 0.6, cloud: '#ffd6c2' },
  { h: 8, lightColor: '#fff1d6', lightIntensity: 2.6, background: '#86c4ff', fog: '#a9d4fb', hemiSky: '#e3f1ff', hemiGround: '#8a7558', hemiIntensity: 1.3, ambient: 0.6, stars: 0, lanterns: 0, cloud: '#fbfdff' },
  { h: 17, lightColor: '#fff1d6', lightIntensity: 2.6, background: '#86c4ff', fog: '#a9d4fb', hemiSky: '#e3f1ff', hemiGround: '#8a7558', hemiIntensity: 1.3, ambient: 0.6, stars: 0, lanterns: 0, cloud: '#fbfdff' },
  { h: 19, lightColor: '#ff9a5a', lightIntensity: 1.3, background: '#ee8a62', fog: '#f2a37e', hemiSky: '#ffc8a0', hemiGround: '#5a4232', hemiIntensity: 0.85, ambient: 0.36, stars: 0.2, lanterns: 0.7, cloud: '#ffc4a8' },
  { h: 20.5, lightColor: '#9fb4ff', lightIntensity: 0.4, background: '#2a2f62', fog: '#283058', hemiSky: '#3e4a86', hemiGround: '#1a1a28', hemiIntensity: 0.5, ambient: 0.24, stars: 0.8, lanterns: 1, cloud: '#5a5f8a' },
  { h: 24, lightColor: '#9fb4ff', lightIntensity: 0.35, background: '#0b1330', fog: '#101a38', hemiSky: '#34447a', hemiGround: '#151520', hemiIntensity: 0.45, ambient: 0.22, stars: 1, lanterns: 1, cloud: '#4a5578' },
];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mixHex = (a: string, b: string, t: number) =>
  `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const norm = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

function skyAt(hour: number): SkyState {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  // The sun rises in the east (+x) at 6:00, is highest at 12:00 and sets in the west at 18:00.
  const ang = ((h - 6) / 12) * Math.PI;
  const sunDir = norm([Math.cos(ang), Math.sin(ang), -0.35]);
  const lightDir: [number, number, number] = sunDir[1] > 0.08 ? sunDir : norm([-sunDir[0] * 0.6, Math.max(0.35, -sunDir[1]), 0.4]);
  return {
    lightDir, sunDir,
    lightColor: mixHex(a.lightColor, b.lightColor, t), lightIntensity: lerp(a.lightIntensity, b.lightIntensity),
    background: mixHex(a.background, b.background, t), fog: mixHex(a.fog, b.fog, t),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, t), hemiGround: mixHex(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity), ambient: lerp(a.ambient, b.ambient),
    stars: lerp(a.stars, b.stars), lanterns: lerp(a.lanterns, b.lanterns), cloud: mixHex(a.cloud, b.cloud, t),
  };
}

// ---------- shared/roomSettings.ts ----------
/**
 * Settings the creator of a room chooses in the lobby. They are stored with the room (match) on the
 * backend, sent by every client when joining, and applied by the game server when it creates the room
 * (over the game-wide Custom settings from the dashboard). Everything is clamped here and again on the server.
 */

interface RoomSettings {
  animals: AnimalKind[];
  animalsPerKind: number;
  ambientBots: number;
  /** Seconds before a bot comes to play an unanswered invite; 0 = never. */
  botJoinAfterSec: number;
  /** Length of a full day in minutes; 0 = time stands still. */
  dayLengthMin: number;
  startHour: number;
  /** Used only when the backend gives the match no duration. 0 = until everyone leaves. */
  sessionMinutes: number;
  chatEnabled: boolean;
  worldSeed: number;
  inviteAcceptDelaySec: number;
  rpsPickSec: number;
  rpsBestOf: number;
  tttTurnSec: number;
  chessTurnSec: number;
  ludoTurnSec: number;
}

const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  animals: [...ANIMAL_KINDS], animalsPerKind: 2, ambientBots: 4, botJoinAfterSec: 5,
  dayLengthMin: 20, startHour: 8, sessionMinutes: 0, chatEnabled: true, worldSeed: 1337,
  inviteAcceptDelaySec: 5, rpsPickSec: 3, rpsBestOf: 3, tttTurnSec: 15, chessTurnSec: 60, ludoTurnSec: 10,
};

/** [min, max] per numeric setting. */
const ROOM_SETTING_LIMITS: Record<Exclude<keyof RoomSettings, 'animals' | 'chatEnabled'>, [number, number]> = {
  animalsPerKind: [1, 6], ambientBots: [0, 8], botJoinAfterSec: [0, 120], dayLengthMin: [0, 120], startHour: [0, 23],
  sessionMinutes: [0, 240], worldSeed: [1, 2_147_483_647], inviteAcceptDelaySec: [0, 60], rpsPickSec: [2, 15],
  rpsBestOf: [1, 9], tttTurnSec: [5, 120], chessTurnSec: [10, 600], ludoTurnSec: [3, 60],
};

/** Keeps only known keys with valid values (unknown or invalid values are dropped, not defaulted). */
function sanitizeRoomSettings(raw: unknown): Partial<RoomSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<RoomSettings> = {};
  if (Array.isArray(o.animals)) out.animals = ANIMAL_KINDS.filter((k) => (o.animals as unknown[]).includes(k));
  if (typeof o.chatEnabled === 'boolean') out.chatEnabled = o.chatEnabled;
  for (const [key, [min, max]] of Object.entries(ROOM_SETTING_LIMITS) as [keyof typeof ROOM_SETTING_LIMITS, [number, number]][]) {
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, number>)[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  return out;
}

// ---------- shared/minigames.ts ----------
/**
 * Popup mini-games: rules engines (pure, deterministic given the inputs) shared by client and server.
 * - Rock Paper Scissors (2 players, best of N, simultaneous picks)
 * - Tic Tac Toe (2 players)
 * - Chess (2 players, full rules: castling, en passant, promotion, check/checkmate/stalemate, 50-move rule)
 * - Ludo (2–4 players, classic rules: 6 to leave base, 6 rolls again, capture, safe squares, exact finish)
 */

type MiniGameKind = 'rps' | 'ttt' | 'chess' | 'ludo';

interface MiniGameInfo { kind: MiniGameKind; name: string; icon: string; minPlayers: number; maxPlayers: number; board: boolean }
const MINI_GAMES: readonly MiniGameInfo[] = [
  { kind: 'rps', name: 'Rock Paper Scissors', icon: '✊', minPlayers: 2, maxPlayers: 2, board: false },
  { kind: 'ttt', name: 'Tic Tac Toe', icon: '❌', minPlayers: 2, maxPlayers: 2, board: true },
  { kind: 'chess', name: 'Chess', icon: '♟️', minPlayers: 2, maxPlayers: 2, board: true },
  { kind: 'ludo', name: 'Ludo', icon: '🎲', minPlayers: 2, maxPlayers: 4, board: true },
];
const isMiniGameKind = (v: unknown): v is MiniGameKind => MINI_GAMES.some((g) => g.kind === v);
const miniGameInfo = (k: MiniGameKind): MiniGameInfo => MINI_GAMES.find((g) => g.kind === k)!;

/** Distance (m) within which a player can accept an invite / start watching a game. */
const ACCEPT_RADIUS = 3.5;
const SPECTATE_RADIUS = 7;

// =====================================================================================================
// Rock Paper Scissors
// =====================================================================================================

type RpsChoice = 'rock' | 'paper' | 'scissors';
const RPS_CHOICES: readonly RpsChoice[] = ['rock', 'paper', 'scissors'];
const RPS_ICON: Record<RpsChoice, string> = { rock: '🪨', paper: '✋', scissors: '✂️' };
const isRpsChoice = (v: unknown): v is RpsChoice => (RPS_CHOICES as readonly unknown[]).includes(v);

/** 0 = seat 0 wins, 1 = seat 1 wins, -1 = tie. */
function rpsWinner(a: RpsChoice, b: RpsChoice): number {
  if (a === b) return -1;
  return (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper') ? 0 : 1;
}

// =====================================================================================================
// Tic Tac Toe — cells: -1 empty, 0 = X (seat 0), 1 = O (seat 1)
// =====================================================================================================

interface TttState { cells: number[]; turn: number }
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const;
const tttNew = (): TttState => ({ cells: new Array(9).fill(-1), turn: 0 });
const tttLegal = (s: TttState): number[] => s.cells.flatMap((c, i) => (c === -1 ? [i] : []));

function tttPlay(s: TttState, seat: number, cell: number): TttState | null {
  if (seat !== s.turn || !Number.isInteger(cell) || cell < 0 || cell > 8 || s.cells[cell] !== -1 || tttResult(s).over) return null;
  const cells = s.cells.slice();
  cells[cell] = seat;
  return { cells, turn: 1 - seat };
}

/** winner: seat index, or -1 for a draw (when over). */
function tttResult(s: TttState): { over: boolean; winner: number; line: readonly number[] | null } {
  for (const l of TTT_LINES) {
    const v = s.cells[l[0]];
    if (v !== -1 && v === s.cells[l[1]] && v === s.cells[l[2]]) return { over: true, winner: v, line: l };
  }
  return { over: s.cells.every((c) => c !== -1), winner: -1, line: null };
}

// =====================================================================================================
// Chess — board[0] = a8 … board[63] = h1 (FEN order). White = uppercase, black = lowercase, '' empty.
// =====================================================================================================

type ChessColor = 'w' | 'b';
type Promo = 'q' | 'r' | 'b' | 'n';
interface ChessMove { from: number; to: number; promo?: Promo }
interface ChessState { board: string[]; turn: ChessColor; castling: string; ep: number; half: number; full: number }

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
function chessNew(): ChessState {
  const board: string[] = [];
  for (const ch of START_FEN.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push('');
    else board.push(ch);
  }
  return { board, turn: 'w', castling: 'KQkq', ep: -1, half: 0, full: 1 };
}

const chessColorOf = (p: string): ChessColor | null => (p === '' ? null : p === p.toUpperCase() ? 'w' : 'b');
const rf = (i: number) => [i >> 3, i & 7] as const;
const at = (r: number, f: number) => (r < 0 || r > 7 || f < 0 || f > 7 ? -1 : r * 8 + f);
const squareName = (i: number): string => `${'abcdefgh'[i & 7]}${8 - (i >> 3)}`;

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Is square `sq` attacked by any piece of colour `by`? */
function chessAttacked(board: string[], sq: number, by: ChessColor): boolean {
  const [r, f] = rf(sq);
  const own = (p: string, type: string) => p !== '' && chessColorOf(p) === by && p.toLowerCase() === type;
  // pawns: a white pawn attacks diagonally upward (row - 1)
  const pr = by === 'w' ? r + 1 : r - 1;
  for (const df of [-1, 1]) { const i = at(pr, f + df); if (i >= 0 && own(board[i], 'p')) return true; }
  for (const [dr, df] of KNIGHT) { const i = at(r + dr, f + df); if (i >= 0 && own(board[i], 'n')) return true; }
  for (const [dr, df] of KING) { const i = at(r + dr, f + df); if (i >= 0 && own(board[i], 'k')) return true; }
  const slide = (dirs: number[][], types: string) => {
    for (const [dr, df] of dirs) {
      for (let k = 1; k < 8; k++) {
        const i = at(r + dr * k, f + df * k);
        if (i < 0) break;
        const p = board[i];
        if (p === '') continue;
        if (chessColorOf(p) === by && types.includes(p.toLowerCase())) return true;
        break;
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
}

const chessKing = (board: string[], c: ChessColor): number => board.indexOf(c === 'w' ? 'K' : 'k');
const chessInCheck = (s: ChessState): boolean => chessAttacked(s.board, chessKing(s.board, s.turn), s.turn === 'w' ? 'b' : 'w');

function pseudoMoves(s: ChessState): ChessMove[] {
  const out: ChessMove[] = [];
  const me = s.turn, them: ChessColor = me === 'w' ? 'b' : 'w';
  const b = s.board;
  const empty = (i: number) => i >= 0 && b[i] === '';
  const enemy = (i: number) => i >= 0 && chessColorOf(b[i]) === them;
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (p === '' || chessColorOf(p) !== me) continue;
    const [r, f] = rf(from);
    const t = p.toLowerCase();
    const push = (to: number) => {
      if ((t === 'p') && ((me === 'w' && to >> 3 === 0) || (me === 'b' && to >> 3 === 7))) {
        for (const promo of ['q', 'r', 'b', 'n'] as Promo[]) out.push({ from, to, promo });
      } else out.push({ from, to });
    };
    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1, startRow = me === 'w' ? 6 : 1;
      const one = at(r + dir, f);
      if (empty(one)) {
        push(one);
        const two = at(r + 2 * dir, f);
        if (r === startRow && empty(two)) out.push({ from, to: two });
      }
      for (const df of [-1, 1]) {
        const c = at(r + dir, f + df);
        if (c >= 0 && (enemy(c) || c === s.ep)) push(c);
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KNIGHT : KING) {
        const i = at(r + dr, f + df);
        if (i >= 0 && (b[i] === '' || enemy(i))) out.push({ from, to: i });
      }
      if (t === 'k') {
        const row = me === 'w' ? 7 : 0;
        if (from === row * 8 + 4 && !chessAttacked(b, from, them)) {
          const K = me === 'w' ? 'K' : 'k', Q = me === 'w' ? 'Q' : 'q';
          if (s.castling.includes(K) && b[row * 8 + 5] === '' && b[row * 8 + 6] === '' && b[row * 8 + 7].toLowerCase() === 'r'
            && !chessAttacked(b, row * 8 + 5, them) && !chessAttacked(b, row * 8 + 6, them)) out.push({ from, to: row * 8 + 6 });
          if (s.castling.includes(Q) && b[row * 8 + 3] === '' && b[row * 8 + 2] === '' && b[row * 8 + 1] === '' && b[row * 8].toLowerCase() === 'r'
            && !chessAttacked(b, row * 8 + 3, them) && !chessAttacked(b, row * 8 + 2, them)) out.push({ from, to: row * 8 + 2 });
        }
      }
    } else {
      const dirs = t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, df] of dirs) {
        for (let k = 1; k < 8; k++) {
          const i = at(r + dr * k, f + df * k);
          if (i < 0) break;
          if (b[i] === '') { out.push({ from, to: i }); continue; }
          if (enemy(i)) out.push({ from, to: i });
          break;
        }
      }
    }
  }
  return out;
}

/** Applies a move WITHOUT legality checks (use chessPlay for validated moves). */
function chessApply(s: ChessState, m: ChessMove): ChessState {
  const b = s.board.slice();
  const p = b[m.from];
  const t = p.toLowerCase();
  const me = s.turn;
  let capture = b[m.to] !== '';
  // en passant capture
  if (t === 'p' && m.to === s.ep && b[m.to] === '') {
    b[m.to + (me === 'w' ? 8 : -8)] = '';
    capture = true;
  }
  b[m.to] = p;
  b[m.from] = '';
  if (t === 'p' && (m.to >> 3 === 0 || m.to >> 3 === 7)) {
    const promo = m.promo ?? 'q';
    b[m.to] = me === 'w' ? promo.toUpperCase() : promo;
  }
  // castling: move the rook too
  if (t === 'k' && Math.abs(m.to - m.from) === 2) {
    const row = m.from >> 3;
    if (m.to > m.from) { b[row * 8 + 5] = b[row * 8 + 7]; b[row * 8 + 7] = ''; }
    else { b[row * 8 + 3] = b[row * 8]; b[row * 8] = ''; }
  }
  let castling = s.castling;
  const drop = (c: string) => { castling = castling.replace(c, ''); };
  if (p === 'K') { drop('K'); drop('Q'); }
  if (p === 'k') { drop('k'); drop('q'); }
  for (const sq of [m.from, m.to]) {
    if (sq === 63) drop('K');
    if (sq === 56) drop('Q');
    if (sq === 7) drop('k');
    if (sq === 0) drop('q');
  }
  const ep = t === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {
    board: b,
    turn: me === 'w' ? 'b' : 'w',
    castling,
    ep,
    half: t === 'p' || capture ? 0 : s.half + 1,
    full: me === 'b' ? s.full + 1 : s.full,
  };
}

/** All legal moves for the side to move. */
function chessLegal(s: ChessState): ChessMove[] {
  return pseudoMoves(s).filter((m) => {
    const n = chessApply(s, m);
    return !chessAttacked(n.board, chessKing(n.board, s.turn), n.turn);
  });
}

/** Validated move; promotion defaults to queen. Returns null if illegal. */
function chessPlay(s: ChessState, color: ChessColor, m: ChessMove): ChessState | null {
  if (color !== s.turn || !m || !Number.isInteger(m.from) || !Number.isInteger(m.to)) return null;
  const legal = chessLegal(s).find((x) => x.from === m.from && x.to === m.to && (x.promo ?? 'q') === (m.promo ?? 'q'));
  return legal ? chessApply(s, legal) : null;
}

type ChessStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw50' | 'insufficient';
function chessStatus(s: ChessState): ChessStatus {
  if (chessLegal(s).length === 0) return chessInCheck(s) ? 'checkmate' : 'stalemate';
  if (s.half >= 100) return 'draw50';
  const rest = s.board.filter((p) => p !== '' && p.toLowerCase() !== 'k').map((p) => p.toLowerCase());
  if (rest.length === 0 || (rest.length === 1 && (rest[0] === 'b' || rest[0] === 'n'))) return 'insufficient';
  return 'playing';
}

// =====================================================================================================
// Ludo — 15×15 board. Colours: 0 red (top-left), 1 green (top-right), 2 yellow (bottom-right), 3 blue (bottom-left).
// Token position: -1 = base, 0..50 = main track (relative to the colour's start), 51..55 = home column, 56 = finished.
// =====================================================================================================

const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'] as const;
const LUDO_FINISH = 56;
const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47] as const;

/** The 52 main-track squares as [x, y] (y down), starting at red's start square. */
const LUDO_TRACK: readonly [number, number][] = (() => {
  const t: [number, number][] = [];
  const seg = (xs: number[], ys: number[]) => { for (let i = 0; i < xs.length; i++) t.push([xs[i], ys[i]]); };
  const range = (a: number, b: number) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Array.from({ length: a - b + 1 }, (_, i) => a - i));
  const rep = (v: number, n: number) => new Array(n).fill(v);
  seg(range(1, 5), rep(6, 5)); seg(rep(6, 6), range(5, 0)); seg([7, 8], [0, 0]);
  seg(rep(8, 5), range(1, 5)); seg(range(9, 14), rep(6, 6)); seg([14, 14], [7, 8]);
  seg(range(13, 9), rep(8, 5)); seg(rep(8, 6), range(9, 14)); seg([7, 6], [14, 14]);
  seg(rep(6, 5), range(13, 9)); seg(range(5, 0), rep(8, 6)); seg([0, 0], [7, 6]);
  return t;
})();
const HOME_COLUMN: readonly [number, number][][] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
];
const BASE_SPOTS: readonly [number, number][][] = [
  [[1.75, 1.75], [3.25, 1.75], [1.75, 3.25], [3.25, 3.25]],
  [[10.75, 1.75], [12.25, 1.75], [10.75, 3.25], [12.25, 3.25]],
  [[10.75, 10.75], [12.25, 10.75], [10.75, 12.25], [12.25, 12.25]],
  [[1.75, 10.75], [3.25, 10.75], [1.75, 12.25], [3.25, 12.25]],
];
const FINISH_SPOT: readonly [number, number][] = [[6.6, 7], [7, 6.6], [7.4, 7], [7, 7.4]];

/** Board cell (x, y in 0..15, cell units, centre of the cell) of a token. */
function ludoCell(color: number, token: number, pos: number): [number, number] {
  if (pos < 0) return [BASE_SPOTS[color][token][0] + 0.5, BASE_SPOTS[color][token][1] + 0.5];
  if (pos >= LUDO_FINISH) return [FINISH_SPOT[color][0] + 0.5, FINISH_SPOT[color][1] + 0.5];
  if (pos > 50) { const c = HOME_COLUMN[color][pos - 51]; return [c[0] + 0.5, c[1] + 0.5]; }
  const c = LUDO_TRACK[(color * 13 + pos) % 52];
  return [c[0] + 0.5, c[1] + 0.5];
}
const ludoHomeColumn = (color: number): readonly [number, number][] => HOME_COLUMN[color];

/** Seats → colours: 2 players sit opposite (red/yellow), 3–4 go round. */
const ludoColorsFor = (n: number): number[] => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);

interface LudoState {
  colors: number[];
  tokens: number[][];
  /** Seats that left the game (skipped, tokens removed). */
  out: boolean[];
  turn: number;
  dice: number;
  phase: 'roll' | 'move';
  winner: number;
}

function ludoNew(players: number): LudoState {
  const n = Math.max(2, Math.min(4, players));
  return { colors: ludoColorsFor(n), tokens: Array.from({ length: n }, () => [-1, -1, -1, -1]), out: new Array(n).fill(false), turn: 0, dice: 0, phase: 'roll', winner: -1 };
}

function ludoMovable(s: LudoState): number[] {
  if (s.phase !== 'move' || s.winner >= 0) return [];
  return s.tokens[s.turn].flatMap((p, t) => ((p < 0 ? s.dice === 6 : p + s.dice <= LUDO_FINISH && p < LUDO_FINISH) ? [t] : []));
}

function nextSeat(s: LudoState, from: number): number {
  for (let k = 1; k <= s.tokens.length; k++) {
    const i = (from + k) % s.tokens.length;
    if (!s.out[i]) return i;
  }
  return from;
}

/** Roll (value 1..6 supplied by the server). If no token can move, the turn passes. */
function ludoRoll(s: LudoState, seat: number, value: number): LudoState | null {
  if (s.winner >= 0 || s.phase !== 'roll' || seat !== s.turn || !Number.isInteger(value) || value < 1 || value > 6) return null;
  const n: LudoState = { ...s, dice: value, phase: 'move', tokens: s.tokens.map((t) => t.slice()) };
  if (ludoMovable(n).length === 0) return { ...n, phase: 'roll', turn: nextSeat(n, seat) };
  return n;
}

function ludoMove(s: LudoState, seat: number, token: number): LudoState | null {
  if (seat !== s.turn || !ludoMovable(s).includes(token)) return null;
  const tokens = s.tokens.map((t) => t.slice());
  const from = tokens[seat][token];
  const to = from < 0 ? 0 : from + s.dice;
  tokens[seat][token] = to;
  if (to <= 50) {
    const abs = (s.colors[seat] * 13 + to) % 52;
    if (!(LUDO_SAFE as readonly number[]).includes(abs)) {
      tokens.forEach((list, other) => {
        if (other === seat || s.out[other]) return;
        list.forEach((p, i) => { if (p >= 0 && p <= 50 && (s.colors[other] * 13 + p) % 52 === abs) list[i] = -1; });
      });
    }
  }
  const won = tokens[seat].every((p) => p === LUDO_FINISH);
  return {
    ...s, tokens, dice: 0, phase: 'roll',
    winner: won ? seat : -1,
    turn: won ? seat : s.dice === 6 ? seat : nextSeat(s, seat),
  };
}

/** A seat leaves: its tokens disappear and it is skipped. Returns the state; check `active` count yourself. */
function ludoLeave(s: LudoState, seat: number): LudoState {
  const out = s.out.slice();
  out[seat] = true;
  const tokens = s.tokens.map((t, i) => (i === seat ? [-1, -1, -1, -1] : t.slice()));
  const n: LudoState = { ...s, out, tokens };
  return s.turn === seat ? { ...n, turn: nextSeat(n, seat), phase: 'roll', dice: 0 } : n;
}
const ludoActive = (s: LudoState): number[] => s.out.flatMap((o, i) => (o ? [] : [i]));

// =====================================================================================================
// Network protocol for mini-games
// =====================================================================================================

type LudoAction = { type: 'roll' } | { type: 'move'; token: number };
type MiniGameMove = RpsChoice | number | ChessMove | LudoAction;

interface MgPlayer { id: string; name: string; seat: number }
interface MgResult { winners: string[]; reason: string }

/** What a participant or spectator sees. Hidden information (the opponent's RPS pick) is never included. */
interface MgView {
  id: string;
  kind: MiniGameKind;
  role: 'player' | 'spectator';
  you: number;
  players: MgPlayer[];
  spectators: number;
  turnSeat: number;
  deadlineMs: number;
  phase: 'playing' | 'reveal' | 'over';
  result: MgResult | null;
  seatYaw?: number;
  rps?: { round: number; target: number; scores: number[]; myPick: RpsChoice | null; picked: boolean[]; reveal: (RpsChoice | null)[] | null; roundWinner: number };
  ttt?: { cells: number[]; line: number[] | null };
  chess?: { board: string[]; turn: ChessColor; check: boolean; last: ChessMove | null; legal: ChessMove[]; status: ChessStatus };
  ludo?: { colors: number[]; tokens: number[][]; out: boolean[]; dice: number; phase: 'roll' | 'move'; movable: number[]; lastRoll: number };
}

/** Ludo lobby (host + up to 3 guests) shown to its members until the host starts. */
interface MgLobby { hostId: string; kind: MiniGameKind; members: { id: string; name: string }[] }

/** Public listing of a running game (in every `state`), for tables, poses and spectating. */
interface MgListing {
  id: string;
  kind: MiniGameKind;
  x: number; y: number; z: number;
  seats: { id: string; x: number; z: number; yaw: number; name?: string }[];
  spectators: number;
  /** RPS picks, only after a round is revealed. */
  reveal?: Record<string, RpsChoice>;
  phase: 'playing' | 'reveal' | 'over';
}

// =====================================================================================================
// Bots (AI players) — ids start with "bot:" (added by a host) or "npc:" (Game Center characters).
// The AIs are cheap (one-ply heuristics) so they never block the shared server process, and slightly
// random so they can be beaten.
// =====================================================================================================

const isBotId = (id: string): boolean => id.startsWith('bot:') || id.startsWith('npc:');
const BOT_NAMES = ['Ada', 'Rex', 'Nova', 'Pip', 'Zed', 'Mila', 'Taro', 'Juno'] as const;

function rpsBotPick(rng: () => number = Math.random): RpsChoice {
  return RPS_CHOICES[Math.floor(rng() * 3)];
}

/** Wins if it can, blocks if it must, prefers centre then corners; 15% of the time it just plays anywhere. */
function tttBotMove(s: TttState, seat: number, rng: () => number = Math.random): number {
  const legal = tttLegal(s);
  const pick = <T>(l: T[]) => l[Math.floor(rng() * l.length)];
  if (rng() < 0.15) return pick(legal);
  const winning = (who: number) => legal.find((c) => {
    const cells = s.cells.slice();
    cells[c] = who;
    return tttResult({ cells, turn: 0 }).winner === who;
  });
  const w = winning(seat);
  if (w !== undefined) return w;
  const b = winning(1 - seat);
  if (b !== undefined) return b;
  if (legal.includes(4)) return 4;
  const corners = legal.filter((c) => c === 0 || c === 2 || c === 6 || c === 8);
  return corners.length ? pick(corners) : pick(legal);
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Greedy chess: material gain, promotion, checks and development, minus pieces left hanging. */
function chessBotMove(s: ChessState, rng: () => number = Math.random): ChessMove | null {
  const moves = chessLegal(s);
  if (moves.length === 0) return null;
  const me = s.turn, them: ChessColor = me === 'w' ? 'b' : 'w';
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const target = s.board[m.to];
    const mover = s.board[m.from].toLowerCase();
    let score = target ? PIECE_VALUE[target.toLowerCase()] * 10 : 0;
    if (mover === 'p' && m.to === s.ep) score += 10;
    if (m.promo) score += m.promo === 'q' ? 80 : -20;
    const n = chessApply(s, m);
    const val = PIECE_VALUE[(n.board[m.to] || 'p').toLowerCase()] * 10;
    if (chessAttacked(n.board, m.to, them)) score -= chessAttacked(n.board, m.to, me) ? val * 0.5 : val;
    if (chessAttacked(n.board, chessKing(n.board, them), me)) score += 4;
    const [r, f] = [m.to >> 3, m.to & 7];
    if (r >= 2 && r <= 5 && f >= 2 && f <= 5) score += 1;
    if (mover === 'k' && Math.abs(m.to - m.from) !== 2) score -= 2; // don't wander with the king
    score += rng() * 3;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return { from: best.from, to: best.to, promo: best.promo };
}

/** Ludo: always rolls; when moving prefers finishing, capturing, leaving base, entering the home column. */
function ludoBotAction(s: LudoState, rng: () => number = Math.random): LudoAction {
  if (s.phase === 'roll') return { type: 'roll' };
  const movable = ludoMovable(s);
  let best = movable[0], bestScore = -Infinity;
  for (const t of movable) {
    const from = s.tokens[s.turn][t];
    const to = from < 0 ? 0 : from + s.dice;
    let score = to * 0.5 + rng();
    if (to === LUDO_FINISH) score += 100;
    if (from < 0) score += 40;
    if (to > 50 && from <= 50) score += 30;
    if (to <= 50) {
      const abs = (s.colors[s.turn] * 13 + to) % 52;
      if ((LUDO_SAFE as readonly number[]).includes(abs)) score += 10;
      else if (s.tokens.some((list, other) => other !== s.turn && !s.out[other] && list.some((p) => p >= 0 && p <= 50 && (s.colors[other] * 13 + p) % 52 === abs))) score += 60;
    }
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return { type: 'move', token: best };
}

/** A Game Center character that plays one mini-game. */
interface GameCenterNpc { id: string; name: string; kind: MiniGameKind; x: number; y: number; z: number; yaw: number }

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
  /** Settings chosen by the room's creator (stored with the match); applied when the room is created. */
  roomSettings?: Record<string, unknown>;
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
  mgInvite: { kind: MiniGameKind };
  mgCancel: Record<string, never>;
  mgAccept: { hostId: string };
  mgStart: Record<string, never>;
  mgMove: { move: MiniGameMove };
  mgLeave: Record<string, never>;
  mgSpectate: { gameId: string };
  rename: { name: string };
  /** Play with a Game Center character. */
  mgNpc: { npcId: string };
  /** Pet / interact with an animal. */
  pet: { animalId: string };
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
  inviteAcceptDelaySec: number;
  ambientBots: number;
  /** Animals on this server (Custom settings "animals": true | false | ["cow", …]). Biomes follow from it. */
  animals: AnimalKind[];
  animalsPerKind: number;
  dayLengthMin: number;
  startHour: number;
  botJoinAfterSec: number;
  rpsPickSec: number;
  rpsBestOf: number;
  tttTurnSec: number;
  chessTurnSec: number;
  ludoTurnSec: number;
  sessionMinutes: number;
  editsPerSecond: number;
  chatEnabled: boolean;
}

/** Dashboard Custom settings, with the room creator's choices (from the match) on top. */
function readSettings(roomName: string, roomOverrides?: unknown): BlocksySettings {
  const raw = { ...((getGameSettings<BlocksySettings>(roomName) ?? {}) as object), ...sanitizeRoomSettings(roomOverrides) } as Partial<Record<keyof BlocksySettings, unknown>>;
  const int = (v: unknown, def: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def;
  return {
    worldSeed: int(raw.worldSeed, 1337, 1, 2_147_483_647),
    inviteAcceptDelaySec: int(raw.inviteAcceptDelaySec, 5, 0, 60),
    ambientBots: int(raw.ambientBots, 4, 0, 8),
    animals: parseAnimalSetting(raw.animals),
    animalsPerKind: int((raw as Record<string, unknown>).animalsPerKind, 2, 1, 6),
    botJoinAfterSec: int(raw.botJoinAfterSec, 5, 0, 120),
    dayLengthMin: int(raw.dayLengthMin, 20, 0, 120),
    startHour: int(raw.startHour, 8, 0, 23),
    rpsPickSec: int(raw.rpsPickSec, 3, 2, 15),
    rpsBestOf: int(raw.rpsBestOf, 3, 1, 9),
    tttTurnSec: int(raw.tttTurnSec, 15, 5, 120),
    chessTurnSec: int(raw.chessTurnSec, 60, 10, 600),
    ludoTurnSec: int(raw.ludoTurnSec, 10, 3, 60),
    sessionMinutes: int(raw.sessionMinutes, 0, 0, 240), // fallback only; Round duration (backend) wins
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
  rename: 1, pet: 3, mgNpc: 2, mgInvite: 2, mgCancel: 2, mgAccept: 2, mgStart: 2, mgMove: 6, mgLeave: 2, mgSpectate: 2,
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


// =====================================================================================================
// MINI-GAMES — invites, sessions, turns, timeouts (random play), spectators. Server-authoritative.
// =====================================================================================================

interface MgInvite { hostId: string; kind: MiniGameKind; since: number; guests: string[]; expiry: Delayed | null }
interface MgSession {
  id: string;
  kind: MiniGameKind;
  seats: string[];
  names: string[];
  spectators: Set<string>;
  table: { x: number; y: number; z: number };
  seatPos: { id: string; x: number; z: number; yaw: number }[];
  phase: 'playing' | 'reveal' | 'over';
  result: MgResult | null;
  timer: Delayed | null;
  deadline: number;
  rps?: { round: number; target: number; scores: number[]; picks: (RpsChoice | null)[]; reveal: (RpsChoice | null)[] | null; roundWinner: number };
  ttt?: TttState;
  chess?: { state: ChessState; last: ChessMove | null };
  ludo?: { state: LudoState; lastRoll: number };
  /** Bumped on every update; a pending bot move only runs if nothing changed meanwhile. */
  ver: number;
  botTimers: Delayed[];
}
interface Spot { x: number; y: number; z: number; yaw: number }
interface HubDeps {
  clock: { setTimeout(fn: () => void, ms: number): Delayed };
  players: Map<string, Player>;
  settings: () => BlocksySettings;
  send: (sessionId: string, type: string, msg: unknown) => void;
  npcs: () => GameCenterNpc[];
}

const INVITE_TTL_MS = 3 * 60_000;
const RPS_REVEAL_MS = 2500;
const RESULT_HOLD_MS = 2500;
const SEAT_RADIUS = 0.95;
const pickRandom = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

class MiniGameHub {
  private readonly invites = new Map<string, MgInvite>();
  private readonly sessions = new Map<string, MgSession>();
  private readonly seatOf = new Map<string, string>();
  private readonly watching = new Map<string, string>();
  private readonly lobbyOf = new Map<string, string>();
  private counter = 0;
  private botCounter = 0;
  /** Names and (virtual) positions of bots and Game Center NPCs. */
  private readonly botNames = new Map<string, string>();
  private readonly botSpots = new Map<string, Spot>();

  constructor(private readonly d: HubDeps) {}

  /** In a game, watching one, or waiting in a Ludo lobby: no walking, building or trading. */
  locked(id: string): boolean { return this.seatOf.has(id) || this.watching.has(id) || this.lobbyOf.has(id); }
  private nameOf(id: string): string { return this.d.players.get(id)?.username ?? this.botNames.get(id) ?? 'Player'; }

  /** Open invites, oldest first (for wandering bots looking for someone to play with). */
  openInvites(): { hostId: string; kind: MiniGameKind; ageMs: number }[] {
    const now = Date.now();
    return [...this.invites.values()].map((i) => ({ hostId: i.hostId, kind: i.kind, ageMs: now - i.since })).sort((a, b) => b.ageMs - a.ageMs);
  }

  /** Is this id seated in a game or waiting in a Ludo lobby? */
  busy(id: string): boolean { return this.seatOf.has(id) || this.lobbyOf.has(id); }

  /** Seat of a seated bot (so the wandering-bot body sits where the game put it). */
  seatSpot(id: string): { x: number; z: number; yaw: number; y: number } | null {
    const sid = this.seatOf.get(id);
    const s = sid ? this.sessions.get(sid) : undefined;
    const seat = s?.seatPos.find((x) => x.id === id);
    return s && seat ? { ...seat, y: s.table.y } : null;
  }

  /** A wandering bot accepts an invite it walked up to (no waiting delay: it already waited). */
  botAccept(botId: string, hostId: string, name: string, spot: Spot): boolean {
    const inv = this.invites.get(hostId);
    if (!inv || this.busy(botId) || this.locked(hostId) && inv.kind !== 'ludo') return false;
    this.botNames.set(botId, name);
    this.botSpots.set(botId, spot);
    if (inv.kind !== 'ludo') {
      this.invites.delete(hostId);
      inv.expiry?.clear();
      this.start(inv.kind, [hostId, botId]);
      return true;
    }
    if (inv.guests.length >= 3 || inv.guests.includes(botId)) return false;
    inv.guests.push(botId);
    this.lobbyOf.set(botId, hostId);
    this.sendLobby(inv);
    return true;
  }

  /** Play with a Game Center character (one game at a time per character). */
  playNpc(id: string, npcId: string): string | null {
    const npc = this.d.npcs().find((n) => n.id === npcId);
    const p = this.d.players.get(id);
    if (!npc || !p) return 'Nobody to play with here.';
    if (this.locked(id)) return 'You are already in a game.';
    if (this.seatOf.has(npc.id)) return `${npc.name} is busy — you can watch or wait.`;
    if (Math.hypot(p.x - npc.x, p.z - npc.z) > ACCEPT_RADIUS + 0.5) return 'Walk closer.';
    this.cancel(id);
    this.botNames.set(npc.id, `🤖 ${npc.name}`);
    this.botSpots.set(npc.id, { x: npc.x, y: npc.y, z: npc.z, yaw: npc.yaw });
    this.start(npc.kind, [id, npc.id]);
    return null;
  }

  /** Seated player (emotes disabled). */
  playing(id: string): boolean { return this.seatOf.has(id); }

  /** Per-player public tags for the state message. */
  tags(id: string): { inv: MiniGameKind | ''; invAgeMs: number; mg: string } {
    const inv = this.invites.get(id);
    return { inv: inv ? inv.kind : '', invAgeMs: inv ? Date.now() - inv.since : 0, mg: this.seatOf.get(id) ?? this.watching.get(id) ?? '' };
  }

  listing(): MgListing[] {
    return [...this.sessions.values()].map((s) => {
      const seats = s.seatPos.map((x) => (isBotId(x.id) ? { ...x, name: this.nameOf(x.id) } : x));
      const l: MgListing = { id: s.id, kind: s.kind, ...s.table, seats, spectators: s.spectators.size, phase: s.phase };
      if (s.rps?.reveal) l.reveal = Object.fromEntries(s.seats.map((id, i) => [id, s.rps!.reveal![i]!]).filter(([, v]) => !!v));
      return l;
    });
  }

  // ---------------- invites & lobby ----------------

  invite(id: string, kind: MiniGameKind): void {
    if (this.locked(id) || !this.d.players.get(id)) return;
    this.cancel(id);
    const inv: MgInvite = { hostId: id, kind, since: Date.now(), guests: [], expiry: null };
    inv.expiry = this.d.clock.setTimeout(() => this.cancel(id), INVITE_TTL_MS);
    this.invites.set(id, inv);
    if (kind === 'ludo') this.sendLobby(inv);
  }

  cancel(hostId: string): void {
    const inv = this.invites.get(hostId);
    if (!inv) return;
    inv.expiry?.clear();
    this.invites.delete(hostId);
    for (const g of [hostId, ...inv.guests]) {
      this.lobbyOf.delete(g);
      this.d.send(g, 'mgLobby', null);
      if (isBotId(g)) this.botSpots.delete(g);
    }
  }

  accept(guestId: string, hostId: string): string | null {
    const inv = this.invites.get(hostId);
    const g = this.d.players.get(guestId), h = this.d.players.get(hostId);
    if (!inv || !g || !h || guestId === hostId) return 'This invite is no longer open.';
    if (this.locked(guestId)) return 'You are already in a game.';
    if (Math.hypot(g.x - h.x, g.z - h.z) > ACCEPT_RADIUS + 0.5) return 'Walk closer to accept.';
    const wait = this.d.settings().inviteAcceptDelaySec * 1000 - (Date.now() - inv.since);
    if (wait > 0) return `You can join in ${Math.ceil(wait / 1000)} s.`;
    this.cancel(guestId); // a guest's own open invite is withdrawn
    if (inv.kind !== 'ludo') {
      this.invites.delete(hostId);
      inv.expiry?.clear();
      this.start(inv.kind, [hostId, guestId]);
      return null;
    }
    if (inv.guests.includes(guestId)) return null;
    if (inv.guests.length >= miniGameInfo('ludo').maxPlayers - 1) return 'This Ludo table is full.';
    inv.guests.push(guestId);
    this.lobbyOf.set(guestId, hostId);
    this.sendLobby(inv);
    return null;
  }

  startLobby(hostId: string): void {
    const inv = this.invites.get(hostId);
    if (!inv || inv.kind !== 'ludo' || inv.guests.length < 1) return;
    const ids = [hostId, ...inv.guests].filter((x) => this.d.players.has(x) || isBotId(x));
    inv.expiry?.clear();
    this.invites.delete(hostId);
    for (const g of ids) { this.lobbyOf.delete(g); this.d.send(g, 'mgLobby', null); }
    if (ids.length >= 2) this.start('ludo', ids);
  }

  private sendLobby(inv: MgInvite): void {
    const members = [inv.hostId, ...inv.guests].map((id) => ({ id, name: this.nameOf(id) }));
    const view: MgLobby = { hostId: inv.hostId, kind: inv.kind, members };
    for (const m of members) this.d.send(m.id, 'mgLobby', view);
  }

  // ---------------- sessions ----------------

  private start(kind: MiniGameKind, ids: string[]): void {
    // Real players and bots share one shape; bots only have a virtual position.
    const ps = ids.map((id) => {
      const p = this.d.players.get(id);
      if (p) return p;
      const spot = this.botSpots.get(id) ?? { x: 0, y: 0, z: 0, yaw: 0 };
      return { sessionId: id, username: this.nameOf(id), ...spot } as Player;
    });
    const host = ps[0];
    const cx = ps.reduce((n, p) => n + p.x, 0) / ps.length, cz = ps.reduce((n, p) => n + p.z, 0) / ps.length;
    let dx = ps[1].x - host.x, dz = ps[1].z - host.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const s: MgSession = {
      id: `g${Date.now().toString(36)}${(this.counter++).toString(36)}`,
      kind, seats: ids, names: ps.map((p) => p.username), spectators: new Set(),
      table: { x: round3(cx), y: round3(host.y), z: round3(cz) }, seatPos: [],
      phase: 'playing', result: null, timer: null, deadline: 0, ver: 0, botTimers: [],
    };
    if (kind === 'rps') {
      // Stand where they are, facing each other.
      s.seatPos = ps.map((p, i) => {
        const o = ps[1 - i];
        return { id: p.sessionId, x: round3(p.x), z: round3(p.z), yaw: round3(Math.atan2(o.x - p.x, o.z - p.z)) };
      });
      s.seatPos.forEach((seat, i) => { ps[i].yaw = seat.yaw; if (!isBotId(seat.id)) this.d.send(seat.id, 'teleport', { x: ps[i].x, y: ps[i].y, z: ps[i].z, yaw: seat.yaw }); });
    } else {
      // Sit around a table that appears between the players.
      const n = ps.length;
      s.seatPos = ps.map((p, i) => {
        const a = (i * 2 * Math.PI) / n;
        const ox = -dx * Math.cos(a) + dz * Math.sin(a), oz = -dz * Math.cos(a) - dx * Math.sin(a);
        const x = cx + ox * SEAT_RADIUS, z = cz + oz * SEAT_RADIUS;
        return { id: p.sessionId, x: round3(x), z: round3(z), yaw: round3(Math.atan2(cx - x, cz - z)) };
      });
      s.seatPos.forEach((seat, i) => {
        const p = ps[i];
        p.x = seat.x; p.z = seat.z; p.y = host.y; p.yaw = seat.yaw;
        if (!isBotId(seat.id)) this.d.send(seat.id, 'teleport', { x: seat.x, y: host.y, z: seat.z, yaw: seat.yaw });
      });
    }
    for (const id of ids) { this.cancel(id); this.seatOf.set(id, s.id); }
    this.sessions.set(s.id, s);
    if (kind === 'rps') { s.rps = { round: 0, target: Math.floor(this.d.settings().rpsBestOf / 2) + 1, scores: [0, 0], picks: [null, null], reveal: null, roundWinner: -1 }; this.rpsRound(s); }
    if (kind === 'ttt') { s.ttt = tttNew(); this.arm(s, this.d.settings().tttTurnSec * 1000, () => this.autoPlay(s)); }
    if (kind === 'chess') { s.chess = { state: chessNew(), last: null }; this.arm(s, this.d.settings().chessTurnSec * 1000, () => this.autoPlay(s)); }
    if (kind === 'ludo') { s.ludo = { state: ludoNew(ids.length), lastRoll: 0 }; this.arm(s, this.d.settings().ludoTurnSec * 1000, () => this.autoPlay(s)); }
    console.log(`[blocksy] ${kind} started: ${s.names.join(' vs ')}`);
    this.push(s);
  }

  private arm(s: MgSession, ms: number, fn: () => void): void {
    s.timer?.clear();
    s.deadline = Date.now() + ms;
    s.timer = this.d.clock.setTimeout(fn, ms);
  }

  private turnSeat(s: MgSession): number {
    if (s.ttt) return s.ttt.turn;
    if (s.chess) return s.chess.state.turn === 'w' ? 0 : 1;
    if (s.ludo) return s.ludo.state.turn;
    return -1;
  }

  private rpsRound(s: MgSession): void {
    const r = s.rps!;
    r.round += 1; r.picks = [null, null]; r.reveal = null; r.roundWinner = -1;
    s.phase = 'playing';
    this.arm(s, this.d.settings().rpsPickSec * 1000, () => this.rpsResolve(s));
    const round = r.round;
    s.seats.forEach((id, seat) => {
      if (!isBotId(id)) return;
      s.botTimers.push(this.d.clock.setTimeout(() => {
        if (s.phase !== 'playing' || r.round !== round || r.picks[seat]) return;
        r.picks[seat] = rpsBotPick();
        if (r.picks.every((p) => !!p)) this.rpsResolve(s);
        else this.push(s);
      }, 500 + Math.random() * 1500));
    });
    this.push(s);
  }

  private rpsResolve(s: MgSession): void {
    const r = s.rps!;
    const picks = r.picks.map((p) => p ?? pickRandom(RPS_CHOICES)) as RpsChoice[]; // no choice → random pick
    r.reveal = picks;
    r.roundWinner = rpsWinner(picks[0], picks[1]);
    if (r.roundWinner >= 0) r.scores[r.roundWinner] += 1;
    s.phase = 'reveal';
    this.arm(s, RPS_REVEAL_MS, () => {
      const w = r.scores.findIndex((v) => v >= r.target);
      if (w >= 0) this.finish(s, [s.seats[w]], 'won');
      else this.rpsRound(s);
    });
    this.push(s);
  }

  /** Time ran out: the server plays a random legal move for the player whose turn it is. */
  private autoPlay(s: MgSession): void {
    const seat = this.turnSeat(s);
    if (s.ttt) this.applyMove(s, seat, pickRandom(tttLegal(s.ttt)));
    else if (s.chess) this.applyMove(s, seat, pickRandom(chessLegal(s.chess.state)));
    else if (s.ludo) {
      const l = s.ludo.state;
      this.applyMove(s, seat, l.phase === 'roll' ? { type: 'roll' } : { type: 'move', token: pickRandom(ludoMovable(l)) });
    }
  }

  move(id: string, payload: unknown): void {
    const sid = this.seatOf.get(id);
    const s = sid ? this.sessions.get(sid) : undefined;
    if (!s || s.phase === 'over') return;
    const seat = s.seats.indexOf(id);
    if (s.rps) {
      if (s.phase !== 'playing' || !isRpsChoice(payload) || s.rps.picks[seat]) return;
      s.rps.picks[seat] = payload;
      if (s.rps.picks.every((p) => !!p)) this.rpsResolve(s);
      else this.push(s);
      return;
    }
    if (seat !== this.turnSeat(s)) return;
    this.applyMove(s, seat, payload);
  }

  private applyMove(s: MgSession, seat: number, m: unknown): void {
    const st = this.d.settings();
    if (s.ttt) {
      const next = typeof m === 'number' ? tttPlay(s.ttt, seat, m) : null;
      if (!next) return;
      s.ttt = next;
      const r = tttResult(next);
      if (r.over) return this.finish(s, r.winner >= 0 ? [s.seats[r.winner]] : [], r.winner >= 0 ? 'won' : 'draw');
      this.arm(s, st.tttTurnSec * 1000, () => this.autoPlay(s));
    } else if (s.chess) {
      const mv = isObj(m) && isInt(m.from) && isInt(m.to) ? { from: m.from, to: m.to, promo: (['q', 'r', 'b', 'n'] as const).find((p) => p === m.promo) } : null;
      const next = mv ? chessPlay(s.chess.state, seat === 0 ? 'w' : 'b', mv) : null;
      if (!next || !mv) return;
      s.chess = { state: next, last: mv };
      const status = chessStatus(next);
      if (status === 'checkmate') return this.finish(s, [s.seats[seat]], 'checkmate');
      if (status !== 'playing') return this.finish(s, [], status);
      this.arm(s, st.chessTurnSec * 1000, () => this.autoPlay(s));
    } else if (s.ludo) {
      if (!isObj(m)) return;
      let next: LudoState | null = null;
      if (m.type === 'roll') {
        const value = 1 + Math.floor(Math.random() * 6);
        next = ludoRoll(s.ludo.state, seat, value);
        if (next) s.ludo.lastRoll = value;
      } else if (m.type === 'move' && isInt(m.token)) next = ludoMove(s.ludo.state, seat, m.token);
      if (!next) return;
      s.ludo.state = next;
      if (next.winner >= 0) return this.finish(s, [s.seats[next.winner]], 'won');
      this.arm(s, st.ludoTurnSec * 1000, () => this.autoPlay(s));
    }
    this.push(s);
  }

  /** If it's a bot's turn, play after a short pause (cancelled automatically if anything changes). */
  private scheduleBot(s: MgSession): void {
    if (s.phase !== 'playing' || s.rps) return;
    const seat = this.turnSeat(s);
    if (seat < 0 || !isBotId(s.seats[seat])) return;
    const ver = s.ver;
    s.botTimers.push(this.d.clock.setTimeout(() => {
      if (s.phase !== 'playing' || s.ver !== ver || this.turnSeat(s) !== seat) return;
      if (s.ttt) this.applyMove(s, seat, tttBotMove(s.ttt, seat));
      else if (s.chess) { const m = chessBotMove(s.chess.state); if (m) this.applyMove(s, seat, m); }
      else if (s.ludo) this.applyMove(s, seat, ludoBotAction(s.ludo.state));
    }, 700 + Math.random() * 900));
  }

  private finish(s: MgSession, winners: string[], reason: string): void {
    if (s.phase === 'over') return;
    s.phase = 'over';
    s.result = { winners, reason };
    this.arm(s, RESULT_HOLD_MS, () => this.close(s));
    this.push(s);
    console.log(`[blocksy] ${s.kind} over (${reason}): ${winners.map((w) => this.d.players.get(w)?.username ?? w).join(', ') || 'draw'}`);
  }

  private close(s: MgSession): void {
    s.timer?.clear();
    for (const t of s.botTimers) t.clear();
    for (const id of s.seats) if (isBotId(id)) this.botSpots.delete(id);
    this.sessions.delete(s.id);
    for (const id of [...s.seats, ...s.spectators]) {
      if (this.seatOf.get(id) === s.id) this.seatOf.delete(id);
      if (this.watching.get(id) === s.id) this.watching.delete(id);
      this.d.send(id, 'mgEnded', { id: s.id });
    }
  }

  spectate(id: string, gameId: string): string | null {
    const s = this.sessions.get(gameId);
    const p = this.d.players.get(id);
    if (!s || !p || s.phase === 'over') return 'That game has finished.';
    if (this.locked(id)) return 'You are already in a game.';
    if (Math.hypot(p.x - s.table.x, p.z - s.table.z) > SPECTATE_RADIUS + 0.5) return 'Walk closer to watch.';
    this.cancel(id);
    s.spectators.add(id);
    this.watching.set(id, s.id);
    this.push(s);
    return null;
  }

  /** Leave whatever the player is part of: game (forfeit), spectating, lobby or own invite. */
  leave(id: string): void {
    const lobbyHost = this.lobbyOf.get(id);
    if (lobbyHost) {
      const inv = this.invites.get(lobbyHost);
      this.lobbyOf.delete(id);
      this.d.send(id, 'mgLobby', null);
      if (inv) { inv.guests = inv.guests.filter((g) => g !== id); this.sendLobby(inv); }
    }
    this.cancel(id);
    const wid = this.watching.get(id);
    if (wid) {
      this.watching.delete(id);
      const s = this.sessions.get(wid);
      if (s) { s.spectators.delete(id); this.push(s); }
      this.d.send(id, 'mgEnded', { id: wid });
    }
    const sid = this.seatOf.get(id);
    const s = sid ? this.sessions.get(sid) : undefined;
    if (!s) return;
    this.seatOf.delete(id);
    s.seatPos = s.seatPos.filter((x) => x.id !== id);
    this.d.send(id, 'mgEnded', { id: s.id });
    if (s.phase === 'over') {
      this.closeIfOnlyBots(s); // everyone human already left the result screen
      return;
    }
    const seat = s.seats.indexOf(id);
    if (s.ludo) {
      s.ludo.state = ludoLeave(s.ludo.state, seat);
      const active = ludoActive(s.ludo.state);
      if (active.length < 2) return this.finish(s, active.map((i) => s.seats[i]), 'left');
      if (active.every((i) => isBotId(s.seats[i]))) { this.finish(s, [], 'left'); this.closeIfOnlyBots(s); return; }
      this.arm(s, this.d.settings().ludoTurnSec * 1000, () => this.autoPlay(s));
      this.push(s);
      return;
    }
    this.finish(s, s.seats.filter((x) => x !== id), 'left');
    this.closeIfOnlyBots(s);
  }

  /** Nobody human left at the table (and nobody watching): no result screen needed, free the bots now. */
  private closeIfOnlyBots(s: MgSession): void {
    if (this.sessions.has(s.id) && s.seatPos.every((x) => isBotId(x.id)) && s.spectators.size === 0) this.close(s);
  }

  /** After a reconnect: resend whatever the player is part of. */
  resend(id: string): void {
    const sid = this.seatOf.get(id) ?? this.watching.get(id);
    const s = sid ? this.sessions.get(sid) : undefined;
    if (s) this.d.send(id, 'mg', this.view(s, id));
    const host = this.lobbyOf.get(id) ?? (this.invites.get(id)?.kind === 'ludo' ? id : undefined);
    const inv = host ? this.invites.get(host) : undefined;
    if (inv) this.sendLobby(inv);
  }

  private push(s: MgSession): void {
    s.ver += 1;
    s.botTimers = s.botTimers.filter((t) => (t as Delayed & { active?: boolean }).active !== false);
    this.scheduleBot(s);
    for (const id of [...s.seats, ...s.spectators]) {
      if (this.seatOf.get(id) === s.id || this.watching.get(id) === s.id) this.d.send(id, 'mg', this.view(s, id));
    }
  }

  private view(s: MgSession, viewer: string): MgView {
    const you = s.seats.indexOf(viewer);
    const turn = this.turnSeat(s);
    const v: MgView = {
      id: s.id, kind: s.kind, role: you >= 0 ? 'player' : 'spectator', you,
      players: s.seats.map((id, seat) => ({ id, name: s.names[seat], seat })),
      spectators: s.spectators.size, turnSeat: turn, deadlineMs: Math.max(0, s.deadline - Date.now()),
      phase: s.phase, result: s.result,
    };
    if (you >= 0) v.seatYaw = s.seatPos[you]?.yaw;
    if (s.rps) {
      const r = s.rps;
      v.rps = { round: r.round, target: r.target, scores: r.scores.slice(), myPick: you >= 0 ? r.picks[you] : null, picked: r.picks.map((p) => !!p), reveal: r.reveal, roundWinner: r.roundWinner };
    }
    if (s.ttt) v.ttt = { cells: s.ttt.cells.slice(), line: tttResult(s.ttt).line?.slice() ?? null };
    if (s.chess) {
      const st = s.chess.state;
      const mine = you >= 0 && you === turn && s.phase === 'playing';
      v.chess = { board: st.board, turn: st.turn, check: chessInCheck(st), last: s.chess.last, legal: mine ? chessLegal(st) : [], status: chessStatus(st) };
    }
    if (s.ludo) {
      const st = s.ludo.state;
      v.ludo = { colors: st.colors, tokens: st.tokens, out: st.out, dice: st.dice, phase: st.phase, movable: you === turn ? ludoMovable(st) : [], lastRoll: s.ludo.lastRoll };
    }
    return v;
  }
}


// =====================================================================================================
// AMBIENT LIFE — wandering bots (talk, emote, join unanswered invites, watch games) and farm animals.
// Simulated on the server (in the 100 ms state tick) so every player sees the same thing.
// =====================================================================================================

interface Walker { id: string; x: number; y: number; z: number; yaw: number; tx: number; tz: number; moving: boolean; waitUntil: number; speed: number }
type BotTask =
  | { type: 'wander' }
  | { type: 'join'; hostId: string; until: number }
  | { type: 'watch'; gameId: string; until: number }
  | { type: 'talk'; with: string; until: number; replyAt: number; line: number; replied: boolean }
  | { type: 'pet'; animalId: string; until: number };
interface AmbientBot extends Walker { name: string; appearance: Appearance; task: BotTask; nextSocial: number; nextTalk: number; nextWatch: number; nextPet: number }
interface Animal extends Walker {
  kind: AnimalKind;
  variant: string;
  /** Cells of its home biome it may roam: [x, z, feetY]. */
  home: [number, number, number][];
  followId: string;
  followUntil: number;
  petReadyAt: number;
}

const CONVERSATIONS: [string, string][] = [
  ['Hi!', 'Hey there!'], ["What's up?", 'Just building stuff.'], ['Nice island!', 'I love the lanterns.'],
  ['Want to play?', 'Maybe later!'], ['Did you see the cows?', 'Moo! 😄'], ['Good game earlier!', 'Thanks, rematch soon!'],
];
const SOLO_LINES = ['What a nice day!', 'Anyone up for a game?', 'I like this island.', 'Hmm…', 'Look at that tree!'];
const ANIMAL_SPEED: Record<AnimalKind, number> = {
  cow: 0.8, sheep: 0.7, pig: 0.9, chicken: 0.9, rooster: 0.9, chick: 0.8, panda: 0.6, fox: 1.6,
  duck: 0.8, bee: 1.6, dog: 1.8, cat: 1.4, llama: 0.9, rabbit: 1.7,
};

class AmbientLife {
  readonly bots: AmbientBot[] = [];
  readonly animals: Animal[] = [];
  /** Walkable columns: "x,z" → feet height (top of the ground + 1). */
  private readonly walk = new Map<string, number>();
  /** Pond surface for swimmers: "x,z" → height. */
  private readonly swim = new Map<string, number>();
  private readonly cells: [number, number][] = [];

  constructor(
    grid: BlockGrid,
    layout: IslandLayout,
    settings: BlocksySettings,
    private readonly hub: MiniGameHub,
    private readonly players: Map<string, Player>,
    private readonly say: (type: 'chat' | 'emoji' | 'emote', id: string, value: string) => void,
    private readonly onPet: (animalId: string, byId: string, kind: AnimalKind) => void,
  ) {
    const cx = Math.floor(layout.center.x), cz = Math.floor(layout.center.z);
    const waterId = blockId('water');
    // Walkable ground is found from the ground UP, so tree tops, roofs and trunks never count as ground
    // (bots and animals used to spawn on and walk over canopies). Leaves and wood are never ground.
    const notGround = new Set(['leaves', 'spruce_leaves', 'oak_log', 'spruce_log', 'bamboo'].map((k) => blockId(k)));
    const maxY = SURFACE_Y + 4;
    for (let x = cx - 49; x <= cx + 49; x++) for (let z = cz - 49; z <= cz + 49; z++) {
      if (Math.hypot(x - cx, z - cz) > 48) continue;
      for (let y = 1; y <= maxY; y++) {
        const id = grid.get(x, y, z), above = grid.get(x, y + 1, z);
        const ground = getBlock(id);
        if (!ground?.solid || ground.shape !== 'cube' || notGround.has(id)) continue;
        if (above === waterId) {                              // pond: swim on the surface
          let top = y + 1;
          while (grid.get(x, top + 1, z) === waterId) top++;
          if (grid.get(x, top + 1, z) === AIR) this.swim.set(`${x},${z}`, top + 0.65);
          break;
        }
        const feet = getBlock(above), head = getBlock(grid.get(x, y + 2, z));
        if (feet?.solid || head?.solid) continue;             // something stands here (fence, trunk…)
        this.walk.set(`${x},${z}`, y + 1);
        this.cells.push([x, z]);
        break;
      }
    }
    if (this.cells.length === 0) return;
    const rnd = () => this.cells[Math.floor(Math.random() * this.cells.length)];
    for (let i = 0; i < settings.ambientBots; i++) {
      const [x, z] = rnd();
      const id = `bot:w${i}`;
      this.bots.push({
        id, name: `🤖 ${BOT_NAMES[i % BOT_NAMES.length]}`, appearance: randomAppearanceFor(id),
        x: x + 0.5, y: this.walk.get(`${x},${z}`)!, z: z + 0.5, yaw: Math.random() * 6.28, tx: x + 0.5, tz: z + 0.5,
        moving: false, waitUntil: 0, speed: 1.6, task: { type: 'wander' }, nextPet: Date.now() + 20000 + Math.random() * 30000,
        nextSocial: Date.now() + 4000 + Math.random() * 8000, nextTalk: Date.now() + 6000 + Math.random() * 10000, nextWatch: Date.now() + 15000 + Math.random() * 20000,
      });
    }
    // Animals live in their home biome (ducks also swim on the pond, bees fly over the meadow).
    const rngA = createRng(settings.worldSeed ^ 0x5eed);
    let n = 0;
    for (const kind of settings.animals) {
      const biome = layout.biomes.find((b) => b.biome === ANIMAL_BIOME[kind]);
      if (!biome) continue;
      const home: [number, number, number][] = [];
      const r2 = biome.r * biome.r;
      const swimmer = (SWIMMING as readonly string[]).includes(kind), flyer = (FLYING as readonly string[]).includes(kind);
      for (const [key, y] of this.walk) { const [x, z] = key.split(',').map(Number); if ((x + 0.5 - biome.x) ** 2 + (z + 0.5 - biome.z) ** 2 <= r2) home.push([x, z, y]); }
      if (swimmer) for (const [key, y] of this.swim) { const [x, z] = key.split(',').map(Number); if ((x + 0.5 - biome.x) ** 2 + (z + 0.5 - biome.z) ** 2 <= r2) home.push([x, z, y]); }
      if (home.length === 0) continue;
      const count = Math.max(1, Math.round(((ANIMAL_BASE_COUNT[kind] ?? 2) * settings.animalsPerKind) / 2));
      for (let i = 0; i < count; i++) {
        const [x, z, y] = home[Math.floor(rngA() * home.length)];
        this.animals.push({
          id: `a${n++}`, kind, variant: pickVariant(kind, rngA), home,
          x: x + 0.5, y: flyer ? y + 1.1 : y, z: z + 0.5, yaw: rngA() * 6.28, tx: x + 0.5, tz: z + 0.5,
          moving: false, waitUntil: 0, speed: ANIMAL_SPEED[kind], followId: '', followUntil: 0, petReadyAt: 0,
        });
      }
    }
  }

  private night = false;

  tick(dt: number, joinAfterMs: number, hour: number): void {
    const now = Date.now();
    const night = isNight(hour);
    if (night !== this.night) this.dayChange(night);
    this.night = night;
    if (joinAfterMs > 0) this.assignInvites(now, joinAfterMs);
    for (const b of this.bots) this.tickBot(b, dt, now);
    for (const a of this.animals) this.tickAnimal(a, dt, now);
  }

  /** Dusk / dawn: a bot says good night / good morning, roosters crow at sunrise. */
  private dayChange(night: boolean): void {
    const b = this.bots[Math.floor(Math.random() * this.bots.length)];
    if (b) this.say('chat', b.id, night ? 'Good night! 🌙' : 'Good morning! ☀️');
    if (!night) for (const a of this.animals) if (a.kind === 'rooster') this.onPet(a.id, '', a.kind);
  }

  /** Position of a player or bot (for petting and following). */
  private posOf(id: string): { x: number; z: number; y: number } | null {
    const p = this.players.get(id);
    if (p) return p;
    return this.bots.find((b) => b.id === id) ?? null;
  }

  /** A player or bot pets an animal: it reacts (heart + sound on every client) and follows them for a while. */
  pet(byId: string, animalId: string): boolean {
    const a = this.animals.find((x) => x.id === animalId);
    const by = this.posOf(byId);
    const now = Date.now();
    if (!a || !by || now < a.petReadyAt || Math.hypot(by.x - a.x, by.z - a.z) > PET_RADIUS + 0.6) return false;
    a.petReadyAt = now + 2500;
    a.followId = byId;
    a.followUntil = now + 12000;
    a.moving = false;
    a.yaw = Math.atan2(by.x - a.x, by.z - a.z);
    this.onPet(a.id, byId, a.kind);
    return true;
  }

  private tickAnimal(a: Animal, dt: number, now: number): void {
    const flyer = (FLYING as readonly string[]).includes(a.kind), swimmer = (SWIMMING as readonly string[]).includes(a.kind);
    if (a.followId && now < a.followUntil) {
      const f = this.posOf(a.followId);
      if (f) {
        const d = Math.hypot(f.x - a.x, f.z - a.z);
        if (d > 1.8) { a.tx = f.x; a.tz = f.z; a.moving = true; this.moveAnimal(a, dt, flyer, swimmer, true, 1.6); }
        else { a.moving = false; a.yaw = Math.atan2(f.x - a.x, f.z - a.z); }
        return;
      }
    }
    a.followId = '';
    if (this.night && !flyer && !swimmer) { a.moving = false; return; }   // most animals rest at night
    if (!a.moving && now >= a.waitUntil) {
      const [x, z] = a.home[Math.floor(Math.random() * a.home.length)];
      a.tx = x + 0.5; a.tz = z + 0.5; a.moving = true;
    }
    this.moveAnimal(a, dt, flyer, swimmer, false, 1);
    if (!a.moving && a.waitUntil < now) a.waitUntil = now + (flyer ? 800 : 3000) + Math.random() * (flyer ? 2500 : 9000);
  }

  private moveAnimal(a: Animal, dt: number, flyer: boolean, swimmer: boolean, following: boolean, speedMul: number): void {
    if (!a.moving) return;
    const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { a.moving = false; return; }
    const k = Math.min(1, (a.speed * speedMul * dt) / d);
    const nx = a.x + dx * k, nz = a.z + dz * k;
    const key = `${Math.floor(nx)},${Math.floor(nz)}`;
    const ground = this.walk.get(key) ?? (swimmer ? this.swim.get(key) : undefined);
    if (!flyer && (ground === undefined || Math.abs(ground - a.y) > 1.01)) {
      if (!following) { a.moving = false; return; }
    } else if (ground !== undefined) a.y = flyer ? ground + 1.1 : ground;
    a.x = nx; a.z = nz;
    a.yaw = Math.atan2(dx, dz);
  }

  /** An invite nobody answered for a while gets a free bot walking over to play. */
  private assignInvites(now: number, joinAfterMs: number): void {
    for (const inv of this.hub.openInvites()) {
      if (inv.ageMs < joinAfterMs || !this.players.has(inv.hostId)) continue;
      if (this.bots.some((b) => b.task.type === 'join' && b.task.hostId === inv.hostId)) continue;
      const free = this.bots.filter((b) => !this.hub.busy(b.id) && (b.task.type === 'wander' || b.task.type === 'watch'));
      if (free.length === 0) return;
      const b = free[Math.floor(Math.random() * free.length)];
      b.task = { type: 'join', hostId: inv.hostId, until: now + 25000 };
      b.speed = 2.6;
      b.waitUntil = 0;
    }
  }

  private tickBot(b: AmbientBot, dt: number, now: number): void {
    // Seated in a game (or waiting at a Ludo table): the body sits where the game put it.
    const seat = this.hub.seatSpot(b.id);
    if (seat) { b.x = seat.x; b.z = seat.z; b.y = seat.y; b.yaw = seat.yaw; b.moving = false; b.task = { type: 'wander' }; b.speed = 1.6; return; }
    if (this.hub.busy(b.id)) { b.moving = false; return; }

    const task = b.task;
    if (task.type === 'join') {
      const host = this.players.get(task.hostId);
      if (!host || now > task.until || !this.hub.openInvites().some((i) => i.hostId === task.hostId)) { this.toWander(b); return; }
      const d = Math.hypot(host.x - b.x, host.z - b.z);
      if (d < 1.8) {
        b.moving = false;
        b.yaw = Math.atan2(host.x - b.x, host.z - b.z);
        if (!this.hub.botAccept(b.id, task.hostId, b.name, { x: b.x, y: b.y, z: b.z, yaw: b.yaw })) this.toWander(b);
        return;
      }
      b.tx = host.x; b.tz = host.z; b.moving = true;
      this.step(b, dt, true, () => undefined); // may squeeze past fences to reach the host
      return;
    }
    if (task.type === 'talk') {
      const other = this.bots.find((o) => o.id === task.with);
      if (!other || now > task.until) { this.toWander(b); return; }
      b.moving = false;
      b.yaw = Math.atan2(other.x - b.x, other.z - b.z);
      if (!task.replied && task.replyAt > 0 && now >= task.replyAt) {
        task.replied = true;
        this.say('chat', b.id, CONVERSATIONS[task.line][1]);
        if (Math.random() < 0.4) this.say('emote', b.id, Math.random() < 0.5 ? 'happy' : 'wave');
      }
      return;
    }
    if (task.type === 'pet') {
      const a = this.animals.find((x) => x.id === task.animalId);
      if (!a || now > task.until) { this.toWander(b); return; }
      if (Math.hypot(a.x - b.x, a.z - b.z) < 2) { b.moving = false; this.pet(b.id, a.id); this.toWander(b); return; }
      b.tx = a.x; b.tz = a.z; b.moving = true;
      this.step(b, dt, false, () => undefined);
      if (!b.moving) this.toWander(b);
      return;
    }
    if (task.type === 'watch') {
      const game = this.hub.listing().find((g) => g.id === task.gameId);
      if (!game || game.phase === 'over' || now > task.until) { this.toWander(b); return; }
      if (b.moving) { this.step(b, dt, false, () => undefined); return; }
      b.yaw = Math.atan2(game.x - b.x, game.z - b.z);
      return;
    }

    // Wandering: chat with a nearby bot now and then, go and watch a game, emote, walk.
    if (now >= b.nextTalk && !b.moving) {
      const partner = this.bots.find((o) => o !== b && o.task.type === 'wander' && !this.hub.busy(o.id) && Math.hypot(o.x - b.x, o.z - b.z) < 4);
      if (partner) {
        const line = Math.floor(Math.random() * CONVERSATIONS.length);
        b.task = { type: 'talk', with: partner.id, until: now + 5000, replyAt: 0, line, replied: true };
        partner.task = { type: 'talk', with: b.id, until: now + 5000, replyAt: now + 1600, line, replied: false };
        partner.moving = false;
        this.say('chat', b.id, CONVERSATIONS[line][0]);
        b.nextTalk = partner.nextTalk = now + 20000 + Math.random() * 20000;
        return;
      }
      b.nextTalk = now + 4000;
    }
    if (now >= b.nextWatch) {
      b.nextWatch = now + 25000 + Math.random() * 30000;
      const games = this.hub.listing().filter((g) => g.phase !== 'over');
      if (games.length && Math.random() < 0.6) {
        const g = games[Math.floor(Math.random() * games.length)];
        const a = Math.random() * Math.PI * 2;
        b.task = { type: 'watch', gameId: g.id, until: now + 15000 + Math.random() * 15000 };
        b.tx = g.x + Math.cos(a) * 3; b.tz = g.z + Math.sin(a) * 3; b.moving = true;
        return;
      }
    }
    if (now >= b.nextPet) {
      b.nextPet = now + 30000 + Math.random() * 40000;
      const near = this.animals.filter((a) => Math.hypot(a.x - b.x, a.z - b.z) < 15);
      if (near.length) { b.task = { type: 'pet', animalId: near[Math.floor(Math.random() * near.length)].id, until: now + 15000 }; return; }
    }
    if (now >= b.nextSocial) {
      b.nextSocial = now + 10000 + Math.random() * 15000;
      const r = Math.random();
      if (r < 0.35) this.say('emoji', b.id, ['smile', 'heart', 'thumbs', 'laugh', 'wow', 'wave'][Math.floor(Math.random() * 6)]);
      else if (r < 0.65) this.say('emote', b.id, ['happy', 'wave', 'happy'][Math.floor(Math.random() * 3)]);
      else this.say('chat', b.id, SOLO_LINES[Math.floor(Math.random() * SOLO_LINES.length)]);
    }
    if (!b.moving && now >= b.waitUntil) this.pickTarget(b, 10);
    this.step(b, dt, false, () => { b.waitUntil = now + 2000 + Math.random() * 5000; });
  }

  private toWander(b: AmbientBot): void {
    b.task = { type: 'wander' };
    b.speed = 1.6;
    b.moving = false;
    b.waitUntil = Date.now() + 1500;
  }

  private pickTarget(w: Walker, range: number): void {
    for (let i = 0; i < 6; i++) {
      const [x, z] = this.cells[Math.floor(Math.random() * this.cells.length)];
      if (Math.hypot(x + 0.5 - w.x, z + 0.5 - w.z) > range) continue;
      w.tx = x + 0.5; w.tz = z + 0.5; w.moving = true;
      return;
    }
    w.waitUntil = Date.now() + 1000;
  }

  /** Moves toward the target on walkable ground; stops at obstacles (unless `squeeze`). */
  private step(w: Walker, dt: number, squeeze: boolean, onArrive: () => void): void {
    if (!w.moving) return;
    const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { w.moving = false; onArrive(); return; }
    const k = Math.min(1, (w.speed * dt) / d);
    const nx = w.x + dx * k, nz = w.z + dz * k;
    const feet = this.walk.get(`${Math.floor(nx)},${Math.floor(nz)}`);
    if (feet === undefined || Math.abs(feet - w.y) > 1.01) {
      if (!squeeze) { w.moving = false; w.waitUntil = Date.now() + 800; return; }
    } else w.y = feet;
    w.x = nx; w.z = nz;
    w.yaw = Math.atan2(dx, dz);
  }
}

function randomAppearanceFor(id: string): Appearance {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rng = createRng(h >>> 0);
  const pick = <T>(l: readonly T[]) => l[Math.floor(rng() * l.length)];
  return sanitizeAppearance({
    skin: pick(['#f6d3b3', '#edb98a', '#e0ac7e', '#c68642', '#9e6b43', '#7a4a2a']),
    hair: pick(['short', 'long', 'spiky', 'ponytail']), hairColor: pick(['#1e1e1e', '#3b2416', '#5a3a22', '#c89b5a', '#b5452f']),
    shirt: pick(['tshirt', 'longsleeve', 'hoodie', 'tank']), shirtColor: pick(['#2bb3a8', '#e8584b', '#f2c230', '#9b6bd6', '#3e78d6', '#3a9e4f']),
    pants: pick(['jeans', 'shorts', 'cargo']), pantsColor: pick(['#2e3a7a', '#2a2a2e', '#8a6a4a']),
    shoes: pick(['sneakers', 'boots']), shoeColor: pick(['#6b6f78', '#2a2a2e', '#f2f2f2']),
    hat: rng() < 0.3 ? pick(['cap', 'beanie']) : 'none', hatColor: pick(['#e8584b', '#3e78d6', '#f2c230']),
  });
}

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
  private hub!: MiniGameHub;
  private life!: AmbientLife;
  private clockStart = Date.now();

  /** In-game time of day (server-owned, identical for everyone). */
  private worldClock(): WorldClock & { dayLengthMs: number } {
    const dayLengthMs = this.settings.dayLengthMin * 60_000;
    return { ...clockAt(this.settings.startHour, dayLengthMs, Date.now() - this.clockStart), dayLengthMs };
  }
  private sessionTimer: Delayed | null = null;

  onCreate(options: Record<string, unknown> = {}): void {
    this.settings = readSettings(this.roomName, options.roomSettings);
    this.clockStart = Date.now();
    this.multiplayerId = sanitizeMultiplayerId(options.multiplayerId, DEFAULT_MULTIPLAYER_ID);
    this.layout = generateIsland(this.grid, this.settings.worldSeed, { biomes: biomesFor(this.settings.animals) });
    this.startedAt = Date.now();
    this.stateTimer = this.clock.setInterval(() => {
      this.life?.tick(STATE_INTERVAL_MS / 1000, this.settings.botJoinAfterSec * 1000, this.worldClock().hour);
      this.broadcastState();
    }, STATE_INTERVAL_MS);
    this.hub = new MiniGameHub({
      clock: this.clock,
      players: this.players,
      settings: () => this.settings,
      send: (id, type, msg) => { for (const c of this.clients) if (c.sessionId === id) c.send(type, msg); },
      npcs: () => this.layout.gameCenter.npcs,
    });
    this.life = new AmbientLife(this.grid, this.layout, this.settings, this.hub, this.players, (type, id, value) => {
      if (type === 'chat') this.broadcast('chat', { sessionId: id, text: value });
      else if (type === 'emoji') this.broadcast('emoji', { sessionId: id, id: value });
      else if (!this.hub.playing(id)) this.broadcast('emote', { sessionId: id, id: value });
    }, (animalId, byId, kind) => this.broadcast('animal', { id: animalId, by: byId, kind }));
    // The session timer starts after the first join, once the match config is known (see startSessionTimer).

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
      if (this.guard(c, 'emote') && isEmoteId(m?.id) && !this.hub.playing(c.sessionId)) this.broadcast('emote', { sessionId: c.sessionId, id: m.id });
    });
    this.onMessage('rename', (c: Client, m: { name?: unknown }) => {
      const p = this.players.get(c.sessionId);
      if (!p || !this.checkRate(c, 'rename') || !isObj(m)) return;
      p.username = sanitizeUsername(m.name);
      this.broadcast('playerMeta', this.metaOf(p));
    });
    this.onMessage('mgInvite', (c: Client, m: { kind?: unknown }) => {
      if (this.guard(c, 'mgInvite') && isObj(m) && isMiniGameKind(m.kind)) this.hub.invite(c.sessionId, m.kind);
    });
    this.onMessage('pet', (c: Client, m: { animalId?: unknown }) => {
      if (!this.guard(c, 'pet') || !isObj(m) || typeof m.animalId !== 'string' || this.hub.locked(c.sessionId)) return;
      this.life.pet(c.sessionId, m.animalId);
    });
    this.onMessage('mgNpc', (c: Client, m: { npcId?: unknown }) => {
      if (!this.guard(c, 'mgNpc') || !isObj(m) || typeof m.npcId !== 'string') return;
      const err = this.hub.playNpc(c.sessionId, m.npcId);
      if (err) c.send('mgError', { message: err });
    });
    this.onMessage('mgCancel', (c: Client) => { if (this.guard(c, 'mgCancel')) this.hub.cancel(c.sessionId); });
    this.onMessage('mgAccept', (c: Client, m: { hostId?: unknown }) => {
      if (!this.guard(c, 'mgAccept') || !isObj(m) || typeof m.hostId !== 'string') return;
      const err = this.hub.accept(c.sessionId, m.hostId);
      if (err) c.send('mgError', { message: err });
    });
    this.onMessage('mgStart', (c: Client) => { if (this.guard(c, 'mgStart')) this.hub.startLobby(c.sessionId); });
    this.onMessage('mgMove', (c: Client, m: { move?: unknown }) => { if (this.guard(c, 'mgMove') && isObj(m)) this.hub.move(c.sessionId, m.move); });
    this.onMessage('mgLeave', (c: Client) => { if (this.guard(c, 'mgLeave')) this.hub.leave(c.sessionId); });
    this.onMessage('mgSpectate', (c: Client, m: { gameId?: unknown }) => {
      if (!this.guard(c, 'mgSpectate') || !isObj(m) || typeof m.gameId !== 'string') return;
      const err = this.hub.spectate(c.sessionId, m.gameId);
      if (err) c.send('mgError', { message: err });
    });
    this.onMessage('*', (c: Client, type: string | number) => { this.checkRate(c, 'other'); void type; });
    if (this.roomName !== ROOM_NAME) console.warn(`[blocksy] game key is "${this.roomName}", client expects "${ROOM_NAME}"`);
    console.log(`[blocksy] room ${this.roomId} created (seed=${this.settings.worldSeed})`);
  }

  async onAuth(_client: Client, options: Partial<JoinOptions> & Record<string, unknown>): Promise<JoinAuth> {
    // Our client always sends protocolVersion; dashboard Playground players may not, so only a *different* version is refused.
    if (options?.protocolVersion !== undefined && options.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Game version mismatch (client ${String(options?.protocolVersion)}, server ${PROTOCOL_VERSION}). Please reload the game.`);
    }
    return await authorizeJoin(options);
  }

  async onJoin(client: Client, options: Partial<JoinOptions> & Record<string, unknown>, auth: JoinAuth): Promise<void> {
    if (!this.configPromise) {
      this.multiplayerId = auth.multiplayerId; // = JWT "mid", the backend's match id
      console.log(`[blocksy] room ${this.roomId} serves match ${auth.multiplayerId}${isPlaygroundMatch(auth.multiplayerId) ? ' (playground)' : ''}`);
      this.configPromise = fetchRoomConfig(auth.multiplayerId, this.roomName)
        .then((cfg) => {
          if (isInt(cfg?.maxPlayers) && cfg.maxPlayers > 0) this.maxClients = Math.min(cfg.maxPlayers, MAX_PLAYERS);
          this.startSessionTimer(isNum(cfg?.durationMs) ? cfg.durationMs : 0);
        })
        .catch((err: unknown) => {
          console.warn('[blocksy] fetchRoomConfig failed, using defaults', err);
          this.startSessionTimer(0);
        });
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
    this.publishMetadata();
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
        this.hub.resend(client.sessionId);
        return;
      } catch {
        // reconnection window expired
      }
    }
    this.hub.leave(client.sessionId);
    this.players.delete(client.sessionId);
    this.buckets.delete(client.sessionId);
    this.publishMetadata();
    this.broadcast('playerLeft', { id: client.sessionId });
  }

  async onDispose(): Promise<void> {
    await this.finish('empty');
  }

  // ---------------- lifecycle ----------------

  /**
   * Session length: the match's Round duration from the backend (cfg.durationMs). If that is 0 or missing,
   * the Custom setting "sessionMinutes" is used; 0 there means the session lasts until everyone leaves.
   */
  private startSessionTimer(durationMs: number): void {
    if (this.sessionTimer || this.finished) return;
    const ms = durationMs > 0 ? durationMs : this.settings.sessionMinutes * 60_000;
    this.startedAt = Date.now();
    if (ms <= 0) return;
    this.endsAt = this.startedAt + ms;
    this.sessionTimer = this.clock.setTimeout(() => { void this.finish('time'); }, ms);
    console.log(`[blocksy] session ${this.roomId}: ${Math.round(ms / 1000)} s`);
  }

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

  /** Public room listing info (match id + live player count) for the platform's matchmaker. */
  private publishMetadata(): void {
    void this.setMetadata({ multiplayerId: this.multiplayerId, players: this.players.size, maxPlayers: this.maxClients });
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
      players: [...[...this.players.values()].map((pl) => this.metaOf(pl)), ...this.life.bots.map((b) => ({ id: b.id, name: b.name, appearance: b.appearance }))],
    };
    client.send('init', init);
  }

  /** Public snapshot only (no user secrets); disconnected players are left out until they return. */
  private broadcastState(): void {
    if (this.players.size === 0) return;
    const players: (PlayerSnapshot & { userId: string; username: string; avatarUrl: string; inv: MiniGameKind | ''; invAgeMs: number; mg: string })[] = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      players.push({
        id: p.sessionId, userId: p.userId, username: p.username, avatarUrl: p.avatarUrl,
        x: round3(p.x), y: round3(p.y), z: round3(p.z), yaw: round3(p.yaw), speed: round3(p.speed),
        grounded: p.grounded, held: p.held, tool: p.tool, action: p.action,
        ...this.hub.tags(p.sessionId),
      });
    }
    for (const b of this.life.bots) {
      players.push({
        id: b.id, userId: '', username: b.name, avatarUrl: '',
        x: round3(b.x), y: round3(b.y), z: round3(b.z), yaw: round3(b.yaw), speed: b.moving ? round3(b.speed / 4.3) : 0,
        grounded: true, held: AIR, tool: 'none', action: 0, ...this.hub.tags(b.id),
      });
    }
    const animals = this.life.animals.map((a) => ({ id: a.id, kind: a.kind, variant: a.variant, x: round3(a.x), y: round3(a.y), z: round3(a.z), yaw: round3(a.yaw), moving: a.moving }));
    const c = this.worldClock();
    this.broadcast('state', {
      t: Date.now(),
      clock: { hour: Math.round(c.hour * 1000) / 1000, day: c.day, dayLengthMs: c.dayLengthMs },
      animals,
      phase: this.phase,
      timeLeftMs: this.endsAt ? Math.max(0, this.endsAt - Date.now()) : 0,
      players,
      games: this.hub.listing(),
      acceptDelayMs: this.settings.inviteAcceptDelaySec * 1000,
    });
  }

  private reject(client: Client, x: number, y: number, z: number, reason: ServerMessages['editRejected']['reason'] | 'busy'): void {
    client.send('editRejected', { x, y, z, id: this.grid.get(x, y, z), reason });
  }

  // ---------------- handlers ----------------

  private handleMove(client: Client, m: ClientMessages['move']): void {
    const p = this.players.get(client.sessionId);
    if (!p || !isObj(m) || ![m.x, m.y, m.z, m.yaw, m.speed].every(isNum)) return;
    if (this.hub.locked(client.sessionId)) { p.speed = 0; p.lastMove = Date.now(); return; }
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
    if (this.hub.locked(client.sessionId)) return this.reject(client, x, y, z, 'busy');
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
    if (this.hub.locked(client.sessionId)) return this.reject(client, x, y, z, 'busy');
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
    if (!p || !isObj(m) || !isInt(m.id) || this.hub.locked(client.sessionId)) return;
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
