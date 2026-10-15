import { clearHeld } from './input';
import { useGame, type Panel } from '../state/store';

let suppressPause = false;

/** True once if the next pointer-lock loss was caused by opening a panel (not by Escape). */
export function takeSuppressPause(): boolean {
  const v = suppressPause;
  suppressPause = false;
  return v;
}

/** Requests pointer lock on the game canvas (must run inside a user gesture). */
export function lockPointer(): void {
  const c = document.querySelector<HTMLCanvasElement>('.game canvas, canvas.game');
  if (!c || document.pointerLockElement === c) return;
  try {
    const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => undefined);
  } catch { /* not allowed right now: the "Click to play" overlay covers it */ }
}

/** Opens a panel (freeing the cursor) or closes the open one (re-locking when the browser allows it). */
export function openPanel(panel: Panel): void {
  const s = useGame.getState();
  if (panel === 'none') {
    s.setPanel('none');
    lockPointer();
    return;
  }
  suppressPause = true;
  clearHeld();
  s.setPanel(panel);
  if (document.pointerLockElement) document.exitPointerLock();
  else suppressPause = false;
}

export const togglePanel = (panel: Panel): void => openPanel(useGame.getState().panel === panel ? 'none' : panel);
