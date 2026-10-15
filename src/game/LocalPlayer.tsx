import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ACCEPT_RADIUS, PET_RADIUS, SPECTATE_RADIUS, AIR, EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_RADIUS, REACH, RESPAWN_BELOW_Y, evaluatePlacement, evaluateRemoval, getBlock,
  isSolidAt, moveBody, type MiniGameKind, playerAabb, resolvePlacementCell, sleeveLength, voxelRaycast, withinReach, type StallInfo,
} from '@jp/blocksy-shared';
import { consumeInput } from './input';
import { localBody, teleportLocal } from './localState';
import { world } from './world';
import { animalStates, remotes, send } from '../net/network';
import { useGame, selectedBlock } from '../state/store';
import { Avatar } from '../render/Avatar';
import { applyGamePose, getAnim, now, playSwing } from '../render/animState';
import { newCameraRig, solveCamera } from './cameraRig';
import { blockBreak, blockPlace, footstep, isWaterAt, land, splash } from '../render/particleFx';
import { getBlockGeometry, getBlockMaterials } from '../render/textures';
import { Hammer } from '../render/Hammer';

// Movement tuning
const WALK = 4.3, SPRINT = 6.4, ACCEL_GROUND = 40, ACCEL_AIR = 12, GRAVITY = 26, MAX_FALL = 45;
const JUMP_HEIGHT = 1.25, JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT), COYOTE = 0.1, JUMP_BUFFER = 0.12;
// Camera tuning
const PIVOT_HEIGHT = 1.55, SHOULDER = 0.45, TP_DISTANCE = 4.2, TRANSITION = 0.28, HIDE_BODY_BELOW = 0.9, LOOK_SPEED = 0.0025;
// Interaction tuning
const REPEAT_DELAY = 0.22, STALL_RADIUS = 3.6, SEND_INTERVAL = 1 / 15;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const FREE_CAM_SPEED = 9;   // m/s
const FREE_CAM_RANGE = 80;  // m from the player

/** First empty cell along the view (within reach) where `held` may be placed, stopping at the first solid block. */
function airPlacementCell(g: NonNullable<typeof world.grid>, origin: THREE.Vector3, dir: THREE.Vector3, eye: THREE.Vector3,
  held: number, blockers: ReturnType<typeof playerAabb>[], start: number): [number, number, number] | null {
  let last = '';
  for (let d = start; d <= start + REACH + 1; d += 0.05) {
    const x = Math.floor(origin.x + dir.x * d), y = Math.floor(origin.y + dir.y * d), z = Math.floor(origin.z + dir.z * d);
    const key = `${x},${y},${z}`;
    if (key === last) continue;
    last = key;
    const here = getBlock(g.get(x, y, z));
    if (here?.targetable && !here.replaceable) return null;            // the view is blocked
    if (!withinReach(eye.x, eye.y, eye.z, x, y, z, REACH)) continue;
    if (evaluatePlacement(g, x, y, z, held, blockers) === 'ok') return [x, y, z];
  }
  return null;
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Thin-box outline of a unit cube (WebGL lines are always 1 px, so edges are boxes). */
function Outline({ color }: { color: string }) {
  const edges = useMemo(() => {
    const t = 0.03, o = 0.5 + t / 2, list: { p: [number, number, number]; s: [number, number, number] }[] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      list.push({ p: [0, a * o, b * o], s: [1 + 2 * t, t, t] });
      list.push({ p: [a * o, 0, b * o], s: [t, 1 + 2 * t, t] });
      list.push({ p: [a * o, b * o, 0], s: [t, t, 1 + 2 * t] });
    }
    return list;
  }, []);
  return <>{edges.map((e, i) => <mesh key={i} position={e.p} scale={e.s}><boxGeometry /><meshBasicMaterial color={color} /></mesh>)}</>;
}

/**
 * The local player: input → voxel physics → camera (first/third person, blended, collision-aware) →
 * block targeting, placement and removal (optimistic, confirmed by the server) → network updates.
 */
