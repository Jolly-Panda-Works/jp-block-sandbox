import { useEffect, useMemo, useState } from 'react';
import {
  LUDO_COLORS, LUDO_SAFE, LUDO_TRACK, RPS_CHOICES, RPS_ICON, ludoCell, ludoHomeColumn, miniGameInfo,
  type ChessMove, type MgView, type RpsChoice,
} from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { leaveMiniGame, send } from '../net/network';

const SEAT_COLOR = ['#3ddbb9', '#ff7a6b', '#f2c230', '#9b6bd6'];
const LUDO_HEX = ['#e53935', '#43a047', '#fbc02d', '#1e88e5'];

/** Remaining time of the current turn, ticking locally from the server's deadline. */
function useCountdown(view: MgView, receivedAt: number): number {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 200); return () => clearInterval(h); }, []);
  return Math.max(0, view.deadlineMs - (performance.now() - receivedAt));
}

function resultText(v: MgView, myId: string): string {
  const r = v.result!;
  if (r.winners.length === 0) return r.reason === 'stalemate' ? 'Stalemate — draw' : 'Draw';
  if (r.winners.includes(myId)) return r.reason === 'left' ? 'Your opponent left — you win!' : 'You win! 🎉';
  const names = v.players.filter((p) => r.winners.includes(p.id)).map((p) => p.name).join(', ');
  return v.role === 'player' ? `${names} wins` : `${names} wins${r.reason === 'checkmate' ? ' by checkmate' : ''}`;
}

/** The live board for players and spectators, plus the Ludo lobby screen for guests. */
export function MiniGameOverlay() {
  const { mg, mgAt, lobby, sessionId } = useGame();
  if (!mg && lobby && lobby.hostId !== sessionId) return <LobbyWait />;
  if (!mg) return null;
  if (mg.kind === 'rps') return <Rps v={mg} at={mgAt} me={sessionId ?? ''} />;
  return <BoardFrame v={mg} at={mgAt} me={sessionId ?? ''} />;
}

function LobbyWait() {
  const lobby = useGame((s) => s.lobby)!;
  const host = lobby.members.find((m) => m.id === lobby.hostId)?.name ?? 'Host';
  return (
    <div className="mg-float card">
      <b>🎲 Ludo with {host}</b>
      <small>{lobby.members.length}/4 players · waiting for {host} to start</small>
      <ul className="lobby-members">{lobby.members.map((m) => <li key={m.id} dir="auto">{m.name}</li>)}</ul>
      <button onClick={leaveMiniGame}>Leave</button>
    </div>
  );
}

function Header({ v, at, me }: { v: MgView; at: number; me: string }) {
  const left = useCountdown(v, at);
  const turnName = v.players[v.turnSeat]?.name ?? '';
  const myTurn = v.role === 'player' && v.turnSeat === v.you;
  return (
    <>
      <header>
        <h2>{v.role === 'spectator' ? 'Watching · ' : ''}{miniGameInfo(v.kind).icon} {miniGameInfo(v.kind).name}</h2>
        {v.spectators > 0 && <span className="muted">👁 {v.spectators}</span>}
      </header>
      <div className="mg-players">
        {v.players.map((p) => (
          <span key={p.id} className={`mg-chip ${p.seat === v.turnSeat && v.phase === 'playing' ? 'turn' : ''}`} style={{ borderColor: v.kind === 'ludo' ? LUDO_HEX[v.ludo!.colors[p.seat]] : SEAT_COLOR[p.seat] }}>
            {v.kind === 'ttt' && (p.seat === 0 ? '✕ ' : '◯ ')}{v.kind === 'chess' && (p.seat === 0 ? '♔ ' : '♚ ')}
            <span dir="auto">{p.id === me ? 'You' : p.name}</span>{v.ludo?.out[p.seat] ? ' (left)' : ''}
          </span>
        ))}
      </div>
      <div className={`mg-status ${myTurn ? 'mine' : ''}`}>
        {v.phase === 'over' ? resultText(v, me) : myTurn ? `Your turn · ${Math.ceil(left / 1000)} s` : `${turnName}'s turn · ${Math.ceil(left / 1000)} s`}
        {v.phase === 'playing' && myTurn && <small> — no move in time? A random move is played.</small>}
      </div>
    </>
  );
}

