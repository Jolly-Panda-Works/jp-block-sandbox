import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { isAnimalKind, variantColors, type AnimalColors, type AnimalKind } from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { animalStates } from '../net/network';
import { now } from './animState';
import { inView } from './cull';
import { mergeBoxArrays } from './mergeBoxes';
import { isNight } from '@jp/blocksy-shared';
import { currentClock } from '../net/network';

/** Animals that lower their head to graze now and then while standing still. */
const GRAZERS = new Set(['cow', 'sheep', 'llama', 'pig', 'rabbit', 'panda', 'chicken', 'chick', 'duck']);
import { footstep } from './particleFx';
import { localBody } from '../game/localState';

const DUSTY = new Set(['cow', 'sheep', 'pig', 'llama', 'panda', 'dog', 'fox']);

/**
 * Box: position, size, colour (hex, or a colour role of the variant: M main, A accent, D detail),
 * leg index (0/1 swing in opposite phases), wing (flaps), lean (x rotation).
 */
type Box = { p: [number, number, number]; s: [number, number, number]; c: string; leg?: 0 | 1; wing?: boolean; rx?: number };
const L = (x: number, y: number, z: number, s: [number, number, number], c: string, leg: 0 | 1): Box => ({ p: [x, y, z], s, c, leg });

