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
