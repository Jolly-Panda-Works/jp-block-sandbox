/**
 * Popup mini-games: rules engines (pure, deterministic given the inputs) shared by client and server.
 * - Rock Paper Scissors (2 players, best of N, simultaneous picks)
 * - Tic Tac Toe (2 players)
 * - Chess (2 players, full rules: castling, en passant, promotion, check/checkmate/stalemate, 50-move rule)
 * - Ludo (2–4 players, classic rules: 6 to leave base, 6 rolls again, capture, safe squares, exact finish)
 */

export type MiniGameKind = 'rps' | 'ttt' | 'chess' | 'ludo';

export interface MiniGameInfo { kind: MiniGameKind; name: string; icon: string; minPlayers: number; maxPlayers: number; board: boolean }
export const MINI_GAMES: readonly MiniGameInfo[] = [
  { kind: 'rps', name: 'Rock Paper Scissors', icon: '✊', minPlayers: 2, maxPlayers: 2, board: false },
  { kind: 'ttt', name: 'Tic Tac Toe', icon: '❌', minPlayers: 2, maxPlayers: 2, board: true },
  { kind: 'chess', name: 'Chess', icon: '♟️', minPlayers: 2, maxPlayers: 2, board: true },
  { kind: 'ludo', name: 'Ludo', icon: '🎲', minPlayers: 2, maxPlayers: 4, board: true },
];
export const isMiniGameKind = (v: unknown): v is MiniGameKind => MINI_GAMES.some((g) => g.kind === v);
export const miniGameInfo = (k: MiniGameKind): MiniGameInfo => MINI_GAMES.find((g) => g.kind === k)!;

/** Distance (m) within which a player can accept an invite / start watching a game. */
export const ACCEPT_RADIUS = 3.5;
export const SPECTATE_RADIUS = 7;

// =====================================================================================================
// Rock Paper Scissors
// =====================================================================================================

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export const RPS_CHOICES: readonly RpsChoice[] = ['rock', 'paper', 'scissors'];
export const RPS_ICON: Record<RpsChoice, string> = { rock: '🪨', paper: '✋', scissors: '✂️' };
export const isRpsChoice = (v: unknown): v is RpsChoice => (RPS_CHOICES as readonly unknown[]).includes(v);

/** 0 = seat 0 wins, 1 = seat 1 wins, -1 = tie. */
export function rpsWinner(a: RpsChoice, b: RpsChoice): number {
  if (a === b) return -1;
  return (a === 'rock' && b === 'scissors') || (a === 'paper' && b === 'rock') || (a === 'scissors' && b === 'paper') ? 0 : 1;
}

// =====================================================================================================
// Tic Tac Toe — cells: -1 empty, 0 = X (seat 0), 1 = O (seat 1)
// =====================================================================================================

export interface TttState { cells: number[]; turn: number }
export const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const;
export const tttNew = (): TttState => ({ cells: new Array(9).fill(-1), turn: 0 });
export const tttLegal = (s: TttState): number[] => s.cells.flatMap((c, i) => (c === -1 ? [i] : []));

export function tttPlay(s: TttState, seat: number, cell: number): TttState | null {
  if (seat !== s.turn || !Number.isInteger(cell) || cell < 0 || cell > 8 || s.cells[cell] !== -1 || tttResult(s).over) return null;
  const cells = s.cells.slice();
  cells[cell] = seat;
  return { cells, turn: 1 - seat };
}

/** winner: seat index, or -1 for a draw (when over). */
export function tttResult(s: TttState): { over: boolean; winner: number; line: readonly number[] | null } {
  for (const l of TTT_LINES) {
    const v = s.cells[l[0]];
    if (v !== -1 && v === s.cells[l[1]] && v === s.cells[l[2]]) return { over: true, winner: v, line: l };
  }
  return { over: s.cells.every((c) => c !== -1), winner: -1, line: null };
}

// =====================================================================================================
// Chess — board[0] = a8 … board[63] = h1 (FEN order). White = uppercase, black = lowercase, '' empty.
// =====================================================================================================

