import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { isNight } from '@jp/blocksy-shared';
import { MAX_GLOW, MAX_LIT, firefly, fx, glow, lit, stepParticles } from './particles';
import { currentClock } from '../net/network';
import { localBody } from '../game/localState';
import { useGame } from '../state/store';

/** Renders all particles and spawns night-time fireflies around the player. */
export function Particles() {
  const litMesh = useRef<THREE.InstancedMesh>(null);
  const glowMesh = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const litMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#ffffff' }), []);
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, fog: false }), []);
  const nextFly = useRef(0);
  const enabled = useGame((s) => s.particles);
  fx.enabled = enabled;

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05), t = state.clock.elapsedTime;
    // Fireflies drift around the player at night.
    if (fx.enabled && isNight(currentClock().hour) && t > nextFly.current) {
      nextFly.current = t + 0.25 / fx.density;
      const flies = glow.filter((p) => p.curve === 1).length;
      if (flies < 45 * fx.density) {
        const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 11;
        firefly(localBody.x + Math.cos(a) * r, localBody.y + 0.6 + Math.random() * 2.2, localBody.z + Math.sin(a) * r);
      }
    }
    stepParticles(lit, litMesh.current, dt, t);
    stepParticles(glow, glowMesh.current, dt, t);
  });

  return (
    <>
      <instancedMesh ref={litMesh} args={[geo, litMat, MAX_LIT]} frustumCulled={false} castShadow={false} />
      <instancedMesh ref={glowMesh} args={[geo, glowMat, MAX_GLOW]} frustumCulled={false} castShadow={false} />
    </>
  );
}
