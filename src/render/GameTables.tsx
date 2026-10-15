import { useMemo } from 'react';
import * as THREE from 'three';
import type { MgListing, MiniGameKind } from '@jp/blocksy-shared';
import { useGame } from '../state/store';

/** Board art painted on the table top (the live board is in the 2D panel). */
function boardTexture(kind: MiniGameKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a2a1c';
  g.fillRect(0, 0, 256, 256);
  if (kind === 'chess') {
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      g.fillStyle = (r + f) % 2 ? '#a0703f' : '#ecd8b3';
      g.fillRect(16 + f * 28, 16 + r * 28, 28, 28);
    }
  } else if (kind === 'ttt') {
    g.fillStyle = '#20262e';
    g.fillRect(24, 24, 208, 208);
    g.strokeStyle = '#59636f';
    g.lineWidth = 6;
    for (const k of [1, 2]) {
      g.beginPath(); g.moveTo(24 + k * 69, 34); g.lineTo(24 + k * 69, 222); g.stroke();
      g.beginPath(); g.moveTo(34, 24 + k * 69); g.lineTo(222, 24 + k * 69); g.stroke();
    }
  } else {
    g.fillStyle = '#f4f4f4';
    g.fillRect(16, 16, 224, 224);
    const q: [string, number, number][] = [['#e53935', 16, 16], ['#43a047', 136, 16], ['#fbc02d', 136, 136], ['#1e88e5', 16, 136]];
    for (const [col, x, y] of q) { g.fillStyle = col; g.fillRect(x, y, 104, 104); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const WOOD = new THREE.MeshLambertMaterial({ color: '#9b6b3d' });
const DARK = new THREE.MeshLambertMaterial({ color: '#6e4a2a' });

function Table({ g }: { g: MgListing }) {
  const top = useMemo(() => new THREE.MeshLambertMaterial({ map: boardTexture(g.kind) }), [g.kind]);
  return (
    <group>
      <group position={[g.x, g.y, g.z]}>
        <mesh position={[0, 0.66, 0]} castShadow receiveShadow material={WOOD}><boxGeometry args={[1.1, 0.08, 1.1]} /></mesh>
        <mesh position={[0, 0.705, 0]} rotation={[-Math.PI / 2, 0, 0]} material={top}><planeGeometry args={[0.9, 0.9]} /></mesh>
        {[[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([x, z], i) => (
          <mesh key={i} position={[x, 0.31, z]} castShadow material={DARK}><boxGeometry args={[0.08, 0.62, 0.08]} /></mesh>
        ))}
      </group>
      {g.seats.map((s) => (
        <mesh key={s.id} position={[s.x - Math.sin(s.yaw) * 0.12, g.y + 0.2, s.z - Math.cos(s.yaw) * 0.12]} castShadow material={DARK}>
          <boxGeometry args={[0.42, 0.4, 0.42]} />
        </mesh>
      ))}
    </group>
  );
}

/** A table with stools appears wherever a board game (Tic Tac Toe, Chess, Ludo) is being played. */
export function GameTables() {
  const games = useGame((s) => s.games);
  return <>{games.filter((g) => g.kind !== 'rps').map((g) => <Table key={g.id} g={g} />)}</>;
}
