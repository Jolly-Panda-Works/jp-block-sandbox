import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { QUALITY, setQuality, useGame } from '../state/store';
import { cull, updateCull } from './cull';
import { fx } from './particleFx';

/** Runs first each frame: updates the view-culling frustum and applies the quality level. */
export function CullUpdater() {
  const { camera } = useThree();
  const quality = useGame((s) => s.quality);
  const touchScale = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 0.6 : 1;
  fx.density = QUALITY[quality].particles * touchScale;
  useFrame(() => {
    cull.viewDistance = QUALITY[quality].viewDistance;
    updateCull(camera);
  });
  return null;
}

/**
 * Automatic quality: if the game keeps running below ~28 FPS (two 4-second windows in a row), lower the
 * graphics quality one step and say so. It never raises it on its own (Settings → Graphics does).
 */
export function PerfGuard() {
  const st = useRef({ frames: 0, time: 0, slow: 0, cooldown: 0 });
  useFrame((_, dt) => {
    const s = st.current;
    if (document.visibilityState !== 'visible' || dt > 0.5) return;   // ignore background tabs / hitches
    s.frames++; s.time += dt;
    if (s.time < 4) return;
    const fps = s.frames / s.time;
    s.frames = 0; s.time = 0;
    if (s.cooldown > 0) { s.cooldown--; return; }
    s.slow = fps < 28 ? s.slow + 1 : 0;
    const g = useGame.getState();
    if (s.slow >= 2 && g.quality !== 'low' && g.panel === 'none') {
      setQuality(g.quality === 'high' ? 'medium' : 'low');
      g.showToast(`Graphics lowered for smoother play (${Math.round(fps)} FPS) — Settings → Graphics`);
      s.slow = 0; s.cooldown = 3;
    }
  });
  return null;
}
