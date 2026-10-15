import { BLOCKS, getBlock, type BlockDef } from './blocks';
import { createRng, hashString } from './rng';

/**
 * Procedural, original 16×16 pixel-art tiles (no third-party textures).
 * Pixel buffers are RGBA, row-major, with row 0 at the BOTTOM (UV convention).
 */
export const TILE = 16;
export const TILE_KEYS = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'stone_bricks', 'bricks', 'oak_planks', 'dark_planks',
  'log_side', 'log_top', 'leaves', 'glass', 'sand', 'path_top', 'gravel', 'farmland_top', 'wool_white', 'wool_teal',
  'wool_red', 'wool_yellow', 'wool_blue', 'crafting_top', 'crafting_side', 'chest_top', 'chest_side', 'lantern',
  'flower_white', 'flower_yellow', 'tall_grass', 'island_core',
] as const;

type C = [number, number, number, number];
const c = (r: number, g: number, b: number, a = 255): C => [r, g, b, a];
const mul = (k: C, f: number): C => [Math.min(255, k[0] * f), Math.min(255, k[1] * f), Math.min(255, k[2] * f), k[3]];
const lerpC = (a: C, b: C, t: number): C => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

class Tile {
  readonly px = new Uint8ClampedArray(TILE * TILE * 4);
  constructor(readonly rng: () => number) {}
  set(x: number, y: number, k: C) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    this.px[i] = k[0]; this.px[i + 1] = k[1]; this.px[i + 2] = k[2]; this.px[i + 3] = k[3];
  }
  get(x: number, y: number): C { const i = (y * TILE + x) * 4; return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]]; }
  jit(a: number) { return 1 + (this.rng() * 2 - 1) * a; }
  each(f: (x: number, y: number) => C | null) { for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const k = f(x, y); if (k) this.set(x, y, k); } }
  noise(base: C, a: number) { this.each(() => mul(base, this.jit(a))); }
  specks(chance: number, f: number) { this.each((x, y) => (this.rng() < chance ? mul(this.get(x, y), f) : null)); }
}

function planks(t: Tile, base: C) {
  for (let p = 0; p < 4; p++) {
    const tint = t.jit(0.06), seam = Math.floor(t.rng() * TILE);
    for (let y = p * 4; y < p * 4 + 4; y++) for (let x = 0; x < TILE; x++) {
      let k = mul(base, tint * t.jit(0.035));
      if (y === p * 4) k = mul(k, 0.72); else if (x === seam) k = mul(k, 0.78); else if (t.rng() < 0.08) k = mul(k, 0.9);
      t.set(x, y, k);
    }
  }
}
const frame = (t: Tile, k: C) => { for (let i = 0; i < TILE; i++) { t.set(i, 0, k); t.set(i, 15, k); t.set(0, i, k); t.set(15, i, k); } };
const stone = (t: Tile, base: C) => {
  t.noise(base, 0.06);
  for (let i = 0; i < 7; i++) {
    const bx = Math.floor(t.rng() * 16), by = Math.floor(t.rng() * 16), w = 2 + Math.floor(t.rng() * 3), h = 1 + Math.floor(t.rng() * 2);
    const f = t.rng() < 0.5 ? 0.86 : 1.1;
    for (let x = bx; x < bx + w; x++) for (let y = by; y < by + h; y++) t.set(x % 16, y % 16, mul(t.get(x % 16, y % 16), f));
  }
};
const wool = (t: Tile, base: C) => t.each((x, y) => mul(base, ((x + y) % 2 === 0 ? 1 : 0.94) * t.jit(0.035)));
const GRASS = c(98, 172, 66), DIRT = c(136, 98, 66), CLEAR = c(0, 0, 0, 0);

