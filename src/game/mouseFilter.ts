/**
 * Pointer-lock mouse deltas are not always trustworthy: Chrome on Windows (and some mice / remote desktops)
 * occasionally report one huge bogus movement, and the first event after locking often carries a jump.
 * Those single spikes made the camera snap while orbiting the character. Real fast flicks build up over a
 * few events, so they pass; a lone event far bigger than the recent movement is dropped.
 */
export interface MouseFilter { avg: number; lockedAt: number }
export const newMouseFilter = (): MouseFilter => ({ avg: 0, lockedAt: -1e9 });

/** Call when pointer lock is gained or lost. */
export function mouseLockChanged(f: MouseFilter, now: number): void { f.lockedAt = now; f.avg = 0; }

/** Returns the delta to use (0, 0 when the event is a spike). `now` in ms. */
export function filterMouse(f: MouseFilter, dx: number, dy: number, now: number): [number, number] {
  if (now - f.lockedAt < 60) return [0, 0];                    // the jump that comes with locking
  const mag = Math.hypot(dx, dy);
  if (mag > 180 && mag > 8 * Math.max(f.avg, 15)) return [0, 0]; // a lone spike, not a real flick
  f.avg = f.avg * 0.75 + mag * 0.25;
  return [dx, dy];
}