/** Original blocky animals. Model faces +Z; y = 0 is the ground. legTop = hip height for leg pivots. */
const MODELS: Record<AnimalKind, { legTop: number; boxes: Box[] }> = {
  cow: { legTop: 0.55, boxes: [
    { p: [0, 0.85, 0], s: [0.62, 0.62, 1.2], c: 'M' },
    { p: [0.315, 0.9, 0.15], s: [0.02, 0.3, 0.35], c: 'A' }, { p: [-0.315, 0.8, -0.25], s: [0.02, 0.28, 0.4], c: 'A' }, { p: [0, 1.161, -0.1], s: [0.4, 0.02, 0.4], c: 'A' },
    { p: [0, 1.0, 0.78], s: [0.46, 0.46, 0.4], c: 'M' }, { p: [0, 0.88, 1.0], s: [0.3, 0.18, 0.06], c: 'D' },
    { p: [0.17, 1.26, 0.78], s: [0.08, 0.1, 0.08], c: '#e6dcc5' }, { p: [-0.17, 1.26, 0.78], s: [0.08, 0.1, 0.08], c: '#e6dcc5' },
    { p: [0.12, 1.06, 0.985], s: [0.08, 0.08, 0.02], c: '#1d1d1d' }, { p: [-0.12, 1.06, 0.985], s: [0.08, 0.08, 0.02], c: '#1d1d1d' },
    L(0.2, -0.27, 0.4, [0.2, 0.55, 0.2], 'M', 0), L(-0.2, -0.27, 0.4, [0.2, 0.55, 0.2], 'M', 1), L(0.2, -0.27, -0.4, [0.2, 0.55, 0.2], 'M', 1), L(-0.2, -0.27, -0.4, [0.2, 0.55, 0.2], 'M', 0),
  ] },
  sheep: { legTop: 0.45, boxes: [
    { p: [0, 0.75, 0], s: [0.62, 0.58, 0.9], c: 'M' }, { p: [0, 0.86, 0.56], s: [0.34, 0.34, 0.32], c: 'A' }, { p: [0, 1.02, 0.5], s: [0.38, 0.12, 0.24], c: 'M' },
    { p: [0.09, 0.92, 0.725], s: [0.06, 0.06, 0.02], c: 'D' }, { p: [-0.09, 0.92, 0.725], s: [0.06, 0.06, 0.02], c: 'D' },
    L(0.17, -0.22, 0.28, [0.14, 0.44, 0.14], 'A', 0), L(-0.17, -0.22, 0.28, [0.14, 0.44, 0.14], 'A', 1), L(0.17, -0.22, -0.28, [0.14, 0.44, 0.14], 'A', 1), L(-0.17, -0.22, -0.28, [0.14, 0.44, 0.14], 'A', 0),
  ] },
  pig: { legTop: 0.3, boxes: [
    { p: [0, 0.55, 0], s: [0.56, 0.5, 0.86], c: 'M' }, { p: [0.285, 0.6, -0.1], s: [0.02, 0.2, 0.25], c: 'A' }, { p: [-0.285, 0.5, 0.15], s: [0.02, 0.18, 0.2], c: 'A' },
    { p: [0, 0.62, 0.56], s: [0.42, 0.4, 0.34], c: 'M' }, { p: [0, 0.56, 0.75], s: [0.2, 0.14, 0.06], c: 'D' },
    { p: [0.11, 0.7, 0.735], s: [0.07, 0.07, 0.02], c: '#1d1d1d' }, { p: [-0.11, 0.7, 0.735], s: [0.07, 0.07, 0.02], c: '#1d1d1d' },
    L(0.16, -0.15, 0.26, [0.14, 0.3, 0.14], 'M', 0), L(-0.16, -0.15, 0.26, [0.14, 0.3, 0.14], 'M', 1), L(0.16, -0.15, -0.26, [0.14, 0.3, 0.14], 'M', 1), L(-0.16, -0.15, -0.26, [0.14, 0.3, 0.14], 'M', 0),
  ] },
  cat: { legTop: 0.2, boxes: [
    { p: [0, 0.3, 0], s: [0.24, 0.22, 0.52], c: 'M' }, { p: [0, 0.3, 0.05], s: [0.245, 0.06, 0.1], c: 'A' }, { p: [0, 0.3, -0.15], s: [0.245, 0.06, 0.08], c: 'A' },
    { p: [0, 0.43, 0.32], s: [0.26, 0.24, 0.22], c: 'M' }, { p: [0.08, 0.58, 0.32], s: [0.06, 0.08, 0.05], c: 'A' }, { p: [-0.08, 0.58, 0.32], s: [0.06, 0.08, 0.05], c: 'A' },
    { p: [0.06, 0.46, 0.435], s: [0.05, 0.05, 0.02], c: 'D' }, { p: [-0.06, 0.46, 0.435], s: [0.05, 0.05, 0.02], c: 'D' },
    { p: [0, 0.48, -0.36], s: [0.06, 0.32, 0.06], c: 'A' },
    L(0.08, -0.1, 0.18, [0.07, 0.2, 0.07], 'M', 0), L(-0.08, -0.1, 0.18, [0.07, 0.2, 0.07], 'M', 1), L(0.08, -0.1, -0.18, [0.07, 0.2, 0.07], 'M', 1), L(-0.08, -0.1, -0.18, [0.07, 0.2, 0.07], 'M', 0),
  ] },
  chicken: { legTop: 0.16, boxes: [
    { p: [0, 0.32, 0], s: [0.32, 0.3, 0.4], c: 'M' }, { p: [0, 0.52, 0.2], s: [0.2, 0.22, 0.2], c: 'M' }, { p: [0, 0.66, 0.2], s: [0.06, 0.08, 0.12], c: 'A' },
    { p: [0, 0.5, 0.33], s: [0.08, 0.06, 0.08], c: 'D' }, { p: [0, 0.43, 0.3], s: [0.05, 0.07, 0.03], c: 'A' }, { p: [0, 0.42, -0.22], s: [0.22, 0.18, 0.08], c: 'M' },
    { p: [0.165, 0.34, 0], s: [0.02, 0.18, 0.26], c: 'M', wing: true }, { p: [-0.165, 0.34, 0], s: [0.02, 0.18, 0.26], c: 'M', wing: true },
    { p: [0.06, 0.56, 0.305], s: [0.04, 0.04, 0.02], c: '#1d1d1d' }, { p: [-0.06, 0.56, 0.305], s: [0.04, 0.04, 0.02], c: '#1d1d1d' },
    L(0.07, -0.08, 0, [0.05, 0.16, 0.05], 'D', 0), L(-0.07, -0.08, 0, [0.05, 0.16, 0.05], 'D', 1),
  ] },
  rooster: { legTop: 0.18, boxes: [
    { p: [0, 0.36, 0], s: [0.36, 0.34, 0.44], c: 'M' }, { p: [0, 0.6, 0.22], s: [0.22, 0.24, 0.22], c: 'M' }, { p: [0, 0.77, 0.22], s: [0.07, 0.12, 0.18], c: '#d9352b' },
    { p: [0, 0.57, 0.37], s: [0.09, 0.07, 0.09], c: 'D' }, { p: [0, 0.48, 0.33], s: [0.06, 0.1, 0.03], c: '#d9352b' },
    { p: [0, 0.56, -0.26], s: [0.2, 0.34, 0.1], c: 'A', rx: -0.4 }, { p: [0, 0.48, -0.31], s: [0.16, 0.2, 0.08], c: 'A', rx: -0.7 },
    { p: [0.185, 0.38, 0], s: [0.02, 0.2, 0.28], c: 'A', wing: true }, { p: [-0.185, 0.38, 0], s: [0.02, 0.2, 0.28], c: 'A', wing: true },
    { p: [0.07, 0.64, 0.335], s: [0.04, 0.04, 0.02], c: '#1d1d1d' }, { p: [-0.07, 0.64, 0.335], s: [0.04, 0.04, 0.02], c: '#1d1d1d' },
    L(0.08, -0.09, 0, [0.05, 0.18, 0.05], 'D', 0), L(-0.08, -0.09, 0, [0.05, 0.18, 0.05], 'D', 1),
  ] },
  chick: { legTop: 0.07, boxes: [
    { p: [0, 0.16, 0], s: [0.18, 0.17, 0.2], c: 'M' }, { p: [0, 0.28, 0.1], s: [0.14, 0.13, 0.13], c: 'M' }, { p: [0, 0.27, 0.18], s: [0.05, 0.04, 0.05], c: 'A' },
    { p: [0.04, 0.31, 0.166], s: [0.025, 0.025, 0.01], c: 'D' }, { p: [-0.04, 0.31, 0.166], s: [0.025, 0.025, 0.01], c: 'D' },
    L(0.04, -0.035, 0, [0.03, 0.07, 0.03], 'A', 0), L(-0.04, -0.035, 0, [0.03, 0.07, 0.03], 'A', 1),
  ] },
  panda: { legTop: 0.4, boxes: [
    { p: [0, 0.7, 0], s: [0.7, 0.6, 1.0], c: 'M' }, { p: [0, 0.74, 0.22], s: [0.72, 0.32, 0.3], c: 'A' },
    { p: [0, 0.85, 0.66], s: [0.5, 0.45, 0.42], c: 'M' }, { p: [0.2, 1.1, 0.62], s: [0.12, 0.12, 0.08], c: 'A' }, { p: [-0.2, 1.1, 0.62], s: [0.12, 0.12, 0.08], c: 'A' },
    { p: [0.12, 0.9, 0.875], s: [0.13, 0.11, 0.02], c: 'A' }, { p: [-0.12, 0.9, 0.875], s: [0.13, 0.11, 0.02], c: 'A' }, { p: [0, 0.76, 0.88], s: [0.08, 0.06, 0.02], c: 'A' },
    L(0.22, -0.2, 0.32, [0.22, 0.4, 0.22], 'A', 0), L(-0.22, -0.2, 0.32, [0.22, 0.4, 0.22], 'A', 1), L(0.22, -0.2, -0.32, [0.22, 0.4, 0.22], 'A', 1), L(-0.22, -0.2, -0.32, [0.22, 0.4, 0.22], 'A', 0),
  ] },
  fox: { legTop: 0.28, boxes: [
    { p: [0, 0.42, 0], s: [0.3, 0.3, 0.7], c: 'M' }, { p: [0, 0.32, 0.12], s: [0.26, 0.1, 0.4], c: 'A' },
    { p: [0, 0.52, 0.45], s: [0.32, 0.28, 0.3], c: 'M' }, { p: [0, 0.46, 0.65], s: [0.14, 0.12, 0.16], c: 'A' }, { p: [0, 0.5, 0.735], s: [0.05, 0.05, 0.02], c: 'D' },
    { p: [0.1, 0.71, 0.42], s: [0.08, 0.12, 0.05], c: 'M' }, { p: [-0.1, 0.71, 0.42], s: [0.08, 0.12, 0.05], c: 'M' },
    { p: [0.08, 0.57, 0.605], s: [0.05, 0.04, 0.02], c: 'D' }, { p: [-0.08, 0.57, 0.605], s: [0.05, 0.04, 0.02], c: 'D' },
    { p: [0, 0.45, -0.55], s: [0.16, 0.16, 0.5], c: 'M', rx: 0.2 }, { p: [0, 0.4, -0.82], s: [0.16, 0.16, 0.12], c: 'A' },
    L(0.1, -0.14, 0.24, [0.08, 0.28, 0.08], 'D', 0), L(-0.1, -0.14, 0.24, [0.08, 0.28, 0.08], 'D', 1), L(0.1, -0.14, -0.24, [0.08, 0.28, 0.08], 'D', 1), L(-0.1, -0.14, -0.24, [0.08, 0.28, 0.08], 'D', 0),
  ] },
  duck: { legTop: 0.1, boxes: [
    { p: [0, 0.22, 0], s: [0.3, 0.26, 0.44], c: 'M' }, { p: [0, 0.42, 0.25], s: [0.2, 0.2, 0.2], c: 'A' }, { p: [0, 0.38, 0.4], s: [0.14, 0.05, 0.12], c: 'D' },
    { p: [0, 0.3, -0.25], s: [0.18, 0.08, 0.1], c: 'M' }, { p: [0.155, 0.24, 0], s: [0.02, 0.16, 0.28], c: 'M', wing: true }, { p: [-0.155, 0.24, 0], s: [0.02, 0.16, 0.28], c: 'M', wing: true },
    { p: [0.07, 0.46, 0.355], s: [0.035, 0.035, 0.01], c: '#1d1d1d' }, { p: [-0.07, 0.46, 0.355], s: [0.035, 0.035, 0.01], c: '#1d1d1d' },
    L(0.07, -0.05, 0, [0.05, 0.1, 0.05], 'D', 0), L(-0.07, -0.05, 0, [0.05, 0.1, 0.05], 'D', 1),
  ] },
  bee: { legTop: 0, boxes: [
    { p: [0, 0, 0], s: [0.18, 0.16, 0.26], c: 'M' }, { p: [0, 0, -0.03], s: [0.185, 0.165, 0.04], c: 'A' }, { p: [0, 0, 0.06], s: [0.185, 0.165, 0.04], c: 'A' },
    { p: [0, 0, 0.16], s: [0.14, 0.14, 0.08], c: 'A' }, { p: [0, -0.02, -0.15], s: [0.03, 0.03, 0.05], c: 'A' },
    { p: [0.1, 0.1, 0], s: [0.18, 0.02, 0.12], c: 'D', wing: true }, { p: [-0.1, 0.1, 0], s: [0.18, 0.02, 0.12], c: 'D', wing: true },
  ] },
  dog: { legTop: 0.3, boxes: [
    { p: [0, 0.45, 0], s: [0.32, 0.32, 0.66], c: 'M' }, { p: [0, 0.62, 0.45], s: [0.3, 0.3, 0.32], c: 'M' }, { p: [0, 0.56, 0.66], s: [0.16, 0.12, 0.14], c: 'A' },
    { p: [0, 0.6, 0.735], s: [0.06, 0.05, 0.02], c: 'D' }, { p: [0.165, 0.64, 0.42], s: [0.04, 0.16, 0.1], c: 'A' }, { p: [-0.165, 0.64, 0.42], s: [0.04, 0.16, 0.1], c: 'A' },
    { p: [0.08, 0.68, 0.61], s: [0.05, 0.05, 0.02], c: 'D' }, { p: [-0.08, 0.68, 0.61], s: [0.05, 0.05, 0.02], c: 'D' },
    { p: [0, 0.6, -0.4], s: [0.06, 0.06, 0.28], c: 'M', rx: -0.6 },
    L(0.1, -0.15, 0.22, [0.1, 0.3, 0.1], 'M', 0), L(-0.1, -0.15, 0.22, [0.1, 0.3, 0.1], 'M', 1), L(0.1, -0.15, -0.22, [0.1, 0.3, 0.1], 'M', 1), L(-0.1, -0.15, -0.22, [0.1, 0.3, 0.1], 'M', 0),
  ] },
  llama: { legTop: 0.72, boxes: [
    { p: [0, 0.95, 0], s: [0.42, 0.45, 0.8], c: 'M' }, { p: [0, 1.19, -0.05], s: [0.44, 0.08, 0.42], c: 'A' },
    { p: [0, 1.35, 0.3], s: [0.2, 0.6, 0.2], c: 'M' }, { p: [0, 1.72, 0.38], s: [0.24, 0.22, 0.32], c: 'M' }, { p: [0, 1.68, 0.56], s: [0.16, 0.12, 0.1], c: 'A' },
    { p: [0.08, 1.9, 0.32], s: [0.06, 0.14, 0.05], c: 'M' }, { p: [-0.08, 1.9, 0.32], s: [0.06, 0.14, 0.05], c: 'M' },
    { p: [0.07, 1.76, 0.545], s: [0.04, 0.04, 0.02], c: 'D' }, { p: [-0.07, 1.76, 0.545], s: [0.04, 0.04, 0.02], c: 'D' }, { p: [0, 1.05, -0.43], s: [0.12, 0.16, 0.08], c: 'M' },
    L(0.13, -0.36, 0.28, [0.12, 0.72, 0.12], 'M', 0), L(-0.13, -0.36, 0.28, [0.12, 0.72, 0.12], 'M', 1), L(0.13, -0.36, -0.28, [0.12, 0.72, 0.12], 'M', 1), L(-0.13, -0.36, -0.28, [0.12, 0.72, 0.12], 'M', 0),
  ] },
  rabbit: { legTop: 0.1, boxes: [
    { p: [0, 0.18, 0], s: [0.24, 0.22, 0.34], c: 'M' }, { p: [0, 0.32, 0.2], s: [0.2, 0.2, 0.2], c: 'M' },
    { p: [0.05, 0.52, 0.18], s: [0.05, 0.22, 0.04], c: 'M' }, { p: [-0.05, 0.52, 0.18], s: [0.05, 0.22, 0.04], c: 'M' },
    { p: [0.05, 0.52, 0.2], s: [0.03, 0.18, 0.01], c: 'A' }, { p: [-0.05, 0.52, 0.2], s: [0.03, 0.18, 0.01], c: 'A' },
    { p: [0.06, 0.35, 0.305], s: [0.035, 0.035, 0.01], c: 'D' }, { p: [-0.06, 0.35, 0.305], s: [0.035, 0.035, 0.01], c: 'D' },
    { p: [0, 0.22, -0.2], s: [0.08, 0.08, 0.06], c: 'A' },
    L(0.08, -0.05, 0.1, [0.06, 0.1, 0.06], 'M', 0), L(-0.08, -0.05, 0.1, [0.06, 0.1, 0.06], 'M', 1), L(0.08, -0.05, -0.1, [0.07, 0.1, 0.1], 'M', 1), L(-0.08, -0.05, -0.1, [0.07, 0.1, 0.1], 'M', 0),
  ] },
};

