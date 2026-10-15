import { useMemo } from 'react';
import * as THREE from 'three';

/** Original blocky hammer (the destroy tool, key 0). Handle along +Y, head at the top. */
export function Hammer({ overlay = false }: { overlay?: boolean }) {
  const [wood, iron] = useMemo(() => [
    new THREE.MeshLambertMaterial({ color: '#8a5a32', depthTest: !overlay }),
    new THREE.MeshLambertMaterial({ color: '#9aa3ad', depthTest: !overlay }),
  ], [overlay]);
  const order = overlay ? 1001 : 0;
  return (
    <group>
      <mesh material={wood} position={[0, 0.2, 0]} scale={[0.06, 0.46, 0.06]} renderOrder={order} castShadow={!overlay}><boxGeometry /></mesh>
      <mesh material={iron} position={[0, 0.44, 0]} scale={[0.26, 0.11, 0.12]} renderOrder={order} castShadow={!overlay}><boxGeometry /></mesh>
      <mesh material={iron} position={[0.15, 0.44, 0]} scale={[0.05, 0.16, 0.14]} renderOrder={order} castShadow={!overlay}><boxGeometry /></mesh>
    </group>
  );
}
