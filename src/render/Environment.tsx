import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { IslandLayout } from '@jp/blocksy-shared';
import { createSignTexture, createWaterTexture } from './textures';
import { localBody } from '../game/localState';

const SUN_DIR = new THREE.Vector3(-0.45, 0.75, -0.5).normalize();

/** Sunny-island atmosphere from the references: warm sun + soft shadows, sky, fog, sea, square sun, clouds, gulls, signs, lantern glow. */
export function Environment({ layout }: { layout: IslandLayout }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);

  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    scene.add(l.target);
    l.shadow.camera.layers.enable(1); // the hidden first-person body still casts a shadow
    return () => { scene.remove(l.target); };
  }, [scene]);

  useFrame(() => {
    const l = sun.current;
    if (!l) return;
    l.target.position.set(localBody.x, localBody.y, localBody.z);
    l.position.set(localBody.x + SUN_DIR.x * 60, localBody.y + SUN_DIR.y * 60, localBody.z + SUN_DIR.z * 60);
  });

  return (
    <>
      <color attach="background" args={['#86c4ff']} />
      <fog attach="fog" args={['#a9d4fb', 60, 175]} />
      <hemisphereLight args={['#e3f1ff', '#8a7558', 1.3]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        ref={sun}
        color="#fff1d6"
        intensity={2.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0006}
        shadow-normalBias={0.04}
      />
      <Sea layout={layout} />
      <SunDisc />
      <Clouds layout={layout} />
      <Seagulls layout={layout} />
      <Signs layout={layout} />
      <LanternLights layout={layout} />
    </>
  );
}

function Sea({ layout }: { layout: IslandLayout }) {
  const tex = useMemo(() => { const t = createWaterTexture(); t.repeat.set(300, 300); return t; }, []);
  useFrame((s) => { tex.offset.set(s.clock.elapsedTime * 0.004, s.clock.elapsedTime * 0.002); });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[layout.center.x, layout.waterLevel, layout.center.z]} receiveShadow>
      <planeGeometry args={[900, 900]} />
      <meshLambertMaterial map={tex} transparent opacity={0.9} />
    </mesh>
  );
}

function SunDisc() {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.position.copy(camera.position).addScaledVector(SUN_DIR, 400);
    m.lookAt(camera.position);
  });
  return (
    <mesh ref={ref} renderOrder={-1}>
      <planeGeometry args={[26, 26]} />
      <meshBasicMaterial color="#fff8d2" fog={false} />
    </mesh>
  );
}

function Clouds({ layout }: { layout: IslandLayout }) {
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(() => {
    let seed = 42;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 18 }, () => {
      const a = r() * Math.PI * 2, d = 50 + r() * 160;
      return { x: layout.center.x + Math.cos(a) * d, y: 46 + r() * 14, z: layout.center.z + Math.sin(a) * d, w: 10 + r() * 22, l: 6 + r() * 12, speed: 1.2 + r() };
    });
  }, [layout]);
  useFrame((_, dt) => {
    group.current?.children.forEach((c, i) => {
      c.position.x += clouds[i].speed * dt;
      if (c.position.x > layout.center.x + 240) c.position.x = layout.center.x - 240;
    });
  });
  return (
    <group ref={group}>
      {clouds.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} scale={[c.w, 2, c.l]}>
          <boxGeometry />
          <meshBasicMaterial color="#fbfdff" />
        </mesh>
      ))}
    </group>
  );
}

function Seagulls({ layout }: { layout: IslandLayout }) {
  const birds = useRef<(THREE.Group | null)[]>([]);
  useFrame((s) => {
    const t0 = s.clock.elapsedTime;
    birds.current.forEach((b, i) => {
      if (!b) return;
      const radius = 10 + i * 5, t = t0 * (4.5 / radius) + i * 1.7;
      b.position.set(layout.center.x + Math.cos(t) * radius, 18 + i * 2.5 + Math.sin(t * 2.3) * 0.8, layout.center.z + Math.sin(t) * radius);
      b.rotation.set(0, Math.atan2(-Math.sin(t), Math.cos(t)), 0.2);
      const flap = Math.sin(t0 * 7 + i) * 0.5;
      (b.children[3] as THREE.Object3D).rotation.z = flap;
      (b.children[4] as THREE.Object3D).rotation.z = -flap;
    });
  });
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} ref={(g) => { birds.current[i] = g; }}>
          <mesh scale={[0.35, 0.3, 0.8]}><boxGeometry /><meshLambertMaterial color="#f7f7f7" /></mesh>
          <mesh position={[0, 0.12, 0.45]} scale={0.26}><boxGeometry /><meshLambertMaterial color="#f7f7f7" /></mesh>
          <mesh position={[0, 0.08, 0.64]} scale={[0.1, 0.08, 0.16]}><boxGeometry /><meshLambertMaterial color="#f9b733" /></mesh>
          <group position={[0.17, 0.08, 0]}><mesh position={[0.45, 0, 0]} scale={[0.9, 0.05, 0.4]}><boxGeometry /><meshLambertMaterial color="#cfd3db" /></mesh></group>
          <group position={[-0.17, 0.08, 0]}><mesh position={[-0.45, 0, 0]} scale={[0.9, 0.05, 0.4]}><boxGeometry /><meshLambertMaterial color="#cfd3db" /></mesh></group>
        </group>
      ))}
    </>
  );
}

function Sign({ text, position, yaw, w, h }: { text: string; position: [number, number, number]; yaw: number; w: number; h: number }) {
  const tex = useMemo(() => createSignTexture(text, w, h), [text, w, h]);
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <mesh scale={[w, h, 0.1]} castShadow><boxGeometry /><meshLambertMaterial color="#8a5f37" /></mesh>
      <mesh position={[0, 0, 0.052]}><planeGeometry args={[w, h]} /><meshLambertMaterial map={tex} /></mesh>
    </group>
  );
}

function Signs({ layout }: { layout: IslandLayout }) {
  return (
    <>
      {layout.signs.map((s, i) => <Sign key={`s${i}`} text={s.text} position={[s.x, s.y, s.z]} yaw={s.yaw} w={1.5} h={0.75} />)}
      {layout.stalls.map((s, i) => <Sign key={`t${i}`} text={s.title} position={[s.sign.x, s.sign.y, s.sign.z]} yaw={s.sign.yaw} w={2.6} h={0.9} />)}
    </>
  );
}

function LanternLights({ layout }: { layout: IslandLayout }) {
  // Point lights are expensive in forward rendering: light the 6 lanterns closest to the spawn.
  const picks = useMemo(() => [...layout.lanterns]
    .sort((a, b) => Math.hypot(a[0] - layout.spawn.x, a[2] - layout.spawn.z) - Math.hypot(b[0] - layout.spawn.x, b[2] - layout.spawn.z))
    .slice(0, 6), [layout]);
  return <>{picks.map(([x, y, z], i) => <pointLight key={i} position={[x + 0.5, y + 0.3, z + 0.5]} color="#ffb860" intensity={5} distance={6} decay={2} />)}</>;
}
