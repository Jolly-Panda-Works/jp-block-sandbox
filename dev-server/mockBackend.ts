/**
 * LOCAL DEVELOPMENT mock of the Rastaar backend endpoints the game uses (see docs/BACKEND-API.md).
 * Sign-in: any phone number, code 1234. Data lives in memory. Never deployed.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Match { id: string; name: string; maxPlayers: number; createdBy: string }
interface User { id: string; username: string }

export const matches = new Map<string, Match>();
const sessions = new Map<string, User>();
const PUBLIC_ID = '00000000-0000-4000-8000-000000000001';
matches.set(PUBLIC_ID, { id: PUBLIC_ID, name: 'Sunny Isle (public)', maxPlayers: 8, createdBy: 'system' });

const uuidFrom = (s: string): string => {
  const h = createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const GAME_PREFIX = '/api/v1/client/multiplayer/games/blocksy/matches';
const MATCH_RE = /^\/api\/v1\/client\/multiplayer\/matches\/([0-9a-f-]{36})$/i;

function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status < 400 ? { code: 0, data: body } : { code: status, message: body }));
  return true;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) break;
  }
  try { return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { return {}; }
}

function cors(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

const userOf = (req: IncomingMessage): User | undefined =>
  sessions.get((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));

/** Handles a mock backend route. Returns false for anything else (e.g. Colyseus /matchmake). */
export async function handle(req: IncomingMessage, res: ServerResponse, liveCount: (matchId: string) => Promise<number>): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  if (!url.startsWith('/api/')) return false;
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }

  if (req.method === 'POST' && url === '/api/v1/auth/otp/send') {
    const { phone } = await readJson(req);
    if (typeof phone !== 'string' || !/^\+?\d{8,15}$/.test(phone)) return send(res, 400, 'Enter a valid phone number.');
    console.log(`[mock-backend] OTP for ${phone}: 1234`);
    return send(res, 200, { sent: true });
  }
  if (req.method === 'POST' && url === '/api/v1/auth/otp/verify') {
    const { phone, code } = await readJson(req);
    if (typeof phone !== 'string' || code !== '1234') return send(res, 400, 'Wrong code (the local dev code is 1234).');
    const user = { id: uuidFrom(phone), username: `Player ${phone.slice(-4)}` };
    const accessToken = randomUUID();
    sessions.set(accessToken, user);
    return send(res, 200, { accessToken, user });
  }

  const user = userOf(req);
  if (!user) return send(res, 401, 'Not signed in.');

  if (req.method === 'GET' && url === '/api/v1/client/me') return send(res, 200, user);

  if (url === GAME_PREFIX && req.method === 'GET') {
    const list = await Promise.all([...matches.values()].map(async (m) => ({ ...m, playerCount: await liveCount(m.id) })));
    return send(res, 200, list);
  }
  if (url === GAME_PREFIX && req.method === 'POST') {
    const body = await readJson(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : `${user.username}'s island`;
    const max = typeof body.maxPlayers === 'number' ? Math.max(2, Math.min(8, Math.round(body.maxPlayers))) : 8;
    const m: Match = { id: randomUUID(), name, maxPlayers: max, createdBy: user.id };
    matches.set(m.id, m);
    console.log(`[mock-backend] ${user.username} created room "${name}" (${m.id})`);
    return send(res, 201, { ...m, playerCount: 0 });
  }
  const one = MATCH_RE.exec(url);
  if (one && req.method === 'GET') {
    const m = matches.get(one[1].toLowerCase());
    return m ? send(res, 200, { ...m, playerCount: await liveCount(m.id) }) : send(res, 404, 'No such room.');
  }

  if (req.method === 'POST' && url === '/api/v1/client/realtime/token') {
    const { multiplayerId } = await readJson(req);
    const m = typeof multiplayerId === 'string' ? matches.get(multiplayerId.toLowerCase()) : undefined;
    if (!m) return send(res, 404, 'No such room.');
    if ((await liveCount(m.id)) >= m.maxPlayers) return send(res, 403, 'This room is full.');
    return send(res, 200, { wsUrl: 'ws://localhost:2567', jwt: `dev:${user.id}:${m.id}`, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  }

  return send(res, 404, 'Unknown endpoint.');
}
