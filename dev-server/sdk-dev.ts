/**
 * LOCAL DEVELOPMENT stand-in for @rastaar/game-sdk (same function names and shapes as the platform docs).
 * It is NOT the real SDK: tokens are not verified and results are only logged.
 * The tsconfig "paths" entry maps `@rastaar/game-sdk` to this file, so game/index.ts runs unchanged.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as colyseusNs from 'colyseus';
import type { Client as ColyseusClient, Delayed as ColyseusDelayed } from 'colyseus';

// Colyseus may be loaded as CommonJS; take the classes from `.default` when needed.
const colyseus = ((colyseusNs as unknown as { default?: typeof colyseusNs }).default ?? colyseusNs) as typeof colyseusNs;

export const Room = colyseus.Room;
export type Client = ColyseusClient;
export type Delayed = ColyseusDelayed;

/** Local tokens look like "dev:<browser id>". Anything else is refused, like a bad token on the platform. */
export async function authorizeJoin(options: Record<string, unknown>): Promise<{ userId: string; multiplayerId: string }> {
  const jwt = typeof options?.jwt === 'string' ? options.jwt : '';
  const m = /^dev:([A-Za-z0-9-]{4,64})$/.exec(jwt);
  if (!m) throw new Error('Local dev server: expected a "dev:<id>" token (run the client with npm run dev).');
  const multiplayerId = typeof options.multiplayerId === 'string' && options.multiplayerId ? options.multiplayerId : 'public';
  return { userId: `dev-${m[1]}`, multiplayerId };
}

export async function fetchRoomConfig(_multiplayerId: string, _roomName: string) {
  return { minPlayers: 1, maxPlayers: 8, countdownMs: 0, durationMs: 0 };
}

/** Custom settings: dev-server/settings.json (same JSON as the dashboard's Custom settings box). */
export function getGameSettings<T>(_roomName: string): Partial<T> {
  try {
    return existsSync('settings.json') ? (JSON.parse(readFileSync('settings.json', 'utf8')) as Partial<T>) : {};
  } catch (err) {
    console.warn('[dev-sdk] settings.json is not valid JSON, using defaults', err);
    return {};
  }
}

export async function postMatchResult(result: unknown): Promise<'skipped'> {
  console.log('[dev-sdk] match result (not sent anywhere):', JSON.stringify(result));
  return 'skipped';
}

export const isPlaygroundMatch = (_multiplayerId: string): boolean => true;

export function sanitizeUsername(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
  return s || 'Player';
}

export function sanitizeAvatarUrl(raw: unknown): string {
  return typeof raw === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(raw) ? raw : '';
}
