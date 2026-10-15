import { voxelRaycast } from '@jp/blocksy-shared';

/**
 * Third-person camera collision without jumps.
 * - A "thick" probe (centre + 4 parallel rays) acts like a small sphere, so block edges don't flicker.
 * - Anticipation, only while turning: the probe also looks a little AHEAD in the direction you are turning
 *   (further the faster you turn), so when you turn toward a wall the camera starts moving in a few degrees
 *   earlier and the change is spread over more frames. Standing still or walking straight there is no
 *   look-ahead, so things beside you (not behind you) never move the camera.
 * - Zooming in is smoothed and speed-limited; zooming out waits a moment and eases.
 * - Safety: the camera is never left inside a block (smallest step toward the player).
 */
export type Vec3 = [number, number, number];
export type SolidFn = (x: number, y: number, z: number) => boolean;

export interface CameraRigState { dist: number; shoulder: number; clearAt: number; lastX: number; lastY: number; lastZ: number; init: boolean; lastYaw: number; yawRate: number }
export const newCameraRig = (dist: number, shoulder: number): CameraRigState =>
  ({ dist, shoulder, clearAt: -9, lastX: 0, lastY: 0, lastZ: 0, init: false, lastYaw: 0, yawRate: 0 });

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
export const CAM_TUNING = {
  pullInRate: 14,     // 1/s
  maxInSpeed: 10,     // m/s
  easeOutRate: 2.2,   // 1/s
  easeOutDelay: 0.3,  // s
  anticipate: 0.55,   // rad — the most it looks ahead (≈ 31°)
  lookAhead: 0.35,    // s — how far ahead in time it looks while turning
};
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
  // How fast the view is turning (rad/s, smoothed), for the look-ahead.
  const yaw = Math.atan2(i.dir[0], i.dir[2]);
  if (s.init && i.dt > 0) {
    const raw = Math.atan2(Math.sin(yaw - s.lastYaw), Math.cos(yaw - s.lastYaw)) / i.dt;
    // Fast attack (a sudden fast turn looks ahead at once), slow release (no flicker from mouse jitter).
    s.yawRate = Math.abs(raw) > Math.abs(s.yawRate) && Math.sign(raw) === Math.sign(s.yawRate || raw)
      ? raw : s.yawRate + (raw - s.yawRate) * (1 - Math.exp(-10 * i.dt));
  }
  s.lastYaw = yaw;
  s.lastX = hx; s.lastY = hy; s.lastZ = hz; s.init = true;

  // Shoulder offset (camera slightly to the right), shrunk smoothly next to a wall.
  const sideFree = thickCast(i.head, i.right, i.shoulder + CAM_RADIUS + 0.1, 0.12, i.solid);
  const wantShoulder = Math.max(0, Math.min(i.shoulder, sideFree - CAM_RADIUS - 0.1));
  s.shoulder = teleported ? wantShoulder : smoothTo(s.shoulder, wantShoulder, wantShoulder < s.shoulder ? SIDE_IN_RATE : SIDE_OUT_RATE, i.dt);
  const pivot = add(i.head, i.right, s.shoulder);

  // Distance behind the pivot: centre direction plus a little to the left and right (anticipation).
  const back: Vec3 = [-i.dir[0], -i.dir[1], -i.dir[2]];
  const T = CAM_TUNING;
  let free = thickCast(pivot, back, i.maxDist + CAM_RADIUS, CAM_RADIUS, i.solid);
  const ahead = Math.max(-T.anticipate, Math.min(T.anticipate, s.yawRate * T.lookAhead));
  if (Math.abs(ahead) > 0.03) {
    // Where the camera will be shortly if the turn continues (same rotation as the yaw).
    for (const a of [ahead, ahead / 2]) {
      const c = Math.cos(a), sn = Math.sin(a);
      const future: Vec3 = [back[0] * c + back[2] * sn, back[1], -back[0] * sn + back[2] * c];
      free = Math.min(free, thickCast(pivot, future, i.maxDist + CAM_RADIUS, CAM_RADIUS, i.solid));
    }
  }
  const wanted = Math.max(MIN_DIST, Math.min(i.maxDist, free - CAM_RADIUS));
  if (wanted <= s.dist + 0.02) s.clearAt = i.t;
  if (teleported) s.dist = wanted;
  else if (wanted < s.dist) s.dist = Math.max(smoothTo(s.dist, wanted, T.pullInRate, i.dt), s.dist - T.maxInSpeed * i.dt);
  else if (i.t - s.clearAt > T.easeOutDelay) s.dist = smoothTo(s.dist, wanted, T.easeOutRate, i.dt);
  s.dist = Math.min(s.dist, i.maxDist);

  // Never inside a block: come toward the player by the smallest step that frees the camera.
  const inside = (d: number) => {
    const p = add(pivot, back, d);
    return cellSolid(i.solid, p) || cellSolid(i.solid, [p[0], p[1] + 0.12, p[2]]) || cellSolid(i.solid, [p[0], p[1] - 0.12, p[2]]);
  };
  while (s.dist > MIN_DIST && inside(s.dist)) s.dist -= 0.05;
  s.dist = Math.max(MIN_DIST, s.dist);
  return add(pivot, back, s.dist);
}
