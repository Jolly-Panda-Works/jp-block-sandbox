import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, WebSocketTransport } from './colyseus';
import { ROOM_NAME } from '@jp/block-sandbox-shared';
import { IslandRoom } from './rooms/IslandRoom';
import { ProfileStore } from './profiles';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 2567);
const DATA_FILE = process.env.PROFILE_FILE ?? resolve(here, '../data/profiles.json');
const CLIENT_DIST = resolve(here, '../../client/dist');

IslandRoom.profiles = new ProfileStore(DATA_FILE);

const app = express();
app.get('/health', (_req, res) => { res.json({ ok: true }); });
// In production the built client is served by the same process (single port).
if (existsSync(CLIENT_DIST)) app.use(express.static(CLIENT_DIST));

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define(ROOM_NAME, IslandRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[server] Blocksy · Colyseus listening on ws://localhost:${PORT}  (room "${ROOM_NAME}")`);
});

const shutdown = () => { IslandRoom.profiles.flush(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
