/**
 * Keyboard/mouse state for gameplay. Uses KeyboardEvent.code so WASD works on any keyboard layout
 * (including Persian). Mouse deltas accumulate until the game loop consumes them once per frame.
 */
const held = new Set<string>();
const pressed = new Set<string>();
let mouseDX = 0, mouseDY = 0, wheel = 0;
const mouseHeld = [false, false, false];
const mousePressed = [false, false, false];

export const isTyping = (): boolean => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
};

export function installInput(onKey: (code: string) => void): () => void {
  const down = (e: KeyboardEvent) => {
    if (isTyping()) { if (e.code === 'Escape') onKey(e.code); return; }
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
  lookX: number; lookY: number; wheel: number;
  primaryPressed: boolean; primaryHeld: boolean; secondaryPressed: boolean; secondaryHeld: boolean;
}

/** Reads and clears per-frame input. */
export function consumeInput(): FrameInput {
  const k = (c: string) => held.has(c);
  const f: FrameInput = {
    moveX: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
    moveY: (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0),
    jump: pressed.has('Space'),
    sprint: k('ShiftLeft') || k('ShiftRight'),
    lookX: mouseDX, lookY: mouseDY, wheel,
    primaryPressed: mousePressed[0], primaryHeld: mouseHeld[0],
    secondaryPressed: mousePressed[2], secondaryHeld: mouseHeld[2],
  };
  pressed.clear();
  mousePressed.fill(false);
  mouseDX = 0; mouseDY = 0; wheel = 0;
  return f;
}

export function clearHeld(): void { held.clear(); mouseHeld.fill(false); }
