import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { tokenBookmarklet } from '../src/net/bookmarklet';

const GAME = 'https://jolly-panda-works.github.io/jp-block-sandbox/';

/** Runs the bookmark the way a browser would, on a fake page. */
async function click(pathname: string, response: { status: number; body: unknown }) {
  const opened: { location: { href: string }; closed: boolean } = { location: { href: '' }, closed: false };
  const alerts: string[] = [];
  const requests: { url: string; init: any }[] = [];
  const ctx = {
    location: { pathname, href: `https://gameserver.rastar.ir${pathname}` },
    window: { open: () => opened },
    alert: (m: string) => alerts.push(m),
    fetch: async (url: string, init: any) => { requests.push({ url, init }); return { ok: response.status < 400, status: response.status, json: async () => response.body }; },
    URL, JSON, encodeURIComponent,
  };
  (opened as any).close = () => { opened.closed = true; };
  const code = decodeURIComponent(tokenBookmarklet('blocksy', GAME).slice('javascript:'.length));
  await vm.runInNewContext(code, ctx);
  await new Promise((r) => setTimeout(r, 10));
  return { opened, alerts, requests };
}

test('bookmark in the dashboard: requests a playground token and opens the game with it', async () => {
  const { opened, requests, alerts } = await click('/dashboard/games/blocksy', {
    status: 200, body: { jwt: 'aaa.bbb.ccc', multiplayerId: '11111111-2222-4333-8444-555555555555', wsUrl: 'wss://gameserver.rastar.ir' },
  });
  assert.equal(alerts.length, 0);
  assert.equal(requests[0].url, '/dashboard/api/playground/token');
  assert.equal(requests[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].init.body), { gameKey: 'blocksy' });
  const u = new URL(opened.location.href);
  assert.equal(`${u.origin}${u.pathname}`, GAME);
  assert.equal(u.searchParams.get('jwt'), 'aaa.bbb.ccc');
  assert.equal(u.searchParams.get('room'), '11111111-2222-4333-8444-555555555555');
});

test('bookmark accepts the { data: { token } } shape too', async () => {
  const { opened } = await click('/dashboard', { status: 200, body: { code: 0, data: { token: 'x.y.z' } } });
  assert.equal(new URL(opened.location.href).searchParams.get('jwt'), 'x.y.z');
});

test('bookmark on the wrong page, or when not signed in: explains instead of failing silently', async () => {
  const wrong = await click('/jp-block-sandbox/', { status: 200, body: {} });
  assert.match(wrong.alerts[0], /Open the Rastaar dashboard/);
  assert.equal(wrong.requests.length, 0);
  assert.ok(wrong.opened.closed, 'the blank tab is closed again');
  const signedOut = await click('/dashboard', { status: 401, body: { message: 'Not signed in' } });
  assert.match(signedOut.alerts[0], /401.*Not signed in/);
});
