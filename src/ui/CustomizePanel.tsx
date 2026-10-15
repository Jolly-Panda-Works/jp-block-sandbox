import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  DEFAULT_APPEARANCE, GLASSES_STYLES, HAIR_STYLES, HAT_STYLES, PALETTES, PANTS_STYLES, SHIRT_STYLES, SHOE_STYLES,
  WATCH_STYLES, createRng, cycle, randomAppearance, type Appearance,
} from '@jp/blocksy-shared';
import { Avatar } from '../render/Avatar';
import { getAnim, playEmote } from '../render/animState';
import { useGame } from '../state/store';
import { send } from '../net/network';
import { openPanel } from '../game/pointer';

type StyleKey = 'hair' | 'shirt' | 'pants' | 'shoes' | 'hat' | 'glasses' | 'watch';
type ColorKey = 'skin' | 'hairColor' | 'shirtColor' | 'pantsColor' | 'shoeColor' | 'hatColor' | 'glassesColor' | 'watchColor';
interface Row { label: string; style?: [StyleKey, readonly string[]]; color: ColorKey; palette: readonly string[] }

const ROWS: Row[] = [
  { label: 'Skin', color: 'skin', palette: PALETTES.skin },
  { label: 'Hair', style: ['hair', HAIR_STYLES], color: 'hairColor', palette: PALETTES.hair },
  { label: 'Shirt', style: ['shirt', SHIRT_STYLES], color: 'shirtColor', palette: PALETTES.clothing },
  { label: 'Pants', style: ['pants', PANTS_STYLES], color: 'pantsColor', palette: PALETTES.clothing },
  { label: 'Shoes', style: ['shoes', SHOE_STYLES], color: 'shoeColor', palette: PALETTES.clothing },
  { label: 'Hat', style: ['hat', HAT_STYLES], color: 'hatColor', palette: PALETTES.clothing },
  { label: 'Glasses', style: ['glasses', GLASSES_STYLES], color: 'glassesColor', palette: PALETTES.accessory },
  { label: 'Watch', style: ['watch', WATCH_STYLES], color: 'watchColor', palette: PALETTES.accessory },
];

const pretty = (v: string) => ({ tshirt: 'T-shirt', longsleeve: 'Long sleeve', tank: 'Tank top', slipons: 'Slip-ons', tophat: 'Top hat' } as Record<string, string>)[v]
  ?? v.charAt(0).toUpperCase() + v.slice(1);

function Turntable({ appearance }: { appearance: Appearance }) {
  const g = useRef<THREE.Group>(null);
  const anim = getAnim('preview');
  useEffect(() => { playEmote('preview', 'wave'); }, []);
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.6; });
  return <group ref={g} position={[0, -0.95, 0]}><Avatar appearance={appearance} anim={anim} cull={false} /></group>;
}

/** Character customisation: model + colour per clothing slot, skin, and hat / glasses / watch accessories. */
export function CustomizePanel() {
  const saved = useGame((s) => s.profile.appearance);
  const [look, setLook] = useState<Appearance>(saved);
  const rng = useMemo(() => createRng(Date.now() & 0xffff), []);
  const apply = (next: Appearance) => {
    setLook(next);
    useGame.setState((s) => ({ profile: { ...s.profile, appearance: next } })); // live on your character
  };
  const done = () => { send('appearance', look); openPanel('none'); };
  // Persist even when the panel is closed with Escape or a hotkey.
  const latest = useRef(look);
  latest.current = look;
  useEffect(() => () => send('appearance', latest.current), []);

  return (
    <div className="overlay">
      <div className="card panel customize">
        <header><h2>Style</h2><button className="close" onClick={done}>✕</button></header>
        <div className="customize-body">
          <div className="preview">
            <Canvas flat camera={{ position: [0, 0.15, 3.4], fov: 35 }}>
              <hemisphereLight args={['#ffffff', '#8a7558', 1.6]} />
              <directionalLight position={[2, 3, 3]} intensity={2.4} />
              <Turntable appearance={look} />
            </Canvas>
          </div>
          <div className="rows">
            {ROWS.map((r) => (
              <div key={r.label} className="row">
                <div className="row-label">{r.label}</div>
                {r.style && (
                  <div className="cycler">
                    <button onClick={() => apply({ ...look, [r.style![0]]: cycle(r.style![1], look[r.style![0]], -1) })}>‹</button>
                    <span>{pretty(look[r.style[0]])}</span>
                    <button onClick={() => apply({ ...look, [r.style![0]]: cycle(r.style![1], look[r.style![0]], 1) })}>›</button>
                  </div>
                )}
                <div className="swatches">
                  {r.palette.map((c) => (
                    <button key={c} className={`swatch ${look[r.color] === c ? 'active' : ''}`} style={{ background: c }}
                      onClick={() => apply({ ...look, [r.color]: c })} aria-label={c} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <footer>
          <button onClick={() => apply(randomAppearance(rng))}>🎲 Randomize</button>
          <button onClick={() => apply({ ...DEFAULT_APPEARANCE })}>Reset</button>
          <button className="primary" onClick={done}>Done</button>
        </footer>
      </div>
    </div>
  );
}
