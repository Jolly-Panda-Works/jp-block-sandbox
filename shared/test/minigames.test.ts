import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rpsWinner, tttNew, tttPlay, tttResult, chessNew, chessLegal, chessPlay, chessStatus, chessApply, squareName,
  LUDO_TRACK, ludoNew, ludoRoll, ludoMove, ludoMovable, ludoCell, ludoLeave, ludoActive, LUDO_FINISH,
} from '../src/index';

const sq = (n: string) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
const mv = (s: any, a: string, b: string, promo?: any) => { const n = chessPlay(s, s.turn, { from: sq(a), to: sq(b), promo }); assert.ok(n, `${a}-${b} should be legal`); return n!; };

test('rps', () => {
  assert.equal(rpsWinner('rock', 'scissors'), 0);
  assert.equal(rpsWinner('rock', 'paper'), 1);
  assert.equal(rpsWinner('paper', 'paper'), -1);
});

test('tic tac toe', () => {
  let s = tttNew();
  assert.equal(tttPlay(s, 1, 0), null, 'not your turn');
  for (const [seat, c] of [[0, 0], [1, 3], [0, 1], [1, 4], [0, 2]]) s = tttPlay(s, seat, c)!;
  assert.deepEqual(tttResult(s), { over: true, winner: 0, line: [0, 1, 2] });
  assert.equal(tttPlay(s, 1, 8), null, 'no moves after the end');
  let d = tttNew();
  for (const [i, c] of [0, 1, 2, 4, 3, 5, 7, 6, 8].entries()) d = tttPlay(d, i % 2, c)!;
  assert.deepEqual(tttResult(d), { over: true, winner: -1, line: null }, 'draw');
});

test('chess: 20 opening moves, perft(2) = 400, perft(3) = 8902', () => {
  const s = chessNew();
  assert.equal(chessLegal(s).length, 20);
  const perft = (st: any, d: number): number => (d === 0 ? 1 : chessLegal(st).reduce((n, m) => n + perft(chessApply(st, m), d - 1), 0));
  assert.equal(perft(s, 2), 400);
  assert.equal(perft(s, 3), 8902);
});

test('chess: fool\'s mate, castling, en passant, promotion, illegal moves', () => {
  let s = chessNew();
  assert.equal(chessPlay(s, 'b', { from: sq('e7'), to: sq('e5') }), null, 'wrong colour');
  assert.equal(chessPlay(s, 'w', { from: sq('e2'), to: sq('e5') }), null, 'illegal pawn jump');
  s = mv(s, 'f2', 'f3'); s = mv(s, 'e7', 'e5'); s = mv(s, 'g2', 'g4'); s = mv(s, 'd8', 'h4');
  assert.equal(chessStatus(s), 'checkmate');

  let c = chessNew();
  for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']]) c = mv(c, a, b);
  c = mv(c, 'e1', 'g1');
  assert.equal(c.board[sq('g1')], 'K'); assert.equal(c.board[sq('f1')], 'R'); assert.ok(!c.castling.includes('K'));

  let e = chessNew();
  for (const [a, b] of [['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5']]) e = mv(e, a, b);
  e = mv(e, 'e5', 'd6');
  assert.equal(e.board[sq('d5')], '', 'en passant removed the pawn');

  let p = chessNew();
  p.board = new Array(64).fill(''); p.board[sq('a7')] = 'P'; p.board[sq('e1')] = 'K'; p.board[sq('h8')] = 'k'; p.castling = '';
  p = mv(p, 'a7', 'a8');
  assert.equal(p.board[sq('a8')], 'Q', 'auto-queen');
  assert.equal(squareName(sq('e4')), 'e4');
});

test('ludo: track geometry, leaving base, capture, safe squares, exact finish, win, leaving', () => {
  assert.equal(LUDO_TRACK.length, 52);
  assert.equal(new Set(LUDO_TRACK.map(([x, y]) => `${x},${y}`)).size, 52, 'track squares unique');
  assert.deepEqual(LUDO_TRACK[13], [8, 1]); assert.deepEqual(LUDO_TRACK[26], [13, 8]); assert.deepEqual(LUDO_TRACK[39], [6, 13]);

  let s = ludoNew(2);
  assert.deepEqual(s.colors, [0, 2]);
  s = ludoRoll(s, 0, 3)!;
  assert.equal(s.turn, 1, 'no 6 → no move → turn passes');
  s = ludoRoll(s, 1, 6)!;
  assert.deepEqual(ludoMovable(s), [0, 1, 2, 3]);
  s = ludoMove(s, 1, 0)!;
  assert.equal(s.tokens[1][0], 0); assert.equal(s.turn, 1, 'a 6 rolls again');

  // capture: put red token on yellow's path, off safe squares
  let c = ludoNew(2);
  c.tokens[0][0] = 28;           // red relative 28 → absolute 28
  c.tokens[1][0] = 0;            // yellow at its start (absolute 26)
  c.turn = 1; c = ludoRoll(c, 1, 2)!;
  c = ludoMove(c, 1, 0)!;        // yellow 0+2 = absolute 28 → captures red
  assert.equal(c.tokens[0][0], -1, 'captured token goes home');
  let safe = ludoNew(2); safe.tokens[0][0] = 34; safe.tokens[1][0] = 6; safe.turn = 1;
  safe = ludoMove(ludoRoll(safe, 1, 2)!, 1, 0)!; // yellow lands on absolute 34 (star)
  assert.equal(safe.tokens[0][0], 34, 'no capture on safe squares');

  let f = ludoNew(2); f.tokens[0] = [56, 56, 56, 53];
  assert.equal(ludoMovable(ludoRoll(f, 0, 3)!).length, 1);
  assert.equal(ludoRoll(f, 0, 4)!.turn, 1, 'overshooting the finish is not allowed');
  f = ludoMove(ludoRoll(f, 0, 3)!, 0, 3)!;
  assert.equal(f.winner, 0);
  assert.deepEqual(ludoCell(0, 3, LUDO_FINISH).length, 2);

  let l = ludoNew(3); l = ludoLeave(l, 0);
  assert.equal(l.turn, 1); assert.deepEqual(ludoActive(l), [1, 2]);
});

