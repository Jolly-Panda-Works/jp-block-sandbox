import { Client, type Room } from 'colyseus.js';
import {
  AIR, EMOJIS, ROOM_NAME, getBlock, sanitizeAppearance,
  type ClientMessages, type ServerMessages,
} from '@jp/block-sandbox-shared';
import { useGame } from '../state/store';
import { world } from '../game/world';
import { teleportLocal } from '../game/localState';
import { dropAnim, getAnim, playEmote, playSwing } from '../render/animState';

/** Replicated transform of a remote player; render* fields are the interpolated values. */
export interface RemoteState { x: number; y: number; z: number; yaw: number; speed: number; grounded: boolean; held: number; tool: string; action: number; rx: number; ry: number; rz: number; ryaw: number }
export const remotes = new Map<string, RemoteState>();

let room: Room | null = null;

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

function profileId(): string {
  try {
    let id = localStorage.getItem('jp.sandbox.profileId');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `p-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`).replace(/[^A-Za-z0-9-]/g, '');
      localStorage.setItem('jp.sandbox.profileId', id);
    }
    return id;
  } catch {
    return `p-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Server URL: VITE_SERVER_URL, or the page host on port 2567 (dev), or the same origin (production build served by the server). */
function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
  return import.meta.env.DEV ? `${wsProto}://${location.hostname}:2567` : `${wsProto}://${location.host}`;
}

export async function connect(name: string): Promise<void> {
  const set = useGame.setState;
  set({ phase: 'connecting', error: null, name });
  try { localStorage.setItem('jp.sandbox.name', name); } catch { /* private mode */ }
  try {
    const client = new Client(serverUrl());
    const r = await client.joinOrCreate(ROOM_NAME, { name, profileId: profileId() });
    room = r;
    set({ sessionId: r.sessionId });
    wireRoom(r);
  } catch (err) {
    console.error('[join failed]', err);
    const detail = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    set({ phase: 'error', error: `Could not join the island (${serverUrl()}): ${detail || 'server unreachable — is it running?'}` });
  }
}

function wireRoom(r: Room): void {
  const set = useGame.setState;
  const get = useGame.getState;

  r.onMessage('init', (m: ServerMessages['init']) => {
    world.load(m.size, m.cells, m.protectedCells);
    teleportLocal(m.spawn.x, m.spawn.y, m.spawn.z, m.spawn.yaw);
    set({ layout: m.layout, profile: m.profile, phase: 'playing' });
    if (m.profile.owned.length === 0) get().showToast('Visit the Blocks stall (or press B) to get blocks, then press T to start building');
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

  // Schema callbacks (colyseus.js 0.15 API). The client has no schema classes; it uses reflection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const players = (r.state as any).players;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  players.onAdd((p: any, id: string) => {
    const isLocal = id === r.sessionId;
    const meta = () => ({ name: String(p.name), appearance: sanitizeAppearance(safeJson(p.appearance)), isLocal });
    set((s) => ({ players: { ...s.players, [id]: meta() } }));
    if (!isLocal) {
      remotes.set(id, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: 0, grounded: true, held: p.held, tool: p.tool, action: p.action, rx: p.x, ry: p.y, rz: p.z, ryaw: p.yaw });
      p.onChange(() => {
        const s = remotes.get(id);
        if (!s) return;
        if (p.action !== s.action) playSwing(id);
        Object.assign(s, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.speed, grounded: p.grounded, held: p.held, tool: p.tool, action: p.action });
        const a = getAnim(id);
        a.holding = p.tool === 'destroy' || (!!getBlock(p.held) && p.held !== AIR);
      });
    }
    p.listen('appearance', () => set((s) => ({ players: { ...s.players, [id]: meta() } })));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  players.onRemove((_p: any, id: string) => {
    remotes.delete(id);
    dropAnim(id);
    set((s) => {
      const next = { ...s.players };
      delete next[id];
      return { players: next };
    });
  });

  r.onLeave((code) => {
    room = null;
    if (code !== 1000) set({ phase: 'error', error: 'Disconnected from the island server.' });
  });
}

function safeJson(s: unknown): unknown {
  try { return typeof s === 'string' ? JSON.parse(s) : null; } catch { return null; }
}

// Keep the server's copy of the hotbar/selection in sync (debounced).
let hotbarTimer: ReturnType<typeof setTimeout> | null = null;
useGame.subscribe((s, prev) => {
  if (s.phase !== 'playing' || (s.profile.hotbar === prev.profile.hotbar && s.selectedSlot === prev.selectedSlot && s.tool === prev.tool)) return;
  if (hotbarTimer) clearTimeout(hotbarTimer);
  hotbarTimer = setTimeout(() => {
    const g = useGame.getState();
    send('hotbar', { slots: g.profile.hotbar, selected: g.selectedSlot, tool: g.tool });
  }, 120);
});
