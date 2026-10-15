import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAM_TUNING, newCameraRig, solveCamera, type SolidFn } from '../src/game/cameraRig';

const dt = 1 / 60;
const run = (rig: any, solid: SolidFn, frames: number, yawFn: (f: number) => number, t0 = 0) => {
  const out: number[] = [];
  for (let f = 0; f < frames; f++) {
    const yaw = yawFn(f);
    const dir: [number, number, number] = [Math.sin(yaw), 0, Math.cos(yaw)];
    const right: [number, number, number] = [-Math.cos(yaw), 0, Math.sin(yaw)];
    solveCamera(rig, { head: [0.5, 1.5, 0.5], dir, right, solid, maxDist: 4, shoulder: 0.5, dt, t: t0 + f * dt });
    out.push(rig.dist);
  }
  return out;
};
const maxStep = (xs: number[]) => xs.slice(1).reduce((m, x, i) => Math.max(m, Math.abs(x - xs[i])), 0);

test('open space: camera stays at full distance', () => {
  const r = newCameraRig(4, 0.5);
  const d = run(r, () => false, 60, () => 0);
  assert.ok(Math.abs(d.at(-1)! - 4) < 1e-6);
});

test('a wall appearing behind: pulled in quickly but without a one-frame jump, and never inside the wall', () => {
  const r = newCameraRig(4, 0.5);
  run(r, () => false, 10, () => 0);                       // settle at 4 m, facing +z
  const wall: SolidFn = (_x, _y, z) => z === -2;           // wall 2 m behind
  const d = run(r, wall, 40, () => 0, 1);
  assert.ok(d[0] < 4 && d[0] > 2, `first frame moves part of the way (${d[0].toFixed(2)})`);
  assert.ok(d.at(-1)! < 2.6, `ends in front of the wall (${d.at(-1)!.toFixed(2)})`);
  const cam = [0.5 + 0.5 * -1, 1.5, 0.5 - d.at(-1)!];
  assert.ok(!wall(Math.floor(cam[0]), Math.floor(cam[1]), Math.floor(cam[2])), 'not inside the wall');
});

test('turning past a block edge: no flicker (the old single ray jumped between ~0.7 m and 4 m)', () => {
  const r = newCameraRig(4, 0.5);
  const post: SolidFn = (x, y, z) => x === -1 && z === -3 && y >= 0 && y <= 3; // a single pillar right behind the view edge
  run(r, post, 30, () => 0.32);
  const d = run(r, post, 180, (f) => 0.32 + Math.sin(f * 0.25) * 0.06, 0.5);  // jitter the view around the edge
  assert.ok(maxStep(d) < 0.35, `largest change per frame ${maxStep(d).toFixed(2)} m`);
});

test('obstacle gone: eases back out slowly after a short pause', () => {
  const r = newCameraRig(4, 0.5);
  const wall: SolidFn = (_x, _y, z) => z === -2;
  run(r, wall, 60, () => 0);
  const near = r.dist;
  const d = run(r, () => false, 120, () => 0, 1);
  assert.ok(Math.abs(d[5] - near) < 1e-6, 'waits ~0.25 s before easing out');
  assert.ok(maxStep(d) < 0.12, 'gentle');
  assert.ok(d.at(-1)! > 3.5, 'back to (almost) full distance after 2 s');
});

test('teleport: snaps (no long slide across the island)', () => {
  const r = newCameraRig(4, 0.5);
  run(r, () => false, 5, () => 0);
  const wall: SolidFn = (_x, _y, z) => z === 100 - 2;
  for (let f = 0; f < 1; f++) solveCamera(r, { head: [0.5, 1.5, 100.5], dir: [0, 0, 1], right: [-1, 0, 0], solid: wall, maxDist: 4, shoulder: 0.5, dt, t: 5 });
  assert.ok(r.dist < 2.6, 'jumps straight to the free distance after a teleport');
});

