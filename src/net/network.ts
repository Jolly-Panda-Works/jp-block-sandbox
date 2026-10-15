import { Client, type Room } from 'colyseus.js';
import {
  AIR, ANIMAL_SOUND, EMOJIS, PROTOCOL_VERSION, getBlock, isAnimalKind, sanitizeAppearance, sanitizeProfile,
  type ClientMessages, type JoinOptions, type PlayerMeta, type PlayerSnapshot, type ProfileData, type ServerMessages,
  type MgLobby, type MgListing, type MgView, type MiniGameKind,
} from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { world } from '../game/world';
import { teleportLocal } from '../game/localState';
import { dropAnim, getAnim, playEmote, playSwing } from '../render/animState';
import { UUID_RE, config } from './config';
import { getRealtimeCredentials } from './api';
import { readGameToken, secondsLeft } from './jwt';
import { lockPointer, openPanel, releasePointer } from '../game/pointer';
import { localBody } from '../game/localState';
import * as fx from '../render/particleFx';

/** Latest replicated transform of a remote player; r* fields are the interpolated render values. */
export interface RemoteState extends PlayerSnapshot {
  rx: number; ry: number; rz: number; ryaw: number;
  /** Open mini-game invite (icon above the head) and when it becomes joinable (performance.now seconds). */
  inv?: MiniGameKind | '';
  invAgeMs?: number;
  invReadyAt?: number;
  /** Mini-game session the player is in or watching. */
  mg?: string;
  /** Sitting / lying down. */
  pose?: '' | 'sit' | 'sleep';
}
type StatePlayer = PlayerSnapshot & { inv?: MiniGameKind | ''; invAgeMs?: number; mg?: string };
export const remotes = new Map<string, RemoteState>();

/** Latest replicated animal transforms; r* fields are interpolated render values. */
export interface AnimalState { kind: string; variant: string; x: number; y: number; z: number; yaw: number; moving: boolean; rx: number; ry: number; rz: number; ryaw: number; hopAt?: number }
export const animalStates = new Map<string, AnimalState>();
/** Server time of day; the client advances it smoothly between updates. */
export const worldClock = { hour: 8, day: 1, dayLengthMs: 0, at: 0 };
const gamePhases = new Map<string, string>();

/** Where a player / bot is right now (for particle effects). */
function posOf(id: string): { x: number; y: number; z: number; yaw: number } | null {
  if (id && id === room?.sessionId) return { x: localBody.x, y: localBody.y, z: localBody.z, yaw: localBody.yaw };
  const r = remotes.get(id);
  return r ? { x: r.rx, y: r.ry, z: r.rz, yaw: r.ryaw } : null;
}
/** Current in-game hour (0–24) and day number. */
export function currentClock(): { hour: number; day: number } {
  if (worldClock.dayLengthMs <= 0 || worldClock.at === 0) return { hour: worldClock.hour, day: worldClock.day };
  const total = worldClock.hour + ((performance.now() - worldClock.at) / worldClock.dayLengthMs) * 24;
  return { hour: total % 24, day: worldClock.day + Math.floor(total / 24) };
}
type AnimalSnapshot = { id: string; kind: string; variant: string; x: number; y: number; z: number; yaw: number; moving: boolean };

/** Extra fields the Rastaar server adds to every `state` message. */
type StateMessage = Omit<ServerMessages['state'], 'players'> & { players: StatePlayer[]; phase?: 'playing' | 'finished'; timeLeftMs?: number; games?: MgListing[]; acceptDelayMs?: number; animals?: AnimalSnapshot[]; clock?: { hour: number; day: number; dayLengthMs: number } };

let client: Client | null = null;
let room: Room | null = null;
let userId = '';
let sessionEnded = false;

/**
 * Leave the current mini-game / spectating / lobby and go straight back to normal play: the board closes at
 * once (no waiting for the server) and, because this runs inside the click, the cursor is captured again.
 */
export function leaveMiniGame(): void {
  send('mgLeave', {});
  const s = useGame.getState();
  useGame.setState({ mg: null, lobby: s.lobby && s.lobby.hostId === s.sessionId ? s.lobby : null });
  lockPointer();
}