const mats = new Map<string, THREE.MeshLambertMaterial>();
const mat = (c: string) => {
  let m = mats.get(c);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: c, transparent: c === '#dff3ff', opacity: c === '#dff3ff' ? 0.6 : 1 }); mats.set(c, m); }
  return m;
};
const BOX = new THREE.BoxGeometry(1, 1, 1);
const BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const bodies = new Map<string, THREE.BufferGeometry>();
/** The animal's whole body (everything except legs and wings) as ONE mesh, cached per kind + colour. */
function bodyGeometry(kind: AnimalKind, variant: string): THREE.BufferGeometry {
  const key = `${kind}:${variant}`;
  let g = bodies.get(key);
  if (g) return g;
  const pal = variantColors(kind, variant);
  const c = new THREE.Color();
  const boxes = MODELS[kind].boxes.filter((b) => b.leg === undefined && !b.wing).map((b) => {
    c.set(colorOf(b.c, pal)).convertSRGBToLinear();
    return { p: b.p, s: b.s, rx: b.rx, color: [c.r, c.g, c.b] as [number, number, number] };
  });
  const d = mergeBoxArrays(boxes);
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  bodies.set(key, g);
  return g;
}
const colorOf = (c: string, pal: AnimalColors) => (c === 'M' ? pal.main : c === 'A' ? pal.accent : c === 'D' ? pal.detail : c);

