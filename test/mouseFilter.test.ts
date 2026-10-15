import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMouse, mouseLockChanged, newMouseFilter } from '../src/game/mouseFilter';

test('mouse filter: drops lone spikes and the jump on locking; keeps real (even fast) movement', () => {
  const f = newMouseFilter();
  mouseLockChanged(f, 0);
  assert.deepEqual(filterMouse(f, 400, 0, 20), [0, 0], 'jump right after locking');
  let t = 100;
  for (let i = 0; i < 20; i++) assert.deepEqual(filterMouse(f, 8, -3, (t += 8)), [8, -3], 'normal orbiting');
  assert.deepEqual(filterMouse(f, 900, -12, (t += 8)), [0, 0], 'a lone bogus spike is dropped');
  assert.deepEqual(filterMouse(f, 9, -2, (t += 8)), [9, -2], 'movement continues');
  // a real fast flick builds up: 20 → 60 → 140 → 260 → 380 px per event
  for (const dx of [20, 60, 140, 260, 380]) assert.deepEqual(filterMouse(f, dx, 0, (t += 8)), [dx, 0], `fast flick ${dx}`);
  // small numbers are never filtered, however sudden
  const g = newMouseFilter();
  assert.deepEqual(filterMouse(g, 150, 0, 1000), [150, 0]);
});
