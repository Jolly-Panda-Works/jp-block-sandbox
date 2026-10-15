import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { animalStates } from '../net/network';

type Box = { p: [number, number, number]; s: [number, number, number]; c: string; leg?: number };

/** Blocky, original farm animals. Legs (leg: 0..3) swing while walking. Model faces +Z. */
const MODELS: Record<string, Box[]> = {
  cow: [
    { p: [0, 0.85, 0], s: [0.62, 0.62, 1.2], c: '#f4f1ea' },
    { p: [0.315, 0.9, 0.15], s: [0.02, 0.3, 0.35], c: '#2b2b2b' }, { p: [-0.315, 0.8, -0.25], s: [0.02, 0.28, 0.4], c: '#2b2b2b' },
    { p: [0, 1.12, -0.1], s: [0.4, 0.02, 0.4], c: '#2b2b2b' },
    { p: [0, 1.0, 0.78], s: [0.46, 0.46, 0.4], c: '#f4f1ea' }, { p: [0, 0.88, 1.0], s: [0.3, 0.18, 0.06], c: '#f2b5b5' },
    { p: [0.17, 1.26, 0.78], s: [0.08, 0.1, 0.08], c: '#e6dcc5' }, { p: [-0.17, 1.26, 0.78], s: [0.08, 0.1, 0.08], c: '#e6dcc5' },
    { p: [0.12, 1.06, 0.985], s: [0.08, 0.08, 0.02], c: '#1d1d1d' }, { p: [-0.12, 1.06, 0.985], s: [0.08, 0.08, 0.02], c: '#1d1d1d' },
    { p: [0.2, -0.27, 0.4], s: [0.2, 0.55, 0.2], c: '#e8e2d6', leg: 0 }, { p: [-0.2, -0.27, 0.4], s: [0.2, 0.55, 0.2], c: '#e8e2d6', leg: 1 },
    { p: [0.2, -0.27, -0.4], s: [0.2, 0.55, 0.2], c: '#e8e2d6', leg: 1 }, { p: [-0.2, -0.27, -0.4], s: [0.2, 0.55, 0.2], c: '#e8e2d6', leg: 0 },
  ],
  sheep: [
    { p: [0, 0.75, 0], s: [0.62, 0.58, 0.9], c: '#f1f0e9' },
    { p: [0, 0.86, 0.56], s: [0.34, 0.34, 0.32], c: '#3d3a38' }, { p: [0, 1.02, 0.5], s: [0.38, 0.12, 0.24], c: '#f1f0e9' },
    { p: [0.09, 0.92, 0.725], s: [0.06, 0.06, 0.02], c: '#f5f5f5' }, { p: [-0.09, 0.92, 0.725], s: [0.06, 0.06, 0.02], c: '#f5f5f5' },
    { p: [0.17, -0.22, 0.28], s: [0.14, 0.44, 0.14], c: '#3d3a38', leg: 0 }, { p: [-0.17, -0.22, 0.28], s: [0.14, 0.44, 0.14], c: '#3d3a38', leg: 1 },
    { p: [0.17, -0.22, -0.28], s: [0.14, 0.44, 0.14], c: '#3d3a38', leg: 1 }, { p: [-0.17, -0.22, -0.28], s: [0.14, 0.44, 0.14], c: '#3d3a38', leg: 0 },
  ],
  pig: [
    { p: [0, 0.55, 0], s: [0.56, 0.5, 0.86], c: '#f2a7a7' },
    { p: [0, 0.62, 0.56], s: [0.42, 0.4, 0.34], c: '#f2a7a7' }, { p: [0, 0.56, 0.75], s: [0.2, 0.14, 0.06], c: '#e48787' },
    { p: [0.11, 0.7, 0.735], s: [0.07, 0.07, 0.02], c: '#1d1d1d' }, { p: [-0.11, 0.7, 0.735], s: [0.07, 0.07, 0.02], c: '#1d1d1d' },
    { p: [0, 0.62, -0.46], s: [0.06, 0.06, 0.1], c: '#e48787' },
    { p: [0.16, -0.15, 0.26], s: [0.14, 0.3, 0.14], c: '#e99a9a', leg: 0 }, { p: [-0.16, -0.15, 0.26], s: [0.14, 0.3, 0.14], c: '#e99a9a', leg: 1 },
    { p: [0.16, -0.15, -0.26], s: [0.14, 0.3, 0.14], c: '#e99a9a', leg: 1 }, { p: [-0.16, -0.15, -0.26], s: [0.14, 0.3, 0.14], c: '#e99a9a', leg: 0 },
  ],
  cat: [
    { p: [0, 0.3, 0], s: [0.24, 0.22, 0.52], c: '#e0893c' }, { p: [0, 0.3, 0.05], s: [0.245, 0.06, 0.1], c: '#c06a26' },
    { p: [0, 0.43, 0.32], s: [0.26, 0.24, 0.22], c: '#e0893c' },
    { p: [0.08, 0.58, 0.32], s: [0.06, 0.08, 0.05], c: '#c06a26' }, { p: [-0.08, 0.58, 0.32], s: [0.06, 0.08, 0.05], c: '#c06a26' },
    { p: [0.06, 0.46, 0.435], s: [0.05, 0.05, 0.02], c: '#3fa34d' }, { p: [-0.06, 0.46, 0.435], s: [0.05, 0.05, 0.02], c: '#3fa34d' },
    { p: [0, 0.48, -0.36], s: [0.06, 0.32, 0.06], c: '#c06a26' },
    { p: [0.08, -0.1, 0.18], s: [0.07, 0.2, 0.07], c: '#e0893c', leg: 0 }, { p: [-0.08, -0.1, 0.18], s: [0.07, 0.2, 0.07], c: '#e0893c', leg: 1 },
    { p: [0.08, -0.1, -0.18], s: [0.07, 0.2, 0.07], c: '#e0893c', leg: 1 }, { p: [-0.08, -0.1, -0.18], s: [0.07, 0.2, 0.07], c: '#e0893c', leg: 0 },
  ],
};
const LEG_TOP: Record<string, number> = { cow: 0.55, sheep: 0.45, pig: 0.3, cat: 0.2 };
const mats = new Map<string, THREE.MeshLambertMaterial>();
const mat = (c: string) => { let m = mats.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); mats.set(c, m); } return m; };
const BOX = new THREE.BoxGeometry(1, 1, 1);

