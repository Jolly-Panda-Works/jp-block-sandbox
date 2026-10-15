/**
 * ESM/CommonJS interop for the Colyseus packages.
 *
 * The server runs as native ESM (via tsx). `colyseus`, `@colyseus/schema` and `@colyseus/ws-transport`
 * are published as CommonJS, and Node can't always detect their named exports, so
 * `import { Room } from 'colyseus'` fails with "does not provide an export named 'Room'".
 * A namespace import works for both module formats: CJS modules expose everything on `.default`,
 * ESM builds expose the names directly. Types are re-exported separately with `import type`.
 */
import * as colyseusNs from 'colyseus';
import * as schemaNs from '@colyseus/schema';
import * as wsTransportNs from '@colyseus/ws-transport';

function interop<T>(ns: T): T {
  const d = (ns as unknown as { default?: T }).default;
  return d && typeof d === 'object' ? d : ns;
}

const colyseus = interop(colyseusNs);
const schema = interop(schemaNs);
const wsTransport = interop(wsTransportNs);

export const Room = colyseus.Room;
export const Server = colyseus.Server;
export const Schema = schema.Schema;
export const MapSchema = schema.MapSchema;
export const type = schema.type;
export const WebSocketTransport = wsTransport.WebSocketTransport;

export type { Client } from 'colyseus';
