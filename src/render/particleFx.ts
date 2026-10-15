import * as THREE from 'three';
import { AIR, blockId, getBlock, paintTile } from '@jp/blocksy-shared';
import { world } from '../game/world';

/**
 * Blocky particle system: two pooled instanced meshes of tiny cubes — "lit" (dust, debris, confetti, water)
 * and "glow" (sparkles, hearts, fireflies; unlit). Emitters below are called from gameplay events.
 * Everything is client-side and cosmetic.
 */
export interface Particle {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; size: number; gravity: number; drag: number;
  spin: number; rot: number; r: number; g: number; b: number;
  /** Size curve: 'shrink' (default), 'pulse' (fireflies), 'pop' (grow then shrink). */
  curve: 0 | 1 | 2;
  wobble: number;
}

export const MAX_LIT = 1400;
export const MAX_GLOW = 700;
export const lit: Particle[] = [];
export const glow: Particle[] = [];

export const fx = {
  enabled: true,
  /** Fewer particles on phones. */
  density: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 0.6 : 1,
};

const tmp = new THREE.Color();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const count = (n: number) => Math.max(1, Math.round(n * fx.density));

function push(pool: Particle[], max: number, p: Partial<Particle> & { x: number; y: number; z: number }, color: string | THREE.Color): void {
  if (!fx.enabled) return;
  if (pool.length >= max) pool.shift();
  tmp.set(color as THREE.ColorRepresentation);
  pool.push({
    vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, gravity: 0, drag: 0, spin: 0, rot: Math.random() * 6, curve: 0, wobble: 0,
    ...p, r: tmp.r, g: tmp.g, b: tmp.b,
  });
}

// ---------------------------------------------------------------- simulation
const dummy = new THREE.Object3D();
const instColor = new THREE.Color();

/** Advances a pool (physics, ageing) and writes the live particles into the instanced mesh, if given. */
export function stepParticles(pool: Particle[], mesh: THREE.InstancedMesh | null, dt: number, t: number): void {
  let w = 0;
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i];
    p.age += dt;
    if (p.age >= p.life) continue;
    const damp = Math.exp(-p.drag * dt);
    p.vx *= damp; p.vz *= damp; p.vy = p.vy * damp - p.gravity * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.wobble) { p.x += Math.sin(t * p.wobble * 3 + i) * 0.004; p.z += Math.cos(t * p.wobble * 3 + i) * 0.004; }
    p.rot += p.spin * dt;
    pool[w++] = p;
    if (!mesh) continue;
    const k = p.age / p.life;
    const s = p.curve === 1 ? p.size * (0.6 + 0.4 * Math.sin(t * 4 + i)) * Math.min(1, (1 - k) * 4)
      : p.curve === 2 ? p.size * Math.sin(Math.min(1, k * 1.1) * Math.PI) * 1.3
      : p.size * (1 - k * k);
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rot, p.rot * 0.7, 0);
    dummy.scale.setScalar(Math.max(0.0001, s));
    dummy.updateMatrix();
    mesh.setMatrixAt(w - 1, dummy.matrix);
    mesh.setColorAt(w - 1, instColor.setRGB(p.r, p.g, p.b));
  }
  pool.length = w;
  if (mesh) {
    mesh.count = w;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}


// ---------------------------------------------------------------- block colours (average of the top tile)
const colorCache = new Map<number, THREE.Color>();
export function blockColor(id: number): THREE.Color {
  let c = colorCache.get(id);
  if (c) return c;
  const def = getBlock(id);
  c = new THREE.Color('#9c8a6a');
  if (def) {
    const px = paintTile(def.top);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
    if (n) c = new THREE.Color().setStyle(`rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`);
  }
  colorCache.set(id, c);
  return c;
}
/** Colour of the ground right under (x, y, z), or null in the air. */
export function groundColor(x: number, y: number, z: number): THREE.Color | null {
  const id = world.grid?.get(Math.floor(x), Math.floor(y - 0.05), Math.floor(z)) ?? AIR;
  return id === AIR || !getBlock(id)?.solid ? null : blockColor(id);
}
let waterId = -1;
export function isWaterAt(x: number, y: number, z: number): boolean {
  if (waterId < 0) waterId = blockId('water');
  return world.grid?.get(Math.floor(x), Math.floor(y), Math.floor(z)) === waterId;
}

// ---------------------------------------------------------------- emitters
const CONFETTI = ['#ff5a5f', '#ffb400', '#3ddbb9', '#5aa3ff', '#b36bff', '#ffffff', '#7ed957'];
const shade = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);

