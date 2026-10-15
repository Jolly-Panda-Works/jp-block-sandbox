import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { AIR, createRng, hashString, isBotId, miniGameInfo, randomAppearance, type IslandLayout, type MgListing, type MiniGameKind } from '@jp/blocksy-shared';
import { Avatar } from './Avatar';
import { applyGamePose, getAnim, now, playEmote } from './animState';
import { footstep, land } from './particles';
import { remotes } from '../net/network';
import { useGame, type PlayerMeta } from '../state/store';
import { localBody } from '../game/localState';

/** Name tag plus speech/emoji bubble above a character (reference images 5, 9, 10). */
export function Label({ id, name, isYou, invite }: { id: string; name: string; isYou?: boolean; invite?: MiniGameKind | '' }) {
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
        {invite && <div className="invite-badge" title={miniGameInfo(invite).name}>{miniGameInfo(invite).icon}<span>{miniGameInfo(invite).name}</span></div>}
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
  const [invite, setInvite] = useState<MiniGameKind | ''>('');
  const fxs = useRef({ grounded: true, airTime: 0, step: 0 });
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
    const f = fxs.current;
    if (Math.hypot(r.rx - localBody.x, r.rz - localBody.z) < 30) {
      if (!r.grounded) f.airTime += dt;
      else if (!f.grounded && f.airTime > 0.45) land(r.rx, r.ry, r.rz, Math.min(1, (f.airTime - 0.45) * 1.2));
      if (r.grounded) f.airTime = 0;
      if (r.grounded && r.speed > 0.3) {
        f.step += r.speed * 4.3 * dt;
        if (f.step > (r.speed > 1.15 ? 0.75 : 1.1)) { f.step = 0; footstep(r.rx, r.ry, r.rz, r.speed > 1.15 ? 1.6 : 0.8); }
      }
    }
    f.grounded = r.grounded;
    if (r.held !== held) setHeld(r.held);
    if ((r.tool === 'destroy') !== hammer) setHammer(r.tool === 'destroy');
    if ((r.inv ?? '') !== invite) setInvite(r.inv ?? '');
    applyGamePose(id, anim, useGame.getState().games);
  });
  return (
    <group ref={group}>
      <Avatar appearance={meta.appearance} anim={anim} heldBlock={held} hammer={hammer} />
      <Label id={id} name={meta.name} invite={invite} />
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
  const invite = useGame((s) => s.myInvite);
  useFrame(() => group.current?.position.set(localBody.x, localBody.y, localBody.z));
  return <group ref={group}>{mode === 'third' && <Label id={id} name="You" isYou invite={invite} />}</group>;
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

/** Each bot / NPC always looks the same (appearance derived from its id). */
const botLook = (id: string) => randomAppearance(createRng(hashString(id)));

/** Game Center characters waiting for a player (an NPC in a game is drawn at its seat by BotSeats). */
export function GameCenterNpcs({ layout }: { layout: IslandLayout }) {
  const games = useGame((s) => s.games);
  const looks = useMemo(() => new Map(layout.gameCenter.npcs.map((n) => [n.id, botLook(n.id)])), [layout]);
  const busy = new Set(games.flatMap((g) => g.seats.map((x) => x.id)));
  return (
    <>
      {layout.gameCenter.npcs.filter((n) => !busy.has(n.id)).map((n) => (
        <IdleNpc key={n.id} id={n.id} name={n.name} kind={n.kind} x={n.x} y={n.y} z={n.z} yaw={n.yaw} look={looks.get(n.id)!} />
      ))}
    </>
  );
}

/** A Game Center character at its spot. Its pose is refreshed every frame, so after a game it stands up
 *  and goes back to idle (previously it kept the seated / Rock-Paper-Scissors pose). */
function IdleNpc({ id, name, kind, x, y, z, yaw, look }: { id: string; name: string; kind: MiniGameKind; x: number; y: number; z: number; yaw: number; look: ReturnType<typeof botLook> }) {
  const anim = getAnim(id);
  useFrame(() => applyGamePose(id, anim, useGame.getState().games));
  return (
    <group position={[x, y, z]} rotation={[0, yaw, 0]}>
      <Avatar appearance={look} anim={anim} />
      <Label id={id} name={`🤖 ${name}`} invite={kind} />
    </group>
  );
}

function BotSeat({ game, seat }: { game: MgListing; seat: MgListing['seats'][number] }) {
  const anim = getAnim(seat.id);
  const look = useMemo(() => botLook(seat.id), [seat.id]);
  useFrame(() => applyGamePose(seat.id, anim, useGame.getState().games));
  return (
    <group position={[seat.x, game.y, seat.z]} rotation={[0, seat.yaw, 0]}>
      <Avatar appearance={look} anim={anim} />
      <Label id={seat.id} name={seat.name ?? '🤖 Bot'} />
    </group>
  );
}

/** Bots and NPCs taking part in a mini-game, drawn at their seat (seated or playing Rock Paper Scissors). */
export function BotSeats() {
  const games = useGame((s) => s.games);
  const bodies = useGame((s) => s.players);
  return <>{games.flatMap((g) => g.seats.filter((x) => isBotId(x.id) && !bodies[x.id]).map((x) => <BotSeat key={x.id} game={g} seat={x} />))}</>;
}
