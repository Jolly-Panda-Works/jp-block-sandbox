# Blocksy — backend API needed for "sign in from the website"

The Blocksy website, hosted on GitHub Pages at `https://jolly-panda-works.github.io/jp-block-sandbox/`, calls the Rastaar backend directly. Six endpoints are needed. `POST /client/realtime/token` already exists; the other five are needed for guest sign-in, renaming and the room browser.

The game reads responses leniently:

- a `{ code, data }` envelope or the bare object;
- the field-name variants listed below.

Paths are configurable with the `VITE_*_PATH` variables, so the backend can keep its own naming.

## CORS (required)

Allow the origin `https://jolly-panda-works.github.io` with:

- methods `GET, POST, OPTIONS`;
- headers `Content-Type, Authorization`.

In cookie mode, also send `Access-Control-Allow-Credentials: true`, and the session cookie must use `SameSite=None; Secure`.

## Authentication: guest accounts (no phone number)

The first time someone opens the game, they enter a display name; nothing else is asked. The browser keeps a random `deviceId`, and the game signs in as a guest with it. The same browser is therefore always the same player: owned blocks and appearance follow the account. The player can change their name in Settings later.

Choose one auth mode:

- **bearer**, recommended for a different site: `guest` returns an access token, and the game sends `Authorization: Bearer <token>` on every call.
- **cookie**: `guest` sets a session cookie.

Build-time setting: `VITE_API_AUTH=bearer|cookie`.

## Endpoints

| # | Method and path (default) | Body | Response (`data`) | Env override |
|---|---|---|---|---|
| 1 | `POST /api/v1/auth/guest` | `{ "deviceId": "<random id>", "name": "Ali" }` | `{ "accessToken": "…", "user": { "id": "<uuid>", "username": "Ali" } }` (`token`/`access_token` also accepted). Same `deviceId` → same user. | `VITE_AUTH_GUEST_PATH` |
| 2 | `GET /api/v1/client/me` | – | `{ "id": "<uuid>", "username": "…" }` | `VITE_ME_PATH` |
| 3 | `PATCH /api/v1/client/me` | `{ "username": "…" }` | the updated user (name changed in Settings) | `VITE_ME_PATH` |
| 4a | `GET /api/v1/client/multiplayer/games/blocksy/matches` | – | `[ Room, … ]` (or `{ items }`, `{ matches }`, `{ rooms }`) — open Blocksy matches | `VITE_ROOMS_PATH` (`{game}` = game key) |
| 4b | `POST /api/v1/client/multiplayer/games/blocksy/matches` | `{ "name": "…", "maxPlayers": 1..8, "settings": { … } }` | `Room` (the new match, **including `settings`**) | same as 4a |
| 5 | `GET /api/v1/client/multiplayer/matches/{id}` | – | `Room`, or `404` | `VITE_ROOM_PATH` |
| ✓ | `POST /api/v1/client/realtime/token` *(exists)* | `{ "multiplayerId": "<uuid>" }` | `{ "wsUrl", "jwt", "expiresAt" }` | `VITE_TOKEN_PATH` |

`Room` object:

```json
{ "id": "<match uuid>", "name": "Ali's island", "maxPlayers": 8, "playerCount": 3, "settings": { "animals": ["cow", "duck"], "dayLengthMin": 20, "ambientBots": 4 } }
```

Accepted variants:

| Field | Also accepted as |
|---|---|
| `id` | `multiplayerId`, `uuid`, `matchId` |
| `name` | `title` |
| `maxPlayers` | `playerMax`, `capacity`; the game caps it at 8 |
| `playerCount` | `currentPlayers`, `connected`, `players[]` (array length) |

- **`playerCount` must be live** (players currently in the room). The game disables Join when `playerCount >= maxPlayers`. The game server publishes the live count as room metadata (`{ multiplayerId, players, maxPlayers }`), so the backend can read it from the Colyseus matchmaker. Alternatively, it can track it from token issuance and results.
- **Status codes on the token request:** return `403` when a room is full, and `404` when the match doesn't exist. The game shows a message for each.
- **Room settings:** a match created with `maxPlayers` should report that value as `playerMax` in `GET /internal/realtime/game-config/{id}`. The game server takes its capacity from there.

## Room settings

`settings` is a small JSON object of at most a few KB, chosen by the room's creator: animals, day length, start time, bots, session length, chat and mini-game timers.

- **Backend:** stores it with the match and returns it unchanged in every `Room` object. No validation is needed on the backend.
- **Clients:** every client sends it when joining.
- **Game server:** clamps and applies it when it creates the room, on top of the dashboard Custom settings.

Keys and limits are in `shared/src/roomSettings.ts`.

## Reference implementation

`dev-server/mockBackend.ts` implements exactly this contract, in memory. Every browser gets a guest account automatically.