const painters: Record<string, (t: Tile) => void> = {
  grass_top: (t) => { t.noise(GRASS, 0.08); t.specks(0.16, 0.82); t.specks(0.08, 1.15); },
  dirt: (t) => { t.noise(DIRT, 0.09); t.specks(0.14, 0.74); t.specks(0.05, 1.2); },
  grass_side: (t) => {
    painters.dirt(t);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(t.rng() * 3);
      for (let y = TILE - depth; y < TILE; y++) t.set(x, y, mul(GRASS, t.jit(0.09)));
      if (t.rng() < 0.3) t.set(x, TILE - depth - 1, mul(c(84, 150, 56), t.jit(0.05)));
    }
  },
  stone: (t) => stone(t, c(128, 128, 130)),
  island_core: (t) => stone(t, c(70, 72, 84)),
  cobblestone: (t) => {
    const seeds = Array.from({ length: 9 }, () => [t.rng() * 16, t.rng() * 16, 0.82 + t.rng() * 0.3]);
    t.each((x, y) => {
      let d1 = Infinity, d2 = Infinity, best = 0;
      seeds.forEach(([sx, sy], i) => {
        let dx = Math.abs(x - sx); dx = Math.min(dx, 16 - dx);
        let dy = Math.abs(y - sy); dy = Math.min(dy, 16 - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      });
      return Math.sqrt(d2) - Math.sqrt(d1) < 1.1 ? c(78, 78, 82) : mul(c(132, 132, 134), seeds[best][2] * t.jit(0.04));
    });
  },
  stone_bricks: (t) => {
    t.noise(c(126, 126, 128), 0.05);
    t.each((x, y) => {
      const off = Math.floor(y / 8) % 2 === 0 ? 0 : 4;
      if (y % 8 === 7 || (x + off) % 8 === 7) return c(88, 88, 92);
      return y % 8 === 6 || (x + off) % 8 === 0 ? mul(t.get(x, y), 0.9) : null;
    });
  },
  bricks: (t) => t.each((x, y) => {
    const off = Math.floor(y / 4) % 2 === 0 ? 0 : 4;
    return y % 4 === 3 || (x + off) % 8 === 7 ? c(196, 186, 172) : mul(c(156, 72, 56), t.jit(0.08));
  }),
  oak_planks: (t) => planks(t, c(184, 142, 90)),
  dark_planks: (t) => planks(t, c(112, 80, 50)),
  log_side: (t) => t.each((x) => mul(c(106, 80, 50), (x % 4 === 0 ? 0.78 : x % 4 === 2 ? 0.92 : 1) * t.jit(0.06) * (t.rng() < 0.06 ? 0.8 : 1))),
  log_top: (t) => t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return mul(d >= 7 ? c(96, 72, 44) : Math.floor(d) % 2 === 0 ? c(182, 146, 94) : c(154, 118, 74), t.jit(0.04));
  }),
  leaves: (t) => t.each(() => {
    if (t.rng() < 0.13) return CLEAR;
    const k = mul(c(66, 146, 50), t.jit(0.14));
    return t.rng() < 0.18 ? mul(k, 0.72) : k;
  }),
  glass: (t) => t.each((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const streak = ((x - y === 3 || x - y === 4) && x > 4 && x < 13) || (x - y === -5 && x > 2 && x < 7);
    return edge ? c(226, 244, 255, 230) : streak ? c(255, 255, 255, 150) : c(196, 232, 250, 52);
  }),
  sand: (t) => { t.noise(c(222, 208, 160), 0.05); t.specks(0.08, 0.88); },
  path_top: (t) => { t.noise(c(160, 120, 74), 0.08); t.specks(0.14, 0.8); },
  gravel: (t) => t.each(() => { const g = 108 + Math.floor(t.rng() * 56); return t.rng() < 0.2 ? c(g, g - 10, g - 22) : c(g, g, g + 3); }),
  farmland_top: (t) => t.each((_x, y) => mul(c(108, 70, 42), (y % 4 < 2 ? 0.78 : 1) * t.jit(0.07))),
  wool_white: (t) => wool(t, c(236, 236, 232)),
  wool_teal: (t) => wool(t, c(42, 178, 166)),
  wool_red: (t) => wool(t, c(200, 58, 50)),
  wool_yellow: (t) => wool(t, c(240, 200, 54)),
  wool_blue: (t) => wool(t, c(54, 96, 200)),
  crafting_top: (t) => {
    planks(t, c(176, 134, 84)); frame(t, c(92, 64, 38));
    for (let i = 2; i < 14; i++) for (const k of [5, 10]) { t.set(k, i, c(110, 78, 46)); t.set(i, k, c(110, 78, 46)); }
  },
  crafting_side: (t) => {
    planks(t, c(170, 128, 80));
    t.each((_x, y) => (y >= 13 ? mul(c(120, 86, 52), t.jit(0.04)) : null));
    t.each((x, y) => (x >= 2 && x <= 6 && y >= 5 && y <= 8 ? c(170, 170, 176) : null));
    t.each((x, y) => ((x === 10 || x === 11) && y >= 3 && y <= 9 ? c(90, 60, 34) : null));
    t.each((x, y) => (x >= 8 && x <= 13 && y >= 9 && y <= 11 ? c(120, 120, 128) : null));
  },
  chest_top: (t) => { planks(t, c(184, 124, 52)); frame(t, c(72, 46, 22)); },
  chest_side: (t) => {
    painters.chest_top(t);
    for (let x = 1; x < 15; x++) t.set(x, 10, c(72, 46, 22));
    t.each((x, y) => (x >= 6 && x <= 9 && y >= 8 && y <= 12 ? (x === 6 || x === 9 || y === 8 || y === 12 ? c(60, 60, 64) : c(196, 196, 204)) : null));
  },
  lantern: (t) => t.each((x, y) => {
    if (y >= 13 && (x < 4 || x > 11)) return CLEAR;
    if (x >= 3 && x <= 12 && y >= 2 && y <= 12) {
      const d = Math.min(1, Math.hypot(x - 7.5, y - 7) / 6.5);
      const k = lerpC(c(255, 236, 160), c(236, 150, 50), d);
      return x === 7 || x === 8 ? mul(k, 0.55) : k;
    }
    return c(44, 40, 38);
  }),
  flower_white: (t) => flower(t, c(246, 246, 240), c(242, 200, 40)),
  flower_yellow: (t) => flower(t, c(248, 210, 44), c(214, 120, 30)),
  tall_grass: (t) => {
    t.each(() => CLEAR);
    for (let b = 0; b < 8; b++) {
      const x = 1 + Math.floor(t.rng() * 14), h = 6 + Math.floor(t.rng() * 9), lean = Math.floor(t.rng() * 3) - 1;
      const k = mul(c(84, 164, 58), t.jit(0.15));
      for (let y = 0; y < h; y++) t.set(x + (y > h / 2 ? lean : 0), y, y > h - 3 ? mul(k, 1.12) : k);
    }
  },
};

