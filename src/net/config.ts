/**
 * Network configuration: Vite env variables (see .env.example), overridable from the page URL so the
 * platform (or a tester) can launch the game with  ?jwt=…&multiplayerId=…&username=…&avatarUrl=…
 */
const env = import.meta.env as Record<string, string | undefined>;
const query = new URLSearchParams(location.search);
const trimSlash = (s: string) => s.replace(/\/+$/, '');

export const config = {
  /** Rastaar backend base URL; issues realtime tokens. */
  apiBaseUrl: trimSlash(query.get('api') ?? env.VITE_API_BASE_URL ?? ''),
  tokenPath: '/client/realtime/token',
  wsUrl: query.get('wsUrl') ?? (env.VITE_WS_URL || 'wss://gameserver.rastar.ir'),
  /** Game key on the platform (= Colyseus room name). */
  roomName: env.VITE_ROOM_NAME || 'blocksy',
  multiplayerId: query.get('multiplayerId') ?? env.VITE_MULTIPLAYER_ID ?? 'public',
  apiAuth: (env.VITE_API_AUTH === 'bearer' ? 'bearer' : 'cookie') as 'cookie' | 'bearer',
  /** A realtime JWT handed over directly (skips the backend call). */
  jwt: query.get('jwt') ?? '',
  username: query.get('username') ?? '',
  avatarUrl: query.get('avatarUrl') ?? '',
  /** Local dev server mode (.env.development): issue a "dev:<id>" token instead of calling the backend. */
  localDev: env.VITE_LOCAL_DEV === 'true' && import.meta.env.DEV === true,
} as const;
