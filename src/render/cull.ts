import * as THREE from 'three';

/**
 * View culling for moving things (characters, animals): anything outside the camera's view, or further than
 * the view distance, is neither drawn nor animated. Its position keeps updating, so it reappears in the right
 * place. The player's own character is never culled.
 */
const frustum = new THREE.Frustum();
const m = new THREE.Matrix4();
const cam = new THREE.Vector3();
const sphere = new THREE.Sphere();
export const cull = { viewDistance: 75 };

/** Call once per frame before anything asks inView (CullUpdater does this). */
export function updateCull(camera: THREE.Camera): void {
  camera.updateMatrixWorld();
  m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(m);
  camera.getWorldPosition(cam);
}

/** Is a sphere at (x, y, z) with radius r in view and within the view distance? */
export function inView(x: number, y: number, z: number, r = 1.5): boolean {
  const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
  if (dx * dx + dy * dy + dz * dz > cull.viewDistance * cull.viewDistance) return false;
  sphere.center.set(x, y + 0.9, z);
  sphere.radius = r;
  return frustum.intersectsSphere(sphere);
}