function Animal({ id, kind }: { id: string; kind: string }) {
  const g = useRef<THREE.Group>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const phase = useRef(Math.random() * 6);
  useFrame((_, rawDt) => {
    const a = animalStates.get(id), grp = g.current;
    if (!a || !grp) return;
    const dt = Math.min(rawDt, 0.05), k = 1 - Math.exp(-10 * dt);
    if (Math.hypot(a.x - a.rx, a.z - a.rz) > 6) { a.rx = a.x; a.ry = a.y; a.rz = a.z; }
    a.rx += (a.x - a.rx) * k; a.ry += (a.y - a.ry) * k; a.rz += (a.z - a.rz) * k;
    a.ryaw += Math.atan2(Math.sin(a.yaw - a.ryaw), Math.cos(a.yaw - a.ryaw)) * k;
    grp.position.set(a.rx, a.ry, a.rz);
    grp.rotation.y = a.ryaw;
    if (a.moving) phase.current += dt * (kind === 'cat' ? 14 : 8);
    const swing = a.moving ? Math.sin(phase.current) * 0.5 : 0;
    legs.current.forEach((l, i) => { if (l) l.rotation.x = i % 2 === 0 ? swing : -swing; });
  });
  const model = MODELS[kind] ?? MODELS.sheep;
  const top = LEG_TOP[kind] ?? 0.4;
  let legIndex = 0;
  return (
    <group ref={g}>
      {model.map((b, i) => {
        if (b.leg === undefined) return <mesh key={i} geometry={BOX} material={mat(b.c)} position={b.p} scale={b.s} castShadow />;
        const li = legIndex++;
        return (
          <group key={i} position={[b.p[0], top, b.p[2]]} ref={(el) => { legs.current[li] = el; }}>
            <mesh geometry={BOX} material={mat(b.c)} position={[0, b.p[1], 0]} scale={b.s} castShadow />
          </group>
        );
      })}
    </group>
  );
}

/** Cows, sheep, pigs and cats wandering the island (simulated by the server, same for everyone). */
export function Animals() {
  const list = useGame((s) => s.animals);
  return <>{list.map((a) => <Animal key={a.id} id={a.id} kind={a.kind} />)}</>;
}
