import { voxelRaycast } from '@jp/blocksy-shared';

/**
 * Third-person camera collision without jumps.
 * - A "thick" probe (centre + 4 parallel rays around it) acts like a small sphere, so block edges no longer
 *   make the camera flicker in and out while turning.
 * - Distance and shoulder offset are smoothed: pulled in quickly but continuously, eased out slowly and only
 *   after the way has been clear for a moment (no bouncing when brushing past an obstacle).
 * - Safety: the camera is never left inside a block; only then (or after a teleport) does it snap.
 */

export type Vec3 = [number, number, number];
export type SolidFn = (x: number, y: number, z: number) => boolean;

export interface CameraRigState { dist: number; shoulder: number; clearAt: number; lastX: number; lastY: number; lastZ: number; init: boolean }
export const newCameraRig = (dist: number, shoulder: number): CameraRigState =>
  ({ dist, shoulder, clearAt: -9, lastX: 0, lastY: 0, lastZ: 0, init: false });

export interface CameraRigInput {
  /** Head pivot (behind which the camera orbits). */
  head: Vec3;
  /** Look direction (unit). */
  dir: Vec3;
  /** Right vector (unit, horizontal). */
  right: Vec3;
  solid: SolidFn;
  maxDist: number;
  shoulder: number;
  dt: number;
  t: number;
}

export const CAM_RADIUS = 0.22;
const MIN_DIST = 0.25;
const PULL_IN_RATE = 20;   // 1/s — fast but continuous
const EASE_OUT_RATE = 2.5; // 1/s — slow, calm recovery
const EASE_OUT_DELAY = 0.25;
const SIDE_IN_RATE = 14, SIDE_OUT_RATE = 4;

const smoothTo = (cur: number, target: number, rate: number, dt: number) => target + (cur - target) * Math.exp(-rate * dt);
const add = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const cellSolid = (solid: SolidFn, p: Vec3) => solid(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));

/** Shortest free distance along `dir` for a ray bundle of radius `r` around `origin`. */
function thickCast(origin: Vec3, dir: Vec3, max: number, r: number, solid: SolidFn): number {
  let up = cross(dir, [0, 1, 0]);
  const ul = Math.hypot(...up);
  up = ul < 1e-3 ? [1, 0, 0] : [up[0] / ul, up[1] / ul, up[2] / ul];
  const side = cross(up, dir);
  let best = max;
  for (const [a, b] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const o = add(add(origin, up, a), side, b);
    if ((a !== 0 || b !== 0) && cellSolid(solid, o)) continue; // offset start already inside a wall: ignore that ray
    const h = voxelRaycast(o[0], o[1], o[2], dir[0], dir[1], dir[2], max, solid);
    if (h.hit) best = Math.min(best, h.distance);
  }
  return best;
}

/** Returns the third-person camera position and updates the rig state. */
export function solveCamera(s: CameraRigState, i: CameraRigInput): Vec3 {
  const [hx, hy, hz] = i.head;
  const teleported = !s.init || Math.hypot(hx - s.lastX, hy - s.lastY, hz - s.lastZ) > 4;
  s.lastX = hx; s.lastY = hy; s.lastZ = hz; s.init = true;

  // Shoulder offset (camera slightly to the right), shrunk smoothly next to a wall.
  const sideFree = thickCast(i.head, i.right, i.shoulder + CAM_RADIUS + 0.1, 0.12, i.solid);
  const wantShoulder = Math.max(0, Math.min(i.shoulder, sideFree - CAM_RADIUS - 0.1));
  s.shoulder = teleported ? wantShoulder : smoothTo(s.shoulder, wantShoulder, wantShoulder < s.shoulder ? SIDE_IN_RATE : SIDE_OUT_RATE, i.dt);
  const pivot = add(i.head, i.right, s.shoulder);

  // Distance behind the pivot.
  const back: Vec3 = [-i.dir[0], -i.dir[1], -i.dir[2]];
  const free = thickCast(pivot, back, i.maxDist + CAM_RADIUS, CAM_RADIUS, i.solid);
  const wanted = Math.max(MIN_DIST, Math.min(i.maxDist, free - CAM_RADIUS));
  // clearAt = last moment something still limited the camera; easing out starts EASE_OUT_DELAY after that.
  if (wanted <= s.dist + 0.02) s.clearAt = i.t;
  if (teleported) s.dist = wanted;
  else if (wanted < s.dist) s.dist = smoothTo(s.dist, wanted, PULL_IN_RATE, i.dt);
  else if (i.t - s.clearAt > EASE_OUT_DELAY) s.dist = smoothTo(s.dist, wanted, EASE_OUT_RATE, i.dt);

  // Never inside a block: if the smoothed position would be in a wall, go to the free distance now.
  let cam = add(pivot, back, s.dist);
  if (cellSolid(i.solid, cam)) { s.dist = Math.min(s.dist, wanted); cam = add(pivot, back, s.dist); }
  return cam;
}
