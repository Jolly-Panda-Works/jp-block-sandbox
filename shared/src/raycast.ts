export interface VoxelHit {
  hit: boolean;
  x: number; y: number; z: number;
  /** Outward normal of the entered face. */
  nx: number; ny: number; nz: number;
  distance: number;
}

const MAX_STEPS = 2048;

/**
 * Grid traversal ray cast (Amanatides & Woo) on block data, independent of rendering.
 * The cell containing the origin is skipped so a camera touching a block can't target from inside it.
 */
export function voxelRaycast(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  isTargetable: (x: number, y: number, z: number) => boolean,
): VoxelHit {
  const res: VoxelHit = { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, distance: 0 };
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9 || maxDistance <= 0) return res;
  dx /= len; dy /= len; dz /= len;

  let cx = Math.floor(ox), cy = Math.floor(oy), cz = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const boundary = (o: number, c: number, d: number) => (d > 0 ? (c + 1 - o) / d : d < 0 ? (o - c) / -d : Infinity);
  let tx = boundary(ox, cx, dx), ty = boundary(oy, cy, dy), tz = boundary(oz, cz, dz);
  const ddx = sx ? 1 / Math.abs(dx) : Infinity, ddy = sy ? 1 / Math.abs(dy) : Infinity, ddz = sz ? 1 / Math.abs(dz) : Infinity;

  for (let i = 0; i < MAX_STEPS; i++) {
    let t: number;
    let nx = 0, ny = 0, nz = 0;
    if (tx <= ty && tx <= tz) { t = tx; cx += sx; tx += ddx; nx = -sx; }
    else if (ty <= tz) { t = ty; cy += sy; ty += ddy; ny = -sy; }
    else { t = tz; cz += sz; tz += ddz; nz = -sz; }
    if (t > maxDistance || !Number.isFinite(t)) break;
    if (isTargetable(cx, cy, cz)) {
      Object.assign(res, { hit: true, x: cx, y: cy, z: cz, nx, ny, nz, distance: t });
      return res;
    }
  }
  return res;
}
