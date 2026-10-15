import { useState } from 'react';
import { ISLAND_NAME, MAX_NAME_LENGTH, sanitizeName } from '@jp/block-sandbox-shared';
import { connect } from '../net/network';
import { useGame } from '../state/store';

export function JoinScreen() {
  const { phase, error, name } = useGame();
  const [value, setValue] = useState(name);
  const go = () => { void connect(sanitizeName(value)); };
  return (
    <div className="join">
      <div className="card join-card">
        <div className="logo">🏝️</div>
        <h1>{ISLAND_NAME}</h1>
        <p>Build together on a tiny blocky island. Up to 8 players per room.</p>
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
