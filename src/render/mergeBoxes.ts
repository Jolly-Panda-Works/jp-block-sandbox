/**
 * Merges many coloured boxes into one geometry (one draw call instead of one per box).
 * Pure data so it can be tested without a GPU.
 */
export interface ColoredBox { p: [number, number, number]; s: [number, number, number]; rx?: number; color: [number, number, number] }

const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], c: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], c: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], c: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

export function mergeBoxArrays(boxes: readonly ColoredBox[]) {
  const n = boxes.length * 24;
  const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  const indices = new Uint32Array(boxes.length * 36);
  let v = 0, i = 0;
  for (const b of boxes) {
    const cr = Math.cos(b.rx ?? 0), sr = Math.sin(b.rx ?? 0);
    for (const f of FACES) {
      const base = v;
      // rotate the face normal about X
      const ny = f.n[1] * cr - f.n[2] * sr, nz = f.n[1] * sr + f.n[2] * cr;
      for (const [cx, cy, cz] of f.c) {
        const x = (cx * b.s[0]) / 2, y = (cy * b.s[1]) / 2, z = (cz * b.s[2]) / 2;
        positions.set([b.p[0] + x, b.p[1] + y * cr - z * sr, b.p[2] + y * sr + z * cr], v * 3);
        normals.set([f.n[0], ny, nz], v * 3);
        colors.set(b.color, v * 3);
        v++;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  }
  return { positions, normals, colors, indices };
}
