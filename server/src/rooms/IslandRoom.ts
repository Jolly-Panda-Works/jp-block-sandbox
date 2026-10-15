import { Room, type Client } from '../colyseus';
import {
  AIR, EYE_HEIGHT, ISLAND_NAME, MAX_PLAYERS, REACH, WORLD_SIZE, assignSlot, createWorldGrid, evaluatePlacement,
  evaluateRemoval, generateIsland, getBlock, isEmojiId, isEmoteId, playerAabb, purchase, rleEncode, sanitizeAppearance,
  sanitizeMessage, sanitizeName, sanitizeProfile, withinReach,
  type Aabb, type BlockGrid, type ClientMessages, type IslandLayout, type JoinOptions, type ProfileData,
} from '@jp/block-sandbox-shared';
import { IslandState, PlayerState } from '../schema';
import type { ProfileStore } from '../profiles';

interface Session {
  profileId: string;
  profile: ProfileData;
  lastMove: number;
  lastChat: number;
  editTokens: number;
  editRefill: number;
}

const MAX_SPEED = 9;            // m/s, generous above sprint speed to absorb jitter
const EDITS_PER_SECOND = 12;
const CHAT_INTERVAL_MS = 700;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * One island instance (up to 8 players). The server is authoritative for blocks, ownership and social
 * messages: every edit is validated (bounds, protection, ownership, reach, player overlap, rate limit)
 * before it's applied and broadcast. Movement is client-predicted and speed-checked here.
 */
export class IslandRoom extends Room<IslandState> {
  maxClients = MAX_PLAYERS;
  static profiles: ProfileStore;

  private readonly grid: BlockGrid = createWorldGrid();
  private layout!: IslandLayout;
  private readonly sessions = new Map<string, Session>();

  onCreate(options: { seed?: number } = {}): void {
    const seed = isInt(options.seed) ? options.seed : 1337;
    this.layout = generateIsland(this.grid, seed);
    const state = new IslandState();
    state.islandName = ISLAND_NAME;
    state.maxPlayers = MAX_PLAYERS;
    this.setState(state);
    this.setPatchRate(50);

    this.onMessage('move', (c, m: ClientMessages['move']) => this.handleMove(c, m));
    this.onMessage('place', (c, m: ClientMessages['place']) => this.handlePlace(c, m));
    this.onMessage('remove', (c, m: ClientMessages['remove']) => this.handleRemove(c, m));
    this.onMessage('buy', (c, m: ClientMessages['buy']) => this.handleBuy(c, m));
    this.onMessage('hotbar', (c, m: ClientMessages['hotbar']) => this.handleHotbar(c, m));
    this.onMessage('appearance', (c, m: ClientMessages['appearance']) => this.handleAppearance(c, m));
    this.onMessage('chat', (c, m: ClientMessages['chat']) => this.handleChat(c, m));
    this.onMessage('emoji', (c, m: ClientMessages['emoji']) => {
      if (isEmojiId(m?.id)) this.broadcast('emoji', { sessionId: c.sessionId, id: m.id });
    });
    this.onMessage('emote', (c, m: ClientMessages['emote']) => {
      if (isEmoteId(m?.id)) this.broadcast('emote', { sessionId: c.sessionId, id: m.id });
    });
    this.onMessage('*', (c, type) => console.warn(`[room] unknown message ${String(type)} from ${c.sessionId}`));
  }

  onJoin(client: Client, options: Partial<JoinOptions> = {}): void {
    const profileId = typeof options.profileId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(options.profileId)
      ? options.profileId : client.sessionId;
    const profile = sanitizeProfile(IslandRoom.profiles.get(profileId));
    this.sessions.set(client.sessionId, { profileId, profile, lastMove: Date.now(), lastChat: 0, editTokens: EDITS_PER_SECOND, editRefill: Date.now() });

    // Spread spawns on a small circle so players don't stack.
    const i = this.state.players.size;
    const a = (i / MAX_PLAYERS) * Math.PI * 2;
    const spawn = { ...this.layout.spawn, x: this.layout.spawn.x + Math.cos(a) * (i ? 1.5 : 0), z: this.layout.spawn.z + Math.sin(a) * (i ? 1.5 : 0) };

    const p = new PlayerState();
    p.name = sanitizeName(options.name);
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z; p.yaw = spawn.yaw;
    p.appearance = JSON.stringify(profile.appearance);
    this.state.players.set(client.sessionId, p);

    client.send('init', {
      size: [WORLD_SIZE.x, WORLD_SIZE.y, WORLD_SIZE.z],
      cells: rleEncode(this.grid.cells),
      protectedCells: rleEncode(this.grid.protectedCells),
      layout: this.layout,
      profile,
      spawn,
    });
    console.log(`[room ${this.roomId}] ${p.name} joined (${this.state.players.size}/${MAX_PLAYERS})`);
  }