function flower(t: Tile, petal: C, center: C) {
  t.each(() => CLEAR);
  const stem = c(62, 140, 52);
  for (let y = 0; y <= 8; y++) { t.set(7, y, stem); t.set(8, y, stem); }
  for (const [x, y] of [[5, 4], [6, 4], [6, 5], [9, 3], [10, 3], [9, 4]]) t.set(x, y, stem);
  t.each((x, y) => { const d = Math.hypot(x - 7.5, y - 11); return y >= 8 && d <= 3.2 ? (d <= 1.2 ? center : petal) : null; });
}

/** Paints a tile; unknown keys produce a magenta checkerboard. */
export function paintTile(key: string): Uint8ClampedArray {
  const t = new Tile(createRng(hashString(key)));
  const p = painters[key];
  if (p) p(t); else t.each((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? c(20, 20, 20) : c(255, 0, 255)));
  return t.px;
}

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(TILE_KEYS.length / ATLAS_COLS);
export const ATLAS_WIDTH = ATLAS_COLS * TILE;
export const ATLAS_HEIGHT = ATLAS_ROWS * TILE;
const tileIndex = new Map<string, number>(TILE_KEYS.map((k, i) => [k, i]));

/** UV rect [u0, v0, u1, v1] of a tile (v from the bottom), inset so point sampling never bleeds. */
export function tileUv(key: string): [number, number, number, number] {
  const i = tileIndex.get(key) ?? 0;
  const inset = 0.02;
  const x = (i % ATLAS_COLS) * TILE, y = Math.floor(i / ATLAS_COLS) * TILE;
  return [(x + inset) / ATLAS_WIDTH, (y + inset) / ATLAS_HEIGHT, (x + TILE - inset) / ATLAS_WIDTH, (y + TILE - inset) / ATLAS_HEIGHT];
}

