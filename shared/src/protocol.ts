import type { Appearance } from './avatar';
import type { ProfileData, PurchaseResult, ToolKind } from './economy';
import type { IslandLayout } from './island';
import type { EmojiId, EmoteId } from './social';
import type { PlacementResult, RemovalResult } from './placement';
import type { MiniGameKind, MiniGameMove } from './minigames';

/**
 * Options for `client.joinOrCreate(ROOM_NAME, options)`.
 * `jwt` comes from the platform backend (POST /client/realtime/token { multiplayerId }) and is verified
 * by the game server. Players with the same `multiplayerId` share a room.
 */
export interface JoinOptions {
  jwt?: string;
  multiplayerId: string;
  username: string;
  /** Anonymous id used only when the server runs without JWT verification (local development). */
  profileId?: string;
  protocolVersion: number;
}

/** Per-player transform sent in every `state` message. */
export interface PlayerSnapshot {
  id: string;
  x: number; y: number; z: number; yaw: number;
  speed: number; grounded: boolean;
  held: number; tool: ToolKind;
  /** Incremented on every place/remove so others can play the arm swing. */
  action: number;
}

/** Rarely-changing player data, sent on join and when it changes. */
export interface PlayerMeta { id: string; name: string; appearance: Appearance }

/** Client → server messages. */
export interface ClientMessages {
  move: { x: number; y: number; z: number; yaw: number; speed: number; grounded: boolean };
  place: { x: number; y: number; z: number; id: number };
  remove: { x: number; y: number; z: number };
  buy: { id: number };
  hotbar: { slots: number[]; selected: number; tool: ToolKind };
  appearance: Appearance;
  chat: { text: string };
  emoji: { id: EmojiId };
  emote: { id: EmoteId };
  mgInvite: { kind: MiniGameKind };
  mgCancel: Record<string, never>;
  mgAccept: { hostId: string };
  mgStart: Record<string, never>;
  mgMove: { move: MiniGameMove };
  mgLeave: Record<string, never>;
  mgSpectate: { gameId: string };
  rename: { name: string };
  /** Start a 2-player game against a bot, or (Ludo) open a table and seat a bot. */
  mgBot: { kind: MiniGameKind };
  /** Ludo host: seat another bot at the table. */
  mgAddBot: Record<string, never>;
  /** Play with a Game Center character. */
  mgNpc: { npcId: string };
}

/** Server → client messages. */
export interface ServerMessages {
  /** Join snapshot: RLE-encoded grid + protection mask, layout, your profile and everyone's meta. */
  init: {
    protocolVersion: number;
    you: string;
    size: [number, number, number];
    cells: number[];
    protectedCells: number[];
    layout: IslandLayout;
    profile: ProfileData;
    spawn: { x: number; y: number; z: number; yaw: number };
    players: PlayerMeta[];
  };
  /** Broadcast at ~15 Hz: transforms of every player in the room (including you). */
  state: { t: number; players: PlayerSnapshot[] };
  playerMeta: PlayerMeta;
  playerLeft: { id: string };
  blockSet: { x: number; y: number; z: number; id: number };
  /** Sent only to the editing client when an edit was refused (includes the cell's real id). */
  editRejected: { x: number; y: number; z: number; id: number; reason: PlacementResult | RemovalResult };
  profile: { profile: ProfileData; result?: PurchaseResult };
  chat: { sessionId: string; text: string };
  emoji: { sessionId: string; id: EmojiId };
  emote: { sessionId: string; id: EmoteId };
  teleport: { x: number; y: number; z: number };
}
