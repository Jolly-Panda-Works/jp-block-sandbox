import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockGrid, blockId } from '../shared/src/index';
import { world } from '../src/game/world';
import * as P from '../src/render/particleFx';

const grid = new BlockGrid(16, 16, 16);
for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) grid.set(x, 4, z, blockId('grass'));
(world as any).grid = grid;
const reset = () => { P.lit.length = 0; P.glow.length = 0; P.fx.enabled = true; P.fx.density = 1; };
const run = (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) { P.stepParticles(P.lit, null, 1 / 60, t); P.stepParticles(P.glow, null, 1 / 60, t); } };

test('footsteps take the colour of the ground; nothing in the air', () => {
  reset();
  P.footstep(5.5, 5, 5.5);
  assert.ok(P.lit.length >= 2);
  const c = P.lit[0];
  assert.ok(c.g > c.b, 'grass-coloured (greenish)');
  reset();
  P.footstep(5.5, 9, 5.5);
  assert.equal(P.lit.length, 0, 'no ground under the feet');
});

test('landing dust grows with the impact; broken block chunks fall and disappear', () => {
  reset(); P.land(5.5, 5, 5.5, 0); const soft = P.lit.length;
  reset(); P.land(5.5, 5, 5.5, 1); assert.ok(P.lit.length > soft * 1.5, 'harder landing → more dust');
  reset();
  P.blockBreak(3, 5, 3, blockId('stone'));
  assert.equal(P.lit.length, 16);
  const y0 = P.lit.map((p) => p.y);
  run(0.4);
  assert.ok(P.lit.some((p, i) => p.y < y0[i]), 'chunks fall');
  run(1.0);
  assert.equal(P.lit.length, 0, 'all gone after their lifetime');
});

test('celebrations, hearts, splash; pool cap; off switch; fewer on phones', () => {
  reset();
  P.victory(0, 5, 0);
  assert.ok(P.lit.length >= 80 && P.glow.length >= 20, 'confetti + sparkles');
  reset(); P.hearts(0, 5, 0); assert.ok(P.glow.every((p) => p.r > 0.9 && p.vy > 0), 'pink, rising');
  reset(); P.splash(0, 5, 0, true); assert.ok(P.lit.length >= 30);
  reset(); for (let i = 0; i < 200; i++) P.confetti(0, 5, 0, 60); assert.equal(P.lit.length, P.MAX_LIT, 'capped');
  reset(); P.fx.enabled = false; P.victory(0, 5, 0); assert.equal(P.lit.length + P.glow.length, 0, 'switched off');
  reset(); P.fx.density = 0.6; P.confetti(0, 5, 0, 100); assert.equal(P.lit.length, 60, 'phones get 60%');
});