export function send<K extends keyof ClientMessages>(type: K, message: ClientMessages[K]): void {
  room?.send(type, message);
}

const REJECT_TEXT: Record<string, string> = {
  protected: 'This part of the island is protected',
  not_removable: "This block can't be removed",
  blocked_by_actor: 'Someone is standing there',
  occupied: 'That spot is taken',
  out_of_range: 'Too far away',
  not_owned: "You don't own this block yet",
  out_of_bounds: "That's the edge of the world",
  busy: 'Not while you are in a mini-game',
  no_support: 'Place it next to another block',
};

// ---------------- local profile cache ----------------
// The platform server keeps profiles in memory only. The game caches the profile per user and sends it
// back once per session ("restore") so free unlocks, the hotbar and the look survive server restarts.
const cacheKey = () => (userId ? `blocksy.profile.${userId}` : '');

function loadCachedProfile(): ProfileData | null {
  try {
    const raw = cacheKey() && localStorage.getItem(cacheKey());
    return raw ? sanitizeProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveCachedProfile(p: ProfileData): void {
  try { if (cacheKey()) localStorage.setItem(cacheKey(), JSON.stringify(p)); } catch { /* storage full or private mode */ }
}

function maybeRestore(serverProfile: ProfileData): void {
  const cached = loadCachedProfile();
  if (!cached) return;
  const missing = cached.owned.some((id) => !serverProfile.owned.includes(id));
  const lookDiffers = JSON.stringify(cached.appearance) !== JSON.stringify(serverProfile.appearance);
  if (missing || lookDiffers) room?.send('restore', { owned: cached.owned, hotbar: cached.hotbar, appearance: cached.appearance });
}

// ---------------- join ----------------

/** Readable message for any join failure (backend, network, server-side auth). */
function describe(err: unknown, wsUrl: string): string {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? '');
  if (!msg || /ECONNREFUSED|Failed to fetch|NetworkError|socket|onerror|\[object/i.test(msg)) return `Could not reach the game server (${wsUrl}).`;
  return msg;
}

/**
 * Join flow (Rastaar):
 * 1. Backend: POST /client/realtime/token { multiplayerId } → { wsUrl, jwt }   (or ?jwt=… in the URL)
 * 2. Game server: joinOrCreate("blocksy", { jwt, multiplayerId, username, avatarUrl, protocolVersion })
 */
/** Match/token typed on the join screen take precedence over the URL and build settings. */
export interface JoinInput { multiplayerId?: string; jwt?: string; wsUrl?: string; roomSettings?: Record<string, unknown> }

export async function connect(name: string, input: JoinInput = {}): Promise<void> {
  const set = useGame.setState;
  set({ phase: 'connecting', error: null, name, sessionEnded: false, timeLeftMs: 0 });
  try { localStorage.setItem('jp.sandbox.name', name); } catch { /* private mode */ }
  sessionEnded = false;
  // The platform's JWT carries the match id ("mid", a UUID); the local dev server accepts any id.
  const directJwt = (input.jwt || config.jwt).trim();
  let requested = (input.multiplayerId || config.multiplayerId).trim();

  // A game token alone is enough: the match id is its "mid" claim.
  if (directJwt) {
    const claims = readGameToken(directJwt);
    if (!claims) {
      set({ phase: 'error', error: "That isn't a Rastaar game token. Copy the whole token (it has two dots: xxxxx.yyyyy.zzzzz)." });
      return;
    }
    const left = secondsLeft(claims);
    if (left !== null && left <= 0) {
      set({ phase: 'error', error: 'This game token has expired. Get a new one from the Rastaar app.' });
      return;
    }
    if (typeof claims.mid === 'string') {
      if (requested && requested.toLowerCase() !== claims.mid.toLowerCase()) {
        set({ phase: 'error', error: 'This token is for a different match than the match code. Leave the match code empty.' });
        return;
      }
      requested = claims.mid;
    }
  }
  const multiplayerId = requested;
  let wsUrl = config.wsUrl;
  if (!UUID_RE.test(multiplayerId)) {
    set({ phase: 'error', error: multiplayerId ? 'That match code is not valid (it should look like 123e4567-e89b-12d3-a456-426614174000).' : 'Choose a room first.' });
    return;
  }
  set({ multiplayerId });
  try {
    const creds = await getRealtimeCredentials(multiplayerId, directJwt);
    if (input.wsUrl && /^wss?:\/\//i.test(input.wsUrl)) creds.wsUrl = input.wsUrl;
    wsUrl = creds.wsUrl;
    const options: JoinOptions & { avatarUrl?: string } = {
      jwt: creds.jwt, multiplayerId, username: name, protocolVersion: PROTOCOL_VERSION, roomSettings: input.roomSettings,
      ...(config.avatarUrl ? { avatarUrl: config.avatarUrl } : {}),
    };
    client = new Client(wsUrl);
    const r = await client.joinOrCreate(config.roomName, options);
    attach(r);
  } catch (err) {
    console.error('[join failed]', err);
    set({ phase: 'error', error: describe(err, wsUrl) });
  }
}

/** The server keeps a dropped player's place for 30 s; try to get back in before giving up. */
async function reconnect(token: string): Promise<void> {
  const set = useGame.setState;
  set({ reconnecting: true });
  for (let attempt = 0; attempt < 8 && client; attempt++) {
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 4000)));
    try {
      attach(await client.reconnect(token));
      set({ reconnecting: false });
      useGame.getState().showToast('Reconnected');
      return;
    } catch {
      // keep trying until the server's reconnection window closes
    }
  }
  set({ reconnecting: false, phase: 'error', error: 'Disconnected from the game server.' });
}

