import { getBlock } from './blocks';
import type { BlockGrid } from './grid';
import type { Aabb } from './placement';

export interface Body { x: number; y: number; z: number; vx: number; vy: number; vz: number; grounded: boolean }
export interface MoveResult { hitCeiling: boolean; hitWallX: boolean; hitWallZ: boolean }

const EPS = 1e-4;

export const isSolidAt = (grid: BlockGrid, x: number, y: number, z: number): boolean => {
  const b = getBlock(grid.get(x, y, z));
  return !!b && b.solid;
};

/**
 * Moves the box along one axis, stopping at the first solid cell. Cells the box already overlaps
 * are ignored so a body can never get permanently stuck. Returns the distance actually moved.
 */
export function sweepAxis(grid: BlockGrid, box: Aabb, axis: 0 | 1 | 2, delta: number): number {
  if (delta === 0) return 0;
  const min = [box.minX, box.minY, box.minZ];
  const max = [box.maxX, box.maxY, box.maxZ];
  const lo = min.slice(), hi = max.slice();
  if (delta > 0) hi[axis] += delta; else lo[axis] += delta;
  const x0 = Math.floor(lo[0] + EPS), x1 = Math.floor(hi[0] - EPS);
  const y0 = Math.floor(lo[1] + EPS), y1 = Math.floor(hi[1] - EPS);
  const z0 = Math.floor(lo[2] + EPS), z1 = Math.floor(hi[2] - EPS);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        if (!isSolidAt(grid, x, y, z)) continue;
        const cMin = axis === 0 ? x : axis === 1 ? y : z;
        if (delta > 0 && cMin >= max[axis] - EPS) delta = Math.min(delta, cMin - max[axis]);
        else if (delta < 0 && cMin + 1 <= min[axis] + EPS) delta = Math.max(delta, cMin + 1 - min[axis]);
      }
  if (axis === 0) { box.minX += delta; box.maxX += delta; }
  else if (axis === 1) { box.minY += delta; box.maxY += delta; }
  else { box.minZ += delta; box.maxZ += delta; }
  return delta;
}

/** Integrates a body (feet position) through the voxel world: Y first, then X and Z (axis-separated). */
export function moveBody(grid: BlockGrid, body: Body, dt: number, radius: number, height: number): MoveResult {
  const box: Aabb = {
    minX: body.x - radius, minY: body.y, minZ: body.z - radius,
    maxX: body.x + radius, maxY: body.y + height, maxZ: body.z + radius,
  };
  const res: MoveResult = { hitCeiling: false, hitWallX: false, hitWallZ: false };
  const wantY = body.vy * dt;
  const gotY = sweepAxis(grid, box, 1, wantY);
  body.grounded = wantY < 0 && gotY > wantY + EPS;
  if (Math.abs(gotY - wantY) > EPS) {
    if (wantY > 0) res.hitCeiling = true;
    body.vy = 0;
  }
  const wantX = body.vx * dt;
  if (Math.abs(sweepAxis(grid, box, 0, wantX) - wantX) > EPS) { res.hitWallX = true; body.vx = 0; }
  const wantZ = body.vz * dt;
  if (Math.abs(sweepAxis(grid, box, 2, wantZ) - wantZ) > EPS) { res.hitWallZ = true; body.vz = 0; }
  body.x = box.minX + radius;
  body.y = box.minY;
  body.z = box.minZ + radius;
  return res;
}
