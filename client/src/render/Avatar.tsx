import { useMemo, useRef, type ReactNode } from 'react';
import { Hammer } from './Hammer';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { AIR, HAND_ANCHOR, JOINTS, MODEL_SCALE, buildAvatarParts, type Appearance, type AvatarPart, type Joint } from '@jp/block-sandbox-shared';
import { getBlockGeometry, getBlockMaterials } from './textures';
import { now, type AnimState } from './animState';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const materialCache = new Map<string, THREE.MeshLambertMaterial>();
let fabric: THREE.DataTexture | null = null;

/** Subtle 8×8 noise so clothing reads as pixel art. */
function fabricTexture(): THREE.DataTexture {
  if (fabric) return fabric;
  const data = new Uint8Array(8 * 8 * 4);
  let seed = 7;
  for (let i = 0; i < 64; i++) {
    seed = (seed * 16807) % 2147483647;
    const v = 255 - ((seed % 1000) / 1000) * 34;
    data.set([v, v, v, 255], i * 4);
  }
  fabric = new THREE.DataTexture(data, 8, 8);
  fabric.magFilter = THREE.NearestFilter;
  fabric.needsUpdate = true;
  return fabric;
}

function material(color: string): THREE.MeshLambertMaterial {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, map: fabricTexture() });
    materialCache.set(color, m);
  }
  return m;
}

function Part({ p }: { p: AvatarPart }) {
  return <mesh geometry={BOX} material={material(p.color)} position={p.pos} scale={p.size} rotation={p.rot ?? [0, 0, 0]} castShadow receiveShadow />;
}

interface Props { appearance: Appearance; anim: AnimState; heldBlock?: number; hammer?: boolean }

/**
 * Blocky character built from {@link buildAvatarParts} with procedural animation:
 * walk cycle, idle sway, airborne pose, use-swing and the Happy / Cry / Wave emotes.
 */
export function Avatar({ appearance, anim, heldBlock = AIR, hammer = false }: Props) {
  const parts = useMemo(() => buildAvatarParts(appearance), [appearance]);
  const by = (j: Joint): ReactNode => parts.filter((p) => p.joint === j).map((p, i) => <Part key={`${j}${i}`} p={p} />);
  const offset = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null), head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const st = useRef({ phase: 0, speed: 0 });
  const heldGeo = heldBlock !== AIR ? getBlockGeometry(heldBlock) : null;

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), t = now();
    const s = st.current;
    s.speed += Math.sign(Math.min(anim.speed, 1.5) - s.speed) * Math.min(Math.abs(Math.min(anim.speed, 1.5) - s.speed), dt * 6);
    s.phase += s.speed * 11 * dt;
    if (anim.emote && (anim.speed > 0.25 || t - anim.emoteStart > 2.8)) anim.emote = null; // moving cancels emotes

    const amp = Math.min(1, s.speed);
    const walk = Math.sin(s.phase) * 0.66 * amp;
    const idle = Math.sin(t * 1.7) * 0.044 * (1 - amp);
    let lL = walk, lR = -walk, aLx = -walk * 0.8 + idle, aRx = walk * 0.8 - idle, aLz = 0.05, aRz = -0.05, hX = 0, hZ = 0, y = 0;
    if (!anim.grounded) { lL = -0.38; lR = 0.24; aLz = 0.49; aRz = -0.49; aLx = aRx = -0.17; }
    if (anim.holding && !anim.emote) aRx = Math.min(aRx, -0.31 + walk * 0.25);

    const e = t - anim.emoteStart;
    switch (anim.emote) {
      case 'happy':
        aLx = aRx = 0; aLz = 2.62 + Math.sin(e * 12) * 0.17; aRz = -2.62 - Math.sin(e * 12) * 0.17;
        y = Math.abs(Math.sin(e * 6)) * 0.18; hX = -0.17; lL = lR = 0;
        break;
      case 'cry':
        y = -0.5; lL = lR = -1.48; aLx = aRx = -2.53; aLz = -0.24; aRz = 0.24; hX = 0.31; hZ = Math.sin(e * 14) * 0.07;
        break;
      case 'wave':
        aRx = 0; aRz = -2.62 + Math.sin(e * 9) * 0.38; hZ = 0.09;
        break;
    }
    const sw = (t - anim.swingStart) / 0.28;
    if (sw >= 0 && sw < 1) { aRx = -0.21 - Math.sin(sw * Math.PI) * 1.4; aRz = -0.1; }

    legL.current?.rotation.set(lL, 0, 0);
    legR.current?.rotation.set(lR, 0, 0);
    armL.current?.rotation.set(aLx, 0, aLz);
    armR.current?.rotation.set(aRx, 0, aRz);
    head.current?.rotation.set(hX, 0, hZ);
    offset.current?.position.set(0, y, 0);
  });

  return (
    <group ref={offset}>
      <group scale={MODEL_SCALE}>
        <group ref={legL} position={JOINTS.legL}>{by('legL')}</group>
        <group ref={legR} position={JOINTS.legR}>{by('legR')}</group>
        <group position={JOINTS.torso}>
          {by('torso')}
          <group ref={head} position={JOINTS.head}>{by('head')}</group>
          <group ref={armL} position={JOINTS.armL}>{by('armL')}</group>
          <group ref={armR} position={JOINTS.armR}>
            {by('armR')}
            {hammer && (
              <group position={HAND_ANCHOR} rotation={[Math.PI / 2, 0, 0]} scale={1 / MODEL_SCALE}><Hammer /></group>
            )}
            {!hammer && heldGeo && (
              <mesh geometry={heldGeo} material={getBlockMaterials()} position={HAND_ANCHOR} scale={0.3 / MODEL_SCALE} rotation={[0, Math.PI / 4, 0]} castShadow />
            )}
          </group>
        </group>
      </group>
    </group>
  );
}
