import { MINI_GAMES, miniGameInfo } from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { send } from '../net/network';
import { openPanel } from '../game/pointer';

/**
 * Popup game panel (P): pick a game to post an invite. The game's icon appears above your head; a
 * nearby player can accept with Interact (E) after a few seconds. Ludo gathers 2–4 players and the
 * host starts it from here.
 */
export function GamesPanel() {
  const { myInvite, lobby, sessionId, acceptDelayMs, showToast } = useGame();
  const close = () => openPanel('none');
  const post = (kind: (typeof MINI_GAMES)[number]['kind']) => {
    send('mgInvite', { kind });
    showToast(`${miniGameInfo(kind).name}: a player next to you can press E to join`);
    close();
  };
  const isHost = !!lobby && lobby.hostId === sessionId;


  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="card panel games-panel">
        <header><h2>🎲 Popup game</h2><button className="close" onClick={close}>✕</button></header>
        {!myInvite && (
          <>
            <p className="hint">Your game's icon appears above your head and a nearby player joins with <b>E</b> after {Math.round(acceptDelayMs / 1000)} s. If nobody does, a 🤖 bot walking around the island may come over and play. You can also visit the <b>Game Center</b> next to the plaza.</p>
            <div className="game-grid">
              {MINI_GAMES.map((g) => (
                <div key={g.kind} className="game-card">
                  <span className="game-icon">{g.icon}</span>
                  <b>{g.name}</b>
                  <small>{g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`}</small>
                  <div className="game-actions">
                    <button className="primary" onClick={() => post(g.kind)}>Invite</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {myInvite && (
          <div className="invite-status">
            <div className="game-icon big">{miniGameInfo(myInvite).icon}</div>
            <b>{miniGameInfo(myInvite).name}</b>
            {isHost ? (
              <>
                <p className="hint">Players at your table ({lobby!.members.length}/4):</p>
                <ul className="lobby-members">{lobby!.members.map((m) => <li key={m.id} dir="auto">{m.id === sessionId ? `${m.name} (you)` : m.name}</li>)}</ul>
                <button className="primary wide" disabled={lobby!.members.length < 2} onClick={() => { send('mgStart', {}); close(); }}>
                  {lobby!.members.length < 2 ? 'Waiting for players…' : `Start with ${lobby!.members.length} players`}
                </button>
              </>
            ) : (
              <p className="hint">Waiting for someone to join… Stay close so they can reach you.</p>
            )}
            <button className="wide" onClick={() => { send('mgCancel', {}); close(); }}>Cancel invite</button>
          </div>
        )}
      </div>
    </div>
  );
}