  onLeave(client: Client): void {
    const s = this.sessions.get(client.sessionId);
    if (s) IslandRoom.profiles.save(s.profileId, s.profile);
    this.sessions.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  onDispose(): void {
    IslandRoom.profiles.flush();
  }

  // ---------------- handlers ----------------

  private handleMove(client: Client, m: ClientMessages['move']): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || !m || ![m.x, m.y, m.z, m.yaw, m.speed].every(isNum)) return;
    const now = Date.now();
    const dt = Math.max(0.05, (now - s.lastMove) / 1000);
    s.lastMove = now;
    const horizontal = Math.hypot(m.x - p.x, m.z - p.z);
    // Falling and respawning legitimately move fast vertically; only horizontal speed is limited.
    if (horizontal > MAX_SPEED * dt + 1.5 && !(m.y > p.y + 1)) {
      client.send('teleport', { x: p.x, y: p.y, z: p.z });
      return;
    }
    p.x = m.x; p.y = Math.max(-50, Math.min(200, m.y)); p.z = m.z;
    p.yaw = m.yaw; p.speed = Math.max(0, Math.min(2, m.speed)); p.grounded = !!m.grounded;
  }

  private takeEditToken(s: Session): boolean {
    const now = Date.now();
    s.editTokens = Math.min(EDITS_PER_SECOND, s.editTokens + ((now - s.editRefill) / 1000) * EDITS_PER_SECOND);
    s.editRefill = now;
    if (s.editTokens < 1) return false;
    s.editTokens -= 1;
    return true;
  }

  private inReach(p: PlayerState, x: number, y: number, z: number): boolean {
    return withinReach(p.x, p.y + EYE_HEIGHT, p.z, x, y, z, REACH + 1); // +1 tolerance for latency
  }

  private blockers(): Aabb[] {
    const list: Aabb[] = [];
    this.state.players.forEach((pl) => list.push(playerAabb(pl.x, pl.y, pl.z)));
    return list;
  }

  private reject(client: Client, x: number, y: number, z: number, reason: string): void {
    client.send('editRejected', { x, y, z, id: this.grid.get(x, y, z), reason });
  }

  private handlePlace(client: Client, m: ClientMessages['place']): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || !m || ![m.x, m.y, m.z, m.id].every(isInt)) return;
    const { x, y, z, id } = m;
    if (!s.profile.owned.includes(id)) return this.reject(client, x, y, z, 'not_owned');
    if (!this.inReach(p, x, y, z)) return this.reject(client, x, y, z, 'out_of_range');
    if (!this.takeEditToken(s)) return this.reject(client, x, y, z, 'out_of_range');
    const result = evaluatePlacement(this.grid, x, y, z, id, this.blockers());
    if (result !== 'ok') return this.reject(client, x, y, z, result);
    this.grid.set(x, y, z, id);
    p.action = (p.action + 1) % 65535;
    this.broadcast('blockSet', { x, y, z, id });
  }

  private handleRemove(client: Client, m: ClientMessages['remove']): void {
    const p = this.state.players.get(client.sessionId);
    const s = this.sessions.get(client.sessionId);
    if (!p || !s || !m || ![m.x, m.y, m.z].every(isInt)) return;
    const { x, y, z } = m;
    if (!this.inReach(p, x, y, z)) return this.reject(client, x, y, z, 'out_of_range');
    if (!this.takeEditToken(s)) return this.reject(client, x, y, z, 'out_of_range');
    const result = evaluateRemoval(this.grid, x, y, z);
    if (result !== 'ok') return this.reject(client, x, y, z, result);
    this.grid.set(x, y, z, AIR);
    p.action = (p.action + 1) % 65535;
    this.broadcast('blockSet', { x, y, z, id: AIR });
  }

  private handleBuy(client: Client, m: ClientMessages['buy']): void {
    const s = this.sessions.get(client.sessionId);
    if (!s || !m || !isInt(m.id)) return;
    const result = purchase(s.profile, m.id);
    if (result === 'purchased') IslandRoom.profiles.save(s.profileId, s.profile);
    client.send('profile', { profile: s.profile, result });
  }

  private handleHotbar(client: Client, m: ClientMessages['hotbar']): void {
    const s = this.sessions.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p || !m || !Array.isArray(m.slots)) return;
    const next = s.profile.hotbar.map(() => AIR);
    m.slots.slice(0, next.length).forEach((id, i) => {
      if (isInt(id) && s.profile.owned.includes(id)) assignSlot(next, i, id);
    });
    s.profile.hotbar = next;
    const selected = isInt(m.selected) && m.selected >= 0 && m.selected < next.length ? m.selected : 0;
    p.held = getBlock(next[selected]) ? next[selected] : AIR;
    IslandRoom.profiles.save(s.profileId, s.profile);
  }

  private handleAppearance(client: Client, m: ClientMessages['appearance']): void {
    const s = this.sessions.get(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!s || !p) return;
    s.profile.appearance = sanitizeAppearance(m);
    p.appearance = JSON.stringify(s.profile.appearance);
    IslandRoom.profiles.save(s.profileId, s.profile);
  }

  private handleChat(client: Client, m: ClientMessages['chat']): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    const now = Date.now();
    if (now - s.lastChat < CHAT_INTERVAL_MS) return;
    const text = sanitizeMessage(m?.text);
    if (!text) return;
    s.lastChat = now;
    this.broadcast('chat', { sessionId: client.sessionId, text });
  }
}
