import * as THREE from 'three';
import {
  ATLAS_HEIGHT, ATLAS_WIDTH, blockFaceUv, buildBlockMesh, getBlock, paintAtlas, renderIcon, type MeshData,
} from '@jp/blocksy-shared';

/** Copies a bottom-up RGBA buffer into a canvas (canvas rows are top-down). */
function toCanvas(px: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

let atlas: THREE.CanvasTexture | null = null;
export function getAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  atlas = new THREE.CanvasTexture(toCanvas(paintAtlas(), ATLAS_WIDTH, ATLAS_HEIGHT));
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.SRGBColorSpace;
  return atlas;
}

let materials: THREE.Material[] | null = null;
/** Materials indexed by render layer: opaque, cutout, transparent, emissive. */
export function getBlockMaterials(): THREE.Material[] {
  if (materials) return materials;
  const map = getAtlas();
  materials = [
    new THREE.MeshLambertMaterial({ map }),
    new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }),
    new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false }),
    new THREE.MeshLambertMaterial({ map, emissive: new THREE.Color('#ffffff'), emissiveMap: map, emissiveIntensity: 0.9 }),
  ];
  return materials;
}

/** Writes mesher output into a BufferGeometry (reusing it). */
export function applyMeshData(geo: THREE.BufferGeometry, d: MeshData): void {
  geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
  geo.clearGroups();
  for (const g of d.groups) geo.addGroup(g.start, g.count, g.layer);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
}

const blockGeometries = new Map<number, THREE.BufferGeometry>();
/** Geometry for one centred block (held items). */
export function getBlockGeometry(id: number): THREE.BufferGeometry | null {
  const def = getBlock(id);
  if (!def) return null;
  let geo = blockGeometries.get(id);
  if (!geo) {
    geo = new THREE.BufferGeometry();
    applyMeshData(geo, buildBlockMesh(def, blockFaceUv));
    blockGeometries.set(id, geo);
  }
  return geo;
}

const icons = new Map<number, string>();
/** Isometric icon as a data URL (cached). */
export function getIconUrl(id: number): string | null {
  const def = getBlock(id);
  if (!def) return null;
  let url = icons.get(id);
  if (!url) {
    url = toCanvas(renderIcon(def, 64), 64, 64).toDataURL();
    icons.set(id, url);
  }
  return url;
}

/** Tiling water texture. */
export function createWaterTexture(): THREE.CanvasTexture {
  const s = 32;
  const canvas = document.createElement('canvas');
  canvas.width = s; canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const wave = Math.sin((x + Math.sin(y * 0.4) * 3) * 0.39) * 0.5 + 0.5;
    const r = 46 + 40 * wave * 0.6, g = 128 + 42 * wave * 0.6, b = 206 + 26 * wave * 0.6;
    ctx.fillStyle = Math.random() < 0.03 ? 'rgb(190,230,255)' : `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Text drawn on a canvas, for wooden signs (respects depth, unlike screen overlays). */
export function createSignTexture(text: string, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w * 128; canvas.height = h * 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a07345';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
  ctx.fillStyle = '#3d2614';
  ctx.font = `bold ${Math.round(canvas.height * 0.42)}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 24);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
