import type { EmoteId } from '@jp/block-sandbox-shared';

/** Per-character animation inputs, written by controllers/network and read by <Avatar>. Times are seconds (performance.now). */
export interface AnimState {
  speed: number;
  grounded: boolean;
  holding: boolean;
  emote: EmoteId | null;
  emoteStart: number;
  swingStart: number;
}

const anims = new Map<string, AnimState>();
export const now = (): number => performance.now() / 1000;

export function getAnim(id: string): AnimState {
  let a = anims.get(id);
  if (!a) {
    a = { speed: 0, grounded: true, holding: false, emote: null, emoteStart: 0, swingStart: -10 };
    anims.set(id, a);
  }
  return a;
}

export const playEmote = (id: string, emote: EmoteId): void => { const a = getAnim(id); a.emote = emote; a.emoteStart = now(); };
export const playSwing = (id: string): void => { getAnim(id).swingStart = now(); };
export const dropAnim = (id: string): void => { anims.delete(id); };
