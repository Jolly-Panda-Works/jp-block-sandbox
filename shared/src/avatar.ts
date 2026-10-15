import { randInt } from './rng';

export const HAIR_STYLES = ['short', 'long', 'spiky', 'ponytail', 'bald'] as const;
export const SHIRT_STYLES = ['tshirt', 'longsleeve', 'tank', 'hoodie'] as const;
export const PANTS_STYLES = ['jeans', 'shorts', 'cargo'] as const;
export const SHOE_STYLES = ['sneakers', 'boots', 'slipons'] as const;
export const HAT_STYLES = ['none', 'cap', 'beanie', 'tophat'] as const;
export const GLASSES_STYLES = ['none', 'square', 'round', 'sunglasses'] as const;
export const WATCH_STYLES = ['none', 'classic', 'smart'] as const;

export type HairStyle = typeof HAIR_STYLES[number];
export type ShirtStyle = typeof SHIRT_STYLES[number];
export type PantsStyle = typeof PANTS_STYLES[number];
export type ShoeStyle = typeof SHOE_STYLES[number];
export type HatStyle = typeof HAT_STYLES[number];
export type GlassesStyle = typeof GLASSES_STYLES[number];
export type WatchStyle = typeof WATCH_STYLES[number];

/** A character look: model + colour for each clothing slot, skin colour and accessories. */
export interface Appearance {
  skin: string;
  hair: HairStyle; hairColor: string;
  shirt: ShirtStyle; shirtColor: string;
  pants: PantsStyle; pantsColor: string;
  shoes: ShoeStyle; shoeColor: string;
  hat: HatStyle; hatColor: string;
  glasses: GlassesStyle; glassesColor: string;
  watch: WatchStyle; watchColor: string;
}

export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
  skin: '#e0ac7e', hair: 'short', hairColor: '#5a3a22', shirt: 'tshirt', shirtColor: '#2bb3a8',
  pants: 'jeans', pantsColor: '#2e3a7a', shoes: 'sneakers', shoeColor: '#6b6f78',
  hat: 'none', hatColor: '#c0392b', glasses: 'none', glassesColor: '#222222', watch: 'none', watchColor: '#333333',
};

export const PALETTES = {
  skin: ['#f6d3b3', '#edb98a', '#e0ac7e', '#c68642', '#9e6b43', '#7a4a2a', '#5a3825', '#3d2616'],
  hair: ['#1e1e1e', '#3b2416', '#5a3a22', '#8a5a30', '#c89b5a', '#e8d29a', '#b5452f', '#8c8c8c', '#3f6fd8', '#d85aa0'],
  clothing: ['#2bb3a8', '#e8584b', '#f2c230', '#9b6bd6', '#3e78d6', '#2e3a7a', '#3a9e4f', '#f28c38', '#f2f2f2', '#2a2a2e', '#8a6a4a', '#e87db0'],
  accessory: ['#222222', '#c9a227', '#c0c0c8', '#c0392b', '#2e86de', '#f2f2f2', '#8e44ad', '#16a085'],
} as const;

const HEX = /^#[0-9a-f]{6}$/i;
const pick = <T extends readonly string[]>(list: T, v: unknown, fallback: T[number]): T[number] =>
  (typeof v === 'string' && (list as readonly string[]).includes(v) ? v : fallback) as T[number];
const color = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

/** Validates untrusted input (network/save data) into a well-formed appearance. */
export function sanitizeAppearance(input: unknown): Appearance {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  return {
    skin: color(o.skin, d.skin),
    hair: pick(HAIR_STYLES, o.hair, d.hair), hairColor: color(o.hairColor, d.hairColor),
    shirt: pick(SHIRT_STYLES, o.shirt, d.shirt), shirtColor: color(o.shirtColor, d.shirtColor),
    pants: pick(PANTS_STYLES, o.pants, d.pants), pantsColor: color(o.pantsColor, d.pantsColor),
    shoes: pick(SHOE_STYLES, o.shoes, d.shoes), shoeColor: color(o.shoeColor, d.shoeColor),
    hat: pick(HAT_STYLES, o.hat, d.hat), hatColor: color(o.hatColor, d.hatColor),
    glasses: pick(GLASSES_STYLES, o.glasses, d.glasses), glassesColor: color(o.glassesColor, d.glassesColor),
    watch: pick(WATCH_STYLES, o.watch, d.watch), watchColor: color(o.watchColor, d.watchColor),
  };
}

/** Cycles through a style list. */
export function cycle<T extends string>(list: readonly T[], value: T, delta: number): T {
  const i = Math.max(0, list.indexOf(value));
  return list[(((i + delta) % list.length) + list.length) % list.length];
}

/** A random look; accessories are rarer than clothing so crowds don't look noisy. */
export function randomAppearance(rng: () => number): Appearance {
  const p = <T>(l: readonly T[]) => l[randInt(rng, l.length)];
  return {
    skin: p(PALETTES.skin), hair: p(HAIR_STYLES), hairColor: p(PALETTES.hair),
    shirt: p(SHIRT_STYLES), shirtColor: p(PALETTES.clothing), pants: p(PANTS_STYLES), pantsColor: p(PALETTES.clothing),
    shoes: p(SHOE_STYLES), shoeColor: p(PALETTES.clothing),
    hat: rng() < 0.3 ? p(HAT_STYLES) : 'none', hatColor: p(PALETTES.clothing),
    glasses: rng() < 0.25 ? p(GLASSES_STYLES) : 'none', glassesColor: p(PALETTES.accessory),
    watch: rng() < 0.3 ? p(WATCH_STYLES) : 'none', watchColor: p(PALETTES.accessory),
  };
}
