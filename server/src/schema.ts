import { MapSchema, Schema, type } from './colyseus';

/**
 * Replicated per-player state. Positions are client-reported (validated for speed on the server);
 * appearance is a sanitised JSON string so new accessory fields don't require schema changes.
 */
export class PlayerState extends Schema {
  @type('string') name = 'Player';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  @type('float32') speed = 0;
  @type('boolean') grounded = true;
  @type('string') appearance = '{}';
  @type('uint16') held = 0;
  /** 'none' (hands empty), 'block' (building with `held`) or 'destroy' (hammer). */
  @type('string') tool = 'none';
  /** Incremented on every place/remove so other clients can play the arm swing. */
  @type('uint16') action = 0;
}

export class IslandState extends Schema {
  @type('string') islandName = '';
  @type('uint8') maxPlayers = 8;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
