import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { AIR, createRng, randomAppearance, type IslandLayout } from '@jp/blocksy-shared';
import { Avatar } from './Avatar';
import { getAnim, now, playEmote } from './animState';
import { remotes } from '../net/network';
import { useGame, type PlayerMeta } from '../state/store';
import { localBody } from '../game/localState';

/** Name tag plus speech/emoji bubble above a character (reference images 5, 9, 10). */
export function Label({ id, name, isYou }: { id: string; name: string; isYou?: boolean }) {
  const bubble = useGame((s) => s.bubbles[id]);
  const [, force] = useState(0);
  useEffect(() => {
    if (!bubble) return;
    const ms = (bubble.until - now()) * 1000;
    if (ms <= 0) return;
    const h = setTimeout(() => force((n) => n + 1), ms + 30);
    return () => clearTimeout(h);
  }, [bubble]);
  const visible = bubble && bubble.until > now();
  return (
    <Html position={[0, 2.15, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="label">
        {visible && <div className={`bubble ${bubble?.emoji ? 'emoji' : ''}`}>{bubble?.emoji ?? bubble?.text}</div>}
        <div className={`nametag ${isYou ? 'you' : ''}`}><span className="dot" />{name}</div>
      </div>
    </Html>
  );
}

function RemotePlayer({ id, meta }: { id: string; meta: PlayerMeta }) {
  const group = useRef<THREE.Group>(null);
  const anim = getAnim(id);
  const [held, setHeld] = useState(AIR);
  const [hammer, setHammer] = useState(false);
  useFrame((_, dt) => {
    const r = remotes.get(id), g = group.current;
    if (!r || !g) return;
    // Interpolate toward the latest replicated transform (server patches arrive at 20 Hz).
    const k = 1 - Math.exp(-12 * Math.min(dt, 0.05));
    if (Math.hypot(r.x - r.rx, r.z - r.rz) > 8) { r.rx = r.x; r.ry = r.y; r.rz = r.z; }
    r.rx += (r.x - r.rx) * k; r.ry += (r.y - r.ry) * k; r.rz += (r.z - r.rz) * k;
    r.ryaw += Math.atan2(Math.sin(r.yaw - r.ryaw), Math.cos(r.yaw - r.ryaw)) * k;
    g.position.set(r.rx, r.ry, r.rz);
    g.rotation.set(0, r.ryaw, 0);
    anim.speed = r.speed; anim.grounded = r.grounded;
    if (r.held !== held) setHeld(r.held);
    if ((r.tool === 'destroy') !== hammer) setHammer(r.tool === 'destroy');
  });
  return (
    <group ref={group}>
      <Avatar appearance={meta.appearance} anim={anim} heldBlock={held} hammer={hammer} />
      <Label id={id} name={meta.name} />
    </group>
  );
}

export function RemotePlayers() {
  const players = useGame((s) => s.players);
  return <>{Object.entries(players).filter(([, m]) => !m.isLocal).map(([id, m]) => <RemotePlayer key={id} id={id} meta={m} />)}</>;
}

/** The local player's label follows the body (only meaningful in third person). */
export function LocalLabel() {
  const group = useRef<THREE.Group>(null);
  const id = useGame((s) => s.sessionId) ?? 'local';
  const mode = useGame((s) => s.cameraMode);
  useFrame(() => group.current?.position.set(localBody.x, localBody.y, localBody.z));
  return <group ref={group}>{mode === 'third' && <Label id={id} name="You" isYou />}</group>;
}

const KEEPER_LINES = ['Welcome!', 'Everything is free today!', 'Fresh blocks!', 'Hi!'];

/** Friendly shopkeepers behind each stall counter; they greet, wave and react now and then. */
export function Shopkeepers({ layout }: { layout: IslandLayout }) {
  const keepers = useMemo(() => layout.stalls.map((s, i) => ({ id: `npc-${i}`, stall: s, look: randomAppearance(createRng(100 + i)) })), [layout]);
  useEffect(() => {
    const rng = createRng(5);
    const h = setInterval(() => {
      const k = keepers[Math.floor(rng() * keepers.length)];
      if (!k) return;
      const near = Math.hypot(k.stall.interact.x - localBody.x, k.stall.interact.z - localBody.z) < 10;
      const roll = rng();
      if (near && roll < 0.5) useGame.getState().showBubble(k.id, { text: KEEPER_LINES[Math.floor(rng() * KEEPER_LINES.length)] });
      else if (roll < 0.75) playEmote(k.id, 'wave');
      else useGame.getState().showBubble(k.id, { emoji: '😊' }, 3);
    }, 6000);
    return () => clearInterval(h);
  }, [keepers]);
  return (
    <>
      {keepers.map((k) => (
        <group key={k.id} position={[k.stall.keeper.x, k.stall.keeper.y, k.stall.keeper.z]} rotation={[0, k.stall.keeper.yaw, 0]}>
          <Avatar appearance={k.look} anim={getAnim(k.id)} />
          <Label id={k.id} name={`${k.stall.title} shop`} />
        </group>
      ))}
    </>
  );
}
