import type { Appearance } from './avatar';

/** Joints of the blocky rig. "L"/"R" are the character's own left/right (model faces +Z, its left is +X). */
export type Joint = 'root' | 'legL' | 'legR' | 'torso' | 'head' | 'armL' | 'armR';
export interface AvatarPart { joint: Joint; name: string; pos: [number, number, number]; size: [number, number, number]; color: string; rot?: [number, number, number] }

/** Model units; the root is scaled by MODEL_SCALE (1.98 units → ~1.78 m). */
export const MODEL_SCALE = 0.9;
const LEG_W = 0.25, LEG_D = 0.26, LEG_LEN = 0.72, TORSO_W = 0.5, TORSO_H = 0.72, TORSO_D = 0.26;
const ARM_W = 0.24, ARM_LEN = 0.7, ARM_TOP = 0.08, HAND = 0.12, HEAD = 0.54;

/** Joint positions relative to their parent (legs/torso → root at hip height; head/arms → torso). */
export const JOINTS: Record<Exclude<Joint, 'root'>, [number, number, number]> = {
  legL: [LEG_W / 2, LEG_LEN, 0], legR: [-LEG_W / 2, LEG_LEN, 0], torso: [0, LEG_LEN, 0],
  head: [0, TORSO_H, 0], armL: [(TORSO_W + ARM_W) / 2, TORSO_H - ARM_TOP, 0], armR: [-(TORSO_W + ARM_W) / 2, TORSO_H - ARM_TOP, 0],
};
/** Held-item anchor inside armR. */
export const HAND_ANCHOR: [number, number, number] = [0, ARM_TOP - ARM_LEN + 0.04, 0.13];

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Sleeve length for a shirt model (used by the body and the first-person arm). */
export const sleeveLength = (shirt: Appearance['shirt']): number =>
  shirt === 'tshirt' ? 0.26 : shirt === 'tank' ? 0 : ARM_LEN - HAND;

