<p align="center"><img src="public/blocksy-logo.png" alt="Blocksy" width="420" /></p>

# Blocksy — game client

Browser game built with React Three Fiber. It connects to the **Blocksy game server**, which lives in its own repository (`blocksy-server`), through the platform API.

## How the game connects (Rastaar platform)

```
Player's app ──(1) POST {backend}/api/v1/client/realtime/token { multiplayerId } ──▶ Rastaar backend
             ◀──────────────── { wsUrl, jwt, expiresAt }  (maybe inside { code, data }) ──
             ──(2) joinOrCreate("blocksy", { jwt, multiplayerId, username, avatarUrl, protocolVersion }) ──▶ wss://gameserver.rastar.ir
```

The JWT (HS256) has two claims the game server checks:

- `sub`: user id (UUID);
- `mid`: match id (UUID).

The `multiplayerId` sent with the join must equal `mid`. Players with the same match id play together; the room holds up to 8 players.

There are two ways a player gets in. They need no code changes; only configuration differs.

| | Launch link from the Rastaar app (recommended) | Token request from this page |
|---|---|---|
| How | The app already knows the player and the match. It requests the token itself and opens `https://<site>/?multiplayerId=<uuid>&jwt=<jwt>&username=<name>&avatarUrl=<url>`. | The page calls the token endpoint itself, with `VITE_API_BASE_URL` set at build time. The player is identified with `VITE_API_AUTH=cookie` (the backend session cookie) or `bearer` (the app access token, passed once as `?token=…`). |
| Backend requirement | None. | CORS must allow the site's origin, e.g. `https://<user>.github.io`, with credentials in cookie mode. |

- **Secrets in the URL:** `jwt` and `token` are removed from the address bar as soon as they are read.
- **Invite link:** the menu (Esc) has a "Copy invite link" button. It copies `…/?multiplayerId=<uuid>` and never includes a token. Whoever opens it needs their own token for that match, either through the app or through the token endpoint.

Other behaviour:

- **Reconnection:** if the connection drops, the game reconnects within the server's 30 s window.
- **Profile cache:** the profile (free unlocks, hotbar, look) is cached per user and restored after server restarts (`restore`).
- **Session end:** the session ends when the match's Round duration runs out, and an end screen appears.

## Configuration (`.env`, see `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | empty | Rastaar backend origin (only needed for the "token request" path) |
| `VITE_TOKEN_PATH` | `/api/v1/client/realtime/token` | Token endpoint path |
| `VITE_API_AUTH` | `cookie` | `cookie` or `bearer` |
| `VITE_WS_URL` | `wss://gameserver.rastar.ir` | Game server, if the token response has no `wsUrl` |
| `VITE_ROOM_NAME` | `blocksy` | Game key |

## Publish on GitHub Pages

1. Push this repository to GitHub, on the `main` branch.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Optionally, go to **Settings → Secrets and variables → Actions → Variables** and add `VITE_API_BASE_URL`. You can also add `VITE_API_AUTH`, `VITE_WS_URL` and `VITE_ROOM_NAME`. These are public build-time values; never put a secret here.
4. Push, or run the workflow by hand from the **Actions** tab. The site appears at `https://<user>.github.io/<repo>/`.
5. Tell the backend team the site's origin, `https://<user>.github.io`. They need it for CORS (token-request path) or for building launch links (app path).

The build uses a relative base (`base: './'`), so it works under any repository name. After the first local `npm install`, commit `package-lock.json`; the workflow then uses `npm ci`.

## Run locally (no backend needed)

```bash
npm run setup      # installs the game and dev-server/
npm run dev:all    # local game server on ws://localhost:2567 + game on http://localhost:5173
```

`dev-server/` runs the same `index.ts` that is deployed on Rastaar (`dev-server/game/index.ts`) with a local stand-in for `@rastaar/game-sdk`:

- tokens are not verified;
- custom settings come from `dev-server/settings.json`;
- match results are only logged.

`.env.development` points `npm run dev` at this local server.

To play against the **real** platform from your machine, open the game with a token, e.g. `http://localhost:5173/?jwt=<TOKEN>&wsUrl=wss://gameserver.rastar.ir&multiplayerId=<ID>`. Alternatively, put `VITE_API_BASE_URL=…` in `.env.local` and delete `VITE_LOCAL_DEV` from `.env.development`.

## Build for production

```bash
npm run build      # dist/ — static files, host anywhere
```

The local mode is development-only and is never active in a production build.

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
