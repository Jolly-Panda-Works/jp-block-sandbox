import { AIR, getBlock } from './blocks';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from './constants';
import type { BlockGrid } from './grid';

export interface Aabb { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }

export const cellAabb = (x: number, y: number, z: number): Aabb =>
  ({ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 });

/** Player collider box from the feet position. */
export const playerAabb = (px: number, py: number, pz: number, r = PLAYER_RADIUS, h = PLAYER_HEIGHT): Aabb =>
  ({ minX: px - r, minY: py, minZ: pz - r, maxX: px + r, maxY: py + h, maxZ: pz + r });

/** Overlap by more than epsilon on every axis (touching faces don't count). */
export function intersects(a: Aabb, b: Aabb, eps = 0.001): boolean {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps
    && a.minY < b.maxY - eps && a.maxY > b.minY + eps
    && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps;
}

export type PlacementResult = 'ok' | 'out_of_bounds' | 'occupied' | 'blocked_by_actor' | 'not_placeable' | 'not_owned' | 'out_of_range';
export type RemovalResult = 'ok' | 'out_of_bounds' | 'empty' | 'protected' | 'not_removable' | 'out_of_range';

/** Replaceable blocks (plants) are replaced in place; otherwise the block goes beside the hit face. */
export function resolvePlacementCell(grid: BlockGrid, hx: number, hy: number, hz: number, nx: number, ny: number, nz: number): [number, number, number] {
  const hit = getBlock(grid.get(hx, hy, hz));
  if (hit?.replaceable && !grid.isProtected(hx, hy, hz)) return [hx, hy, hz];
  return [hx + nx, hy + ny, hz + nz];
}

export function evaluatePlacement(grid: BlockGrid, x: number, y: number, z: number, id: number, blockers: readonly Aabb[]): PlacementResult {
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

export function evaluateRemoval(grid: BlockGrid, x: number, y: number, z: number): RemovalResult {
  if (!grid.inBounds(x, y, z)) return 'out_of_bounds';
  const id = grid.get(x, y, z);
  if (id === AIR) return 'empty';
  if (grid.isProtected(x, y, z)) return 'protected';
  const def = getBlock(id);
  if (!def || !def.removable) return 'not_removable';
  return 'ok';
}

/** Distance from the eye to the nearest point of the cell is within reach. */
export function withinReach(ex: number, ey: number, ez: number, x: number, y: number, z: number, reach: number): boolean {
  const cl = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const dx = cl(ex, x, x + 1) - ex, dy = cl(ey, y, y + 1) - ey, dz = cl(ez, z, z + 1) - ez;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}