export function LocalPlayer() {
  const { camera, size } = useThree();
  const sessionId = useGame((s) => s.sessionId) ?? 'local';
  const appearance = useGame((s) => s.profile.appearance);
  const held = useGame(selectedBlock);
  const tool = useGame((s) => s.tool);
  const anim = getAnim(sessionId);
  const avatar = useRef<THREE.Group>(null);
  const outline = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const arm = useRef<THREE.Group>(null);
  const armInner = useRef<THREE.Group>(null);
  const st = useRef({
    blend: 1, rig: newCameraRig(TP_DISTANCE, SHOULDER), lastGround: -9, lastJump: -9, nextRepeat: 0, sendAt: 0, bodyYaw: 0,
    faceAimUntil: 0, stepDist: 0, freeOn: false, freePos: new THREE.Vector3(), freeLast: new THREE.Vector3(), freeExitAt: -9, nearKey: '', offKey: '', framedFor: '', nearby: null as StallInfo | null, hidden: false, layerKey: '', lastLook: null as unknown, armSwing: -9, bob: 0,
  });

  useEffect(() => { camera.layers.disable(1); }, [camera]);

  useFrame((_, rawDt) => {
    const g = world.grid;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05), t = now(), s = st.current, b = localBody;
    const game = useGame.getState();
    const active = game.panel === 'none' && !game.sessionEnded && !game.reconnecting && (game.pointerLocked || game.touch);
    // In a mini-game (playing, watching or waiting in a lobby) you may only look around.
    const inMg = !!game.mg || (!!game.lobby && game.lobby.hostId !== sessionId);
    // Free camera: the camera flies on its own, the player stands still (no walking or building).
    const freeCam = game.cameraMode === 'free' && !inMg;
    const canLook = game.panel === 'none' && !game.sessionEnded && !game.reconnecting && (game.pointerLocked || game.touch || inMg);
    const canAct = active && !inMg && !freeCam;
    const inp = consumeInput();

    // ---- look (mouse delta is per frame: never multiplied by dt) ----
    if (canLook) {
      b.yaw -= inp.lookX * LOOK_SPEED * game.sensitivity;
      b.pitch += inp.lookY * LOOK_SPEED * game.sensitivity * (game.invertY ? -1 : 1);
      if (inp.wheel && game.tool !== 'none' && !inMg && !freeCam) game.cycleSlot(inp.wheel);
    }
    // Entering a mini-game: aim at the table / opponent once, and use third person for board games.
    if (game.mg && game.mg.id !== s.framedFor) {
      s.framedFor = game.mg.id;
      const g = game.games.find((x) => x.id === game.mg!.id);
      if (game.mg.role === 'player' && game.mg.seatYaw !== undefined) b.yaw = game.mg.seatYaw;
      else if (g) b.yaw = Math.atan2(g.x - b.x, g.z - b.z);
      b.pitch = 0.42;
      if ((game.mg.kind !== 'rps' && game.cameraMode === 'first') || game.cameraMode === 'free') useGame.setState({ cameraMode: 'third' });
    }
    if (!game.mg) s.framedFor = '';
    // Board games: shift the picture right so players + table sit on the right and the board panel on the left.
    const boardOpen = !!game.mg && game.mg.kind !== 'rps';
    const offKey = boardOpen ? `${size.width}x${size.height}` : '';
    if (offKey !== s.offKey) {
      s.offKey = offKey;
      const pc = camera as THREE.PerspectiveCamera;
      if (boardOpen) pc.setViewOffset(size.width, size.height, -size.width * 0.24, 0, size.width, size.height);
      else pc.clearViewOffset();
    }
    s.blend = clamp(s.blend + Math.sign((game.cameraMode !== 'first' ? 1 : 0) - s.blend) * (dt / TRANSITION), 0, 1);
    const smooth = s.blend * s.blend * (3 - 2 * s.blend);
    b.pitch = clamp(b.pitch, lerp(-1.48, -0.8, smooth), lerp(1.48, 1.3, smooth));

    // ---- movement ----
    let mx = canAct ? inp.moveX : 0, my = canAct ? inp.moveY : 0;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = -Math.cos(b.yaw), rz = Math.sin(b.yaw);
    const speed = canAct && inp.sprint ? SPRINT : WALK;
    const wx = (fx * my + rx * mx) * speed, wz = (fz * my + rz * mx) * speed;
    const accel = (b.grounded ? ACCEL_GROUND : ACCEL_AIR) * dt;
    const dvx = wx - b.vx, dvz = wz - b.vz, dl = Math.hypot(dvx, dvz);
    if (dl <= accel) { b.vx = wx; b.vz = wz; } else { b.vx += (dvx / dl) * accel; b.vz += (dvz / dl) * accel; }

    if (b.grounded) s.lastGround = t;
    if (canAct && inp.jump) s.lastJump = t;
    if (t - s.lastGround <= COYOTE && t - s.lastJump <= JUMP_BUFFER) {
      b.vy = JUMP_VELOCITY;
      s.lastGround = s.lastJump = -9; // consume both: no double jumps
    }
    b.vy = Math.max(b.vy - GRAVITY * dt, -MAX_FALL);
    const vyBefore = b.vy, wasGrounded = b.grounded, wasInWater = isWaterAt(b.x, b.y + 0.2, b.z), prevY = b.y;
    moveBody(g, b, dt, PLAYER_RADIUS, PLAYER_HEIGHT);
    // Particles: landing dust, footsteps (more when sprinting), splashes in the pond and the sea.
    if (!wasGrounded && b.grounded && vyBefore < -5) land(b.x, b.y, b.z, Math.min(1, (-vyBefore - 5) / 12));
    const hsNow = Math.hypot(b.vx, b.vz);
    if (b.grounded && hsNow > 1.2) {
      s.stepDist += hsNow * dt;
      const sprinting = hsNow > WALK * 1.15;
      if (s.stepDist > (sprinting ? 0.75 : 1.1)) { s.stepDist = 0; footstep(b.x, b.y, b.z, sprinting ? 1.6 : 0.8); }
    } else s.stepDist = 0.6;
    if (!wasInWater && isWaterAt(b.x, b.y + 0.2, b.z)) splash(b.x, Math.floor(b.y + 0.2) + 1, b.z);
    if (game.layout && prevY > game.layout.waterLevel && b.y <= game.layout.waterLevel) splash(b.x, game.layout.waterLevel, b.z, true);
    if (b.y < RESPAWN_BELOW_Y && game.layout) {
      const sp = game.layout.spawn;
      teleportLocal(sp.x, sp.y, sp.z);
      game.showToast('Splash! Back to the island');
    }

    // ---- camera ----
    const solid = (x: number, y: number, z: number) => isSolidAt(g, x, y, z);
    const cp = Math.cos(b.pitch);
    const dir = new THREE.Vector3(fx * cp, -Math.sin(b.pitch), fz * cp);
    const eye = new THREE.Vector3(b.x, b.y + EYE_HEIGHT, b.z);
    const head = new THREE.Vector3(b.x, b.y + PIVOT_HEIGHT, b.z);
    // Collision-aware, smoothed third-person camera (no jumps when brushing walls or turning; see cameraRig.ts).
    const tp = solveCamera(s.rig, {
      head: [head.x, head.y, head.z], dir: [dir.x, dir.y, dir.z], right: [rx, 0, rz],
      solid, maxDist: game.camDistance || TP_DISTANCE, shoulder: SHOULDER, dt, t,
    });
    const third = new THREE.Vector3(tp[0], tp[1], tp[2]);
    camera.position.lerpVectors(eye, third, smooth);
    // ---- free camera ----
    if (freeCam) {
      if (!s.freeOn) { s.freeOn = true; s.freePos.copy(camera.position); }
      if (canLook) {
        const cpf = Math.cos(b.pitch);
        const speedF = FREE_CAM_SPEED * dt;
        s.freePos.x += (fx * cpf * inp.moveY + rx * inp.moveX) * speedF;
        s.freePos.z += (fz * cpf * inp.moveY + rz * inp.moveX) * speedF;
        s.freePos.y += (-Math.sin(b.pitch) * inp.moveY + (inp.up ? 1 : 0) - (inp.down ? 1 : 0)) * speedF;
      }
      // stay inside the world and within reach of the player
      const away = s.freePos.distanceTo(eye);
      if (away > FREE_CAM_RANGE) s.freePos.sub(eye).multiplyScalar(FREE_CAM_RANGE / away).add(eye);
      s.freePos.y = clamp(s.freePos.y, 1, g.sy + 20);
      camera.position.copy(s.freePos);
    } else if (s.freeOn) {
      s.freeOn = false; s.freeExitAt = t; s.freeLast.copy(s.freePos);   // glide back to the player
    }
    if (!freeCam && t - s.freeExitAt < 0.5) {
      const k = (t - s.freeExitAt) / 0.5, e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(s.freeLast, camera.position, e);
    }
    camera.rotation.set(-b.pitch, b.yaw + Math.PI, 0, 'YXZ');

    // ---- body presentation ----
    const fp = s.blend < 0.5;
    const hs = Math.hypot(b.vx, b.vz);
    let targetYaw = s.bodyYaw;
    if (fp || t < s.faceAimUntil) targetYaw = b.yaw;
    else if (hs > 0.2) targetYaw = Math.atan2(b.vx, b.vz);
    if (game.mg?.role === 'player' && game.mg.seatYaw !== undefined) targetYaw = game.mg.seatYaw; // face the table / opponent
    const diff = Math.atan2(Math.sin(targetYaw - s.bodyYaw), Math.cos(targetYaw - s.bodyYaw));
    s.bodyYaw += fp ? diff : clamp(diff, -12 * dt, 12 * dt);
    anim.speed = hs / WALK;
    anim.grounded = b.grounded;
    anim.holding = game.tool !== 'none' && !inMg;
    applyGamePose(sessionId, anim, game.games);
    if (avatar.current) {
      avatar.current.position.set(b.x, b.y, b.z);
      avatar.current.rotation.set(0, s.bodyYaw, 0);
      const hide = camera.position.distanceTo(eye) < HIDE_BODY_BELOW;
      const key = `${hide}|${held}|${game.tool}`;
      if (key !== s.layerKey || s.lastLook !== appearance) {
        s.layerKey = key;
        s.lastLook = appearance;
        // Layer 1 is invisible to the camera but still casts shadows (see Environment).
        avatar.current.traverse((o) => o.layers.set(hide ? 1 : 0));
      }
    }

    // ---- targeting and editing ----
    const origin = camera.position;
    const hit = voxelRaycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, REACH + origin.distanceTo(eye) + 1,
      (x, y, z) => !!getBlock(g.get(x, y, z))?.targetable);
    const minAlong = eye.clone().sub(origin).dot(dir) - 0.5; // ignore blocks between a third-person camera and the player
    const building = game.tool !== 'none';
    const valid = canAct && building && hit.hit && hit.distance >= minAlong && withinReach(eye.x, eye.y, eye.z, hit.x, hit.y, hit.z, REACH);
    const blockers = [playerAabb(b.x, b.y, b.z), ...[...remotes.values()].map((r) => playerAabb(r.x, r.y, r.z))];
    let place: [number, number, number] | null = null;
    if (valid && game.tool === 'block') {
      place = resolvePlacementCell(g, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
      if (held === AIR || evaluatePlacement(g, place[0], place[1], place[2], held, blockers) !== 'ok') place = null;
    }
    // Aiming past an edge into empty air (extending a bridge, a wall, a roof): use the first free cell along
    // the view that touches a block on any side.
    let airPlace = false;
    if (!place && canAct && game.tool === 'block' && held !== AIR) {
      place = airPlacementCell(g, origin, dir, eye, held, blockers, Math.max(0, minAlong));
      airPlace = !!place;
    }
    if (outline.current) { outline.current.visible = valid && !airPlace; if (valid) outline.current.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5); }
    if (ghost.current) { ghost.current.visible = !!place; if (place) ghost.current.position.set(place[0] + 0.5, place[1] + 0.5, place[2] + 0.5); }

    // One button, one action: left click uses whatever is in hand (block → place, hammer → destroy).
    if (canAct && building) {
      if (!inp.primaryHeld) s.nextRepeat = 0;
      const use = inp.primaryPressed || (inp.primaryHeld && t >= s.nextRepeat);
      const explicit = inp.primaryPressed;
      if (use) s.nextRepeat = t + REPEAT_DELAY;
      if (use && game.tool === 'destroy') {
        if (!valid) { if (explicit) game.showToast('Nothing in reach'); }
        else {
          const r = evaluateRemoval(g, hit.x, hit.y, hit.z);
          if (r === 'ok') {
            const broken = g.get(hit.x, hit.y, hit.z);
            g.set(hit.x, hit.y, hit.z, AIR); // optimistic; the server confirms or rolls back
            blockBreak(hit.x, hit.y, hit.z, broken);
            send('remove', { x: hit.x, y: hit.y, z: hit.z });
            s.faceAimUntil = t + 0.8; s.armSwing = t; playSwing(sessionId);
          } else if (explicit && r === 'protected') game.showToast('This part of the island is protected');
          else if (explicit && r === 'not_removable') game.showToast("This block can't be removed");
        }
      } else if (use && game.tool === 'block') {
        if (held === AIR) { if (explicit) game.showToast(`Slot ${game.selectedSlot + 1} is empty — press T to choose blocks`); }
        else if (!game.profile.owned.includes(held)) { if (explicit) game.showToast("You don't own this block yet"); }
        else if (!valid && !place) { if (explicit) game.showToast('Build next to another block'); }
        else if (place) {
          g.set(place[0], place[1], place[2], held);
          blockPlace(place[0], place[1], place[2], held);
          send('place', { x: place[0], y: place[1], z: place[2], id: held });
          s.faceAimUntil = t + 0.8; s.armSwing = t; playSwing(sessionId);
        } else if (explicit) game.showToast("Can't build there");
      }
    }

    // ---- first-person arm follows the camera ----
    if (arm.current && armInner.current) {
      arm.current.position.copy(camera.position);
      arm.current.quaternion.copy(camera.quaternion);
      arm.current.visible = s.blend < 0.02 && game.tool !== 'none' && !inMg; // hands empty: no arm in view
      s.bob += dt * 9 * (b.grounded ? Math.min(1, hs / WALK) : 0);
      const sw = (t - s.armSwing) / 0.25, swing = sw >= 0 && sw < 1 ? Math.sin(sw * Math.PI) : 0;
      const amp = Math.min(1, hs / WALK) * 0.018;
      armInner.current.position.set(0.36 + Math.cos(s.bob) * amp - 0.06 * swing, -0.6 + Math.abs(Math.sin(s.bob)) * amp + 0.05 * swing, -0.42 - 0.12 * swing);
      armInner.current.rotation.set(-0.96 - 0.5 * swing, 0.31 + 0.17 * swing, 0);
    }

    // ---- shops, networking ----
    // Not gated on canAct: with the shop open the player can't act, but is still at the stall
    // (the shop closes itself when nearbyStall goes away).
    let nearby: StallInfo | null = null;
    if (game.layout && !inMg) {
      let best = STALL_RADIUS * STALL_RADIUS;
      for (const st2 of game.layout.stalls) {
        const d = (st2.interact.x - b.x) ** 2 + (st2.interact.z - b.z) ** 2 + ((st2.interact.y - b.y) ** 2) * 0.25;
        if (d <= best) { best = d; nearby = st2; }
      }
    }
    if (nearby !== s.nearby) { s.nearby = nearby; useGame.setState({ nearbyStall: nearby }); }

    // Nearest joinable invite and nearest running game (for the E prompt).
    let nearInvite: { hostId: string; name: string; kind: MiniGameKind; waitMs: number } | null = null;
    let nearGame: { id: string; kind: MiniGameKind } | null = null;
    let nearNpc: { id: string; name: string; kind: MiniGameKind } | null = null;
    let nearAnimal: { id: string; kind: string } | null = null;
    if (canAct) {
      let best = ACCEPT_RADIUS * ACCEPT_RADIUS;
      for (const [id, r] of remotes) {
        if (!r.inv) continue;
        const d = (r.x - b.x) ** 2 + (r.z - b.z) ** 2;
        if (d > best) continue;
        best = d;
        nearInvite = { hostId: id, name: game.players[id]?.name ?? 'Player', kind: r.inv, waitMs: Math.max(0, ((r.invReadyAt ?? 0) - t) * 1000) };
      }
      const busy = new Set(game.games.flatMap((g) => g.seats.map((x) => x.id)));
      let bestN = ACCEPT_RADIUS * ACCEPT_RADIUS;
      for (const n of game.layout?.gameCenter?.npcs ?? []) {
        if (busy.has(n.id)) continue;
        const d = (n.x - b.x) ** 2 + (n.z - b.z) ** 2;
        if (d <= bestN) { bestN = d; nearNpc = { id: n.id, name: n.name, kind: n.kind }; }
      }
      let bestA = PET_RADIUS * PET_RADIUS;
      for (const [id, a] of animalStates) {
        const d = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
        if (d <= bestA && Math.abs(a.y - b.y) < 2.5) { bestA = d; nearAnimal = { id, kind: a.kind }; }
      }
      let bestG = SPECTATE_RADIUS * SPECTATE_RADIUS;
      for (const g of game.games) {
        if (g.phase === 'over' || g.seats.some((x) => x.id === sessionId)) continue;
        const d = (g.x - b.x) ** 2 + (g.z - b.z) ** 2;
        if (d <= bestG) { bestG = d; nearGame = { id: g.id, kind: g.kind }; }
      }
    }
    const nearKey = `${nearInvite?.hostId ?? ''}:${nearInvite ? Math.ceil(nearInvite.waitMs / 1000) : ''}|${nearGame?.id ?? ''}|${nearNpc?.id ?? ''}|${nearAnimal?.id ?? ''}`;
    if (nearKey !== s.nearKey) { s.nearKey = nearKey; useGame.setState({ nearInvite, nearGame, nearNpc, nearAnimal }); }

    if (t >= s.sendAt) {
      s.sendAt = t + SEND_INTERVAL;
      send('move', { x: b.x, y: b.y, z: b.z, yaw: s.bodyYaw, speed: Math.min(2, hs / WALK), grounded: b.grounded });
    }
  });

  const sleeve = sleeveLength(appearance.shirt) > 0 ? (appearance.shirt === 'tshirt' ? 0.3 : 0.58) : 0;
  const heldGeo = held !== AIR ? getBlockGeometry(held) : null;
  const overlay = (color: string) => <meshLambertMaterial color={color} depthTest={false} />;

  return (
    <>
      <group ref={avatar}><Avatar appearance={appearance} anim={anim} heldBlock={held} hammer={tool === 'destroy'} /></group>
      <group ref={outline} visible={false}><Outline color={tool === 'destroy' ? '#ff7a59' : '#3fe6c8'} /></group>
      <mesh ref={ghost} visible={false} scale={0.98}>
        <boxGeometry />
        <meshBasicMaterial color="#5ff2d9" transparent opacity={0.28} depthWrite={false} />
      </mesh>
      {/* First-person arm: drawn on top (no depth test) so it never clips into walls. */}
      <group ref={arm}>
        <group ref={armInner}>
          {sleeve > 0 && <mesh renderOrder={1000} position={[0, sleeve / 2, 0]} scale={[0.252, sleeve, 0.252]}><boxGeometry />{overlay(appearance.shirtColor)}</mesh>}
          <mesh renderOrder={1000} position={[0, sleeve + (0.7 - sleeve) / 2, 0]} scale={[0.24, 0.7 - sleeve, 0.24]}><boxGeometry />{overlay(appearance.skin)}</mesh>
          {tool === 'destroy' && <group position={[0, 0.62, -0.12]} rotation={[0.5, 0, 0.25]}><Hammer overlay /></group>}
          {tool === 'block' && heldGeo && (
            <mesh renderOrder={1001} geometry={heldGeo} position={[0, 0.72, -0.16]} rotation={[0.96, -0.52, 0]} scale={0.3}
              material={getBlockMaterials()} />
          )}
        </group>
      </group>
    </>
  );
}
