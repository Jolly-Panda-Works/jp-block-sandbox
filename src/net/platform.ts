/**
 * Rastaar backend adapter for direct sign-in from the site. EVERY backend call made by the game is in
 * this file (plus the realtime token request in api.ts). Paths are configurable through env variables;
 * responses are parsed leniently ({ code, data } envelopes, common field-name variants).
 * The contract the backend must offer is documented in docs/BACKEND-API.md.
 */
import { config } from './config';

const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
const GAME = env.VITE_ROOM_NAME || 'blocksy';
const paths = {
  guest: env.VITE_AUTH_GUEST_PATH || '/api/v1/auth/guest',
  me: env.VITE_ME_PATH || '/api/v1/client/me',
  rooms: (env.VITE_ROOMS_PATH || '/api/v1/client/multiplayer/games/{game}/matches').replace('{game}', encodeURIComponent(GAME)),
  room: env.VITE_ROOM_PATH || '/api/v1/client/multiplayer/matches/{id}',
};

/** A room = a backend match of this game. */
export interface RoomInfo { id: string; name: string; maxPlayers: number; playerCount: number }
export interface UserInfo { id: string; name: string }

export const MAX_ROOM_PLAYERS = 8;
const TOKEN_KEY = 'blocksy.authToken';

/** Stable random id of this browser (the guest account). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('blocksy.deviceId');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, '');
      localStorage.setItem('blocksy.deviceId', id);
    }
    return id;
  } catch {
    return `${Date.now()}`;
  }
}

export const authToken = {
  get(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t: string): void { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear(): void { try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  if (!config.apiBaseUrl) throw new ApiError('The game is not connected to the Rastaar backend (VITE_API_BASE_URL is empty).', 0);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = authToken.get();
  if (config.apiAuth === 'bearer' && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers,
      credentials: config.apiAuth === 'cookie' ? 'include' : 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(`Could not reach the Rastaar backend (${config.apiBaseUrl}).`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) { authToken.clear(); throw new ApiError('Please sign in again.', 401); }
  if (!res.ok) throw new ApiError(messageOf(json) || `Backend error ${res.status}.`, res.status);
  return unwrap(json) as T;
}

const unwrap = (b: Record<string, unknown>): unknown => (b && typeof b === 'object' && 'data' in b ? b.data : b);
const messageOf = (b: Record<string, unknown>): string => {
  const m = b?.message ?? b?.error ?? (b?.data as Record<string, unknown> | undefined)?.message;
  return typeof m === 'string' ? m : '';
};
const str = (...v: unknown[]) => { for (const x of v) if (typeof x === 'string' && x) return x; return ''; };
const num = (...v: unknown[]) => { for (const x of v) if (typeof x === 'number' && Number.isFinite(x)) return x; return NaN; };

function toRoom(raw: unknown): RoomInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, o.multiplayerId, o.uuid, o.matchId);
  if (!id) return null;
  const players = Array.isArray(o.players) ? o.players.length : NaN;
  const max = num(o.maxPlayers, o.playerMax, o.capacity);
  const count = num(o.playerCount, o.currentPlayers, o.connected, o.clients, players);
  return {
    id,
    name: str(o.name, o.title) || 'Blocksy room',
    maxPlayers: Math.max(1, Math.min(MAX_ROOM_PLAYERS, Number.isNaN(max) ? MAX_ROOM_PLAYERS : max)),
    playerCount: Math.max(0, Number.isNaN(count) ? 0 : count),
  };
}

function toList(raw: unknown): RoomInfo[] {
  const o = raw as Record<string, unknown> | unknown[];
  const arr = Array.isArray(o) ? o : (o?.items ?? o?.matches ?? o?.rooms ?? o?.results ?? []) as unknown[];
  return (Array.isArray(arr) ? arr : []).map(toRoom).filter((r): r is RoomInfo => !!r);
}

export const isFull = (r: RoomInfo): boolean => r.playerCount >= r.maxPlayers;

export const platform = {
  /** True if the site is configured to talk to the backend. */
  configured: (): boolean => !!config.apiBaseUrl,
  /** True if we hold a session (bearer) or may hold one (cookie: checked with me()). */
  hasSession: (): boolean => config.apiAuth === 'cookie' || !!authToken.get(),

  /**
   * Guest sign-in: no phone number or password. The device keeps a random id, so the same browser is
   * always the same player; the display name is chosen by the player.
   */
  async signInGuest(name: string): Promise<UserInfo | null> {
    const r = (await call<Record<string, unknown>>('POST', paths.guest, { deviceId: deviceId(), name })) ?? {};
    const token = str(r.accessToken, r.token, r.access_token, (r.tokens as Record<string, unknown> | undefined)?.accessToken);
    if (token) authToken.set(token);
    else if (config.apiAuth === 'bearer') throw new ApiError('Sign-in succeeded but no access token was returned.', 0);
    return toUser(r.user ?? r);
  },

  /** Saves the display name on the backend (best effort). */
  async updateName(name: string): Promise<void> {
    await call('PATCH', paths.me, { username: name });
  },

  async me(): Promise<UserInfo | null> {
    return toUser(await call('GET', paths.me));
  },

  signOut(): void { authToken.clear(); },

  async listRooms(): Promise<RoomInfo[]> {
    return toList(await call('GET', paths.rooms));
  },

  async getRoom(id: string): Promise<RoomInfo | null> {
    try {
      return toRoom(await call('GET', paths.room.replace('{id}', encodeURIComponent(id))));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },

  async createRoom(name: string, maxPlayers: number): Promise<RoomInfo> {
    const r = toRoom(await call('POST', paths.rooms, { name, maxPlayers: Math.max(2, Math.min(MAX_ROOM_PLAYERS, Math.round(maxPlayers))) }));
    if (!r) throw new ApiError('The backend did not return the new room.', 0);
    return r;
  },
};

function toUser(raw: unknown): UserInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id, o.userId, o.uuid);
  return id ? { id, name: str(o.username, o.name, o.displayName, o.nickname) } : null;
}
