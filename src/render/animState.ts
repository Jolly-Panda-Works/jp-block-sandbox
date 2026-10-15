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
  pose: 'none' | 'seated' | 'rps' | 'sit' | 'sleep';
  /** Resting pose outside mini-games: sitting on the ground / lying down. */
  restPose: 'none' | 'sit' | 'sleep';
  /** Item shown in the right hand after an RPS reveal. */
  handItem: RpsChoice | null;
}

const anims = new Map<string, AnimState>();
export const now = (): number => performance.now() / 1000;

export function getAnim(id: string): AnimState {
  let a = anims.get(id);
  if (!a) {
    a = { speed: 0, grounded: true, holding: false, emote: null, emoteStart: 0, swingStart: -10, pose: 'none', restPose: 'none', handItem: null };
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
  a.pose = !g ? a.restPose : g.kind === 'rps' ? 'rps' : 'seated';
  a.handItem = g?.reveal?.[id] ?? null;
}

/** Walking speed (m/s) that speed ratio 1 stands for. */
export const WALK_SPEED = 4.3;
/** Effective leg length for the foot-travel calculation (m, model scale included). */
export const LEG_REACH = 1.0;

/**
 * Walk cycle for a speed ratio (1 = normal walk): leg swing angle and how fast the cycle advances.
 * The foot travels 2·LEG_REACH·sin(swing) per half cycle; the cycle advances so the body covers exactly that
 * distance in the same time, so the feet stay planted. Slower walking = smaller, slower steps.
 */
export function gaitFor(speedRatio: number): { swing: number; phaseRate: number } {
  const s = Math.max(0, Math.min(1.5, speedRatio));
  if (s < 0.012) return { swing: 0, phaseRate: 0 };
  const swing = Math.min(0.75, 0.66 * Math.sqrt(Math.min(1.3, s)));
  const halfStride = Math.max(0.25, 2 * LEG_REACH * Math.sin(swing));
  return { swing, phaseRate: (Math.PI * s * WALK_SPEED) / halfStride };
}