export type ChessColor = 'w' | 'b';
export type Promo = 'q' | 'r' | 'b' | 'n';
export interface ChessMove { from: number; to: number; promo?: Promo }
export interface ChessState { board: string[]; turn: ChessColor; castling: string; ep: number; half: number; full: number }

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
export function chessNew(): ChessState {
  const board: string[] = [];
  for (const ch of START_FEN.replace(/\//g, '')) {
    if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push('');
    else board.push(ch);
  }
  return { board, turn: 'w', castling: 'KQkq', ep: -1, half: 0, full: 1 };
}

export const chessColorOf = (p: string): ChessColor | null => (p === '' ? null : p === p.toUpperCase() ? 'w' : 'b');
const rf = (i: number) => [i >> 3, i & 7] as const;
const at = (r: number, f: number) => (r < 0 || r > 7 || f < 0 || f > 7 ? -1 : r * 8 + f);
export const squareName = (i: number): string => `${'abcdefgh'[i & 7]}${8 - (i >> 3)}`;

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/** Is square `sq` attacked by any piece of colour `by`? */
export function chessAttacked(board: string[], sq: number, by: ChessColor): boolean {
  const [r, f] = rf(sq);
  const own = (p: string, type: string) => p !== '' && chessColorOf(p) === by && p.toLowerCase() === type;
  // pawns: a white pawn attacks diagonally upward (row - 1)
  const pr = by === 'w' ? r + 1 : r - 1;
  for (const df of [-1, 1]) { const i = at(pr, f + df); if (i >= 0 && own(board[i], 'p')) return true; }
  for (const [dr, df] of KNIGHT) { const i = at(r + dr, f + df); if (i >= 0 && own(board[i], 'n')) return true; }
  for (const [dr, df] of KING) { const i = at(r + dr, f + df); if (i >= 0 && own(board[i], 'k')) return true; }
  const slide = (dirs: number[][], types: string) => {
    for (const [dr, df] of dirs) {
      for (let k = 1; k < 8; k++) {
        const i = at(r + dr * k, f + df * k);
        if (i < 0) break;
        const p = board[i];
        if (p === '') continue;
        if (chessColorOf(p) === by && types.includes(p.toLowerCase())) return true;
        break;
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, 'rq') || slide(BISHOP_DIRS, 'bq');
}

export const chessKing = (board: string[], c: ChessColor): number => board.indexOf(c === 'w' ? 'K' : 'k');
export const chessInCheck = (s: ChessState): boolean => chessAttacked(s.board, chessKing(s.board, s.turn), s.turn === 'w' ? 'b' : 'w');

function pseudoMoves(s: ChessState): ChessMove[] {
  const out: ChessMove[] = [];
  const me = s.turn, them: ChessColor = me === 'w' ? 'b' : 'w';
  const b = s.board;
  const empty = (i: number) => i >= 0 && b[i] === '';
  const enemy = (i: number) => i >= 0 && chessColorOf(b[i]) === them;
  for (let from = 0; from < 64; from++) {
    const p = b[from];
    if (p === '' || chessColorOf(p) !== me) continue;
    const [r, f] = rf(from);
    const t = p.toLowerCase();
    const push = (to: number) => {
      if ((t === 'p') && ((me === 'w' && to >> 3 === 0) || (me === 'b' && to >> 3 === 7))) {
        for (const promo of ['q', 'r', 'b', 'n'] as Promo[]) out.push({ from, to, promo });
      } else out.push({ from, to });
    };
    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1, startRow = me === 'w' ? 6 : 1;
      const one = at(r + dir, f);
      if (empty(one)) {
        push(one);
        const two = at(r + 2 * dir, f);
        if (r === startRow && empty(two)) out.push({ from, to: two });
      }
      for (const df of [-1, 1]) {
        const c = at(r + dir, f + df);
        if (c >= 0 && (enemy(c) || c === s.ep)) push(c);
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, df] of t === 'n' ? KNIGHT : KING) {
        const i = at(r + dr, f + df);
        if (i >= 0 && (b[i] === '' || enemy(i))) out.push({ from, to: i });
      }
      if (t === 'k') {
        const row = me === 'w' ? 7 : 0;
        if (from === row * 8 + 4 && !chessAttacked(b, from, them)) {
          const K = me === 'w' ? 'K' : 'k', Q = me === 'w' ? 'Q' : 'q';
          if (s.castling.includes(K) && b[row * 8 + 5] === '' && b[row * 8 + 6] === '' && b[row * 8 + 7].toLowerCase() === 'r'
            && !chessAttacked(b, row * 8 + 5, them) && !chessAttacked(b, row * 8 + 6, them)) out.push({ from, to: row * 8 + 6 });
          if (s.castling.includes(Q) && b[row * 8 + 3] === '' && b[row * 8 + 2] === '' && b[row * 8 + 1] === '' && b[row * 8].toLowerCase() === 'r'
            && !chessAttacked(b, row * 8 + 3, them) && !chessAttacked(b, row * 8 + 2, them)) out.push({ from, to: row * 8 + 2 });
        }
      }
    } else {
      const dirs = t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
      for (const [dr, df] of dirs) {
        for (let k = 1; k < 8; k++) {
          const i = at(r + dr * k, f + df * k);
          if (i < 0) break;
          if (b[i] === '') { out.push({ from, to: i }); continue; }
          if (enemy(i)) out.push({ from, to: i });
          break;
        }
      }
    }
  }
  return out;
}

/** Applies a move WITHOUT legality checks (use chessPlay for validated moves). */
export function chessApply(s: ChessState, m: ChessMove): ChessState {
  const b = s.board.slice();
  const p = b[m.from];
  const t = p.toLowerCase();
  const me = s.turn;
  let capture = b[m.to] !== '';
  // en passant capture
  if (t === 'p' && m.to === s.ep && b[m.to] === '') {
    b[m.to + (me === 'w' ? 8 : -8)] = '';
    capture = true;
  }
  b[m.to] = p;
  b[m.from] = '';
  if (t === 'p' && (m.to >> 3 === 0 || m.to >> 3 === 7)) {
    const promo = m.promo ?? 'q';
    b[m.to] = me === 'w' ? promo.toUpperCase() : promo;
  }
  // castling: move the rook too
  if (t === 'k' && Math.abs(m.to - m.from) === 2) {
    const row = m.from >> 3;
    if (m.to > m.from) { b[row * 8 + 5] = b[row * 8 + 7]; b[row * 8 + 7] = ''; }
    else { b[row * 8 + 3] = b[row * 8]; b[row * 8] = ''; }
  }
  let castling = s.castling;
  const drop = (c: string) => { castling = castling.replace(c, ''); };
  if (p === 'K') { drop('K'); drop('Q'); }
  if (p === 'k') { drop('k'); drop('q'); }
  for (const sq of [m.from, m.to]) {
    if (sq === 63) drop('K');
    if (sq === 56) drop('Q');
    if (sq === 7) drop('k');
    if (sq === 0) drop('q');
  }
  const ep = t === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {
    board: b,
    turn: me === 'w' ? 'b' : 'w',
    castling,
    ep,
    half: t === 'p' || capture ? 0 : s.half + 1,
    full: me === 'b' ? s.full + 1 : s.full,
  };
}

/** All legal moves for the side to move. */
export function chessLegal(s: ChessState): ChessMove[] {
  return pseudoMoves(s).filter((m) => {
    const n = chessApply(s, m);
    return !chessAttacked(n.board, chessKing(n.board, s.turn), n.turn);
  });
}

/** Validated move; promotion defaults to queen. Returns null if illegal. */
export function chessPlay(s: ChessState, color: ChessColor, m: ChessMove): ChessState | null {
  if (color !== s.turn || !m || !Number.isInteger(m.from) || !Number.isInteger(m.to)) return null;
  const legal = chessLegal(s).find((x) => x.from === m.from && x.to === m.to && (x.promo ?? 'q') === (m.promo ?? 'q'));
  return legal ? chessApply(s, legal) : null;
}

export type ChessStatus = 'playing' | 'checkmate' | 'stalemate' | 'draw50' | 'insufficient';
export function chessStatus(s: ChessState): ChessStatus {
  if (chessLegal(s).length === 0) return chessInCheck(s) ? 'checkmate' : 'stalemate';
  if (s.half >= 100) return 'draw50';
  const rest = s.board.filter((p) => p !== '' && p.toLowerCase() !== 'k').map((p) => p.toLowerCase());
  if (rest.length === 0 || (rest.length === 1 && (rest[0] === 'b' || rest[0] === 'n'))) return 'insufficient';
  return 'playing';
}

// =====================================================================================================
// Ludo — 15×15 board. Colours: 0 red (top-left), 1 green (top-right), 2 yellow (bottom-right), 3 blue (bottom-left).
// Token position: -1 = base, 0..50 = main track (relative to the colour's start), 51..55 = home column, 56 = finished.
// =====================================================================================================

export const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'] as const;
export const LUDO_FINISH = 56;
export const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47] as const;