/** A footstep puff in the colour of the ground. */
export function footstep(x: number, y: number, z: number, strength = 1): void {
  const c = groundColor(x, y, z);
  if (!c) return;
  for (let i = 0; i < count(2 + strength * 2); i++) {
    push(lit, MAX_LIT, {
      x: x + rand(-0.15, 0.15), y: y + 0.05, z: z + rand(-0.15, 0.15),
      vx: rand(-0.5, 0.5), vy: rand(0.6, 1.3), vz: rand(-0.5, 0.5),
      life: rand(0.35, 0.6), size: rand(0.05, 0.09) * (0.8 + strength * 0.3), gravity: 3, drag: 3,
    }, shade(c, rand(0.85, 1.1)));
  }
}

/** Dust ring when landing; `impact` 0..1. */
export function land(x: number, y: number, z: number, impact: number): void {
  const c = groundColor(x, y, z);
  if (!c) return;
  const n = count(8 + impact * 16);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), sp = rand(1.4, 2.4) * (0.7 + impact);
    push(lit, MAX_LIT, {
      x: x + Math.cos(a) * 0.25, y: y + 0.05, z: z + Math.sin(a) * 0.25,
      vx: Math.cos(a) * sp, vy: rand(0.4, 1.2) * (0.6 + impact), vz: Math.sin(a) * sp,
      life: rand(0.4, 0.75), size: rand(0.07, 0.12), gravity: 4, drag: 4,
    }, shade(c, rand(0.8, 1.1)));
  }
}

/** Chunks of a broken block that tumble down. */
export function blockBreak(x: number, y: number, z: number, id: number): void {
  const c = blockColor(id);
  for (let i = 0; i < count(16); i++) {
    push(lit, MAX_LIT, {
      x: x + rand(0.15, 0.85), y: y + rand(0.15, 0.85), z: z + rand(0.15, 0.85),
      vx: rand(-1.8, 1.8), vy: rand(1, 3.6), vz: rand(-1.8, 1.8),
      life: rand(0.6, 1.0), size: rand(0.09, 0.17), gravity: 14, drag: 0.6, spin: rand(-8, 8),
    }, shade(c, rand(0.75, 1.15)));
  }
}

/** A small puff around a freshly placed block. */
export function blockPlace(x: number, y: number, z: number, id: number): void {
  const c = blockColor(id);
  for (let i = 0; i < count(10); i++) {
    const a = rand(0, Math.PI * 2);
    push(lit, MAX_LIT, {
      x: x + 0.5 + Math.cos(a) * 0.55, y: y + rand(0, 0.3), z: z + 0.5 + Math.sin(a) * 0.55,
      vx: Math.cos(a) * 0.8, vy: rand(0.3, 0.9), vz: Math.sin(a) * 0.8,
      life: rand(0.3, 0.5), size: rand(0.05, 0.09), gravity: 1, drag: 3,
    }, shade(c, rand(0.9, 1.2)));
  }
}

/** Twinkling sparkles. */
export function sparkle(x: number, y: number, z: number, n = 14, colors = ['#fff6a8', '#ffe45c', '#ffffff'], spread = 0.6): void {
  for (let i = 0; i < count(n); i++) {
    push(glow, MAX_GLOW, {
      x: x + rand(-spread, spread), y: y + rand(-0.2, spread), z: z + rand(-spread, spread),
      vx: rand(-0.4, 0.4), vy: rand(0.4, 1.4), vz: rand(-0.4, 0.4),
      life: rand(0.5, 1.0), size: rand(0.05, 0.1), gravity: -0.3, drag: 1.5, spin: rand(-6, 6), curve: 2,
    }, colors[Math.floor(Math.random() * colors.length)]);
  }
}

/** Confetti fountain (mini-game wins, happy emote). */
export function confetti(x: number, y: number, z: number, n = 60, power = 1): void {
  for (let i = 0; i < count(n); i++) {
    const a = rand(0, Math.PI * 2), sp = rand(0.6, 2.4) * power;
    push(lit, MAX_LIT, {
      x, y, z, vx: Math.cos(a) * sp, vy: rand(3.5, 6.5) * power, vz: Math.sin(a) * sp,
      life: rand(1.6, 2.6), size: rand(0.06, 0.1), gravity: 5, drag: 1.4, spin: rand(-10, 10), wobble: rand(1, 3),
    }, CONFETTI[Math.floor(Math.random() * CONFETTI.length)]);
  }
}

/** Little rising hearts (petting). */
export function hearts(x: number, y: number, z: number): void {
  for (let i = 0; i < count(9); i++) {
    push(glow, MAX_GLOW, {
      x: x + rand(-0.3, 0.3), y: y + rand(0, 0.3), z: z + rand(-0.3, 0.3),
      vx: rand(-0.2, 0.2), vy: rand(0.8, 1.4), vz: rand(-0.2, 0.2),
      life: rand(0.9, 1.4), size: rand(0.09, 0.14), gravity: -0.2, drag: 1, curve: 2, wobble: rand(2, 4),
    }, i % 3 === 0 ? '#ffd0dc' : '#ff4f7a');
  }
}

