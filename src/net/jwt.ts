/**
 * Reads (does NOT verify) the claims of a Rastaar game token so the game can:
 * - take the match id from `mid` (no separate match code needed),
 * - reject obviously wrong or expired tokens with a clear message before contacting the server.
 * The game server verifies the signature; nothing here is trusted for security.
 */
export interface GameTokenClaims { sub?: string; mid?: string; exp?: number }

export function readGameToken(raw: string): GameTokenClaims | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')))));
    return json && typeof json === 'object' ? (json as GameTokenClaims) : null;
  } catch {
    return null;
  }
}

/** Seconds until expiry (negative = expired), or null if the token has no exp. */
export const secondsLeft = (c: GameTokenClaims): number | null =>
  typeof c.exp === 'number' ? Math.floor(c.exp - Date.now() / 1000) : null;