function BoardFrame({ v, at, me }: { v: MgView; at: number; me: string }) {
  return (
    <div className="mg-board-wrap">
      <div className="card panel mg-panel">
        <Header v={v} at={at} me={me} />
        {v.kind === 'ttt' && <Ttt v={v} />}
        {v.kind === 'chess' && <Chess v={v} />}
        {v.kind === 'ludo' && <Ludo v={v} />}
        <footer>
          <button className={v.role === 'spectator' ? 'primary wide' : 'wide'} onClick={leaveMiniGame}>
            {v.role === 'spectator' ? 'Leave spectator' : v.phase === 'over' ? 'Close' : 'Leave game'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Ttt({ v }: { v: MgView }) {
  const t = v.ttt!;
  const canPlay = v.role === 'player' && v.turnSeat === v.you && v.phase === 'playing';
  return (
    <div className="ttt">
      {t.cells.map((c, i) => (
        <button key={i} className={`ttt-cell ${t.line?.includes(i) ? 'win' : ''}`} disabled={!canPlay || c !== -1}
          onClick={() => send('mgMove', { move: i })}>
          {c === 0 && <span className="x">✕</span>}{c === 1 && <span className="o">◯</span>}
        </button>
      ))}
    </div>
  );
}

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

function Chess({ v }: { v: MgView }) {
  const c = v.chess!;
  const [sel, setSel] = useState<number | null>(null);
  const flip = v.role === 'player' && v.you === 1; // black sees the board from its side
  const targets = useMemo(() => (sel === null ? [] : c.legal.filter((m) => m.from === sel).map((m) => m.to)), [sel, c.legal]);
  useEffect(() => setSel(null), [c.board]);
  const king = c.check ? c.board.indexOf(c.turn === 'w' ? 'K' : 'k') : -1;
  const click = (i: number) => {
    if (sel !== null && targets.includes(i)) {
      const m: ChessMove = { from: sel, to: i, promo: 'q' };
      send('mgMove', { move: m });
      setSel(null);
    } else if (c.legal.some((m) => m.from === i)) setSel(i);
    else setSel(null);
  };
  const order = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k));
  return (
    <div className="chess">
      {order.map((i) => {
        const p = c.board[i];
        const dark = ((i >> 3) + (i & 7)) % 2 === 1;
        const last = c.last && (c.last.from === i || c.last.to === i);
        return (
          <button key={i} className={`sq ${dark ? 'dark' : 'light'} ${sel === i ? 'sel' : ''} ${last ? 'last' : ''} ${king === i ? 'check' : ''}`} onClick={() => click(i)}>
            {p && <span className={p === p.toUpperCase() ? 'pw' : 'pb'}>{GLYPH[p.toLowerCase()]}</span>}
            {targets.includes(i) && <i className={p ? 'cap' : 'dot'} />}
          </button>
        );
      })}
    </div>
  );
}

function Ludo({ v }: { v: MgView }) {
  const l = v.ludo!;
  const myTurn = v.role === 'player' && v.turnSeat === v.you && v.phase === 'playing';
  const cells = useMemo(() => {
    const list: { x: number; y: number; bg: string; star: boolean }[] = [];
    LUDO_TRACK.forEach(([x, y], i) => {
      const startColor = [0, 13, 26, 39].indexOf(i);
      list.push({ x, y, bg: startColor >= 0 ? LUDO_HEX[startColor] : '#fff', star: (LUDO_SAFE as readonly number[]).includes(i) && startColor < 0 });
    });
    for (let c = 0; c < 4; c++) for (const [x, y] of ludoHomeColumn(c)) list.push({ x, y, bg: LUDO_HEX[c], star: false });
    return list;
  }, []);
  const pct = (n: number) => `${(n / 15) * 100}%`;
  return (
    <div className="ludo-wrap">
      <div className="ludo">
        {[0, 1, 2, 3].map((c) => {
          const [x, y] = [[0, 0], [9, 0], [9, 9], [0, 9]][c];
          return <div key={c} className="ludo-base" style={{ left: pct(x), top: pct(y), background: LUDO_HEX[c] }}><div /></div>;
        })}
        {cells.map((c, i) => <div key={i} className="ludo-cell" style={{ left: pct(c.x), top: pct(c.y), background: c.bg }}>{c.star ? '★' : ''}</div>)}
        <div className="ludo-center" />
        {l.tokens.map((list, seat) => l.out[seat] ? null : list.map((pos, t) => {
          const [cx, cy] = ludoCell(l.colors[seat], t, pos);
          const can = myTurn && seat === v.you && l.movable.includes(t);
          return (
            <button key={`${seat}-${t}`} className={`ludo-token ${can ? 'can' : ''}`} disabled={!can}
              style={{ left: `calc(${pct(cx)} - 2.6%)`, top: `calc(${pct(cy)} - 2.6%)`, background: LUDO_HEX[l.colors[seat]] }}
              onClick={() => send('mgMove', { move: { type: 'move', token: t } })} aria-label={`${LUDO_COLORS[l.colors[seat]]} token ${t + 1}`} />
          );
        }))}
      </div>
      <div className="ludo-controls">
        <div className="dice">{['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][l.lastRoll] || '🎲'}</div>
        <button className="primary" disabled={!myTurn || l.phase !== 'roll'} onClick={() => send('mgMove', { move: { type: 'roll' } })}>Roll</button>
        <small className="muted">{myTurn && l.phase === 'move' ? 'Pick a glowing token' : l.lastRoll === 6 ? 'A six rolls again' : ''}</small>
      </div>
    </div>
  );
}

/** Rock Paper Scissors: choose in 3 seconds; the opponent's choice stays hidden until both are revealed. */
function Rps({ v, at, me }: { v: MgView; at: number; me: string }) {
  const r = v.rps!;
  const left = useCountdown(v, at);
  const opp = v.role === 'player' ? 1 - v.you : 1;
  const mySeat = v.role === 'player' ? v.you : 0;
  const pick = (c: RpsChoice) => send('mgMove', { move: c });
  const card = (seat: number, mine: boolean) => {
    const revealed = r.reveal?.[seat] ?? null;
    return (
      <div className={`rps-card ${mine ? 'mine' : 'theirs'}`}>
        <div className="rps-name" dir="auto">{v.players[seat]?.id === me ? 'You' : v.players[seat]?.name} · {r.scores[seat]}</div>
        <div className="rps-choices">
          {mine && !revealed ? RPS_CHOICES.map((c) => (
            <button key={c} className={r.myPick === c ? 'picked' : ''} disabled={v.phase !== 'playing' || !!r.myPick} onClick={() => pick(c)}>{RPS_ICON[c]}</button>
          )) : revealed ? <span className="rps-big">{RPS_ICON[revealed]}</span> : [0, 1, 2].map((k) => <span key={k} className="q">{r.picked[seat] && k === 1 ? '✔' : '?'}</span>)}
        </div>
      </div>
    );
  };
  const roundText = v.phase === 'over' ? resultText(v, me)
    : v.phase === 'reveal' ? (r.roundWinner < 0 ? 'Tie — again!' : `${v.players[r.roundWinner].id === me ? 'You win' : `${v.players[r.roundWinner].name} wins`} the round`)
    : `Choose in ${Math.ceil(left / 1000)} seconds`;
  return (
    <div className="rps-wrap">
      <div className="rps-head card">✊ Round {r.round} · first to {r.target}{v.role === 'spectator' ? ' · watching' : ''}</div>
      <div className="rps-row">{card(mySeat, v.role === 'player')}{card(opp, false)}</div>
      <div className="rps-foot card">
        <b>{roundText}</b>
        {v.phase === 'playing' && v.role === 'player' && <small>No choice? Random pick. Keys 1 · 2 · 3</small>}
        <button onClick={leaveMiniGame}>{v.role === 'spectator' ? 'Leave spectator' : 'Leave game'}</button>
      </div>
    </div>
  );
}
