import { AIR, getBlock, type BlockDef, type ShopCategory, BLOCKS } from './blocks';
import { HOTBAR_SLOTS } from './constants';
import { DEFAULT_APPEARANCE, sanitizeAppearance, type Appearance } from './avatar';

/**
 * Persistent per-player data. Ownership is permanent and unlimited: a block bought once is owned forever,
 * and there are no item counts. Coins exist for a future economy; every price is 0 for now.
 */
export interface ProfileData {
  coins: number;
  owned: number[];
  hotbar: number[];
  appearance: Appearance;
}

export const createProfile = (): ProfileData =>
  ({ coins: 0, owned: [], hotbar: new Array(HOTBAR_SLOTS).fill(AIR), appearance: { ...DEFAULT_APPEARANCE } });

/** Repairs untrusted profile data (unknown ids dropped, hotbar only holds owned blocks). */
export function sanitizeProfile(input: unknown): ProfileData {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const owned = Array.isArray(o.owned)
    ? [...new Set(o.owned.filter((id): id is number => typeof id === 'number' && !!getBlock(id)?.purchasable))]
    : [];
  const hotbar = new Array<number>(HOTBAR_SLOTS).fill(AIR);
  if (Array.isArray(o.hotbar)) o.hotbar.slice(0, HOTBAR_SLOTS).forEach((id, i) => { if (owned.includes(id as number)) hotbar[i] = id as number; });
  for (let i = 0; i < hotbar.length; i++) if (hotbar.indexOf(hotbar[i]) !== i) hotbar[i] = AIR; // no duplicates
  const coins = typeof o.coins === 'number' && Number.isFinite(o.coins) && o.coins > 0 ? Math.floor(o.coins) : 0;
  return { coins, owned, hotbar, appearance: sanitizeAppearance(o.appearance) };
}

export type PurchaseResult = 'purchased' | 'already_owned' | 'not_for_sale' | 'insufficient_funds' | 'unknown_item';

/** Buys a block once. Mutates the profile on success and auto-assigns it to the first empty hotbar slot. */
export function purchase(profile: ProfileData, id: number): PurchaseResult {
  const def = getBlock(id);
  if (!def) return 'unknown_item';
  if (!def.purchasable) return 'not_for_sale';
  if (profile.owned.includes(id)) return 'already_owned';
  if (profile.coins < def.price) return 'insufficient_funds';
  profile.coins -= def.price;
  profile.owned.push(id);
  autoAssign(profile.hotbar, id);
  return 'purchased';
}

export const owns = (profile: ProfileData, id: number): boolean => profile.owned.includes(id);

/** Puts a block in a slot; if it's already in another slot the two swap (a block never appears twice). */
export function assignSlot(hotbar: number[], slot: number, id: number): void {
  if (slot < 0 || slot >= hotbar.length) return;
  const existing = id === AIR ? -1 : hotbar.indexOf(id);
  if (existing === slot) return;
  if (existing >= 0) hotbar[existing] = hotbar[slot];
  hotbar[slot] = id;
}

/** First empty slot unless already present. Returns the slot or -1. */
export function autoAssign(hotbar: number[], id: number): number {
  const existing = hotbar.indexOf(id);
  if (existing >= 0) return existing;
  const empty = hotbar.indexOf(AIR);
  if (empty >= 0) hotbar[empty] = id;
  return empty;
}

/** What the player has in hand: nothing, a block from the hotbar, or the destroy tool (key 0). */
export const TOOLS = ['none', 'block', 'destroy'] as const;
export type ToolKind = typeof TOOLS[number];
export const isToolKind = (v: unknown): v is ToolKind => (TOOLS as readonly unknown[]).includes(v);

export const listings = (category: ShopCategory): BlockDef[] => BLOCKS.filter((b) => b.purchasable && b.category === category);
