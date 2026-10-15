import type { Body } from '@jp/blocksy-shared';

/** The local player's simulated body plus view angles (radians; pitch > 0 looks down). */
export const localBody: Body & { yaw: number; pitch: number } = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, yaw: 0, pitch: 0.15 };

export function teleportLocal(x: number, y: number, z: number, yaw?: number): void {
  Object.assign(localBody, { x, y, z, vx: 0, vy: 0, vz: 0 });
  if (yaw !== undefined) localBody.yaw = yaw;
}
