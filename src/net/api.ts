import { config } from './config';
import { authToken } from './platform';

/** What the game needs to join the realtime server. */
export interface RealtimeCredentials { wsUrl: string; jwt?: string }

/** Bearer token for the backend: from ?token=... (stored for next time) or localStorage. */
function bearerToken(): string | null {
  if (config.userToken) authToken.set(config.userToken);
  return config.userToken || authToken.get();
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
  if (!config.apiBaseUrl) {
    throw new Error('Sign in to play (this site is not connected to the Rastaar backend).');
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
  if (res.status === 401) { authToken.clear(); throw new Error('Please sign in again.'); }
  if (res.status === 403) throw new Error('You are not allowed to join this room.');
  if (res.status === 404) throw new Error('This room no longer exists.');
  if (!res.ok) throw new Error(`Backend error ${res.status} while requesting a realtime token.`);

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
  const jwt = [data.jwt, data.token, data.accessToken].find((v): v is string => typeof v === 'string' && v.length > 0);
  const wsUrl = typeof data.wsUrl === 'string' && data.wsUrl ? data.wsUrl : config.wsUrl;
  if (!jwt) throw new Error('Backend response did not contain a realtime token.');
  return { wsUrl, jwt };
}