/** Builds the list of boxes for an appearance. Every clothing piece/accessory is its own box. */
export function buildAvatarParts(a: Appearance): AvatarPart[] {
  const parts: AvatarPart[] = [];
  const add = (joint: Joint, name: string, pos: [number, number, number], size: [number, number, number], color: string, rot?: [number, number, number]) =>
    parts.push({ joint, name, pos, size, color, rot });

  // Legs
  for (const [joint, side] of [['legL', 1], ['legR', -1]] as const) {
    const shoeH = a.shoes === 'boots' ? 0.27 : a.shoes === 'slipons' ? 0.1 : 0.13;
    add(joint, 'shoe', [0, -LEG_LEN + shoeH / 2, 0.02], [LEG_W + 0.02, shoeH, LEG_D + 0.06], a.shoeColor);
    if (a.shoes === 'sneakers') add(joint, 'sole', [0, -LEG_LEN + 0.02, 0.02], [LEG_W + 0.03, 0.04, LEG_D + 0.07], '#f2f2f2');
    if (a.shoes === 'boots') add(joint, 'sole', [0, -LEG_LEN + 0.025, 0.02], [LEG_W + 0.03, 0.05, LEG_D + 0.07], shade(a.shoeColor, 0.45));
    const bottom = -LEG_LEN + shoeH;
    if (a.pants === 'shorts') {
      const s = 0.32, skinLen = -s - bottom;
      add(joint, 'shorts', [0, -s / 2, 0], [LEG_W + 0.01, s, LEG_D + 0.01], a.pantsColor);
      add(joint, 'shin', [0, -s - skinLen / 2, 0], [LEG_W - 0.02, skinLen, LEG_D - 0.02], a.skin);
    } else {
      add(joint, 'pants', [0, bottom / 2, 0], [LEG_W, -bottom, LEG_D], a.pantsColor);
      if (a.pants === 'cargo') add(joint, 'pocket', [side * (LEG_W / 2 + 0.012), -0.3, 0], [0.03, 0.14, 0.13], shade(a.pantsColor, 0.78));
    }
  }

  // Torso
  add('torso', 'shirt', [0, TORSO_H / 2, 0], [TORSO_W, TORSO_H, TORSO_D], a.shirtColor);
  add('torso', 'waist', [0, 0.04, 0], [TORSO_W + 0.012, 0.08, TORSO_D + 0.012], a.pantsColor);
  if (a.shirt === 'tank') add('torso', 'neckline', [0, TORSO_H - 0.05, TORSO_D / 2 + 0.003], [0.24, 0.1, 0.01], a.skin);
  if (a.shirt === 'hoodie') {
    const dark = shade(a.shirtColor, 0.8);
    add('torso', 'pocket', [0, 0.2, TORSO_D / 2 + 0.008], [0.3, 0.14, 0.02], dark);
    add('torso', 'hood', [0, TORSO_H - 0.01, -TORSO_D / 2 - 0.03], [0.44, 0.16, 0.1], dark);
    add('torso', 'string', [0.07, TORSO_H - 0.12, TORSO_D / 2 + 0.006], [0.02, 0.16, 0.01], '#ffffff');
    add('torso', 'string', [-0.07, TORSO_H - 0.12, TORSO_D / 2 + 0.006], [0.02, 0.16, 0.01], '#ffffff');
  }

  // Arms
  const sleeve = sleeveLength(a.shirt);
  for (const [joint, side] of [['armL', 1], ['armR', -1]] as const) {
    if (sleeve > 0) add(joint, 'sleeve', [0, ARM_TOP - sleeve / 2, 0], [ARM_W + 0.012, sleeve, ARM_W + 0.012], a.shirtColor);
    const skinLen = ARM_LEN - sleeve;
    add(joint, 'arm', [0, ARM_TOP - sleeve - skinLen / 2, 0], [ARM_W, skinLen, ARM_W], a.skin);
    if (joint === 'armL' && a.watch !== 'none') {
      const y = ARM_TOP - ARM_LEN + HAND + 0.04;
      add(joint, 'watchBand', [0, y, 0], [ARM_W + 0.03, 0.06, ARM_W + 0.03], a.watchColor);
      add(joint, 'watchFace', [side * (ARM_W / 2 + 0.022), y, 0], [0.02, 0.075, 0.095], a.watch === 'smart' ? '#142028' : '#f4f4ec');
      if (a.watch === 'smart') add(joint, 'watchGlow', [side * (ARM_W / 2 + 0.033), y, 0], [0.004, 0.05, 0.07], '#4de6cc');
    }
  }

  // Head and face
  const front = HEAD / 2;
  add('head', 'face', [0, HEAD / 2, 0], [HEAD, HEAD, HEAD], a.skin);
  for (const s of [1, -1]) {
    add('head', 'eyeWhite', [s * 0.12, 0.25, front + 0.004], [0.12, 0.08, 0.01], '#f7f7f7');
    add('head', 'pupil', [s * 0.09, 0.25, front + 0.007], [0.06, 0.08, 0.012], '#38241a');
    add('head', 'brow', [s * 0.12, 0.315, front + 0.005], [0.12, 0.025, 0.01], a.hair === 'bald' ? shade(a.skin, 0.6) : a.hairColor);
  }
  add('head', 'mouth', [0, 0.12, front + 0.004], [0.14, 0.03, 0.01], shade(a.skin, 0.62));

  // Hair
  const hasHat = a.hat !== 'none';
  if (a.hair !== 'bald') {
    const w = HEAD + 0.04, back = -(HEAD / 2 + 0.02), long = a.hair === 'long';
    if (!hasHat) add('head', 'hairTop', [0, 0.57, 0], [w, 0.12, w], a.hairColor);
    const bb = long ? -0.14 : 0.2;
    add('head', 'hairBack', [0, (bb + 0.6) / 2, back], [w, 0.6 - bb, 0.05], a.hairColor);
    const sb = long ? 0 : 0.34;
    for (const s of [1, -1]) add('head', 'hairSide', [s * (HEAD / 2 + 0.015), (sb + 0.6) / 2, 0], [0.03, 0.6 - sb, w], a.hairColor);
    add('head', 'fringe', [0, 0.51, HEAD / 2 + 0.015], [w, 0.09, 0.03], a.hairColor);
    if (a.hair === 'spiky' && !hasHat) {
      const spikes: [number, number, number][] = [[-0.18, 0.66, -0.1], [0, 0.68, -0.12], [0.18, 0.66, -0.1], [-0.16, 0.65, 0.12], [0.02, 0.67, 0.1], [0.18, 0.65, 0.12]];
      spikes.forEach((p, i) => add('head', 'spike', p, [0.14, 0.14, 0.14], a.hairColor, [0.35 * ((i % 3) - 1), 0.785, 0.26]));
    }
    if (a.hair === 'ponytail') {
      add('head', 'ponytail', [0, 0.2, back - 0.07], [0.14, 0.34, 0.12], a.hairColor);
      add('head', 'hairTie', [0, 0.38, back - 0.05], [0.16, 0.05, 0.1], shade(a.hairColor, 0.5));
    }
  }

  // Hat
  const hc = a.hatColor, hd = shade(a.hatColor, 0.72);
  if (a.hat === 'cap') {
    add('head', 'capCrown', [0, 0.6, 0], [HEAD + 0.06, 0.16, HEAD + 0.06], hc);
    add('head', 'capBrim', [0, 0.53, HEAD / 2 + 0.11], [HEAD - 0.04, 0.035, 0.22], hd);
  } else if (a.hat === 'beanie') {
    add('head', 'beanie', [0, 0.56, 0], [HEAD + 0.08, 0.24, HEAD + 0.08], hc);
    add('head', 'beanieFold', [0, 0.47, 0], [HEAD + 0.1, 0.07, HEAD + 0.1], hd);
    add('head', 'pompom', [0, 0.72, 0], [0.1, 0.1, 0.1], '#ffffff');
  } else if (a.hat === 'tophat') {
    add('head', 'brim', [0, 0.56, 0], [0.74, 0.035, 0.74], hc);
    add('head', 'crown', [0, 0.77, 0], [0.46, 0.38, 0.46], hc);
    add('head', 'band', [0, 0.62, 0], [0.47, 0.07, 0.47], hd);
  }

  // Glasses
  if (a.glasses !== 'none') {
    const f = a.glassesColor, z = HEAD / 2 + 0.012, cy = 0.25, w = 0.17, h = 0.12, t = 0.025, d = 0.015;
    for (const s of [1, -1]) {
      const cx = s * 0.12;
      if (a.glasses === 'sunglasses') {
        add('head', 'lens', [cx, cy - 0.005, z], [w, h - 0.01, d], '#0f1217');
        add('head', 'frameTop', [cx, cy + h / 2 - t / 2, z + 0.002], [w + 0.01, t, d], f);
      } else {
        const inset = a.glasses === 'round' ? 0.06 : 0;
        add('head', 'frameTop', [cx, cy + h / 2 - t / 2, z], [w - inset, t, d], f);
        add('head', 'frameBottom', [cx, cy - h / 2 + t / 2, z], [w - inset, t, d], f);
        add('head', 'frameSide', [cx - w / 2 + t / 2, cy, z], [t, h - inset, d], f);
        add('head', 'frameSide', [cx + w / 2 - t / 2, cy, z], [t, h - inset, d], f);
        if (a.glasses === 'round') for (const qx of [1, -1]) for (const qy of [1, -1])
          add('head', 'frameCorner', [cx + qx * (w / 2 - 0.035), cy + qy * (h / 2 - 0.03), z], [0.03, 0.03, d], f);
      }
      add('head', 'temple', [s * (HEAD / 2 + 0.012), cy + 0.02, HEAD / 2 - 0.14], [0.02, t, 0.28], f);
    }
    add('head', 'bridge', [0, cy + 0.02, z], [0.08, t, d], f);
  }
  return parts;
}
