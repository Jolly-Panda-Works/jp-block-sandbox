/**
 * Settings the creator of a room chooses in the lobby. They are stored with the room (match) on the
 * backend, sent by every client when joining, and applied by the game server when it creates the room
 * (over the game-wide Custom settings from the dashboard). Everything is clamped here and again on the server.
 */
import { ANIMAL_KINDS, type AnimalKind } from './animals';

export interface RoomSettings {
  animals: AnimalKind[];
  animalsPerKind: number;
  ambientBots: number;
  /** Seconds before a bot comes to play an unanswered invite; 0 = never. */
  botJoinAfterSec: number;
  /** Length of a full day in minutes; 0 = time stands still. */
  dayLengthMin: number;
  startHour: number;
  /** Used only when the backend gives the match no duration. 0 = until everyone leaves. */
  sessionMinutes: number;
  chatEnabled: boolean;
  worldSeed: number;
  inviteAcceptDelaySec: number;
  rpsPickSec: number;
  rpsBestOf: number;
  tttTurnSec: number;
  chessTurnSec: number;
  ludoTurnSec: number;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  animals: [...ANIMAL_KINDS], animalsPerKind: 2, ambientBots: 4, botJoinAfterSec: 5,
  dayLengthMin: 20, startHour: 8, sessionMinutes: 0, chatEnabled: true, worldSeed: 1337,
  inviteAcceptDelaySec: 5, rpsPickSec: 3, rpsBestOf: 3, tttTurnSec: 15, chessTurnSec: 60, ludoTurnSec: 10,
};

/** [min, max] per numeric setting. */
export const ROOM_SETTING_LIMITS: Record<Exclude<keyof RoomSettings, 'animals' | 'chatEnabled'>, [number, number]> = {
  animalsPerKind: [1, 6], ambientBots: [0, 8], botJoinAfterSec: [0, 120], dayLengthMin: [0, 120], startHour: [0, 23],
  sessionMinutes: [0, 240], worldSeed: [1, 2_147_483_647], inviteAcceptDelaySec: [0, 60], rpsPickSec: [2, 15],
  rpsBestOf: [1, 9], tttTurnSec: [5, 120], chessTurnSec: [10, 600], ludoTurnSec: [3, 60],
};

/** Keeps only known keys with valid values (unknown or invalid values are dropped, not defaulted). */
export function sanitizeRoomSettings(raw: unknown): Partial<RoomSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Partial<RoomSettings> = {};
  if (Array.isArray(o.animals)) out.animals = ANIMAL_KINDS.filter((k) => (o.animals as unknown[]).includes(k));
  if (typeof o.chatEnabled === 'boolean') out.chatEnabled = o.chatEnabled;
  for (const [key, [min, max]] of Object.entries(ROOM_SETTING_LIMITS) as [keyof typeof ROOM_SETTING_LIMITS, [number, number]][]) {
    const v = o[key];
    if (typeof v === 'number' && Number.isFinite(v)) (out as Record<string, number>)[key] = Math.min(max, Math.max(min, Math.round(v)));
  }
  return out;
}
