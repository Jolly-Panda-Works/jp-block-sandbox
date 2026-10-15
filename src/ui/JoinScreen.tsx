import { useState } from 'react';
import { GAME_NAME, ISLAND_NAME, MAX_NAME_LENGTH, MAX_PLAYERS, sanitizeName } from '@jp/blocksy-shared';
import { connect } from '../net/network';
import { useGame } from '../state/store';

export function JoinScreen() {
  const { phase, error, name } = useGame();
  const [value, setValue] = useState(name);
  const go = () => { void connect(sanitizeName(value)); };
  return (
    <div className="join">
      <div className="card join-card">
        <div className="brand">
          <img className="brand-icon" src="/blocksy-icon.png" alt="" />
          <img className="brand-word" src="/blocksy-wordmark-light.png" alt={GAME_NAME} />
        </div>
        <p>Build together on <b>{ISLAND_NAME}</b>, a tiny blocky island. Up to {MAX_PLAYERS} players per room.</p>
        <input value={value} maxLength={MAX_NAME_LENGTH} placeholder="Your name" autoFocus dir="auto"
          onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        <button className="primary" disabled={phase === 'connecting'} onClick={go}>
          {phase === 'connecting' ? 'Joining…' : 'Play'}
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