function setMeta(m: PlayerMeta, you: string): void {
  useGame.setState((s) => ({
    players: { ...s.players, [m.id]: { name: m.name, appearance: sanitizeAppearance(m.appearance), isLocal: m.id === you } },
  }));
}

function attach(r: Room): void {
  room = r;
  const set = useGame.setState;
  const get = useGame.getState;
  set({ sessionId: r.sessionId });

  r.onMessage('welcome', (m: { sessionId: string; userId: string }) => {
    userId = typeof m?.userId === 'string' ? m.userId : '';
    set({ userId });
  });

  r.onMessage('init', (m: ServerMessages['init']) => {
    world.load(m.size, m.cells, m.protectedCells);
    teleportLocal(m.spawn.x, m.spawn.y, m.spawn.z, m.spawn.yaw);
    remotes.clear();
    set({ layout: m.layout, profile: m.profile, phase: 'playing', players: {} });
    for (const p of m.players) setMeta(p, r.sessionId);
    maybeRestore(m.profile);
    if (m.profile.owned.length === 0 && !loadCachedProfile()?.owned.length) {
      get().showToast('Visit the Blocks stall (or press B) to get blocks, then press T to start building');
    }
  });

  // Every player's transform, 10 Hz. Our own entry is skipped: the local player is simulated on this client.
  r.onMessage('state', (m: StateMessage) => {
    const seen = new Set<string>();
    const nowS = performance.now() / 1000;
    const delay = typeof m.acceptDelayMs === 'number' ? m.acceptDelayMs : get().acceptDelayMs;
    for (const p of m.players) {
      if (p.id === r.sessionId) {
        const inv = p.inv ?? '';
        if (inv !== get().myInvite) set({ myInvite: inv });
        continue;
      }
      seen.add(p.id);
      const s = remotes.get(p.id);
      if (!s) remotes.set(p.id, { ...p, rx: p.x, ry: p.y, rz: p.z, ryaw: p.yaw });
      else {
        if (p.action !== s.action) playSwing(p.id);
        Object.assign(s, p);
      }
      const rs = remotes.get(p.id)!;
      rs.invReadyAt = p.inv ? nowS + Math.max(0, delay - (p.invAgeMs ?? 0)) / 1000 : undefined;
      getAnim(p.id).holding = p.tool === 'destroy' || (p.tool === 'block' && p.held !== AIR && !!getBlock(p.held));
    }
    for (const id of remotes.keys()) if (!seen.has(id)) remotes.delete(id);
    const timeLeftMs = typeof m.timeLeftMs === 'number' ? m.timeLeftMs : 0;
    if (timeLeftMs !== get().timeLeftMs) set({ timeLeftMs });
    if (m.clock) Object.assign(worldClock, m.clock, { at: performance.now() });
    const animals = m.animals ?? [];
    for (const a of animals) {
      const s = animalStates.get(a.id);
      if (s) Object.assign(s, a);
      else animalStates.set(a.id, { ...a, rx: a.x, ry: a.y, rz: a.z, ryaw: a.yaw });
    }
    if (animals.length !== get().animals.length) set({ animals: animals.map((a) => ({ id: a.id, kind: a.kind, variant: a.variant })) });
    const games = m.games ?? [];
    for (const gm of games) {   // games finishing nearby (that I'm not part of): confetti over the table
      if (gm.phase === 'over' && gamePhases.get(gm.id) !== 'over' && get().mg?.id !== gm.id && Math.hypot(gm.x - localBody.x, gm.z - localBody.z) < 40) fx.confetti(gm.x, gm.y + 1.4, gm.z, 40, 0.8);
      gamePhases.set(gm.id, gm.phase);
    }
    if (gamePhases.size > 50) gamePhases.clear();
    if (JSON.stringify(games) !== JSON.stringify(get().games)) set({ games });
    if (delay !== get().acceptDelayMs) set({ acceptDelayMs: delay });
  });
  r.onMessage('playerMeta', (m: ServerMessages['playerMeta']) => setMeta(m, r.sessionId));
  r.onMessage('playerLeft', (m: ServerMessages['playerLeft']) => {
    remotes.delete(m.id);
    dropAnim(m.id);
    set((s) => {
      const next = { ...s.players };
      delete next[m.id];
      return { players: next };
    });
  });

  r.onMessage('blockSet', (m: ServerMessages['blockSet']) => {
    const old = world.grid?.get(m.x, m.y, m.z);
    world.grid?.set(m.x, m.y, m.z, m.id);
    // Someone else's edit (our own optimistic edit already changed the cell, so no double effect).
    if (old !== undefined && old !== m.id) { if (m.id === AIR) fx.blockBreak(m.x, m.y, m.z, old); else fx.blockPlace(m.x, m.y, m.z, m.id); }
  });
  r.onMessage('editRejected', (m: ServerMessages['editRejected']) => {
    world.grid?.set(m.x, m.y, m.z, m.id); // roll back the optimistic edit
    get().showToast(REJECT_TEXT[m.reason] ?? 'Not allowed');
  });
  r.onMessage('profile', (m: ServerMessages['profile']) => {
    set({ profile: m.profile });
    if ((m.result as string) === 'not_at_stall') get().showToast('Buy it at its stall in the market');
    if (m.result === 'purchased') { get().showToast('Unlocked — it is yours forever'); fx.coins(localBody.x, localBody.y + 0.8, localBody.z); }
  });
  r.onMessage('chat', (m: ServerMessages['chat']) => get().showBubble(m.sessionId, { text: m.text }));
  r.onMessage('emoji', (m: ServerMessages['emoji']) => {
    const e = EMOJIS.find((x) => x.id === m.id);
    { const p = posOf(m.sessionId); if (p) fx.sparkle(p.x, p.y + 2.2, p.z, 8, ['#ffffff', '#ffe45c', '#ffb3c7'], 0.3); }
    if (e) get().showBubble(m.sessionId, { emoji: e.char }, 3.5);
  });
  r.onMessage('emote', (m: ServerMessages['emote']) => {
    playEmote(m.sessionId, m.id);
    const p = posOf(m.sessionId);
    if (!p) return;
    if (m.id === 'happy') { fx.sparkle(p.x, p.y + 1.9, p.z, 16); fx.confetti(p.x, p.y + 2, p.z, 26, 0.6); }
    else if (m.id === 'cry') fx.tears(p.x, p.y + 1.55, p.z, p.yaw);
    else fx.notes(p.x - Math.cos(p.yaw) * 0.45, p.y + 2, p.z + Math.sin(p.yaw) * 0.45, '#ffe45c');
  });
  r.onMessage('teleport', (m: ServerMessages['teleport'] & { yaw?: number }) => teleportLocal(m.x, m.y, m.z, m.yaw));

  // ---- mini-games ----
  r.onMessage('mg', (m: MgView) => {
    const prev = get().mg;
    if (!prev && m.role === 'player') fx.poof(localBody.x, localBody.y, localBody.z);
    // Celebrations: confetti for the winners, sparkles for a won Rock Paper Scissors round.
    if (m.phase === 'over' && prev?.phase !== 'over' && m.result) for (const w of m.result.winners) { const p = posOf(w); if (p) fx.victory(p.x, p.y, p.z); }
    if (m.phase === 'reveal' && prev?.phase !== 'reveal' && m.rps && m.rps.roundWinner >= 0) {
      const p = posOf(m.players[m.rps.roundWinner]?.id ?? '');
      if (p) fx.sparkle(p.x, p.y + 1.8, p.z, 12);
    }
    if (!get().mg) { releasePointer(); set({ tool: 'none', panel: 'none' }); }
    set({ mg: m, mgAt: performance.now() });
  });
  r.onMessage('mgEnded', (m: { id: string }) => { if (get().mg?.id === m.id) set({ mg: null }); });
  r.onMessage('mgLobby', (m: MgLobby | null) => {
    const prev = get().lobby;
    set({ lobby: m });
    if (m && m.hostId === r.sessionId && m.members.length > (prev?.members.length ?? 1)) {
      // Someone sat down at the host's Ludo table: show the host the start panel right away.
      get().showToast(`${m.members[m.members.length - 1].name} joined your Ludo table`);
      openPanel('games');
    }
    if (m && m.hostId !== r.sessionId && !prev) { releasePointer(); set({ tool: 'none', panel: 'none' }); }
  });
  r.onMessage('mgError', (m: { message: string }) => get().showToast(m.message));

  // ---- animals: someone petted one → it hops and shows a heart and its sound ----
  r.onMessage('animal', (m: { id: string; by: string; kind: string }) => {
    const a = animalStates.get(m.id);
    if (a) a.hopAt = performance.now() / 1000;
    if (a) { if (m.by) fx.hearts(a.x, a.y + 0.9, a.z); else fx.notes(a.x, a.y + 0.8, a.z, '#ffb400'); }
    const kind = isAnimalKind(m.kind) ? m.kind : null;
    get().showBubble(m.id, { text: `❤️ ${kind ? ANIMAL_SOUND[kind] : ''}` }, 2.5);
  });
  r.onMessage('sessionEnded', () => {
    sessionEnded = true;
    set({ sessionEnded: true, timeLeftMs: 0, panel: 'none' });
    if (document.pointerLockElement) document.exitPointerLock(); // free the cursor for the end screen
  });

  r.onLeave((code: number) => {
    room = null;
    if (sessionEnded) { set({ sessionEnded: true }); return; }
    if (code === 1000 || code === 4000) {
      set({ phase: 'error', error: 'You left the game.' });
      return;
    }
    void reconnect(r.reconnectionToken);
  });
}

// Keep the server's copy of the hotbar / selection / tool in sync (debounced).
let hotbarTimer: ReturnType<typeof setTimeout> | null = null;
useGame.subscribe((s, prev) => {
  if (s.phase !== 'playing') return;
  if (s.profile !== prev.profile) saveCachedProfile(s.profile);
  if (s.profile.hotbar === prev.profile.hotbar && s.selectedSlot === prev.selectedSlot && s.tool === prev.tool) return;
  if (hotbarTimer) clearTimeout(hotbarTimer);
  hotbarTimer = setTimeout(() => {
    const g = useGame.getState();
    send('hotbar', { slots: g.profile.hotbar, selected: g.selectedSlot, tool: g.tool });
  }, 120);
});
