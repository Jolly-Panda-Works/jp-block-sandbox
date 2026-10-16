import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BlockGrid, blockId } from '../shared/src/index';
import { world } from '../src/game/world';
import { LABEL_RANGE, labelVisible } from '../src/render/labelVisibility';

test('names / bubbles: only up close, never through walls or trees (glass, plants and fences don’t hide them)', () => {
  const g = new BlockGrid(64, 16, 64);
  (world as { grid: BlockGrid | null }).grid = g;
  const cam = new THREE.Vector3(10.5, 3.5, 10.5);
  const at = (x: number, z: number) => new THREE.Vector3(x + 0.5, 3.5, z + 0.5);
  assert.ok(labelVisible(cam, at(10, 20)), 'open view, 9.5 m');
  assert.ok(!labelVisible(cam, at(10, 10 + LABEL_RANGE + 2)), 'too far away');
  for (let y = 0; y < 8; y++) for (let x = 5; x < 16; x++) g.set(x, y, 15, blockId('stone'));
  assert.ok(!labelVisible(cam, at(10, 20)), 'behind a wall');
  for (let y = 0; y < 8; y++) for (let x = 5; x < 16; x++) g.set(x, y, 15, blockId('leaves'));
  assert.ok(!labelVisible(cam, at(10, 20)), 'behind tree leaves');
  for (let y = 0; y < 8; y++) for (let x = 5; x < 16; x++) g.set(x, y, 15, blockId('glass'));
  assert.ok(labelVisible(cam, at(10, 20)), 'through glass: visible');
  for (let y = 0; y < 8; y++) for (let x = 5; x < 16; x++) g.set(x, y, 15, blockId('fence'));
  assert.ok(labelVisible(cam, at(10, 20)), 'over a fence: visible');
});
