import { asset } from '../assets';
import { useState, type KeyboardEvent } from 'react';
import { GAME_NAME, ISLAND_NAME, MAX_NAME_LENGTH, MAX_PLAYERS, sanitizeName } from '@jp/blocksy-shared';
import { connect } from '../net/network';
import { UUID_RE, config, parseMatchInput } from '../net/config';
import { useGame } from '../state/store';

/**
 * Join screen. With a launch link from the Rastaar app (?multiplayerId=…&jwt=…) only the name is asked.
 * Otherwise the player can paste a match code (UUID or invite link) and, if this site has no backend
 * configured, their game token (JWT).
 */
export function JoinScreen() {
  const { phase, error, name } = useGame();
  const [value, setValue] = useState(name);
  const [match, setMatch] = useState('');
  const [token, setToken] = useState('');
  const needsToken = !config.localDev && !config.jwt && !config.apiBaseUrl;
  const hasMatch = config.localDev || UUID_RE.test(config.multiplayerId) || !!config.jwt;
  const [showAdvanced, setShowAdvanced] = useState(needsToken || !hasMatch);

  const go = () => {
    const parsed = parseMatchInput(match);
    // The token box also accepts a whole game link (…?jwt=…&multiplayerId=…).
    const fromLink = /^https?:\/\//i.test(token.trim()) ? parseMatchInput(token) : null;
    const jwt = fromLink ? fromLink.jwt : token.trim();
    void connect(sanitizeName(value), {
      multiplayerId: parsed.multiplayerId || fromLink?.multiplayerId || undefined,
      jwt: jwt || parsed.jwt || undefined,
    });
  };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };

  return (
    <div className="join">
      <div className="card join-card">
        <div className="brand">
          <img className="brand-icon" src={asset('blocksy-icon.png')} alt="" />
          <img className="brand-word" src={asset('blocksy-wordmark-light.png')} alt={GAME_NAME} />
        </div>
        <p>Build together on <b>{ISLAND_NAME}</b>, a tiny blocky island. Up to {MAX_PLAYERS} players per match.</p>
        <input value={value} maxLength={MAX_NAME_LENGTH} placeholder="Your name" autoFocus dir="auto"
          onChange={(e) => setValue(e.target.value)} onKeyDown={enter} />
        {!showAdvanced && <button className="link" onClick={() => setShowAdvanced(true)}>Join another match…</button>}
        {showAdvanced && (
          <div className="join-advanced">
            {needsToken && (
              <input value={token} placeholder="Game token from Rastaar (or a full game link)" dir="ltr" spellCheck={false} type="password"
                onChange={(e) => setToken(e.target.value)} onKeyDown={enter} />
            )}
            {!needsToken && (
              <input value={match} placeholder="Match code or invite link (optional)" dir="ltr" spellCheck={false}
                onChange={(e) => setMatch(e.target.value)} onKeyDown={enter} />
            )}
            <small>Your game token comes from the Rastaar app and already contains the match. Everyone with a token for the same match plays together.</small>
          </div>
        )}
        <button className="primary" disabled={phase === 'connecting'} onClick={go}>
          {phase === 'connecting' ? 'Joining…' : 'Play'}
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
