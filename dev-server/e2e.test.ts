import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handle } from './mockBackend';
import { authorizeJoin, fetchRoomConfig } from './sdk-dev';

test('mock backend: guest sign-in (same device = same user), rename, rooms, token, full room', async () => {
  const counts = new Map<string, number>();
  const srv = createServer((req, res) => { void handle(req, res, async (id) => counts.get(id) ?? 0); }).listen(0);
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const j = async (method: string, path: string, body?: object, token?: string) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) as any };
  };
  try {
    assert.equal((await j('POST', '/api/v1/auth/guest', { name: 'x' })).status, 400, 'device id required');
    const g1 = await j('POST', '/api/v1/auth/guest', { deviceId: 'device-aaaa', name: 'Ali' });
    const token = g1.body.data.accessToken;
    assert.equal(g1.body.data.user.username, 'Ali');
    const g2 = await j('POST', '/api/v1/auth/guest', { deviceId: 'device-aaaa', name: '' });
    assert.equal(g2.body.data.user.id, g1.body.data.user.id, 'same device → same player');
    assert.equal(g2.body.data.user.username, 'Ali', 'name kept');
    await j('PATCH', '/api/v1/client/me', { username: 'Ali R' }, token);
    assert.equal((await j('GET', '/api/v1/client/me', undefined, token)).body.data.username, 'Ali R', 'rename from Settings');

    const solo = await j('POST', '/api/v1/client/multiplayer/games/blocksy/matches', { name: 'Solo', maxPlayers: 1, settings: { animals: ['cat'] } }, token);
    assert.equal(solo.body.data.maxPlayers, 1, 'a one-player room is allowed');
    assert.deepEqual(solo.body.data.settings, { animals: ['cat'] }, 'settings are stored and echoed');
    const c = await j('POST', '/api/v1/client/multiplayer/games/blocksy/matches', { name: 'Ali island', maxPlayers: 2 }, token);
    const id = c.body.data.id;
    const t = await j('POST', '/api/v1/client/realtime/token', { multiplayerId: id }, token);
    const auth = await authorizeJoin({ jwt: t.body.data.jwt, multiplayerId: id });
    assert.equal(auth.multiplayerId, id);
    assert.equal((await fetchRoomConfig(id, 'blocksy')).maxPlayers, 2);
    counts.set(id, 2);
    assert.equal((await j('POST', '/api/v1/client/realtime/token', { multiplayerId: id }, token)).status, 403, 'full room');
  } finally {
    srv.close();
  }
});
