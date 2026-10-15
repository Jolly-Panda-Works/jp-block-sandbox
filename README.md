<p align="center"><img src="public/blocksy-logo.png" alt="Blocksy" width="420" /></p>

# Blocksy — game client

Browser game built with React Three Fiber. It connects to the **Blocksy game server**, which lives in its own repository (`blocksy-server`), through the platform API.

## How players get in

1. **Sign in on the website:** phone number, then the one-time code (a Rastaar account).
2. **Lobby:**
   - **Rooms list:** each room shows its name, a live player count (`3 / 8`) and Join. Join is disabled while a room is full. The list refreshes every 5 seconds.
   - **Find a room:** paste a room id or invite link.
   - **Create a room:** pick a name and a size of 2–8 players. You get its id, a "Copy invite link" button (`…/?room=<id>`) and "Join now".
3. **Joining:** the game requests a game token for the chosen room (`POST /api/v1/client/realtime/token`) and enters it on `wss://gameserver.rastar.ir`, room `blocksy`.

The Rastaar app can also skip all of this by opening `…/?jwt=<game token>`. The room is read from the token's `mid` claim and only the name is asked.

What the backend must provide for steps 1–2, including CORS, is specified in **[docs/BACKEND-API.md](docs/BACKEND-API.md)**. `dev-server/` contains a working mock of it.

## Configuration (`.env`, see `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | empty | Rastaar backend origin (only needed for the "token request" path) |
| `VITE_TOKEN_PATH` | `/api/v1/client/realtime/token` | Token endpoint path |
| `VITE_API_AUTH` | `cookie` | `cookie` or `bearer` (the Pages workflow defaults to `bearer`) |
| `VITE_*_PATH` | see `.env.example` | Sign-in / room endpoints, if the backend uses other paths |
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

`dev-server/` runs, on http://localhost:2567:

- the same `index.ts` that is deployed on Rastaar (`dev-server/game/index.ts`), with a local stand-in for `@rastaar/game-sdk`;
- a mock of the Rastaar backend: sign in with any phone number and code **1234**; create, list and search rooms; game tokens.

Custom settings come from `dev-server/settings.json`, and match results are only logged.

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
