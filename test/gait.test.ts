import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEG_REACH, WALK_SPEED, gaitFor } from '../src/render/animState';

test('walk cycle keeps the feet planted at every speed; stops when standing', () => {
  assert.deepEqual(gaitFor(0), { swing: 0, phaseRate: 0 }, 'no leg movement when not moving');
  let lastRate = 0, lastSwing = 0;
  for (const ratio of [0.1, 0.25, 0.37, 0.6, 1, 1.4]) {          // 0.37 = a bot strolling at 1.6 m/s
    const g = gaitFor(ratio);
    const bodyPerHalfCycle = (ratio * WALK_SPEED * Math.PI) / g.phaseRate;
    const footPerHalfCycle = Math.max(0.25, 2 * LEG_REACH * Math.sin(g.swing));
    assert.ok(Math.abs(bodyPerHalfCycle - footPerHalfCycle) < 1e-9, `feet slide at ${ratio}`);
    assert.ok(g.phaseRate > lastRate && g.swing >= lastSwing, 'faster = quicker and longer steps');
    lastRate = g.phaseRate; lastSwing = g.swing;
  }
  assert.ok(gaitFor(0.37).swing > 0.35, 'a slow stroll still swings the legs visibly (was 0.24)');
});