import { tttBotMove, chessBotMove, ludoBotAction, rpsBotPick, isBotId, createWorldGrid, generateIsland, getBlock } from '../src/index';

test('bots: tic tac toe wins/blocks, chess grabs a free queen, ludo captures, ids', () => {
  const noRandom = () => 0.5;
  assert.equal(tttBotMove({ cells: [0, 0, -1, 1, 1, -1, -1, -1, -1], turn: 1 }, 1, noRandom), 5, 'wins');
  assert.equal(tttBotMove({ cells: [0, 0, -1, 1, -1, -1, -1, -1, -1], turn: 1 }, 1, noRandom), 2, 'blocks');
  const c = chessNew();
  c.board = new Array(64).fill(''); c.board[sq('e1')] = 'K'; c.board[sq('h8')] = 'k'; c.board[sq('d1')] = 'R'; c.board[sq('d7')] = 'q'; c.castling = '';
  const m = chessBotMove(c, () => 0)!;
  assert.deepEqual([m.from, m.to], [sq('d1'), sq('d7')], 'takes the undefended queen');
  let l = ludoNew(2); l.tokens[0] = [10, 20, -1, -1]; l.tokens[1][0] = 26; l.dice = 4; l.phase = 'move';
  // red token at 20 + 4 = 24 → absolute 24; yellow at relative 26 → absolute (26+26)%52 = 0 … place yellow on 24 instead
  l.tokens[1][0] = (24 - 26 + 52) % 52;
  assert.deepEqual(ludoBotAction(l, () => 0), { type: 'move', token: 1 }, 'captures');
  assert.deepEqual(ludoBotAction({ ...l, phase: 'roll' }), { type: 'roll' });
  assert.ok(['rock', 'paper', 'scissors'].includes(rpsBotPick()));
  assert.ok(isBotId('bot:1') && isBotId('npc:chess') && !isBotId('abc'));
});

test('island: game center with four NPCs on a clear floor', () => {
  const g = createWorldGrid();
  const layout = generateIsland(g, 1337);
  assert.equal(layout.gameCenter.npcs.length, 4);
  for (const n of layout.gameCenter.npcs) {
    const x = Math.floor(n.x), z = Math.floor(n.z);
    assert.ok(getBlock(g.get(x, n.y - 1, z))?.solid, `${n.name} stands on the floor`);
    assert.ok(!getBlock(g.get(x, n.y, z))?.solid && !getBlock(g.get(x, n.y + 1, z))?.solid, `${n.name} has room`);
  }
  assert.ok(layout.signs.some((s) => s.text === 'Game Center'));
});

import { parseAnimalSetting, biomesFor, ANIMAL_KINDS, pickVariant, variantColors, WORLD_SIZE, blockId, createRng as rngFor } from '../src/index';

test('bigger world with animal biomes; biomes left out when their animals are disabled', () => {
  assert.ok(WORLD_SIZE.x >= 176);
  const full = createWorldGrid();
  const all = generateIsland(full, 1337);
  assert.deepEqual(all.biomes.map((b) => b.biome).sort(), ['bamboo', 'farm', 'flowers', 'forest', 'highlands', 'pond', 'village']);
  assert.ok(full.count(blockId('water')) > 50, 'pond has water');
  assert.ok(full.count(blockId('bamboo')) > 20 && full.count(blockId('beehive')) === 3 && full.count(blockId('spruce_log')) > 20);
  const few = createWorldGrid();
  const some = generateIsland(few, 1337, { biomes: biomesFor(parseAnimalSetting(['cow', 'dog'])) });
  assert.deepEqual(some.biomes.map((b) => b.biome).sort(), ['farm', 'village']);
  assert.equal(few.count(blockId('water')), 0, 'no ducks → no pond');
  assert.equal(few.count(blockId('bamboo')), 0, 'no pandas → no bamboo grove');
  const sx = Math.floor(some.spawn.x), sz = Math.floor(some.spawn.z);
  assert.ok(getBlock(few.get(sx, some.spawn.y - 1, sz))?.solid, 'spawn still on solid ground');
});

