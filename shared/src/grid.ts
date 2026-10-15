import { AIR } from './blocks';

export type ChangeListener = (x: number, y: number, z: number, oldId: number, newId: number) => void;

/**
 * Dense, bounded block storage covering [0, size) on every axis.
 * Single source of truth for world contents; meshes and collision are derived from it.
 */
export class BlockGrid {
  readonly cells: Uint16Array;
  readonly protectedCells: Uint8Array;
  private readonly listeners = new Set<ChangeListener>();

  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    if (sx <= 0 || sy <= 0 || sz <= 0) throw new Error('Grid size must be positive');
    this.cells = new Uint16Array(sx * sy * sz);
    this.protectedCells = new Uint8Array(sx * sy * sz);
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  index(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x;
  }

  /** Block id, or air outside the bounds. */
  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.cells[this.index(x, y, z)] : AIR;
  }

  /** Sets a block and notifies listeners. Returns false if nothing changed. */
  set(x: number, y: number, z: number, id: number): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const i = this.index(x, y, z);
    const old = this.cells[i];
    if (old === id) return false;
    this.cells[i] = id;
    for (const l of this.listeners) l(x, y, z, old, id);
    return true;
  }

  /** Sets without notification (bulk generation). */
  setSilent(x: number, y: number, z: number, id: number): void {
    if (this.inBounds(x, y, z)) this.cells[this.index(x, y, z)] = id;
  }

  isProtected(x: number, y: number, z: number): boolean {
    return this.inBounds(x, y, z) && this.protectedCells[this.index(x, y, z)] === 1;
  }

  setProtected(x: number, y: number, z: number, value: boolean): void {
    if (this.inBounds(x, y, z)) this.protectedCells[this.index(x, y, z)] = value ? 1 : 0;
  }

  /** Subscribes to changes; returns an unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  count(id: number): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === id) n++;
    return n;
  }
}

/** Run-length encoding of a typed array as [value, runLength, ...] (used for the join snapshot). */
export function rleEncode(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

/** Decodes {@link rleEncode} output into a target array; throws if the length doesn't match. */
export function rleDecodeInto(rle: readonly number[], target: Uint16Array | Uint8Array): void {
  let o = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i], n = rle[i + 1];
    if (o + n > target.length) throw new Error('RLE overflow');
    target.fill(v, o, o + n);
    o += n;
  }
  if (o !== target.length) throw new Error(`RLE length mismatch: ${o} != ${target.length}`);
}
