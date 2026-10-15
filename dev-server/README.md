# dev-server (local development only)

This folder runs `game/index.ts` (the exact file deployed in the Rastaar dashboard) on `ws://localhost:2567`. `sdk-dev.ts` stands in for `@rastaar/game-sdk`:

- tokens have the form `dev:<id>` and are not verified;
- `fetchRoomConfig` returns fixed values;
- custom settings come from `settings.json`;
- match results are only logged.

It is never deployed. When you change the game server, edit `game/index.ts` here, test it locally, then paste the same file into the dashboard's Code tab.
