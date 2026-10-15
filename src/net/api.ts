import { config } from './config';

/** What the game needs to join the realtime server. */
export interface RealtimeCredentials { wsUrl: string; jwt?: string }

/** Stable per-browser id for the local dev server's "dev:<id>" tokens. */
function localDevId(): string {
  try {
    let id = localStorage.getItem('blocksy.devId');
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9-]/g, '');
      localStorage.setItem('blocksy.devId', id);
    }
    return id;
  } catch {
    return `${Date.now()}`;
  }
}

/** Bearer token for the backend: from ?token=... (stored for next time) or localStorage. */
function bearerToken(): string | null {
  try {
    if (config.userToken) localStorage.setItem('blocksy.authToken', config.userToken);
    return config.userToken || localStorage.getItem('blocksy.authToken');
  } catch {
    return config.userToken || null;
  }
}

/**
 * Asks the platform backend for a realtime token:
 *   POST {apiBaseUrl}/api/v1/client/realtime/token  { multiplayerId }  →  { wsUrl, jwt, expiresAt }   (maybe inside { code, data })
 * Also accepts `{ data: { … } }` envelopes and `token`/`accessToken` instead of `jwt`.
 * A token passed in the page URL (?jwt=…) is used directly.
 */
export async function getRealtimeCredentials(multiplayerId: string, jwtOverride = ''): Promise<RealtimeCredentials> {
  const direct = jwtOverride || config.jwt;
  if (direct) return { wsUrl: config.wsUrl, jwt: direct };
  if (!config.apiBaseUrl && config.localDev) return { wsUrl: config.wsUrl, jwt: `dev:${localDevId()}` };
  if (!config.apiBaseUrl) {
    throw new Error('No game token for this match. Paste your game token (JWT) on the join screen, or open Blocksy from the Rastaar app.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.apiAuth === 'bearer') {
    const t = bearerToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${config.tokenPath}`, {
      method: 'POST',
      headers,
      credentials: config.apiAuth === 'cookie' ? 'include' : 'same-origin',
      body: JSON.stringify({ multiplayerId }),
    });
  } catch {
    throw new Error(`Could not reach the game backend (${config.apiBaseUrl}).`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('Please sign in to play (backend refused the token request).');
  if (!res.ok) throw new Error(`Backend error ${res.status} while requesting a realtime token.`);

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
  const jwt = [data.jwt, data.token, data.accessToken].find((v): v is string => typeof v === 'string' && v.length > 0);
  const wsUrl = typeof data.wsUrl === 'string' && data.wsUrl ? data.wsUrl : config.wsUrl;
  if (!jwt) throw new Error('Backend response did not contain a realtime token.');
  return { wsUrl, jwt };
}
