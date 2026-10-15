/** World and gameplay constants shared by client and server. */
/** Default world: a bigger island (radius ≈ 46) with a village and animal biomes around it. */
export const WORLD_SIZE = { x: 176, y: 40, z: 176 } as const;
export const CHUNK_SIZE = 16;
export const SURFACE_Y = 5;
export const WATER_LEVEL = 3.45;
export const MAX_PLAYERS = 8;
export const REACH = 5.5;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.3;
export const EYE_HEIGHT = 1.62;
export const RESPAWN_BELOW_Y = 0.5;
/** Colyseus room name on the game server. */
export const ROOM_NAME = 'blocksy';
/**
 * Bump on any breaking change to messages or shared rules. Client and server each carry a copy of
 * `shared/`; the server refuses clients whose version differs, with a clear error.
 */
export const PROTOCOL_VERSION = 5;
/** Players joining with the same multiplayerId share a room; this is used when none is given. */
export const DEFAULT_MULTIPLAYER_ID = 'public';
export const GAME_NAME = 'Blocksy';
export const ISLAND_NAME = 'Sunny Isle';
export const HOTBAR_SLOTS = 9;
