import { create } from 'zustand';
import {
  AIR, HOTBAR_SLOTS, assignSlot, createProfile, DEFAULT_APPEARANCE,
  type Appearance, type IslandLayout, type ProfileData, type ShopCategory, type StallInfo,
} from '@jp/block-sandbox-shared';

export type Panel = 'none' | 'pause' | 'shop' | 'customize' | 'social';
export type CameraMode = 'first' | 'third';

export interface PlayerMeta { name: string; appearance: Appearance; isLocal: boolean }
export interface Bubble { text?: string; emoji?: string; until: number }

interface GameState {
  phase: 'join' | 'connecting' | 'playing' | 'error';
  error: string | null;
  name: string;
  sessionId: string | null;
  layout: IslandLayout | null;
  profile: ProfileData;
  selectedSlot: number;
  panel: Panel;
  shopTab: ShopCategory;
  pointerLocked: boolean;
  cameraMode: CameraMode;
  showHints: boolean;
  players: Record<string, PlayerMeta>;
  bubbles: Record<string, Bubble>;
  toast: { text: string; id: number } | null;
  nearbyStall: StallInfo | null;
  sensitivity: number;
  invertY: boolean;

  setPanel: (p: Panel) => void;
  showToast: (text: string) => void;
  selectSlot: (i: number) => void;
  cycleSlot: (delta: number) => void;
  equip: (id: number) => void;
  showBubble: (sessionId: string, b: Omit<Bubble, 'until'>, seconds?: number) => void;
}

const savedName = (() => { try { return localStorage.getItem('jp.sandbox.name') ?? ''; } catch { return ''; } })();

export const useGame = create<GameState>()((set, get) => ({
  phase: 'join',
  error: null,
  name: savedName,
  sessionId: null,
  layout: null,
  profile: createProfile(),
  selectedSlot: 0,
  panel: 'none',
  shopTab: 'blocks',
  pointerLocked: false,
  cameraMode: 'third',
  showHints: true,
  players: {},
  bubbles: {},
  toast: null,
  nearbyStall: null,
  sensitivity: 1,
  invertY: false,

  setPanel: (panel) => set({ panel }),
  showToast: (text) => set({ toast: { text, id: Date.now() + Math.random() } }),
  selectSlot: (i) => { if (i >= 0 && i < HOTBAR_SLOTS) set({ selectedSlot: i }); },
  cycleSlot: (delta) => set({ selectedSlot: (((get().selectedSlot + delta) % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS }),
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
export const selectedBlock = (s: Pick<GameState, 'profile' | 'selectedSlot'>): number => s.profile.hotbar[s.selectedSlot] ?? AIR;

/** Local appearance (from the profile). */
export const localAppearance = (s: Pick<GameState, 'profile'>): Appearance => s.profile.appearance ?? DEFAULT_APPEARANCE;
