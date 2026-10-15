import { CHUNK_SIZE, BlockGrid, rleDecodeInto } from '@jp/blocksy-shared';

/**
 * Client copy of the authoritative grid. Edits mark the containing chunk (and neighbours across a border)
 * dirty; the renderer rebuilds dirty chunks each frame.
 */
export class ClientWorld {
  grid: BlockGrid | null = null;
  readonly dirty = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  load(size: [number, number, number], cells: number[], protectedCells: number[]): void {
    this.unsubscribe?.();
    const g = new BlockGrid(size[0], size[1], size[2]);
    rleDecodeInto(cells, g.cells);
    rleDecodeInto(protectedCells, g.protectedCells);
    this.grid = g;
    this.unsubscribe = g.onChange((x, y, z) => this.markCell(x, y, z));
    this.dirty.clear();
    for (const key of this.chunkKeys()) this.dirty.add(key);
  }

  /** All chunk keys "cx,cy,cz". */
  chunkKeys(): string[] {
    const g = this.grid;
    if (!g) return [];
    const keys: string[] = [];
    for (let cy = 0; cy < Math.ceil(g.sy / CHUNK_SIZE); cy++)
      for (let cz = 0; cz < Math.ceil(g.sz / CHUNK_SIZE); cz++)
        for (let cx = 0; cx < Math.ceil(g.sx / CHUNK_SIZE); cx++) keys.push(`${cx},${cy},${cz}`);
    return keys;
  }

  private markCell(x: number, y: number, z: number): void {
    const c = CHUNK_SIZE;
    const cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    this.dirty.add(`${cx},${cy},${cz}`);
    const lx = x - cx * c, ly = y - cy * c, lz = z - cz * c;
    if (lx === 0) this.dirty.add(`${cx - 1},${cy},${cz}`);
    if (lx === c - 1) this.dirty.add(`${cx + 1},${cy},${cz}`);
    if (ly === 0) this.dirty.add(`${cx},${cy - 1},${cz}`);
    if (ly === c - 1) this.dirty.add(`${cx},${cy + 1},${cz}`);
    if (lz === 0) this.dirty.add(`${cx},${cy},${cz - 1}`);
    if (lz === c - 1) this.dirty.add(`${cx},${cy},${cz + 1}`);
  }
}

export const world = new ClientWorld();