/** The 52 main-track squares as [x, y] (y down), starting at red's start square. */
export const LUDO_TRACK: readonly [number, number][] = (() => {
  const t: [number, number][] = [];
  const seg = (xs: number[], ys: number[]) => { for (let i = 0; i < xs.length; i++) t.push([xs[i], ys[i]]); };
  const range = (a: number, b: number) => (a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Array.from({ length: a - b + 1 }, (_, i) => a - i));
  const rep = (v: number, n: number) => new Array(n).fill(v);
  seg(range(1, 5), rep(6, 5)); seg(rep(6, 6), range(5, 0)); seg([7, 8], [0, 0]);
  seg(rep(8, 5), range(1, 5)); seg(range(9, 14), rep(6, 6)); seg([14, 14], [7, 8]);
  seg(range(13, 9), rep(8, 5)); seg(rep(8, 6), range(9, 14)); seg([7, 6], [14, 14]);
  seg(rep(6, 5), range(13, 9)); seg(range(5, 0), rep(8, 6)); seg([0, 0], [7, 6]);
  return t;
})();
const HOME_COLUMN: readonly [number, number][][] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
];
const BASE_SPOTS: readonly [number, number][][] = [
  [[1.75, 1.75], [3.25, 1.75], [1.75, 3.25], [3.25, 3.25]],
  [[10.75, 1.75], [12.25, 1.75], [10.75, 3.25], [12.25, 3.25]],
  [[10.75, 10.75], [12.25, 10.75], [10.75, 12.25], [12.25, 12.25]],
  [[1.75, 10.75], [3.25, 10.75], [1.75, 12.25], [3.25, 12.25]],
];
const FINISH_SPOT: readonly [number, number][] = [[6.6, 7], [7, 6.6], [7.4, 7], [7, 7.4]];