test('report: new vs old jump size at the pillar edge', () => {
  const r = newCameraRig(4, 0.5);
  const post: SolidFn = (x, y, z) => x === -1 && z === -3 && y >= 0 && y <= 3;
  run(r, post, 30, () => 0.32);
  const d = run(r, post, 180, (f) => 0.32 + Math.sin(f * 0.25) * 0.06, 0.5);
  console.log(`NEW max jump per frame: ${maxStep(d).toFixed(2)} m`);
});

test('turning near walls, corners and thin posts: no camera jumps at any turning speed, never inside a block', () => {
  type Solid = (x: number, y: number, z: number) => boolean;
  const scenes: Solid[] = [
    (x, y) => x === -2 && y >= 0 && y <= 5,
    (x, y, z) => x === 0 && z === -3 && y >= 0 && y <= 5,
    (x, y, z) => (x === -2 || z === -2) && y >= 0 && y <= 5,
  ];
  for (const speed of [Math.PI / 3, (2 * Math.PI) / 3, 1.5 * Math.PI, -(2 * Math.PI) / 3]) for (const solid of scenes) {
    const r = newCameraRig(4, 0.5);
    let prev = -1, turned = 0;
    for (let f = 0; f < 480; f++) {
      turned += speed * Math.min(1, (f * dt) / 0.2) * dt;   // a real turn builds up over ~0.2 s
      const yaw = turned + Math.sin(f * 0.3) * 0.03;
      const cam = solveCamera(r, { head: [0.5, 1.5, 0.5], dir: [Math.sin(yaw) * 0.94, -0.34, Math.cos(yaw) * 0.94], right: [-Math.cos(yaw), 0, Math.sin(yaw)], solid, maxDist: 4, shoulder: 0.5, dt, t: f * dt });
      if (prev >= 0) assert.ok(Math.abs(r.dist - prev) <= 0.2, `jump of ${Math.abs(r.dist - prev).toFixed(2)} m in one frame`);
      prev = r.dist;
      assert.ok(!solid(Math.floor(cam[0]), Math.floor(cam[1]), Math.floor(cam[2])), 'camera inside a block');
    }
  }
});

test('nothing behind the camera: things BESIDE the player never move it (standing still or walking)', () => {
  const look = (r: ReturnType<typeof newCameraRig>, solid: SolidFn, head: (f: number) => [number, number, number]) => {
    let min = 4;
    for (let f = 0; f < 240; f++) {
      const yaw = Math.sin(f * 0.3) * 0.01;   // hand resting on the mouse
      solveCamera(r, { head: head(f), dir: [Math.sin(yaw) * 0.94, -0.34, Math.cos(yaw) * 0.94], right: [-Math.cos(yaw), 0, Math.sin(yaw)], solid, maxDist: 4, shoulder: 0.5, dt, t: f * dt });
      if (f > 20) min = Math.min(min, r.dist);
    }
    return min;
  };
  // every single post around the player that is NOT on the line behind it
  let checked = 0;
  for (let px = -5; px <= 5; px++) for (let pz = -6; pz <= 1; pz++) {
    const post: SolidFn = (x, y, z) => x === px && z === pz && y >= 0 && y <= 5;
    const saved = CAM_TUNING.anticipate; CAM_TUNING.anticipate = 0;
    const behind = look(newCameraRig(4, 0.5), post, () => [0.5, 1.5, 0.5]) < 3.99;
    CAM_TUNING.anticipate = saved;
    if (behind) continue;
    checked++;
    assert.ok(look(newCameraRig(4, 0.5), post, () => [0.5, 1.5, 0.5]) > 3.99, `a post at (${px}, ${pz}) beside the player moved the camera`);
  }
  assert.ok(checked > 50);
  // walking past a row of trees on the side
  const trees: SolidFn = (x, y, z) => x === 3 && z % 3 === 0 && y >= 0 && y <= 5;
  assert.ok(look(newCameraRig(4, 0.5), trees, (f) => [0.5, 1.5, 0.5 + f * dt * 4.3]) > 3.99, 'walking past trees');
});
