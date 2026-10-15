/** Block definitions. Id 0 is air. */
export type BlockShape = 'cube' | 'cross' | 'fence' | 'lantern';
/** 0 opaque, 1 cutout (alpha-test), 2 transparent, 3 emissive. */
export type RenderLayer = 0 | 1 | 2 | 3;
export type ShopCategory = 'blocks' | 'decor';

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  shape: BlockShape;
  layer: RenderLayer;
  solid: boolean;
  removable: boolean;
  replaceable: boolean;
  targetable: boolean;
  purchasable: boolean;
  /** Price in coins. Every price is 0 in phase one; the field exists for a later economy. */
  price: number;
  category: ShopCategory;
  top: string;
  side: string;
  bottom: string;
}

export const AIR = 0;

function def(id: number, key: string, name: string, tiles: [string, string?, string?], opts: Partial<BlockDef> = {}): BlockDef {
  const [top, side = top, bottom = top] = tiles;
  return {
    id, key, name, shape: 'cube', layer: 0, solid: true, removable: true, replaceable: false,
    targetable: true, purchasable: true, price: 0, category: 'blocks', top, side, bottom, ...opts,
  };
}

const plant = (extra: Partial<BlockDef> = {}): Partial<BlockDef> =>
  ({ category: 'decor', shape: 'cross', layer: 1, solid: false, replaceable: true, ...extra });

