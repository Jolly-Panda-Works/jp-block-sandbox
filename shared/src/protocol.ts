import type { Appearance } from './avatar';
import type { ProfileData, PurchaseResult, ToolKind } from './economy';
import type { IslandLayout } from './island';
import type { EmojiId, EmoteId } from './social';
import type { PlacementResult, RemovalResult } from './placement';

/** Options sent with joinOrCreate. */
export interface JoinOptions { name: string; profileId: string }

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
  swing: Record<string, never>;
}

/** Server → client messages. */
export interface ServerMessages {
  /** Join snapshot: RLE-encoded grid + protection mask, island layout and the player's profile. */
  init: { size: [number, number, number]; cells: number[]; protectedCells: number[]; layout: IslandLayout; profile: ProfileData; spawn: { x: number; y: number; z: number; yaw: number } };
  blockSet: { x: number; y: number; z: number; id: number };
  /** Sent only to the editing client when an edit was refused (the cell's real id is included). */
  editRejected: { x: number; y: number; z: number; id: number; reason: PlacementResult | RemovalResult };
  profile: { profile: ProfileData; result?: PurchaseResult };
  chat: { sessionId: string; text: string };
  emoji: { sessionId: string; id: EmojiId };
  emote: { sessionId: string; id: EmoteId };
  teleport: { x: number; y: number; z: number };
}