/** Board cell (x, y in 0..15, cell units, centre of the cell) of a token. */
export function ludoCell(color: number, token: number, pos: number): [number, number] {
  if (pos < 0) return [BASE_SPOTS[color][token][0] + 0.5, BASE_SPOTS[color][token][1] + 0.5];
  if (pos >= LUDO_FINISH) return [FINISH_SPOT[color][0] + 0.5, FINISH_SPOT[color][1] + 0.5];
  if (pos > 50) { const c = HOME_COLUMN[color][pos - 51]; return [c[0] + 0.5, c[1] + 0.5]; }
  const c = LUDO_TRACK[(color * 13 + pos) % 52];
  return [c[0] + 0.5, c[1] + 0.5];
}
export const ludoHomeColumn = (color: number): readonly [number, number][] => HOME_COLUMN[color];

/** Seats → colours: 2 players sit opposite (red/yellow), 3–4 go round. */
export const ludoColorsFor = (n: number): number[] => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);

export interface LudoState {
  colors: number[];
  tokens: number[][];
  /** Seats that left the game (skipped, tokens removed). */
  out: boolean[];
  turn: number;
  dice: number;
  phase: 'roll' | 'move';
  winner: number;
}

export function ludoNew(players: number): LudoState {
  const n = Math.max(2, Math.min(4, players));
  return { colors: ludoColorsFor(n), tokens: Array.from({ length: n }, () => [-1, -1, -1, -1]), out: new Array(n).fill(false), turn: 0, dice: 0, phase: 'roll', winner: -1 };
}

export function ludoMovable(s: LudoState): number[] {
  if (s.phase !== 'move' || s.winner >= 0) return [];
  return s.tokens[s.turn].flatMap((p, t) => ((p < 0 ? s.dice === 6 : p + s.dice <= LUDO_FINISH && p < LUDO_FINISH) ? [t] : []));
}

function nextSeat(s: LudoState, from: number): number {
  for (let k = 1; k <= s.tokens.length; k++) {
    const i = (from + k) % s.tokens.length;
    if (!s.out[i]) return i;
  }
  return from;
}

