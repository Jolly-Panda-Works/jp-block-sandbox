import { create } from 'zustand';
import {
  AIR, HOTBAR_SLOTS, assignSlot, createProfile, DEFAULT_APPEARANCE,
  type Appearance, type ToolKind, type MgLobby, type MgListing, type MgView, type MiniGameKind, type IslandLayout, type ProfileData, type ShopCategory, type StallInfo,
} from '@jp/blocksy-shared';

export type Panel = 'none' | 'pause' | 'shop' | 'customize' | 'social' | 'build' | 'games';
/** first / third person, or a free camera that flies around on its own (the player stays put). */
export type CameraMode = 'first' | 'third' | 'free';

export interface PlayerMeta { name: string; appearance: Appearance; isLocal: boolean }
export interface Bubble { text?: string; emoji?: string; until: number }

interface GameState {
  phase: 'join' | 'connecting' | 'playing' | 'error';
  error: string | null;
  name: string;
  sessionId: string | null;
  /** Platform user id (from the server's welcome message). */
  userId: string;
  /** Match being played (for invite links). */
  multiplayerId: string;
  /** Remaining session time in ms (0 = no time limit). */
  timeLeftMs: number;
  sessionEnded: boolean;
  reconnecting: boolean;
  /** Mini-game I'm playing or watching (server view), and when it was received (performance.now ms). */
  mg: MgView | null;
  mgAt: number;
  /** Ludo lobby I'm in (host or guest). */
  lobby: MgLobby | null;
  /** My own open invite (shown above my head). */
  myInvite: MiniGameKind | '';
  /** Running games on the island (tables, poses, spectating). */
  games: MgListing[];
  acceptDelayMs: number;
  /** Closest invite / game in reach (set by the local player controller). */
  nearInvite: { hostId: string; name: string; kind: MiniGameKind; waitMs: number } | null;
  nearGame: { id: string; kind: MiniGameKind } | null;
  /** Free Game Center character in reach. */
  nearNpc: { id: string; name: string; kind: MiniGameKind } | null;
  /** Animals on the island (id + kind; positions live in net/network.ts animalStates). */
  animals: { id: string; kind: string; variant: string }[];
  /** Animal in petting reach. */
  nearAnimal: { id: string; kind: string } | null;
  layout: IslandLayout | null;
  profile: ProfileData;
  selectedSlot: number;
  /** Hands are empty by default; building/destroying is opted into with 1–9 / 0. */
  tool: ToolKind;
  panel: Panel;
  shopTab: ShopCategory;
  pointerLocked: boolean;
  /** Small screen: touch controls on, keyboard and pointer lock off. */
  touch: boolean;
  cameraMode: CameraMode;
  showHints: boolean;
  players: Record<string, PlayerMeta>;
  bubbles: Record<string, Bubble>;
  toast: { text: string; id: number } | null;
  nearbyStall: StallInfo | null;
  sensitivity: number;
  /** Visual particles on/off (saved on this device). */
  particles: boolean;
  /** Third-person camera distance from the player in metres (2–8, saved on this device). */
  camDistance: number;
  invertY: boolean;

  setPanel: (p: Panel) => void;
  showToast: (text: string) => void;
  selectSlot: (i: number) => void;
  /** Number-key behaviour: 1–9 picks a hotbar block, 'destroy' is key 0; pressing the active one again empties your hands. */
  selectTool: (slot: number | 'destroy') => void;
  setTool: (tool: ToolKind) => void;
  cycleSlot: (delta: number) => void;
  clearSlot: (i: number) => void;
  equip: (id: number) => void;
  showBubble: (sessionId: string, b: Omit<Bubble, 'until'>, seconds?: number) => void;
}

/** Saves the player's display name on this device. */
export function saveName(name: string): void {
  try { localStorage.setItem('jp.sandbox.name', name); } catch { /* private mode */ }
  useGame.setState({ name });
}

const savedName = (() => {
  const fromUrl = new URLSearchParams(location.search).get('username');
  if (fromUrl) return fromUrl;
  try { return localStorage.getItem('jp.sandbox.name') ?? ''; } catch { return ''; }
})();

export const useGame = create<GameState>()((set, get) => ({
  phase: 'join',
  error: null,
  name: savedName,
  sessionId: null,
  userId: '',
  multiplayerId: '',
  timeLeftMs: 0,
  sessionEnded: false,
  reconnecting: false,
  mg: null,
  mgAt: 0,
  lobby: null,
  myInvite: '',
  games: [],
  acceptDelayMs: 5000,
  nearInvite: null,
  nearGame: null,
  nearNpc: null,
  animals: [],
  nearAnimal: null,
  layout: null,
  profile: createProfile(),
  selectedSlot: 0,
  tool: 'none',
  panel: 'none',
  shopTab: 'blocks',
  pointerLocked: false,
  touch: false,
  cameraMode: 'third',
  showHints: true,
  players: {},
  bubbles: {},
  toast: null,
  nearbyStall: null,
  sensitivity: 1,
  camDistance: (() => { try { const v = Number(localStorage.getItem('blocksy.camDistance')); return v >= 2 && v <= 8 ? v : 4; } catch { return 4; } })(),
  particles: (() => { try { return localStorage.getItem('blocksy.particles') !== 'off'; } catch { return true; } })(),
  invertY: false,

  setPanel: (panel) => set({ panel }),
  showToast: (text) => set({ toast: { text, id: Date.now() + Math.random() } }),
  selectSlot: (i) => { if (i >= 0 && i < HOTBAR_SLOTS) set({ selectedSlot: i }); },
  selectTool: (slot) => {
    const { tool, selectedSlot } = get();
    if (slot === 'destroy') set({ tool: tool === 'destroy' ? 'none' : 'destroy' });
    else if (slot >= 0 && slot < HOTBAR_SLOTS) set(tool === 'block' && selectedSlot === slot ? { tool: 'none' } : { tool: 'block', selectedSlot: slot });
  },
  setTool: (tool) => set({ tool }),
  // Mouse wheel while building: slots 1–9 then the destroy tool (position 9), wrapping around.
  cycleSlot: (delta) => {
    const { tool, selectedSlot } = get();
    const n = HOTBAR_SLOTS + 1;
    const pos = ((((tool === 'destroy' ? HOTBAR_SLOTS : selectedSlot) + delta) % n) + n) % n;
    set(pos === HOTBAR_SLOTS ? { tool: 'destroy' } : { tool: 'block', selectedSlot: pos });
  },
  clearSlot: (i) => {
    const { profile } = get();
    const hotbar = profile.hotbar.slice();
    if (i < 0 || i >= hotbar.length) return;
    hotbar[i] = AIR;
    set({ profile: { ...profile, hotbar } });
  },
  equip: (id) => {
    const { profile, selectedSlot } = get();
    const hotbar = profile.hotbar.slice();
    assignSlot(hotbar, selectedSlot, id);
    set({ profile: { ...profile, hotbar } });
  },
  showBubble: (sessionId, b, seconds = 4.5) =>
    set((s) => ({ bubbles: { ...s.bubbles, [sessionId]: { ...b, until: performance.now() / 1000 + seconds } } })),
}));

/** Block in the selected hotbar slot (air when empty). */
export const selectedBlock = (s: Pick<GameState, 'profile' | 'selectedSlot' | 'tool'>): number =>
  s.tool === 'block' ? s.profile.hotbar[s.selectedSlot] ?? AIR : AIR;

/** Local appearance (from the profile). */
export const localAppearance = (s: Pick<GameState, 'profile'>): Appearance => s.profile.appearance ?? DEFAULT_APPEARANCE;
