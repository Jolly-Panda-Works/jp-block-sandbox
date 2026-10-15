import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { GAME_NAME, ISLAND_NAME, MAX_NAME_LENGTH, sanitizeName } from '@jp/blocksy-shared';
import { asset } from '../assets';
import { connect } from '../net/network';
import { UUID_RE, config, inviteLink, parseMatchInput, parsePastedToken } from '../net/config';
import { ApiError, MAX_ROOM_PLAYERS, isFull, platform, type RoomInfo } from '../net/platform';
import { saveName, useGame } from '../state/store';
import { lockLandscape } from '../game/orientation';

type Step = 'name' | 'checking' | 'lobby' | 'direct' | 'test';

/**
 * Before the game starts:
 * - name:   first visit only — choose a display name (saved on this device; change it later in Settings).
 * - direct: launched with ?jwt=… by the Rastaar app → Play.
 * - test:   no backend configured → playground test token.
 * - lobby:  room list (name, players/capacity, Join disabled when full), search by room id, create + share.
 * There is no phone-number sign-in: each device gets a guest account automatically.
 */
export function Entry() {
  const savedName = useGame((s) => s.name);
  const nextStep = (): Step => (config.jwt ? 'direct' : !platform.configured() ? 'test' : 'checking');
  const [step, setStep] = useState<Step>(savedName ? nextStep() : 'name');
  const [error, setError] = useState('');

  // Guest session: reuse the stored token, or create a guest account silently.
  useEffect(() => {
    if (step !== 'checking') return;
    const name = useGame.getState().name;
    (platform.hasSession() ? platform.me().catch(() => null) : Promise.resolve(null))
      .then((u) => u ?? platform.signInGuest(name))
      .then(() => setStep('lobby'))
      .catch((err) => { setError(err instanceof Error ? err.message : 'Could not reach the game backend.'); setStep('lobby'); });
  }, [step]);

  return (
    <div className="join">
      <div className={`card join-card ${step === 'lobby' ? 'wide' : ''}`}>
        <div className="brand">
          <img className="brand-icon" src={asset('blocksy-icon.png')} alt="" />
          <img className="brand-word" src={asset('blocksy-wordmark-light.png')} alt={GAME_NAME} />
        </div>
        {step === 'name' && <NameStep onDone={() => setStep(nextStep())} />}
        {step === 'checking' && <p>Connecting…</p>}
        {step === 'direct' && <Direct />}
        {step === 'test' && <TestToken />}
        {step === 'lobby' && <Lobby startError={error} onRename={() => setStep('name')} />}
      </div>
    </div>
  );
}

function NameStep({ onDone }: { onDone: () => void }) {
  const current = useGame((s) => s.name);
  const [name, setName] = useState(current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = sanitizeName(name);
    saveName(clean);
    if (platform.configured() && platform.hasSession()) void platform.updateName(clean).catch(() => undefined);
    lockLandscape();
    onDone();
  };
  return (
    <form className="entry-form" onSubmit={submit}>
      <p>Welcome to <b>{ISLAND_NAME}</b>! What should other players call you?</p>
      <input value={name} maxLength={MAX_NAME_LENGTH} placeholder="Your name" dir="auto" autoFocus onChange={(e) => setName(e.target.value)} />
      <button className="primary" disabled={!name.trim()}>Continue</button>
      <small>You can change it any time in Settings.</small>
    </form>
  );
}

function ErrorLine() {
  const error = useGame((s) => s.error);
  return error ? <div className="error">{error}</div> : null;
}

function PlayingAs({ onRename }: { onRename?: () => void }) {
  const name = useGame((s) => s.name);
  return <div className="playing-as">Playing as <b dir="auto">{name}</b>{onRename && <button type="button" className="link" onClick={onRename}>change</button>}</div>;
}

/** Launched by the Rastaar app with a game token. */
function Direct() {
  const phase = useGame((s) => s.phase);
  const name = useGame((s) => s.name);
  return (
    <form className="entry-form" onSubmit={(e) => { e.preventDefault(); lockLandscape(); void connect(sanitizeName(name)); }}>
      <p>Build together on <b>{ISLAND_NAME}</b>.</p>
      <PlayingAs />
      <button className="primary" disabled={phase === 'connecting'}>{phase === 'connecting' ? 'Joining…' : 'Play'}</button>
      <ErrorLine />
    </form>
  );
}

/** Snippet that the dashboard page runs to mint a playground token for this game (as in the Rastaar docs). */
const playgroundSnippet = (gameKey: string) => `copy(JSON.stringify(await (await fetch("/dashboard/api/playground/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ gameKey: "${gameKey}" }),
})).json()))`;

/** Test mode (no backend configured): join with a short-lived token from the dashboard playground. */
function TestToken() {
  const phase = useGame((s) => s.phase);
  const name = useGame((s) => s.name);
  const [pasted, setPasted] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const snippet = playgroundSnippet(config.roomName);
  const copySnippet = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); } catch { window.prompt('Copy this snippet', snippet); }
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    const t = parsePastedToken(pasted);
    if (t.error || !t.jwt) { setError(t.error || 'Paste a token first.'); return; }
    setError('');
    lockLandscape();
    void connect(sanitizeName(name), { jwt: t.jwt, multiplayerId: t.multiplayerId || undefined, wsUrl: t.wsUrl || undefined });
  };
  return (
    <form className="entry-form" onSubmit={join}>
      <PlayingAs />
      <p>Test mode: join with a token from the Rastaar dashboard playground.</p>
      <ol className="steps">
        <li>Open <a href="https://gameserver.rastar.ir/dashboard" target="_blank" rel="noreferrer">the dashboard</a> in another tab and sign in.</li>
        <li>In <b>that tab</b>, press F12 → Console (context: <code>top</code>), paste the snippet and press Enter.</li>
        <li>Paste the copied token below and press Join. Each player needs a <b>new</b> token.</li>
      </ol>
      <div className="snippet">
        <pre dir="ltr">{snippet}</pre>
        <button type="button" onClick={() => void copySnippet()}>{copied ? 'Copied ✓' : 'Copy snippet'}</button>
      </div>
      <textarea value={pasted} onChange={(e) => { setPasted(e.target.value); setError(''); }} rows={3} dir="ltr" spellCheck={false}
        placeholder='Paste the token here ({"jwt": …} or eyJ…)' />
      <button className="primary" disabled={phase === 'connecting' || !pasted.trim()}>{phase === 'connecting' ? 'Joining…' : 'Join'}</button>
      {error && <div className="error">{error}</div>}
      <ErrorLine />
    </form>
  );
}

