/**
 * Day / night cycle. The server owns the clock (hour 0–24 + day number); the client turns the hour into
 * sun / moon direction, sky, fog and light colours with skyAt().
 */

export interface WorldClock { hour: number; day: number }

/** Clock after `elapsedMs` of play. dayLengthMs = length of a full 24-hour day; 0 = time stands still. */
export function clockAt(startHour: number, dayLengthMs: number, elapsedMs: number): WorldClock {
  if (dayLengthMs <= 0) return { hour: startHour, day: 1 };
  const total = startHour + (elapsedMs / dayLengthMs) * 24;
  return { hour: ((total % 24) + 24) % 24, day: 1 + Math.floor(total / 24) };
}

export const isNight = (hour: number): boolean => hour < 5.5 || hour >= 20.5;

export const formatClock = (hour: number): string => {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export interface SkyState {
  /** Direction toward the light (sun by day, moon by night), normalised. */
  lightDir: [number, number, number];
  /** Direction toward the sun (may be below the horizon). */
  sunDir: [number, number, number];
  lightColor: string;
  lightIntensity: number;
  background: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  /** 0..1 */
  stars: number;
  /** 0..1, how strongly lanterns glow. */
  lanterns: number;
  /** Cloud tint. */
  cloud: string;
}

type Key = Omit<SkyState, 'lightDir' | 'sunDir'> & { h: number };
const KEYS: Key[] = [
  { h: 0, lightColor: '#9fb4ff', lightIntensity: 0.35, background: '#0b1330', fog: '#101a38', hemiSky: '#34447a', hemiGround: '#151520', hemiIntensity: 0.45, ambient: 0.22, stars: 1, lanterns: 1, cloud: '#4a5578' },
  { h: 4.8, lightColor: '#9fb4ff', lightIntensity: 0.35, background: '#141c46', fog: '#18224a', hemiSky: '#3a4a80', hemiGround: '#18182a', hemiIntensity: 0.5, ambient: 0.24, stars: 0.9, lanterns: 1, cloud: '#56608a' },
  { h: 6, lightColor: '#ffb070', lightIntensity: 1.3, background: '#f0a27a', fog: '#f1b892', hemiSky: '#ffd7b0', hemiGround: '#6a5040', hemiIntensity: 0.85, ambient: 0.38, stars: 0.15, lanterns: 0.6, cloud: '#ffd6c2' },
  { h: 8, lightColor: '#fff1d6', lightIntensity: 2.6, background: '#86c4ff', fog: '#a9d4fb', hemiSky: '#e3f1ff', hemiGround: '#8a7558', hemiIntensity: 1.3, ambient: 0.6, stars: 0, lanterns: 0, cloud: '#fbfdff' },
  { h: 17, lightColor: '#fff1d6', lightIntensity: 2.6, background: '#86c4ff', fog: '#a9d4fb', hemiSky: '#e3f1ff', hemiGround: '#8a7558', hemiIntensity: 1.3, ambient: 0.6, stars: 0, lanterns: 0, cloud: '#fbfdff' },
  { h: 19, lightColor: '#ff9a5a', lightIntensity: 1.3, background: '#ee8a62', fog: '#f2a37e', hemiSky: '#ffc8a0', hemiGround: '#5a4232', hemiIntensity: 0.85, ambient: 0.36, stars: 0.2, lanterns: 0.7, cloud: '#ffc4a8' },
  { h: 20.5, lightColor: '#9fb4ff', lightIntensity: 0.4, background: '#2a2f62', fog: '#283058', hemiSky: '#3e4a86', hemiGround: '#1a1a28', hemiIntensity: 0.5, ambient: 0.24, stars: 0.8, lanterns: 1, cloud: '#5a5f8a' },
  { h: 24, lightColor: '#9fb4ff', lightIntensity: 0.35, background: '#0b1330', fog: '#101a38', hemiSky: '#34447a', hemiGround: '#151520', hemiIntensity: 0.45, ambient: 0.22, stars: 1, lanterns: 1, cloud: '#4a5578' },
];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mixHex = (a: string, b: string, t: number) =>
  `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const norm = (v: [number, number, number]): [number, number, number] => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function skyAt(hour: number): SkyState {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - a.h) / (b.h - a.h)));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  // The sun rises in the east (+x) at 6:00, is highest at 12:00 and sets in the west at 18:00.
  const ang = ((h - 6) / 12) * Math.PI;
  const sunDir = norm([Math.cos(ang), Math.sin(ang), -0.35]);
  const lightDir: [number, number, number] = sunDir[1] > 0.08 ? sunDir : norm([-sunDir[0] * 0.6, Math.max(0.35, -sunDir[1]), 0.4]);
  return {
    lightDir, sunDir,
    lightColor: mixHex(a.lightColor, b.lightColor, t), lightIntensity: lerp(a.lightIntensity, b.lightIntensity),
    background: mixHex(a.background, b.background, t), fog: mixHex(a.fog, b.fog, t),
    hemiSky: mixHex(a.hemiSky, b.hemiSky, t), hemiGround: mixHex(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity), ambient: lerp(a.ambient, b.ambient),
    stars: lerp(a.stars, b.stars), lanterns: lerp(a.lanterns, b.lanterns), cloud: mixHex(a.cloud, b.cloud, t),
  };
}
