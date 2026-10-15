/**
 * The game always runs in landscape.
 * - On phones/tablets the first tap (Continue / Play / Join) asks for fullscreen + a landscape lock
 *   (supported by Android browsers).
 * - Where the lock isn't available (e.g. iOS Safari) and the device is held upright, the whole app is
 *   rotated 90° with CSS (see .rotator in styles.css); touch deltas are rotated back with toLocalDelta.
 */
const PORTRAIT_TOUCH = '(orientation: portrait) and (pointer: coarse)';

export const isRotated = (): boolean => typeof matchMedia === 'function' && matchMedia(PORTRAIT_TOUCH).matches;

/** Converts a screen-space drag into the rotated app's coordinates. */
export function toLocalDelta(dx: number, dy: number): [number, number] {
  return isRotated() ? [dy, -dx] : [dx, dy];
}

export function lockLandscape(): void {
  if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  const full = el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.();
  Promise.resolve(full).then(() => orientation?.lock?.('landscape')).catch(() => undefined);
}
