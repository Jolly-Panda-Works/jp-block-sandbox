import { Client, type Room } from 'colyseus.js';
import {
  AIR, DEFAULT_MULTIPLAYER_ID, EMOJIS, PROTOCOL_VERSION, getBlock, sanitizeAppearance, sanitizeMultiplayerId, sanitizeProfile,
  type ClientMessages, type JoinOptions, type PlayerMeta, type PlayerSnapshot, type ProfileData, type ServerMessages,
} from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { world } from '../game/world';
import { teleportLocal } from '../game/localState';
import { dropAnim, getAnim, playEmote, playSwing } from '../render/animState';
import { UUID_RE, config } from './config';
import { getRealtimeCredentials } from './api';

/** Latest replicated transform of a remote player; r* fields are the interpolated render values. */
export interface RemoteState extends PlayerSnapshot { rx: number; ry: number; rz: number; ryaw: number }
export const remotes = new Map<string, RemoteState>();

/** Extra fields the Rastaar server adds to every `state` message. */
type StateMessage = ServerMessages['state'] & { phase?: 'playing' | 'finished'; timeLeftMs?: number };

let client: Client | null = null;
let room: Room | null = null;
let userId = '';
let sessionEnded = false;

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
export async function connect(name: string): Promise<void> {
  const set = useGame.setState;
  set({ phase: 'connecting', error: null, name, sessionEnded: false, timeLeftMs: 0 });
  try { localStorage.setItem('jp.sandbox.name', name); } catch { /* private mode */ }
  sessionEnded = false;
  // The platform's JWT carries the match id ("mid", a UUID); the local dev server accepts any id.
  const multiplayerId = config.localDev ? sanitizeMultiplayerId(config.multiplayerId, DEFAULT_MULTIPLAYER_ID) : config.multiplayerId;
  let wsUrl = config.wsUrl;
  if (!config.localDev && !UUID_RE.test(multiplayerId)) {
    set({ phase: 'error', error: 'No match selected. Open Blocksy from the Rastaar app, or use an invite link (…?multiplayerId=<match id>).' });
    return;
  }
  set({ multiplayerId });
  try {
    const creds = await getRealtimeCredentials(multiplayerId);
    wsUrl = creds.wsUrl;
    const options: JoinOptions & { avatarUrl?: string } = {
      jwt: creds.jwt, multiplayerId, username: name, protocolVersion: PROTOCOL_VERSION,
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
    for (const p of m.players) {
      if (p.id === r.sessionId) continue;
      seen.add(p.id);
      const s = remotes.get(p.id);
      if (!s) remotes.set(p.id, { ...p, rx: p.x, ry: p.y, rz: p.z, ryaw: p.yaw });
      else {
        if (p.action !== s.action) playSwing(p.id);
        Object.assign(s, p);
      }
      getAnim(p.id).holding = p.tool === 'destroy' || (p.tool === 'block' && p.held !== AIR && !!getBlock(p.held));
    }
    for (const id of remotes.keys()) if (!seen.has(id)) remotes.delete(id);
    const timeLeftMs = typeof m.timeLeftMs === 'number' ? m.timeLeftMs : 0;
    if (timeLeftMs !== get().timeLeftMs) set({ timeLeftMs });
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

  r.onMessage('blockSet', (m: ServerMessages['blockSet']) => { world.grid?.set(m.x, m.y, m.z, m.id); });
  r.onMessage('editRejected', (m: ServerMessages['editRejected']) => {
    world.grid?.set(m.x, m.y, m.z, m.id); // roll back the optimistic edit
    get().showToast(REJECT_TEXT[m.reason] ?? 'Not allowed');
  });
  r.onMessage('profile', (m: ServerMessages['profile']) => {
    set({ profile: m.profile });
    if (m.result === 'purchased') get().showToast('Unlocked — it is yours forever');
  });
  r.onMessage('chat', (m: ServerMessages['chat']) => get().showBubble(m.sessionId, { text: m.text }));
  r.onMessage('emoji', (m: ServerMessages['emoji']) => {
    const e = EMOJIS.find((x) => x.id === m.id);
    if (e) get().showBubble(m.sessionId, { emoji: e.char }, 3.5);
  });
  r.onMessage('emote', (m: ServerMessages['emote']) => playEmote(m.sessionId, m.id));
  r.onMessage('teleport', (m: ServerMessages['teleport']) => teleportLocal(m.x, m.y, m.z));
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
