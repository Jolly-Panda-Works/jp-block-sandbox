<p align="center"><img src="public/blocksy-logo.png" alt="Blocksy" width="420" /></p>

# Blocksy — game client

Browser game built with React Three Fiber. It connects to the **Blocksy game server**, which lives in its own repository (`blocksy-server`), through the platform API.

## How the game connects (Rastaar platform)

The game server is the Blocksy room deployed on the Rastaar platform at `wss://gameserver.rastar.ir`, with game key `blocksy`. Its source is a single `index.ts` built on `@rastaar/game-sdk`.

```
1. POST {VITE_API_BASE_URL}/client/realtime/token  { multiplayerId }  →  { wsUrl, jwt }
   (or pass ?jwt=… in the page URL to skip this step)
2. new Client(wsUrl).joinOrCreate("blocksy", { jwt, multiplayerId, username, avatarUrl?, protocolVersion: 2 })
3. welcome → init → state (10 Hz) …
```

- **Token response:** the backend may return `{ wsUrl, jwt }` or the same inside `{ data: … }`. `token` or `accessToken` is accepted in place of `jwt`. If `wsUrl` is missing, `VITE_WS_URL` is used.
- **Backend auth:** cookies by default. With `VITE_API_AUTH=bearer` the game sends `Authorization: Bearer`, taking the token from `?token=` or `localStorage["blocksy.authToken"]`. `src/net/api.ts` is the only file that talks to the backend.
- **URL parameters:** the platform or a tester can open the game with:

  | Parameter | Effect |
  |---|---|
  | `jwt` | Realtime token; skips the backend request |
  | `multiplayerId` | Session to join |
  | `username` | Prefills the name |
  | `avatarUrl` | Sent to the server with the join |
  | `wsUrl` | Overrides `VITE_WS_URL` |
  | `api` | Overrides `VITE_API_BASE_URL` |

- **Reconnection:** if the connection drops, the game reconnects automatically. The server holds your place for 30 seconds.
- **Profile persistence:** the platform server keeps profiles in memory only. The game caches your profile (free unlocks, hotbar, look) in `localStorage` per user and sends it back once per session with `restore`. The server only accepts free blocks from it.
- **Session timer:** if the server's `sessionMinutes` setting is above 0, a timer is shown at the top. When it runs out, a "Session ended" screen appears.

## Configuration (`.env`, see `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | empty | Rastaar backend that issues realtime tokens |
| `VITE_API_AUTH` | `cookie` | `cookie` or `bearer` |
| `VITE_MULTIPLAYER_ID` | `public` | Session to join (also `?multiplayerId=`) |
| `VITE_WS_URL` | `wss://gameserver.rastar.ir` | Game server |
| `VITE_ROOM_NAME` | `blocksy` | Game key on the platform |

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (needs VITE_API_BASE_URL or ?jwt=…)
npm run build      # dist/ — static files, host anywhere
```

Env variables are baked in at build time.

## Controls

**Desktop:**

| Action | Input |
|---|---|
| Move / sprint / jump | WASD / Shift / Space |
| Look | Mouse |
| Hold a block / put it away | 1–9 (again or Q to empty hands) |
| Destroy tool | 0 |
| Use the tool in hand | Left click |
| Build menu: choose blocks | T |
| Camera | V |
| Interact | E |
| Shop / Style / Social | B / C / G |
| Hints / Menu | H / Esc |

**Small screens:** touch controls (joystick, drag-to-look, Jump, Use) replace the keyboard automatically.

## shared/

`shared/` holds the game rules and the network protocol. The platform server's `index.ts` embeds a copy in its "SHARED RULES" section, and the two must stay identical. If a change breaks compatibility, bump `PROTOCOL_VERSION` (currently 2) on both sides.

- `npm test` runs its tests.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TESTING.md](docs/TESTING.md).