function AnimalBubble({ id }: { id: string }) {
  const bubble = useGame((s) => s.bubbles[id]);
  if (!bubble || bubble.until < now()) return null;
  return (
    <Html position={[0, 1.4, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="bubble">{bubble.emoji ?? bubble.text}</div>
    </Html>
  );
}

function Animal({ id, kind, variant }: { id: string; kind: AnimalKind; variant: string }) {
  const g = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Mesh | null)[]>([]);
  const phase = useRef(Math.random() * 6);
  const step = useRef(0);
  const gait = useRef({ px: 0, pz: 0, sp: 0, init: false, graze: Math.random() * 20 });
  const model = MODELS[kind];
  const pal = variantColors(kind, variant);
  const fly = kind === 'bee', hopper = kind === 'rabbit';
  useFrame((_, rawDt) => {
    const a = animalStates.get(id), grp = g.current;
    if (!a || !grp) return;
    const dt = Math.min(rawDt, 0.05), k = 1 - Math.exp(-10 * dt), t = now();
    if (Math.hypot(a.x - a.rx, a.z - a.rz) > 6) { a.rx = a.x; a.ry = a.y; a.rz = a.z; }
    a.rx += (a.x - a.rx) * k; a.ry += (a.y - a.ry) * k; a.rz += (a.z - a.rz) * k;
    a.ryaw += Math.atan2(Math.sin(a.yaw - a.ryaw), Math.cos(a.yaw - a.ryaw)) * k;
    grp.position.set(a.rx, a.ry, a.rz);
    grp.rotation.y = a.ryaw;
    const show = inView(a.rx, a.ry, a.rz, 1.2);
    grp.visible = show;
    if (!show) return;                         // off-screen: position kept up to date, nothing else
    // Legs move with the speed you actually see (smoothed position), one step per leg length.
    const gs = gait.current;
    const moved = gs.init ? Math.hypot(a.rx - gs.px, a.rz - gs.pz) : 0;
    gs.px = a.rx; gs.pz = a.rz; gs.init = true;
    gs.sp += ((dt > 0 && moved < 3 ? moved / dt : 0) - gs.sp) * (1 - Math.exp(-12 * dt));
    const walking = gs.sp > 0.08;
    const strideLen = Math.max(0.12, model.legTop * 1.3);
    if (walking) phase.current += ((Math.PI * gs.sp) / strideLen) * dt;
    if (walking && DUSTY.has(kind) && Math.hypot(a.rx - localBody.x, a.rz - localBody.z) < 25) {
      step.current += dt;
      if (step.current > 0.55) { step.current = 0; footstep(a.rx, a.ry, a.rz, kind === 'cow' || kind === 'llama' || kind === 'panda' ? 1 : 0.5); }
    }
    const swing = walking ? Math.sin(phase.current) * 0.55 : 0;
    // Night: most animals lie down (legs tucked under). Day: grazers lower their head now and then.
    const asleep = !walking && !fly && kind !== 'duck' && isNight(currentClock().hour);
    const grazing = !walking && !asleep && GRAZERS.has(kind) && Math.sin(t * 0.35 + gs.graze) > 0.55;
    legs.current.forEach((l) => { if (l) l.visible = !asleep; });
    if (body.current) body.current.rotation.x += ((grazing ? 0.22 : 0) - body.current.rotation.x) * (1 - Math.exp(-4 * dt));
    legs.current.forEach((l, i) => { if (l) l.rotation.x = i % 2 === 0 ? swing : -swing; });
    const flap = fly ? Math.sin(t * 60) * 0.6 : Math.max(0, Math.sin(t * 18)) * 0.5 * (t - (a.hopAt ?? -9) < 0.8 ? 1 : 0);
    wings.current.forEach((w, i) => { if (w) w.rotation.z = i % 2 === 0 ? flap : -flap; });
    // Pet reaction: two little hops. Rabbits hop while walking; bees bob in the air.
    const since = t - (a.hopAt ?? -9);
    let y = since < 0.8 ? Math.abs(Math.sin((since / 0.4) * Math.PI)) * 0.25 : 0;
    if (hopper && walking) y += Math.abs(Math.sin(phase.current)) * 0.15;
    if (asleep) y -= model.legTop * 0.85;
    if (fly) y += Math.sin(t * 2 + phase.current) * 0.12;
    if (body.current) body.current.position.y = y;
  });
  let li = 0, wi = 0;
  return (
    <group ref={g}>
      <group ref={body}>
        <mesh geometry={bodyGeometry(kind, variant)} material={BODY_MAT} castShadow />
        {model.boxes.map((b, i) => {
          const m = mat(colorOf(b.c, pal));
          if (b.leg !== undefined) {
            const idx = li++;
            return (
              <group key={i} position={[b.p[0], model.legTop, b.p[2]]} ref={(el) => { legs.current[idx] = el; }}>
                <mesh geometry={BOX} material={m} position={[0, b.p[1], 0]} scale={b.s} castShadow />
              </group>
            );
          }
          if (b.wing) {
            const idx = wi++;
            return <mesh key={i} ref={(el) => { wings.current[idx] = el; }} geometry={BOX} material={m} position={b.p} scale={b.s} castShadow={!fly} />;
          }
          return null; // part of the merged body mesh
        })}
      </group>
      <AnimalBubble id={id} />
    </group>
  );
}

/** All animals on the island (simulated by the server, identical for everyone). */
export function Animals() {
  const list = useGame((s) => s.animals);
  return <>{list.filter((a) => isAnimalKind(a.kind)).map((a) => <Animal key={a.id} id={a.id} kind={a.kind as AnimalKind} variant={a.variant} />)}</>;
}
