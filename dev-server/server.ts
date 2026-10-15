/**
 * LOCAL DEVELOPMENT server: hosts game/index.ts (the exact file deployed on Rastaar) and a mock of the
 * Rastaar backend API on http://localhost:2567. Never deployed.
 */
import { createServer } from 'node:http';
import * as colyseusNs from 'colyseus';
import * as wsNs from '@colyseus/ws-transport';
import BlocksyRoom from './game/index';
import { handle } from './mockBackend';

const pick = <T>(ns: T): T => ((ns as unknown as { default?: T }).default ?? ns);
const colyseus = pick(colyseusNs);
const { WebSocketTransport } = pick(wsNs);

/** Live player count of a match, from the running Blocksy rooms. */
async function liveCount(matchId: string): Promise<number> {
  const mm = (colyseus as unknown as { matchMaker?: { query: (q: object) => Promise<{ clients: number; metadata?: { multiplayerId?: string } }[]> } }).matchMaker;
  if (!mm) return 0;
  const rooms = await mm.query({ name: 'blocksy' });
  return rooms.filter((r) => r.metadata?.multiplayerId === matchId).reduce((n, r) => n + r.clients, 0);
}

const PORT = Number(process.env.PORT ?? 2567);
const httpServer = createServer((req, res) => {
  void handle(req, res, liveCount).then((handled) => {
    if (!handled && !(req.url ?? '').startsWith('/matchmake') && !res.headersSent) { res.writeHead(404); res.end(); }
  });
});
const gameServer = new colyseus.Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define('blocksy', BlocksyRoom).filterBy(['multiplayerId']);

gameServer.listen(PORT).then(() => {
  console.log(`[dev-server] Blocksy + mock backend on http://localhost:${PORT}   (sign in with any phone, code 1234)`);
});
