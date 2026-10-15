import { AIR, getBlock, occludes, type BlockDef } from './blocks';
import type { BlockGrid } from './grid';

/** Geometry for one chunk; index ranges are grouped by render layer (0..3). */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  groups: { start: number; count: number; layer: number }[];
}

export type UvLookup = (id: number, face: number) => [number, number, number, number];

/** Face order: +X, -X, +Y, -Y, +Z, -Z. Corners are listed so (0,1,2),(0,2,3) is counter-clockwise from outside. */
export const FACE_DIRS: readonly [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const FACE_CORNERS: readonly (readonly [number, number, number][])[] = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0]],
  [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[][] = [[], [], [], []];
  constructor(private readonly uvOf: UvLookup) {}

  face(layer: number, ox: number, oy: number, oz: number, min: number[], ext: number[], f: number, r: [number, number, number, number]) {
    const start = this.pos.length / 3;
    for (const k of FACE_CORNERS[f]) {
      this.pos.push(ox + min[0] + k[0] * ext[0], oy + min[1] + k[1] * ext[1], oz + min[2] + k[2] * ext[2]);
      this.nor.push(...FACE_DIRS[f]);
    }
    this.uv.push(r[0], r[1], r[0], r[3], r[2], r[3], r[2], r[1]);
    this.idx[layer].push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  box(def: BlockDef, ox: number, oy: number, oz: number, min: number[], max: number[]) {
    const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    for (let f = 0; f < 6; f++) this.face(def.layer, ox, oy, oz, min, ext, f, this.uvOf(def.id, f));
  }

  cross(def: BlockDef, ox: number, oy: number, oz: number) {
    const r = this.uvOf(def.id, 0), a = 0.15, b = 0.85;
    const quads = [[[a, 0, a], [a, 1, a], [b, 1, b], [b, 0, b]], [[a, 0, b], [a, 1, b], [b, 1, a], [b, 0, a]]];
    for (const q of quads) for (const side of [0, 1]) {
      const start = this.pos.length / 3;
      for (const p of q) { this.pos.push(ox + p[0], oy + p[1], oz + p[2]); this.nor.push(0, 1, 0); }
      this.uv.push(r[0], r[1], r[0], r[3], r[2], r[3], r[2], r[1]);
      if (side === 0) this.idx[def.layer].push(start, start + 1, start + 2, start, start + 2, start + 3);
      else this.idx[def.layer].push(start, start + 2, start + 1, start, start + 3, start + 2);
    }
  }

  block(grid: BlockGrid | null, def: BlockDef, wx: number, wy: number, wz: number, ox: number, oy: number, oz: number) {
    switch (def.shape) {
      case 'cube':
        for (let f = 0; f < 6; f++) {
          const d = FACE_DIRS[f];
          const n = grid ? getBlock(grid.get(wx + d[0], wy + d[1], wz + d[2])) : undefined;
          const hidden = !!n && (occludes(n) || (n.id === def.id && def.layer !== 0));
          if (!hidden) this.face(def.layer, ox, oy, oz, [0, 0, 0], [1, 1, 1], f, this.uvOf(def.id, f));
        }
        break;
      case 'cross':
        this.cross(def, ox, oy, oz);
        break;
      case 'lantern':
        this.box(def, ox, oy, oz, [0.3125, 0, 0.3125], [0.6875, 0.5, 0.6875]);
        this.box(def, ox, oy, oz, [0.375, 0.5, 0.375], [0.625, 0.5625, 0.625]);
        break;
      case 'fence': {
        this.box(def, ox, oy, oz, [0.375, 0, 0.375], [0.625, 1, 0.625]);
        if (!grid) break;
        const rails: [number, number, number[], number[]][] = [
          [1, 0, [0.625, 0.4375], [1, 0.5625]], [-1, 0, [0, 0.4375], [0.375, 0.5625]],
          [0, 1, [0.4375, 0.625], [0.5625, 1]], [0, -1, [0.4375, 0], [0.5625, 0.375]],
        ];
        for (const [dx, dz, mn, mx] of rails) {
          const n = getBlock(grid.get(wx + dx, wy, wz + dz));
          if (!n || !(n.id === def.id || (n.shape === 'cube' && n.solid))) continue;
          this.box(def, ox, oy, oz, [mn[0], 0.375, mn[1]], [mx[0], 0.5625, mx[1]]);
          this.box(def, ox, oy, oz, [mn[0], 0.75, mn[1]], [mx[0], 0.9375, mx[1]]);
        }
        break;
      }
    }
  }

  finish(): MeshData {
    const groups: MeshData['groups'] = [];
    const all: number[] = [];
    this.idx.forEach((list, layer) => {
      if (list.length === 0) return;
      groups.push({ start: all.length, count: list.length, layer });
      for (const i of list) all.push(i);
    });
    return {
      positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), uvs: new Float32Array(this.uv),
      indices: new Uint32Array(all), groups,
    };
  }
}

/** Builds the mesh of a chunk whose minimum cell is (cx, cy, cz). Positions are relative to that cell. */
export function buildChunkMesh(grid: BlockGrid, cx: number, cy: number, cz: number, size: number, uvOf: UvLookup): MeshData {
  const b = new Builder(uvOf);
  for (let y = 0; y < size; y++) for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const wx = cx + x, wy = cy + y, wz = cz + z;
    const id = grid.get(wx, wy, wz);
    if (id === AIR) continue;
    const def = getBlock(id);
    if (def) b.block(grid, def, wx, wy, wz, x, y, z);
  }
  return b.finish();
}

/** A single block centred on the origin (held items, previews). */
export function buildBlockMesh(def: BlockDef, uvOf: UvLookup): MeshData {
  const b = new Builder(uvOf);
  b.block(null, def, 0, 0, 0, -0.5, -0.5, -0.5);
  return b.finish();
}
