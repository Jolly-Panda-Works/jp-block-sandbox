/**
 * LOCAL DEVELOPMENT game server: hosts game/index.ts (the exact file deployed on Rastaar) on ws://localhost:2567.
 * On the platform this hosting is done by Rastaar; this file is never deployed.
 */
import * as colyseusNs from 'colyseus';
import * as wsNs from '@colyseus/ws-transport';
import BlocksyRoom from './game/index';

const pick = <T>(ns: T): T => ((ns as unknown as { default?: T }).default ?? ns);
const { Server } = pick(colyseusNs);
const { WebSocketTransport } = pick(wsNs);

const PORT = Number(process.env.PORT ?? 2567);
const gameServer = new Server({ transport: new WebSocketTransport() });
// Same as the platform: room name = game key, rooms split by multiplayerId.
gameServer.define('blocksy', BlocksyRoom).filterBy(['multiplayerId']);

gameServer.listen(PORT).then(() => {
  console.log(`[dev-server] Blocksy running on ws://localhost:${PORT}  (room "blocksy", local tokens, results not sent)`);
});