/** Musical notes (rooster crowing, wave emote). */
export function notes(x: number, y: number, z: number, color = '#ffe45c'): void {
  for (let i = 0; i < count(6); i++) {
    push(glow, MAX_GLOW, {
      x: x + rand(-0.2, 0.2), y, z: z + rand(-0.2, 0.2), vx: rand(-0.5, 0.5), vy: rand(0.7, 1.2), vz: rand(-0.5, 0.5),
      life: rand(0.9, 1.3), size: rand(0.07, 0.11), drag: 0.8, curve: 2, wobble: 3,
    }, color);
  }
}

/** Tears (cry emote). */
export function tears(x: number, y: number, z: number, yaw: number): void {
  const fx0 = Math.sin(yaw) * 0.18, fz0 = Math.cos(yaw) * 0.18;
  for (let i = 0; i < count(10); i++) {
    const side = i % 2 ? 1 : -1;
    push(lit, MAX_LIT, {
      x: x + fx0 + Math.cos(yaw) * 0.1 * side, y: y + rand(-0.05, 0.05), z: z + fz0 - Math.sin(yaw) * 0.1 * side,
      vx: fx0 * 2 + rand(-0.3, 0.3), vy: rand(0.2, 0.9), vz: fz0 * 2 + rand(-0.3, 0.3),
      life: rand(0.6, 0.9), size: rand(0.04, 0.07), gravity: 9,
    }, '#5aa8ff');
  }
}

/** Water splash. */
export function splash(x: number, y: number, z: number, big = false): void {
  for (let i = 0; i < count(big ? 40 : 18); i++) {
    const a = rand(0, Math.PI * 2), sp = rand(0.6, 2.2) * (big ? 1.4 : 1);
    push(lit, MAX_LIT, {
      x: x + Math.cos(a) * 0.2, y: y + 0.1, z: z + Math.sin(a) * 0.2,
      vx: Math.cos(a) * sp, vy: rand(2.5, 5) * (big ? 1.2 : 1), vz: Math.sin(a) * sp,
      life: rand(0.6, 1), size: rand(0.05, 0.1), gravity: 13, drag: 0.5,
    }, Math.random() < 0.3 ? '#e8f6ff' : '#4aa3e8');
  }
}

/** White "poof" (sitting down at a game, teleports). */
export function poof(x: number, y: number, z: number): void {
  for (let i = 0; i < count(14); i++) {
    const a = rand(0, Math.PI * 2);
    push(lit, MAX_LIT, {
      x: x + Math.cos(a) * 0.3, y: y + rand(0.1, 1.2), z: z + Math.sin(a) * 0.3,
      vx: Math.cos(a) * 1.2, vy: rand(0.2, 0.8), vz: Math.sin(a) * 1.2,
      life: rand(0.4, 0.7), size: rand(0.1, 0.16), drag: 4,
    }, '#f4f4f4');
  }
}

/** Gold coins spiralling up (shop purchase). */
export function coins(x: number, y: number, z: number): void {
  for (let i = 0; i < count(18); i++) {
    const a = (i / 18) * Math.PI * 4;
    push(glow, MAX_GLOW, {
      x: x + Math.cos(a) * 0.5, y: y + i * 0.05, z: z + Math.sin(a) * 0.5,
      vx: -Math.sin(a) * 0.8, vy: rand(1, 1.6), vz: Math.cos(a) * 0.8,
      life: rand(0.8, 1.2), size: rand(0.08, 0.12), gravity: 0.5, drag: 0.6, spin: 8, curve: 2,
    }, i % 4 === 0 ? '#fff3b0' : '#ffc533');
  }
}

/** One firefly (night ambience). */
export function firefly(x: number, y: number, z: number): void {
  push(glow, MAX_GLOW, {
    x, y, z, vx: rand(-0.3, 0.3), vy: rand(-0.1, 0.2), vz: rand(-0.3, 0.3),
    life: rand(3, 6), size: rand(0.05, 0.08), drag: 0.2, curve: 1, wobble: rand(0.6, 1.4),
  }, Math.random() < 0.5 ? '#d8ff6a' : '#fff07a');
}

/** Big celebration for a mini-game winner. */
export function victory(x: number, y: number, z: number): void {
  confetti(x, y + 1.6, z, 90, 1.1);
  sparkle(x, y + 1.2, z, 26, ['#fff6a8', '#ffe45c', '#ffffff', '#3ddbb9'], 0.9);
}
