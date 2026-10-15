/**
 * Keyboard/mouse state for gameplay. Uses KeyboardEvent.code so WASD works on any keyboard layout
 * (including Persian). Mouse deltas accumulate until the game loop consumes them once per frame.
 */
const held = new Set<string>();
const pressed = new Set<string>();
let mouseDX = 0, mouseDY = 0, wheel = 0;
const mouseHeld = [false, false, false];
const mousePressed = [false, false, false];
let keyboardEnabled = true;

/** Touch-control state written by <TouchControls> and merged into each frame's input. */
export const touch = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, usePressed: false, useHeld: false };

/** In touch mode the keyboard is ignored entirely (text fields keep working). */
export function setKeyboardEnabled(enabled: boolean): void {
  keyboardEnabled = enabled;
  if (!enabled) { held.clear(); pressed.clear(); }
}

export const isTyping = (): boolean => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
};

export function installInput(onKey: (code: string) => void): () => void {
  const down = (e: KeyboardEvent) => {
    if (isTyping()) { if (e.code === 'Escape' && keyboardEnabled) onKey(e.code); return; }
    if (!keyboardEnabled) return;
    if (!held.has(e.code)) pressed.add(e.code);
    held.add(e.code);
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (!e.repeat) onKey(e.code);
  };
  const up = (e: KeyboardEvent) => held.delete(e.code);
  const move = (e: MouseEvent) => {
    if (!document.pointerLockElement) return;
    mouseDX += e.movementX; mouseDY += e.movementY;
  };
  const mdown = (e: MouseEvent) => {
    if (!document.pointerLockElement || e.button > 2) return;
    mouseHeld[e.button] = true; mousePressed[e.button] = true;
  };
  const mup = (e: MouseEvent) => { if (e.button <= 2) mouseHeld[e.button] = false; };
  const wh = (e: WheelEvent) => { if (document.pointerLockElement) wheel += Math.sign(e.deltaY); };
  const blur = () => { held.clear(); mouseHeld.fill(false); };
  const ctx = (e: MouseEvent) => { if (document.pointerLockElement) e.preventDefault(); };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('mousemove', move);
  window.addEventListener('mousedown', mdown);
  window.addEventListener('mouseup', mup);
  window.addEventListener('wheel', wh, { passive: true });
  window.addEventListener('blur', blur);
  window.addEventListener('contextmenu', ctx);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mousedown', mdown);
    window.removeEventListener('mouseup', mup);
    window.removeEventListener('wheel', wh);
    window.removeEventListener('blur', blur);
    window.removeEventListener('contextmenu', ctx);
  };
}

export interface FrameInput {
  moveX: number; moveY: number; jump: boolean; sprint: boolean;
  /** Held Space / Shift (free camera up / down). */
  up: boolean; down: boolean;
  lookX: number; lookY: number; wheel: number;
  primaryPressed: boolean; primaryHeld: boolean; secondaryPressed: boolean; secondaryHeld: boolean;
}

/** Reads and clears per-frame input. */
export function consumeInput(): FrameInput {
  const k = (c: string) => held.has(c);
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  const f: FrameInput = {
    moveX: clamp1((k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + touch.moveX),
    moveY: clamp1((k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) + touch.moveY),
    jump: pressed.has('Space') || touch.jump,
    sprint: k('ShiftLeft') || k('ShiftRight'),
    up: k('Space'), down: k('ShiftLeft') || k('ShiftRight'),
    lookX: mouseDX + touch.lookDX, lookY: mouseDY + touch.lookDY, wheel,
    primaryPressed: mousePressed[0] || touch.usePressed, primaryHeld: mouseHeld[0] || touch.useHeld,
    secondaryPressed: mousePressed[2], secondaryHeld: mouseHeld[2],
  };
  pressed.clear();
  mousePressed.fill(false);
  touch.jump = false; touch.usePressed = false; touch.lookDX = 0; touch.lookDY = 0;
  mouseDX = 0; mouseDY = 0; wheel = 0;
  return f;
}

export function clearHeld(): void {
  held.clear(); mouseHeld.fill(false);
  Object.assign(touch, { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, usePressed: false, useHeld: false });
}