/** UV rect for a block face. Face order: 0 +X, 1 -X, 2 +Y (top), 3 -Y (bottom), 4 +Z, 5 -Z. */
export function blockFaceUv(id: number, face: number): [number, number, number, number] {
  const b = getBlock(id);
  if (!b) return [0, 0, 0, 0];
  return tileUv(face === 2 ? b.top : face === 3 ? b.bottom : b.side);
}

/** Paints the whole atlas (bottom-up rows). */
export function paintAtlas(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  TILE_KEYS.forEach((key, i) => {
    const px = paintTile(key);
    const ox = (i % ATLAS_COLS) * TILE, oy = Math.floor(i / ATLAS_COLS) * TILE;
    for (let y = 0; y < TILE; y++) out.set(px.subarray(y * TILE * 4, (y + 1) * TILE * 4), ((oy + y) * ATLAS_WIDTH + ox) * 4);
  });
  return out;
}

/** Software-rendered isometric icon (bottom-up RGBA). Non-cube blocks are drawn flat. */
export function renderIcon(def: BlockDef, size = 64): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const top = paintTile(def.top), side = paintTile(def.side);
  const put = (x: number, y: number, k: ArrayLike<number>, shadeF: number) => {
    const i = (y * size + x) * 4;
    out[i] = k[0] * shadeF; out[i + 1] = k[1] * shadeF; out[i + 2] = k[2] * shadeF; out[i + 3] = Math.max(k[3], 120);
  };
  const sample = (tile: Uint8ClampedArray, s: number, t: number) => {
    const i = (Math.min(15, Math.floor(t * 16)) * 16 + Math.min(15, Math.floor(s * 16))) * 4;
    return tile.subarray(i, i + 4);
  };
  if (def.shape !== 'cube') {
    const pad = Math.round(size / 8), span = size - pad * 2;
    for (let y = 0; y < span; y++) for (let x = 0; x < span; x++) {
      const k = sample(side, x / span, y / span);
      if (k[3] > 0) put(x + pad, y + pad, k, 1);
    }
    return out;
  }
  const a = size * 0.42, b = a / 2, h = a * 1.05, margin = (size - (2 * b + h)) / 2, cx = size / 2, topY = size - margin;
  const left = [cx - a, topY - b], front = [cx, topY - 2 * b], right = [cx + a, topY - b];
  const faces: [number[], number[], number[], Uint8ClampedArray, number][] = [
    [front, [right[0] - front[0], right[1] - front[1]], [left[0] - front[0], left[1] - front[1]], top, 1],
    [[left[0], left[1] - h], [front[0] - left[0], front[1] - left[1]], [0, h], side, 0.8],
    [[front[0], front[1] - h], [right[0] - front[0], right[1] - front[1]], [0, h], side, 0.62],
  ];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    for (const [o, e1, e2, tile, sh] of faces) {
      const dx = x + 0.5 - o[0], dy = y + 0.5 - o[1];
      const det = e1[0] * e2[1] - e1[1] * e2[0];
      const s = (dx * e2[1] - dy * e2[0]) / det, t = (e1[0] * dy - e1[1] * dx) / det;
      if (s < 0 || s >= 1 || t < 0 || t >= 1) continue;
      const k = sample(tile, s, t);
      if (k[3] === 0) continue;
      put(x, y, k, sh);
      break;
    }
  }
  return out;
}

/** All block ids that have icons. */
export const ICON_BLOCKS = BLOCKS.map((b) => b.id);
