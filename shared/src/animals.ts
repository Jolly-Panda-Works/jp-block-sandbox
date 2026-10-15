/**
 * Island animals: kinds, home biomes, realistic colour variants, sounds and the server setting parser.
 */

export const ANIMAL_KINDS = [
  'cow', 'sheep', 'pig', 'chicken', 'rooster', 'chick', 'panda', 'fox', 'duck', 'bee', 'dog', 'cat', 'llama', 'rabbit',
] as const;
export type AnimalKind = typeof ANIMAL_KINDS[number];
export const isAnimalKind = (v: unknown): v is AnimalKind => (ANIMAL_KINDS as readonly unknown[]).includes(v);

/** Biomes of the island. The village always exists; the others are only built if one of their animals is enabled. */
export const BIOMES = ['village', 'farm', 'bamboo', 'forest', 'pond', 'flowers', 'highlands'] as const;
export type Biome = typeof BIOMES[number];

export const ANIMAL_BIOME: Record<AnimalKind, Biome> = {
  cow: 'farm', sheep: 'farm', pig: 'farm', chicken: 'farm', rooster: 'farm', chick: 'farm',
  panda: 'bamboo', fox: 'forest', rabbit: 'forest', duck: 'pond', bee: 'flowers', llama: 'highlands',
  dog: 'village', cat: 'village',
};

/** Biomes needed for a set of animals (the village is always included). */
export function biomesFor(kinds: readonly AnimalKind[]): Biome[] {
  const set = new Set<Biome>(['village']);
  for (const k of kinds) set.add(ANIMAL_BIOME[k]);
  return BIOMES.filter((b) => set.has(b));
}

/**
 * Reads the "animals" custom setting:
 *  true / missing → all animals;  false → none;  ["cow", "duck", …] → only those (unknown names ignored).
 */
export function parseAnimalSetting(v: unknown): AnimalKind[] {
  if (v === false) return [];
  if (Array.isArray(v)) return ANIMAL_KINDS.filter((k) => v.includes(k));
  return [...ANIMAL_KINDS];
}

export const ANIMAL_SOUND: Record<AnimalKind, string> = {
  cow: 'Moo!', sheep: 'Baa!', pig: 'Oink!', chicken: 'Cluck!', rooster: 'Cock-a-doodle-doo!', chick: 'Peep!',
  panda: '*munch*', fox: 'Yip!', duck: 'Quack!', bee: 'Bzzz', dog: 'Woof!', cat: 'Meow!', llama: 'Hmmm', rabbit: '*twitch*',
};
export const ANIMAL_ICON: Record<AnimalKind, string> = {
  cow: '🐄', sheep: '🐑', pig: '🐖', chicken: '🐔', rooster: '🐓', chick: '🐥', panda: '🐼', fox: '🦊',
  duck: '🦆', bee: '🐝', dog: '🐕', cat: '🐈', llama: '🦙', rabbit: '🐇',
};
/** How many of each kind spawn (multiplied by the animalsPerKind setting / 2). */
export const ANIMAL_BASE_COUNT: Partial<Record<AnimalKind, number>> = { chick: 3, bee: 4, rooster: 1 };