export const BLOCKS: readonly BlockDef[] = [
  def(1, 'grass', 'Grass', ['grass_top', 'grass_side', 'dirt']),
  def(2, 'dirt', 'Dirt', ['dirt']),
  def(3, 'stone', 'Stone', ['stone']),
  def(4, 'cobblestone', 'Cobblestone', ['cobblestone']),
  def(5, 'stone_bricks', 'Stone Bricks', ['stone_bricks']),
  def(6, 'bricks', 'Bricks', ['bricks']),
  def(7, 'oak_planks', 'Wood', ['oak_planks']),
  def(8, 'dark_planks', 'Dark Wood', ['dark_planks']),
  def(9, 'oak_log', 'Log', ['log_top', 'log_side', 'log_top']),
  def(10, 'leaves', 'Leaves', ['leaves'], { layer: 1 }),
  def(11, 'glass', 'Glass', ['glass'], { layer: 2 }),
  def(12, 'sand', 'Sand', ['sand']),
  def(13, 'dirt_path', 'Path', ['path_top', 'dirt', 'dirt']),
  def(14, 'gravel', 'Gravel', ['gravel']),
  def(15, 'farmland', 'Farmland', ['farmland_top', 'dirt', 'dirt']),
  def(16, 'white_wool', 'White Wool', ['wool_white']),
  def(17, 'teal_wool', 'Teal Wool', ['wool_teal']),
  def(18, 'red_wool', 'Red Wool', ['wool_red']),
  def(19, 'yellow_wool', 'Yellow Wool', ['wool_yellow']),
  def(20, 'blue_wool', 'Blue Wool', ['wool_blue']),
  def(21, 'crafting_table', 'Workbench', ['crafting_top', 'crafting_side', 'oak_planks'], { category: 'decor' }),
  def(22, 'chest', 'Chest', ['chest_top', 'chest_side', 'chest_top'], { category: 'decor' }),
  def(23, 'lantern', 'Lantern', ['lantern'], { category: 'decor', shape: 'lantern', layer: 3, solid: false }),
  def(24, 'fence', 'Fence', ['oak_planks'], { category: 'decor', shape: 'fence' }),
  def(25, 'white_flower', 'Daisy', ['flower_white'], plant()),
  def(26, 'yellow_flower', 'Buttercup', ['flower_yellow'], plant()),
  def(27, 'tall_grass', 'Grass Tuft', ['tall_grass'], plant()),
  // Indestructible base layer of the island. Never sold, never removable.
  def(28, 'island_core', 'Island Core', ['island_core'], { purchasable: false, removable: false }),
  // Biome blocks
  def(29, 'water', 'Water', ['water'], { layer: 2, solid: false, removable: false, targetable: false, purchasable: false, replaceable: true }),
  def(30, 'hay', 'Hay Bale', ['hay_top', 'hay_side', 'hay_top']),
  def(31, 'beehive', 'Beehive', ['hive_top', 'hive_side', 'hive_top'], { category: 'decor' }),
  def(32, 'spruce_log', 'Spruce Log', ['spruce_log_top', 'spruce_log_side', 'spruce_log_top']),
  def(33, 'spruce_leaves', 'Spruce Leaves', ['spruce_leaves'], { layer: 1 }),
  def(34, 'bamboo', 'Bamboo', ['bamboo'], plant({ replaceable: false })),
  // Decoration (sold at the Decor stall)
  def(35, 'bookshelf', 'Bookshelf', ['oak_planks', 'bookshelf_side', 'oak_planks'], { category: 'decor' }),
  def(36, 'barrel', 'Barrel', ['barrel_top', 'barrel_side', 'barrel_top'], { category: 'decor' }),
  def(37, 'crate', 'Crate', ['crate'], { category: 'decor' }),
  def(38, 'pumpkin', 'Pumpkin', ['pumpkin_top', 'pumpkin_side', 'pumpkin_top'], { category: 'decor' }),
  def(39, 'jack_o_lantern', "Jack-o'-Lantern", ['pumpkin_top', 'jack_face', 'pumpkin_top'], { category: 'decor' }),
  def(40, 'melon', 'Melon', ['melon_top', 'melon_side', 'melon_top'], { category: 'decor' }),
  def(41, 'checker_tiles', 'Checker Tiles', ['checker'], { category: 'decor' }),
  def(42, 'teal_glass', 'Teal Glass', ['glass_teal'], { category: 'decor', layer: 2 }),
  def(43, 'red_glass', 'Red Glass', ['glass_red'], { category: 'decor', layer: 2 }),
  def(44, 'mushroom_block', 'Mushroom Block', ['mushroom_block'], { category: 'decor' }),
  def(45, 'white_planks', 'White Wood', ['white_planks']),
  def(46, 'rose', 'Rose', ['rose'], plant()),
  def(47, 'pink_tulip', 'Pink Tulip', ['tulip_pink'], plant()),
  def(48, 'blue_orchid', 'Blue Orchid', ['blue_orchid'], plant()),
  def(49, 'sunflower', 'Sunflower', ['sunflower'], plant()),
  def(50, 'red_mushroom', 'Red Mushroom', ['red_mushroom'], plant()),
  def(51, 'brown_mushroom', 'Brown Mushroom', ['brown_mushroom'], plant()),
  def(52, 'fern', 'Fern', ['fern'], plant()),
  def(53, 'sapling', 'Sapling', ['sapling'], plant()),
  def(54, 'dark_fence', 'Dark Fence', ['dark_planks'], { category: 'decor', shape: 'fence' }),
  def(55, 'stone_wall', 'Stone Wall', ['cobblestone'], { category: 'decor', shape: 'fence' }),
  def(56, 'blue_lantern', 'Blue Lantern', ['lantern_blue'], { category: 'decor', shape: 'lantern', layer: 3, solid: false }),
  def(57, 'paper_lantern', 'Paper Lantern', ['lantern_paper'], { category: 'decor', shape: 'lantern', layer: 3, solid: false }),
  def(58, 'terracotta', 'Terracotta', ['terracotta']),
  def(59, 'mossy_cobblestone', 'Mossy Cobblestone', ['mossy_cobblestone']),
  def(60, 'quartz', 'Quartz', ['quartz']),
];

const byId: (BlockDef | undefined)[] = [];
const byKey = new Map<string, BlockDef>();
for (const b of BLOCKS) {
  if (b.id === AIR) throw new Error('Id 0 is reserved for air');
  if (byId[b.id] || byKey.has(b.key)) throw new Error(`Duplicate block ${b.id}/${b.key}`);
  byId[b.id] = b;
  byKey.set(b.key, b);
}

export const getBlock = (id: number): BlockDef | undefined => byId[id];

export function blockId(key: string): number {
  const b = byKey.get(key);
  if (!b) throw new Error(`Unknown block key ${key}`);
  return b.id;
}

/** Full opaque cubes hide neighbouring faces. */
export const occludes = (b: BlockDef | undefined): boolean => !!b && b.shape === 'cube' && b.layer === 0;