/** Roll (value 1..6 supplied by the server). If no token can move, the turn passes. */
export function ludoRoll(s: LudoState, seat: number, value: number): LudoState | null {
  if (s.winner >= 0 || s.phase !== 'roll' || seat !== s.turn || !Number.isInteger(value) || value < 1 || value > 6) return null;
  const n: LudoState = { ...s, dice: value, phase: 'move', tokens: s.tokens.map((t) => t.slice()) };
  if (ludoMovable(n).length === 0) return { ...n, phase: 'roll', turn: nextSeat(n, seat) };
  return n;
}

export function ludoMove(s: LudoState, seat: number, token: number): LudoState | null {
  if (seat !== s.turn || !ludoMovable(s).includes(token)) return null;
  const tokens = s.tokens.map((t) => t.slice());
  const from = tokens[seat][token];
  const to = from < 0 ? 0 : from + s.dice;
  tokens[seat][token] = to;
  if (to <= 50) {
    const abs = (s.colors[seat] * 13 + to) % 52;
    if (!(LUDO_SAFE as readonly number[]).includes(abs)) {
      tokens.forEach((list, other) => {
        if (other === seat || s.out[other]) return;
        list.forEach((p, i) => { if (p >= 0 && p <= 50 && (s.colors[other] * 13 + p) % 52 === abs) list[i] = -1; });
      });
    }
  }
  const won = tokens[seat].every((p) => p === LUDO_FINISH);
  return {
    ...s, tokens, dice: 0, phase: 'roll',
    winner: won ? seat : -1,
    turn: won ? seat : s.dice === 6 ? seat : nextSeat(s, seat),
  };
}

/** A seat leaves: its tokens disappear and it is skipped. Returns the state; check `active` count yourself. */
export function ludoLeave(s: LudoState, seat: number): LudoState {
  const out = s.out.slice();
  out[seat] = true;
  const tokens = s.tokens.map((t, i) => (i === seat ? [-1, -1, -1, -1] : t.slice()));
  const n: LudoState = { ...s, out, tokens };
  return s.turn === seat ? { ...n, turn: nextSeat(n, seat), phase: 'roll', dice: 0 } : n;
}
export const ludoActive = (s: LudoState): number[] => s.out.flatMap((o, i) => (o ? [] : [i]));

// =====================================================================================================
// Network protocol for mini-games
// =====================================================================================================

export type LudoAction = { type: 'roll' } | { type: 'move'; token: number };
export type MiniGameMove = RpsChoice | number | ChessMove | LudoAction;

export interface MgPlayer { id: string; name: string; seat: number }
export interface MgResult { winners: string[]; reason: string }

/** What a participant or spectator sees. Hidden information (the opponent's RPS pick) is never included. */
export interface MgView {
  id: string;
  kind: MiniGameKind;
  role: 'player' | 'spectator';
  you: number;
  players: MgPlayer[];
  spectators: number;
  turnSeat: number;
  deadlineMs: number;
  phase: 'playing' | 'reveal' | 'over';
  result: MgResult | null;
  seatYaw?: number;
  rps?: { round: number; target: number; scores: number[]; myPick: RpsChoice | null; picked: boolean[]; reveal: (RpsChoice | null)[] | null; roundWinner: number };
  ttt?: { cells: number[]; line: number[] | null };
  chess?: { board: string[]; turn: ChessColor; check: boolean; last: ChessMove | null; legal: ChessMove[]; status: ChessStatus };
  ludo?: { colors: number[]; tokens: number[][]; out: boolean[]; dice: number; phase: 'roll' | 'move'; movable: number[]; lastRoll: number };
}

/** Ludo lobby (host + up to 3 guests) shown to its members until the host starts. */
export interface MgLobby { hostId: string; kind: MiniGameKind; members: { id: string; name: string }[] }

/** Public listing of a running game (in every `state`), for tables, poses and spectating. */
export interface MgListing {
  id: string;
  kind: MiniGameKind;
  x: number; y: number; z: number;
  seats: { id: string; x: number; z: number; yaw: number }[];
  spectators: number;
  /** RPS picks, only after a round is revealed. */
  reveal?: Record<string, RpsChoice>;
  phase: 'playing' | 'reveal' | 'over';
}