/** Colour roles used by the models: main body, accent (spots/patches), and detail. */
export interface AnimalColors { main: string; accent: string; detail: string }
/** Realistic colour variants per kind (weight, colours). */
export const ANIMAL_VARIANTS: Record<AnimalKind, { name: string; weight: number; colors: AnimalColors }[]> = {
  cow: [
    { name: 'holstein', weight: 3, colors: { main: '#f4f1ea', accent: '#2b2b2b', detail: '#f2b5b5' } },
    { name: 'brown', weight: 2, colors: { main: '#7a4e2d', accent: '#f4f1ea', detail: '#e8b0a0' } },
    { name: 'black', weight: 1, colors: { main: '#2e2c2b', accent: '#2e2c2b', detail: '#d9a3a3' } },
  ],
  sheep: [
    { name: 'white', weight: 6, colors: { main: '#f1f0e9', accent: '#3d3a38', detail: '#f5f5f5' } },
    { name: 'grey', weight: 2, colors: { main: '#a3a3a0', accent: '#3d3a38', detail: '#f5f5f5' } },
    { name: 'brown', weight: 1, colors: { main: '#7d5a3c', accent: '#3d3a38', detail: '#f5f5f5' } },
    { name: 'black', weight: 1, colors: { main: '#353333', accent: '#262424', detail: '#f5f5f5' } },
  ],
  pig: [
    { name: 'pink', weight: 4, colors: { main: '#f2a7a7', accent: '#f2a7a7', detail: '#e48787' } },
    { name: 'spotted', weight: 2, colors: { main: '#f2b4a8', accent: '#3a2a26', detail: '#e48787' } },
    { name: 'black', weight: 1, colors: { main: '#3a3434', accent: '#f0e6e0', detail: '#6b5a5a' } },
  ],
  chicken: [
    { name: 'white', weight: 2, colors: { main: '#f6f4ee', accent: '#d9352b', detail: '#f2b632' } },
    { name: 'brown', weight: 2, colors: { main: '#a0632e', accent: '#d9352b', detail: '#f2b632' } },
  ],
  rooster: [
    { name: 'red', weight: 2, colors: { main: '#b5452f', accent: '#1f3b2a', detail: '#f2b632' } },
    { name: 'white', weight: 1, colors: { main: '#f6f4ee', accent: '#2b2b2b', detail: '#f2b632' } },
  ],
  chick: [{ name: 'yellow', weight: 1, colors: { main: '#f7d64a', accent: '#f29b32', detail: '#2b2b2b' } }],
  panda: [{ name: 'giant', weight: 1, colors: { main: '#f2f2ee', accent: '#202020', detail: '#202020' } }],
  fox: [
    { name: 'red', weight: 6, colors: { main: '#d9682b', accent: '#f6f1e8', detail: '#2b2b2b' } },
    { name: 'arctic', weight: 1, colors: { main: '#eef2f4', accent: '#ffffff', detail: '#3a3a3a' } },
  ],
  duck: [
    { name: 'mallard', weight: 3, colors: { main: '#8a7a63', accent: '#2f7d4f', detail: '#f2a332' } },
    { name: 'hen', weight: 2, colors: { main: '#8a6a48', accent: '#7a5a3a', detail: '#e0902e' } },
    { name: 'white', weight: 2, colors: { main: '#f4f4f0', accent: '#f4f4f0', detail: '#f2a332' } },
  ],
  bee: [{ name: 'honeybee', weight: 1, colors: { main: '#f2c02e', accent: '#2b2b2b', detail: '#dff3ff' } }],
  dog: [
    { name: 'golden', weight: 3, colors: { main: '#d9a441', accent: '#e8c27a', detail: '#2b2b2b' } },
    { name: 'brown', weight: 2, colors: { main: '#7a4e2d', accent: '#a0704a', detail: '#2b2b2b' } },
    { name: 'black', weight: 2, colors: { main: '#2b2b2b', accent: '#4a4040', detail: '#1a1a1a' } },
    { name: 'white', weight: 1, colors: { main: '#efefea', accent: '#d6cfc4', detail: '#2b2b2b' } },
  ],
  cat: [
    { name: 'orange', weight: 3, colors: { main: '#e0893c', accent: '#c06a26', detail: '#3fa34d' } },
    { name: 'black', weight: 2, colors: { main: '#2a2a2a', accent: '#1d1d1d', detail: '#e8c547' } },
    { name: 'grey', weight: 2, colors: { main: '#8f9296', accent: '#6f7276', detail: '#3fa34d' } },
    { name: 'white', weight: 1, colors: { main: '#f2f2ee', accent: '#e2dcd2', detail: '#5aa3e0' } },
    { name: 'calico', weight: 1, colors: { main: '#f2efe8', accent: '#d9822b', detail: '#3fa34d' } },
  ],
  llama: [
    { name: 'white', weight: 2, colors: { main: '#f1ece2', accent: '#d8cbb3', detail: '#2b2b2b' } },
    { name: 'beige', weight: 2, colors: { main: '#d8c3a0', accent: '#b8a07a', detail: '#2b2b2b' } },
    { name: 'brown', weight: 2, colors: { main: '#8a6142', accent: '#6e4a30', detail: '#2b2b2b' } },
  ],
  rabbit: [
    { name: 'white', weight: 2, colors: { main: '#f4f2ec', accent: '#f2b5c0', detail: '#d94a5a' } },
    { name: 'brown', weight: 3, colors: { main: '#8a6142', accent: '#d9c2a8', detail: '#2b2b2b' } },
    { name: 'grey', weight: 2, colors: { main: '#8f8f8f', accent: '#d6d6d6', detail: '#2b2b2b' } },
  ],
};

export function pickVariant(kind: AnimalKind, rng: () => number): string {
  const list = ANIMAL_VARIANTS[kind];
  let r = rng() * list.reduce((n, v) => n + v.weight, 0);
  for (const v of list) { r -= v.weight; if (r <= 0) return v.name; }
  return list[0].name;
}
export const variantColors = (kind: AnimalKind, variant: string): AnimalColors =>
  (ANIMAL_VARIANTS[kind].find((v) => v.name === variant) ?? ANIMAL_VARIANTS[kind][0]).colors;

/** Animals that fly (bees) or swim (ducks) move differently. */
export const FLYING: readonly AnimalKind[] = ['bee'];
export const SWIMMING: readonly AnimalKind[] = ['duck'];
/** Distance (m) within which a player can pet an animal. */
export const PET_RADIUS = 2.6;
