import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBoxArrays } from '../src/render/mergeBoxes';

test('merged animal body: one geometry, correct size, rotation and colours', () => {
  const d = mergeBoxArrays([
    { p: [0, 1, 0], s: [2, 1, 4], color: [1, 0, 0] },
    { p: [0, 0, -2], s: [0.2, 1, 0.2], rx: Math.PI / 2, color: [0, 0, 1] },    // a tail turned 90°
  ]);
  assert.equal(d.positions.length / 3, 48, '24 vertices per box');
  assert.equal(d.indices.length, 72, '12 triangles per box');
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let i = 0; i < 24; i++) { xs.push(d.positions[i * 3]); ys.push(d.positions[i * 3 + 1]); zs.push(d.positions[i * 3 + 2]); }
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)], [-1, 1, 0.5, 1.5, -2, 2]);
  // the rotated box is now 1 m long along z (its height became depth)
  const z2: number[] = [];
  for (let i = 24; i < 48; i++) z2.push(d.positions[i * 3 + 2]);
  assert.ok(Math.abs(Math.max(...z2) - Math.min(...z2) - 1) < 1e-6);
  assert.deepEqual([...d.colors.slice(0, 3)], [1, 0, 0]);
  assert.deepEqual([...d.colors.slice(24 * 3, 24 * 3 + 3)], [0, 0, 1]);
  for (let i = 0; i < d.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(d.normals[i], d.normals[i + 1], d.normals[i + 2]) - 1) < 1e-6, 'unit normals');
  // triangles face outward (counter-clockwise from outside): check the +x face of the first box
  const v = (k: number) => [d.positions[k * 3], d.positions[k * 3 + 1], d.positions[k * 3 + 2]];
  const [a, b, c] = [v(d.indices[0]), v(d.indices[1]), v(d.indices[2])];
  const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  assert.ok(n[0] > 0, 'winding matches the face normal');
});
