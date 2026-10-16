import { useRef } from 'react';

type Ref<T> = { readonly current: T | null };
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getBlock, voxelRaycast } from '@jp/blocksy-shared';
import { world } from '../game/world';

/** Names, chat bubbles and emoji only show within this distance (m) of the camera. */
export const LABEL_RANGE = 18;

const p = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3();

/** Blocks you can't see through: full opaque or leafy cubes (not glass, water, plants, fences, lanterns). */
function opaque(x: number, y: number, z: number): boolean {
  const id = world.grid?.get(x, y, z);
  if (!id) return false;
  const d = getBlock(id);
  return !!d && d.solid && d.shape === 'cube' && d.layer !== 2;
}

/** Pure check: visible from the camera at `from` to the label at `to`? (exported for tests) */
export function labelVisible(from: THREE.Vector3, to: THREE.Vector3, solid: (x: number, y: number, z: number) => boolean = opaque): boolean {
  const d = from.distanceTo(to);
  if (d > LABEL_RANGE) return false;
  if (d < 0.6) return true;
  dir.subVectors(to, from).divideScalar(d);
  return !voxelRaycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, d - 0.35, solid).hit;
}

/**
 * Hides a label (name, bubble, emoji) when it is far away or something solid — a wall, a tree, the ground —
 * is between it and the camera. Checked ~10× a second; the label fades in/out (CSS transition on opacity).
 */
export function useLabelVisibility(anchor: Ref<THREE.Object3D>, el: Ref<HTMLElement>): void {
  const { camera } = useThree();
  const st = useRef({ next: Math.random() * 0.1, shown: true });
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (t < st.current.next) return;
    st.current.next = t + 0.1;
    const o = anchor.current, e = el.current;
    if (!o || !e) return;
    o.getWorldPosition(p);
    camera.getWorldPosition(c);
    const show = labelVisible(c, p);
    if (show !== st.current.shown) {
      st.current.shown = show;
      e.style.opacity = show ? '1' : '0';
      e.style.visibility = show ? 'visible' : 'hidden';
    }
  });
}
