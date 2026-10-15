import { test } from 'node:test';
import assert from 'node:assert/strict';
(globalThis as any).location = new URL('https://jolly-panda-works.github.io/jp-block-sandbox/');
(globalThis as any).history = { replaceState() {} };
const { trustedUrl } = await import('../src/net/config');

test('only trusted servers can be set from the address bar', () => {
  const ws = 'wss://gameserver.rastar.ir';
  assert.equal(trustedUrl('wss://gameserver.rastar.ir', ws, ['wss:']), 'wss://gameserver.rastar.ir');
  assert.equal(trustedUrl('wss://evil.example.com', ws, ['wss:']), ws, 'unknown host → ignored');
  assert.equal(trustedUrl('https://api.rastar.ir', '', ['https:']), 'https://api.rastar.ir');
  assert.equal(trustedUrl('https://rastar.ir.evil.com', '', ['https:']), '', 'look-alike host → ignored');
  assert.equal(trustedUrl('javascript:alert(1)', ws, ['wss:']), ws);
  assert.equal(trustedUrl('ws://localhost:2567', ws, ['wss:', 'ws:']), 'ws://localhost:2567');
  assert.equal(trustedUrl(null, ws, ['wss:']), ws);
});