test('animal settings, variants and colours', () => {
  assert.equal(parseAnimalSetting(undefined).length, ANIMAL_KINDS.length);
  assert.deepEqual(parseAnimalSetting(false), []);
  assert.deepEqual(parseAnimalSetting(['duck', 'unicorn', 'cat']), ['duck', 'cat']);
  assert.deepEqual(biomesFor(['panda']), ['village', 'bamboo']);
  for (const k of ANIMAL_KINDS) {
    const v = pickVariant(k, rngFor(3));
    assert.match(variantColors(k, v).main, /^#[0-9a-f]{6}$/);
  }
});

import { clockAt, skyAt, isNight, formatClock, sanitizeRoomSettings } from '../src/index';

test('day / night: clock, sun path, night sky', () => {
  assert.deepEqual(clockAt(8, 0, 999999), { hour: 8, day: 1 }, 'frozen time');
  const c = clockAt(8, 24 * 60_000, 6 * 60_000);   // 24-minute day, 6 minutes later → 6 hours later
  assert.ok(Math.abs(c.hour - 14) < 1e-9 && c.day === 1);
  assert.equal(clockAt(20, 24 * 60_000, 6 * 60_000).day, 2, 'past midnight is day 2');
  assert.ok(skyAt(12).sunDir[1] > 0.9, 'sun high at noon');
  assert.ok(skyAt(0).sunDir[1] < 0 && skyAt(0).lightDir[1] > 0, 'at midnight the light comes from the moon above');
  assert.ok(skyAt(0).stars === 1 && skyAt(12).stars === 0 && skyAt(23).lanterns === 1);
  assert.ok(skyAt(12).lightIntensity > skyAt(0).lightIntensity * 5);
  assert.ok(isNight(2) && !isNight(12));
  assert.equal(formatClock(14.5), '14:30');
});

test('room settings are clamped and filtered', () => {
  assert.deepEqual(sanitizeRoomSettings({ animals: ['cow', 'dragon'], ambientBots: 99, dayLengthMin: -5, chatEnabled: false, hack: 1, startHour: 'x' }),
    { animals: ['cow'], chatEnabled: false, ambientBots: 8, dayLengthMin: 0 });
  assert.deepEqual(sanitizeRoomSettings('nope'), {});
});

import { evaluatePlacement as evalPlace, hasSupport, BLOCKS as ALL_BLOCKS, TILE_KEYS as ALL_TILES, BlockGrid as Grid } from '../src/index';

test('building: a block needs a neighbour on ANY side (not necessarily below)', () => {
  const g = new Grid(16, 16, 16);
  const stone = blockId('stone');
  g.set(5, 5, 5, stone);
  assert.equal(evalPlace(g, 6, 5, 5, stone, []), 'ok', 'beside a block, with air underneath');
  assert.equal(evalPlace(g, 5, 4, 5, stone, []), 'ok', 'hanging under a block');
  assert.equal(evalPlace(g, 9, 9, 9, stone, []), 'no_support', 'floating in the air');
  g.set(9, 8, 9, blockId('rose'));
  assert.ok(!hasSupport(g, 9, 9, 9), 'plants are not support');
  // a whole bridge out over the void, one block at a time
  for (let x = 6; x < 15; x++) { assert.equal(evalPlace(g, x, 5, 5, stone, []), 'ok'); g.set(x, 5, 5, stone); }
});

test('decor catalogue: many decorative items, every tile painted', () => {
  const decor = ALL_BLOCKS.filter((b) => b.purchasable && b.category === 'decor');
  assert.ok(decor.length >= 28, `decor items: ${decor.length}`);
  for (const b of ALL_BLOCKS) for (const tile of [b.top, b.side, b.bottom]) assert.ok((ALL_TILES as readonly string[]).includes(tile), `${b.key} uses unknown tile ${tile}`);
});

import { EMOJIS, isEmojiId } from '../src/index';

test('emoji: all faces and hands, unique ids, the six original ids still valid', () => {
  assert.ok(EMOJIS.filter((e) => e.group === 'faces').length >= 90);
  assert.ok(EMOJIS.filter((e) => e.group === 'hands').length >= 30);
  assert.equal(new Set(EMOJIS.map((e) => e.id)).size, EMOJIS.length, 'unique ids');
  assert.equal(new Set(EMOJIS.map((e) => e.char)).size, EMOJIS.length, 'no duplicates');
  for (const id of ['smile', 'heart', 'thumbs', 'laugh', 'wow', 'wave']) assert.ok(isEmojiId(id));
  assert.ok(!EMOJIS.some((e) => e.char === '🖕'), 'no offensive gestures');
  assert.ok(isEmojiId('u1f600') && !isEmojiId('u1f595') && !isEmojiId('<script>'));
});
