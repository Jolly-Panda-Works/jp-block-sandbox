import type { EmoteId, RpsChoice } from '@jp/blocksy-shared';

/** Per-character animation inputs, written by controllers/network and read by <Avatar>. Times are seconds (performance.now). */
export interface AnimState {
  speed: number;
  grounded: boolean;
  holding: boolean;
  emote: EmoteId | null;
  emoteStart: number;
  swingStart: number;
  /** Mini-game pose: sitting at a table, or playing Rock Paper Scissors. */
  pose: 'none' | 'seated' | 'rps';
  /** Item shown in the right hand after an RPS reveal. */
  handItem: RpsChoice | null;
}

const anims = new Map<string, AnimState>();
export const now = (): number => performance.now() / 1000;

export function getAnim(id: string): AnimState {
  let a = anims.get(id);
  if (!a) {
    a = { speed: 0, grounded: true, holding: false, emote: null, emoteStart: 0, swingStart: -10, pose: 'none', handItem: null };
    anims.set(id, a);
  }
  return a;
}

export const playEmote = (id: string, emote: EmoteId): void => { const a = getAnim(id); a.emote = emote; a.emoteStart = now(); };
export const playSwing = (id: string): void => { getAnim(id).swingStart = now(); };
export const dropAnim = (id: string): void => { anims.delete(id); };

/** Sets pose and hand item of a character from the public list of running mini-games. */
export function applyGamePose(id: string, a: AnimState, games: readonly { kind: string; seats: { id: string }[]; reveal?: Record<string, RpsChoice> }[]): void {
  const g = games.find((x) => x.seats.some((s) => s.id === id));
  a.pose = !g ? 'none' : g.kind === 'rps' ? 'rps' : 'seated';
  a.handItem = g?.reveal?.[id] ?? null;
}
