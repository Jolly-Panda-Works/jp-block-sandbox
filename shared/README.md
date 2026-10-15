# shared/ — game rules shared by client and server

This folder exists **identically** in both repositories:

- `blocksy` (the game client)
- `blocksy-server` (the Colyseus game server)

It contains engine-free TypeScript only, with no dependencies:

- block catalog, grid, ray cast and placement rules;
- physics and island generator;
- avatar model, economy, social rules;
- network protocol types.

Rules when you change anything here:

1. Make the same change in both repositories. Compare the output of `npm run shared:hash` in each repo; the hashes must match.
2. If the change breaks compatibility (messages, rules, block ids), bump `PROTOCOL_VERSION` in `src/constants.ts`. The server rejects clients with a different version and shows a clear message, so old clients don't silently desync.
3. Run `npm test` in both repos.