function RoomCard({ room, onJoin, busy }: { room: RoomInfo; onJoin: (r: RoomInfo) => void; busy: boolean }) {
  const full = isFull(room);
  return (
    <div className={`room-card ${full ? 'full' : ''}`}>
      <div className="room-main">
        <div className="room-name" dir="auto">{room.name}</div>
        <div className="room-id" title={room.id}>{room.id.slice(0, 8)}…</div>
      </div>
      <div className="room-count" aria-label={`${room.playerCount} of ${room.maxPlayers} players`}>
        <span className="dots">{Array.from({ length: room.maxPlayers }, (_, i) => <i key={i} className={i < room.playerCount ? 'on' : ''} />)}</span>
        👥 {room.playerCount} / {room.maxPlayers}
      </div>
      <button className="primary" disabled={full || busy} onClick={() => onJoin(room)} title={full ? 'This room is full' : ''}>
        {full ? 'Full' : 'Join'}
      </button>
    </div>
  );
}

function Lobby({ startError, onRename }: { startError: string; onRename: () => void }) {
  const phase = useGame((s) => s.phase);
  const name = useGame((s) => s.name);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(startError);
  const [query, setQuery] = useState(config.multiplayerId);
  const [found, setFound] = useState<RoomInfo | null | undefined>(undefined);
  const [newName, setNewName] = useState('');
  const [newMax, setNewMax] = useState(MAX_ROOM_PLAYERS);
  const [created, setCreated] = useState<RoomInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = phase === 'connecting';

  const refresh = useCallback(async () => {
    try {
      setRooms(await platform.listRooms());
      setListError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Guest session expired: sign in again silently and retry.
        try { await platform.signInGuest(useGame.getState().name); setRooms(await platform.listRooms()); setListError(''); return; } catch { /* fall through */ }
      }
      setListError(err instanceof Error ? err.message : 'Could not load rooms.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const h = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => clearInterval(h);
  }, [refresh]);

  const search = useCallback(async (raw: string) => {
    const id = parseMatchInput(raw).multiplayerId;
    if (!UUID_RE.test(id)) { setFound(null); return; }
    try { setFound(await platform.getRoom(id)); } catch { setFound(null); }
  }, []);
  useEffect(() => { if (config.multiplayerId) void search(config.multiplayerId); }, [search]);

  const join = (r: RoomInfo) => { lockLandscape(); void connect(sanitizeName(name), { multiplayerId: r.id }); };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await platform.createRoom(newName.trim() || `${sanitizeName(name)}'s island`, newMax);
      setCreated(r);
      setCopied(false);
      void refresh();
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not create the room.');
    }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { window.prompt('Copy', text); }
  };

  return (
    <div className="lobby">
      <PlayingAs onRename={onRename} />
      <ErrorLine />
      <section>
        <h3>Find a room</h3>
        <form className="row-form" onSubmit={(e) => { e.preventDefault(); void search(query); }}>
          <input value={query} onChange={(e) => { setQuery(e.target.value); setFound(undefined); }} placeholder="Room id or invite link" dir="ltr" spellCheck={false} />
          <button>Search</button>
        </form>
        {found === null && <small className="muted">No room with that id.</small>}
        {found && <RoomCard room={found} onJoin={join} busy={busy} />}
      </section>
      <section>
        <h3>Rooms <button className="link" onClick={() => void refresh()}>refresh</button></h3>
        {loading && <small className="muted">Loading…</small>}
        {listError && <div className="error">{listError}</div>}
        {!loading && !listError && rooms.length === 0 && <small className="muted">No rooms yet — create the first one below.</small>}
        <div className="room-list">{rooms.map((r) => <RoomCard key={r.id} room={r} onJoin={join} busy={busy} />)}</div>
      </section>
      <section>
        <h3>Create a room</h3>
        <form className="row-form" onSubmit={create}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Room name" maxLength={40} dir="auto" />
          <select value={newMax} onChange={(e) => setNewMax(Number(e.target.value))} aria-label="Max players">
            {Array.from({ length: MAX_ROOM_PLAYERS - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} players</option>)}
          </select>
          <button className="primary">Create</button>
        </form>
        {created && (
          <div className="created">
            <div>Room <b dir="auto">{created.name}</b> is ready. Share its id or link:</div>
            <code className="room-full-id">{created.id}</code>
            <div className="row-form">
              <button onClick={() => void copy(created.id)}>Copy id</button>
              <button onClick={() => void copy(inviteLink(created.id))}>Copy invite link</button>
              <button className="primary" onClick={() => join(created)} disabled={busy}>Join now</button>
            </div>
            {copied && <small className="muted">Copied!</small>}
          </div>
        )}
      </section>
    </div>
  );
}
