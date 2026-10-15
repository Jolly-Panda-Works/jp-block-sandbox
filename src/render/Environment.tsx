import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { skyAt, type IslandLayout } from '@jp/blocksy-shared';
import { currentClock } from '../net/network';
import { QUALITY, useGame } from '../state/store';
import { createSignTexture, createWaterTexture } from './textures';
import { localBody } from '../game/localState';

/** Live sky state for this frame (updated by Environment from the in-game clock). */
const live = {
  sun: new THREE.Vector3(0, 1, 0), light: new THREE.Vector3(0, 1, 0), stars: 0, lanterns: 0,
};
const CLOUD_MAT = new THREE.MeshBasicMaterial({ color: '#fbfdff' });

/** Sunny-island atmosphere from the references: warm sun + soft shadows, sky, fog, sea, square sun, clouds, gulls, signs, lantern glow. */
/** Island atmosphere driven by the in-game clock: sun / moon, sky, fog, lights, stars, lantern glow. */
export function Environment({ layout }: { layout: IslandLayout }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const amb = useRef<THREE.AmbientLight>(null);
  const bg = useMemo(() => new THREE.Color('#86c4ff'), []);
  const fog = useMemo(() => new THREE.Fog('#a9d4fb', 75, 220), []);

  useEffect(() => {
    const l = sun.current;
    scene.background = bg;
    scene.fog = fog;
    if (!l) return;
    scene.add(l.target);
    l.shadow.camera.layers.enable(1); // the hidden first-person body still casts a shadow
    return () => { scene.remove(l.target); };
  }, [scene, bg, fog]);

  const quality = useGame((s) => s.quality);
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const size = QUALITY[quality].shadowMap;
    l.castShadow = size > 0;
    if (size > 0 && l.shadow.mapSize.x !== size) {
      l.shadow.mapSize.set(size, size);
      l.shadow.map?.dispose();
      (l.shadow as { map: unknown }).map = null;   // re-created at the new size
    }
  }, [quality]);

  useFrame(() => {
    const k = skyAt(currentClock().hour);
    live.sun.set(...k.sunDir);
    live.light.set(...k.lightDir);
    live.stars = k.stars;
    live.lanterns = k.lanterns;
    bg.set(k.background);
    fog.color.set(k.fog);
    CLOUD_MAT.color.set(k.cloud);
    if (hemi.current) { hemi.current.color.set(k.hemiSky); hemi.current.groundColor.set(k.hemiGround); hemi.current.intensity = k.hemiIntensity; }
    if (amb.current) amb.current.intensity = k.ambient;
    const l = sun.current;
    if (!l) return;
    l.color.set(k.lightColor);
    l.intensity = k.lightIntensity;
    l.target.position.set(localBody.x, localBody.y, localBody.z);
    l.position.set(localBody.x + live.light.x * 60, localBody.y + live.light.y * 60, localBody.z + live.light.z * 60);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#e3f1ff', '#8a7558', 1.3]} />
      <ambientLight ref={amb} intensity={0.6} />
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
      <MoonDisc />
      <Stars />
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

/** Square sun: follows the in-game sun, hidden below the horizon. */
function SunDisc() {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.visible = live.sun.y > -0.05;
    m.position.copy(camera.position).addScaledVector(live.sun, 400);
    m.lookAt(camera.position);
  });
  return (
    <mesh ref={ref} renderOrder={-1}>
      <planeGeometry args={[26, 26]} />
      <meshBasicMaterial color="#fff8d2" fog={false} />
    </mesh>
  );
}

/** Square moon opposite the sun. */
function MoonDisc() {
  const ref = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    dir.copy(live.sun).negate();
    m.visible = dir.y > -0.05;
    m.position.copy(camera.position).addScaledVector(dir, 400);
    m.lookAt(camera.position);
  });
  return (
    <mesh ref={ref} renderOrder={-1}>
      <planeGeometry args={[16, 16]} />
      <meshBasicMaterial color="#e8eefc" fog={false} />
    </mesh>
  );
}

/** Night sky: a dome of square stars that fades in after dusk. */
function Stars() {
  const ref = useRef<THREE.Points>(null);
  const { camera } = useThree();
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 600; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const y = Math.abs(u) * 0.9 + 0.1, r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(th) * r * 380, y * 380, Math.sin(th) * r * 380);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }), []);
  useFrame(() => {
    const p = ref.current;
    if (!p) return;
    p.position.copy(camera.position);
    mat.opacity = live.stars;
    p.visible = live.stars > 0.01;
  });
  return <points ref={ref} geometry={geo} material={mat} renderOrder={-2} />;
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
          <primitive object={CLOUD_MAT} attach="material" />
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
  // They glow brightly at night and fade out by day.
  const picks = useMemo(() => [...layout.lanterns]
    .sort((a, b) => Math.hypot(a[0] - layout.spawn.x, a[2] - layout.spawn.z) - Math.hypot(b[0] - layout.spawn.x, b[2] - layout.spawn.z))
    .slice(0, 6), [layout]);
  const refs = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => { for (const l of refs.current) if (l) l.intensity = 1.5 + live.lanterns * 9; });
  return <>{picks.map(([x, y, z], i) => <pointLight key={i} ref={(el) => { refs.current[i] = el; }} position={[x + 0.5, y + 0.3, z + 0.5]} color="#ffb860" intensity={5} distance={live.lanterns > 0.5 ? 9 : 6} decay={2} />)}</>;
}
