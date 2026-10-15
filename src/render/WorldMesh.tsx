import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, blockFaceUv, buildChunkMesh } from '@jp/blocksy-shared';
import { world } from '../game/world';
import { applyMeshData, getBlockMaterials } from './textures';

/**
 * Renders the grid as chunk meshes. Meshes are created/updated imperatively from the world's dirty set
 * (React never re-renders per edit). After the first full build, at most 8 chunks rebuild per frame.
 */
export function WorldMesh() {
  const group = useRef<THREE.Group>(null);
  const meshes = useRef(new Map<string, THREE.Mesh>());

  useEffect(() => () => {
    for (const m of meshes.current.values()) m.geometry.dispose();
    meshes.current.clear();
  }, []);

  useFrame(() => {
    const g = world.grid, root = group.current;
    if (!g || !root || world.dirty.size === 0) return;
    let budget = meshes.current.size === 0 ? Number.POSITIVE_INFINITY : 8;
    for (const key of world.dirty) {
      if (budget-- <= 0) break;
      world.dirty.delete(key);
      const [cx, cy, cz] = key.split(',').map(Number);
      if (cx < 0 || cy < 0 || cz < 0 || cx * CHUNK_SIZE >= g.sx || cy * CHUNK_SIZE >= g.sy || cz * CHUNK_SIZE >= g.sz) continue;
      const data = buildChunkMesh(g, cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE, CHUNK_SIZE, blockFaceUv);
      let mesh = meshes.current.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BufferGeometry(), getBlockMaterials());
        mesh.position.set(cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        meshes.current.set(key, mesh);
        root.add(mesh);
      }
      mesh.visible = data.indices.length > 0;
      if (mesh.visible) applyMeshData(mesh.geometry, data);
    }
  });

  return <group ref={group} />;
}
