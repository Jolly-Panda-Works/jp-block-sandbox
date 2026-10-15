/**
 * LOCAL DEVELOPMENT stand-in for @rastaar/game-sdk (same function names and shapes as the platform docs).
 * It is NOT the real SDK: tokens are not verified and results are only logged.
 * The tsconfig "paths" entry maps `@rastaar/game-sdk` to this file, so game/index.ts runs unchanged.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as colyseusNs from 'colyseus';
import type { Client as ColyseusClient, Delayed as ColyseusDelayed } from 'colyseus';
import { matches } from './mockBackend';

// Colyseus may be loaded as CommonJS; take the classes from `.default` when needed.
const colyseus = ((colyseusNs as unknown as { default?: typeof colyseusNs }).default ?? colyseusNs) as typeof colyseusNs;

export const Room = colyseus.Room;
export type Client = ColyseusClient;
export type Delayed = ColyseusDelayed;

/** Local tokens look like "dev:<userId>:<matchId>" (issued by mockBackend.ts). Anything else is refused. */
export async function authorizeJoin(options: Record<string, unknown>): Promise<{ userId: string; multiplayerId: string }> {
  const jwt = typeof options?.jwt === 'string' ? options.jwt : '';
  const m = /^dev:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(jwt);
  if (!m) throw new Error('jwt malformed');
  if (options.multiplayerId !== m[2]) throw new Error('multiplayerId does not match the token');
  return { userId: m[1], multiplayerId: m[2] };
}

export async function fetchRoomConfig(multiplayerId: string, _roomName: string) {
  const match = matches.get(multiplayerId);
  return { minPlayers: 1, maxPlayers: match?.maxPlayers ?? 8, countdownMs: 0, durationMs: 0 };
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
