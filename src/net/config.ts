/**
 * Network configuration. Values come from build-time env variables (see .env.example) and can be
 * overridden from the page URL, so the Rastaar app can launch the game with
 *   ?jwt=…&multiplayerId=…&username=…&avatarUrl=…
 * Secrets (jwt, token) are removed from the address bar right after they are read.
 */
const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
const query = new URLSearchParams(location.search);
const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Reads a URL parameter once and strips it from the visible address (so links/screenshots don't leak it). */
function takeSecret(name: string): string {
  const v = query.get(name) ?? '';
  if (v) {
    const url = new URL(location.href);
    url.searchParams.delete(name);
    history.replaceState(null, '', url.toString());
  }
  return v;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const config = {
  /** Rastaar backend origin, e.g. https://api.rastar.ir (the token path below is appended). */
  apiBaseUrl: trimSlash(query.get('api') ?? env.VITE_API_BASE_URL ?? ''),
  tokenPath: env.VITE_TOKEN_PATH || '/api/v1/client/realtime/token',
  wsUrl: query.get('wsUrl') ?? (env.VITE_WS_URL || 'wss://gameserver.rastar.ir'),
  /** Game key on the platform (= Colyseus room name). */
  roomName: env.VITE_ROOM_NAME || 'blocksy',
  /** The backend's match id (UUID). Players with the same id play together. */
  multiplayerId: query.get('room') ?? query.get('multiplayerId') ?? env.VITE_MULTIPLAYER_ID ?? '',
  apiAuth: (env.VITE_API_AUTH === 'bearer' ? 'bearer' : 'cookie') as 'cookie' | 'bearer',
  /** Realtime JWT handed over directly by the Rastaar app (skips the backend call). */
  jwt: takeSecret('jwt'),
  /** The player's Rastaar app access token, for the token request in bearer mode. */
  userToken: takeSecret('token'),
  username: query.get('username') ?? '',
  avatarUrl: query.get('avatarUrl') ?? '',
} as const;

/**
 * Accepts a match code typed or pasted by the player: a bare UUID, or a whole link containing
 * ?multiplayerId=… (and possibly &jwt=…). Returns what it found.
 */
export function parseMatchInput(raw: string): { multiplayerId: string; jwt: string } {
  const text = raw.trim();
  if (!text) return { multiplayerId: '', jwt: '' };
  try {
    const url = new URL(text);
    return { multiplayerId: url.searchParams.get('room') ?? url.searchParams.get('multiplayerId') ?? '', jwt: url.searchParams.get('jwt') ?? '' };
  } catch {
    const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text);
    return { multiplayerId: m ? m[0] : text, jwt: '' };
  }
}

/**
 * Reads a pasted test token: the JSON copied by the dashboard's playground snippet
 * (e.g. { "jwt", "multiplayerId", "wsUrl", … }, possibly inside { data }), a bare JWT, or a game link with ?jwt=….
 */
export function parsePastedToken(raw: string): { jwt: string; multiplayerId: string; wsUrl: string; error: string } {
  const text = raw.trim();
  const out = { jwt: '', multiplayerId: '', wsUrl: '', error: '' };
  if (!text) return out;
  if (text.startsWith('{')) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const o = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === 'string' ? v : '');
      out.jwt = s(o.jwt) || s(o.token) || s(o.accessToken);
      out.multiplayerId = s(o.multiplayerId) || s(o.mid) || s(o.matchId);
      out.wsUrl = s(o.wsUrl);
      if (!out.jwt) out.error = s(o.message) || s(o.error) || 'The pasted JSON has no token in it. Run the snippet again in the dashboard tab.';
    } catch {
      out.error = 'That text is not valid JSON. Copy the snippet result again.';
    }
    return out;
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      out.jwt = u.searchParams.get('jwt') ?? '';
      out.multiplayerId = u.searchParams.get('room') ?? u.searchParams.get('multiplayerId') ?? '';
    } catch { /* fall through */ }
    if (!out.jwt) out.error = 'That link has no token in it.';
    return out;
  }
  out.jwt = text;
  return out;
}

/** Shareable link to this match. Never contains a jwt or token. */
export function inviteLink(multiplayerId: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', multiplayerId);
  return url.toString();
}
