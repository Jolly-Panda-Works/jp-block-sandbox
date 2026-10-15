import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ANIMAL_ICON, ANIMAL_KINDS, DEFAULT_ROOM_SETTINGS, GAME_NAME, ISLAND_NAME, MAX_NAME_LENGTH, sanitizeName,
  type AnimalKind, type RoomSettings,
} from '@jp/blocksy-shared';
import { asset } from '../assets';
import { connect } from '../net/network';
import { UUID_RE, config, gamePageUrl, inviteLink, parseMatchInput, parsePastedToken } from '../net/config';
import { tokenBookmarklet } from '../net/bookmarklet';
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
    // Guest sign-in is idempotent (the same device is always the same player), so there is no need to
    // probe an old, possibly expired session first (that probe showed up as a 401 in the console).
    platform.signInGuest(useGame.getState().name)
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
  // The bookmark's href is a javascript: URL; set it on the element directly (React warns about such hrefs).
  const bookmark = useRef<HTMLAnchorElement>(null);
  useEffect(() => { bookmark.current?.setAttribute('href', tokenBookmarklet(config.roomName, gamePageUrl())); }, []);
  return (
    <form className="entry-form" onSubmit={join}>
      <PlayingAs />
      <div className="bookmark-box">
        <b>One-click test login</b>
        <ol className="steps">
          <li>Drag this button to your bookmarks bar (show it with Ctrl+Shift+B / ⌘⇧B):
            <a ref={bookmark} className="bookmarklet" onClick={(e) => { e.preventDefault(); setError('Drag the button to your bookmarks bar, then click it in the Rastaar dashboard tab.'); }}>🎮 Play {config.roomName}</a>
          </li>
          <li>Open <a href="https://gameserver.rastar.ir/dashboard" target="_blank" rel="noreferrer">the dashboard</a> and sign in.</li>
          <li>Click the bookmark there: the game opens in a new tab with a fresh token. Every player does this in their own browser.</li>
        </ol>
      </div>
      <details>
      <summary className="muted">Or paste a token by hand</summary>
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
      </details>
      {error && <div className="error">{error}</div>}
      <ErrorLine />
    </form>
  );
}

/** Short description of a room's settings for its card. */
function summary(s: Partial<RoomSettings>): string {
  const parts: string[] = [];
  if (s.animals) parts.push(s.animals.length === 0 ? 'no animals' : s.animals.length === ANIMAL_KINDS.length ? '🐾 all animals' : s.animals.map((a) => ANIMAL_ICON[a]).join(''));
  if (s.dayLengthMin !== undefined) parts.push(s.dayLengthMin === 0 ? `⏸ ${String(s.startHour ?? 8).padStart(2, '0')}:00` : `🌗 ${s.dayLengthMin} min day`);
  if (s.ambientBots !== undefined) parts.push(`🤖 ${s.ambientBots}`);
  if (s.sessionMinutes) parts.push(`⏱ ${s.sessionMinutes} min`);
  if (s.chatEnabled === false) parts.push('chat off');
  return parts.join(' · ');
}

const numberOptions = (values: number[], label: (v: number) => string) => values.map((v) => <option key={v} value={v}>{label(v)}</option>);

/** Everything the creator can choose for a new room (applied by the game server when the room starts). */
function RoomSettingsForm({ value, onChange }: { value: RoomSettings; onChange: (v: RoomSettings) => void }) {
  const set = <K extends keyof RoomSettings>(k: K, v: RoomSettings[K]) => onChange({ ...value, [k]: v });
  const num = (k: keyof RoomSettings) => (e: { target: { value: string } }) => set(k, Number(e.target.value) as never);
  const toggleAnimal = (a: AnimalKind) => set('animals', value.animals.includes(a) ? value.animals.filter((x) => x !== a) : ANIMAL_KINDS.filter((k) => k === a || value.animals.includes(k)));
  return (
    <div className="room-settings">
      <div className="rs-grid">
        <label>Session length<select value={value.sessionMinutes} onChange={num('sessionMinutes')}>{numberOptions([0, 10, 20, 30, 60, 120], (v) => (v ? `${v} minutes` : 'Until everyone leaves'))}</select></label>
        <label>Day length<select value={value.dayLengthMin} onChange={num('dayLengthMin')}>{numberOptions([5, 10, 20, 40, 60, 0], (v) => (v ? `${v} minutes` : 'Time stands still'))}</select></label>
        <label>Start time<select value={value.startHour} onChange={num('startHour')}>{numberOptions([6, 8, 12, 17, 19, 22], (v) => `${String(v).padStart(2, '0')}:00 ${v < 6 || v >= 21 ? '🌙' : v < 8 || v >= 19 ? '🌅' : '☀️'}`)}</select></label>
        <label>Wandering bots<select value={value.ambientBots} onChange={num('ambientBots')}>{numberOptions([0, 1, 2, 3, 4, 6, 8], (v) => (v ? `${v} bots` : 'None'))}</select></label>
        <label>Bot joins an unanswered invite<select value={value.botJoinAfterSec} onChange={num('botJoinAfterSec')}>{numberOptions([5, 10, 20, 30, 0], (v) => (v ? `after ${v} s` : 'Never'))}</select></label>
        <label>Animals of each kind<select value={value.animalsPerKind} onChange={num('animalsPerKind')}>{numberOptions([1, 2, 3, 4, 6], (v) => `${v}`)}</select></label>
        <label className="rs-toggle"><input type="checkbox" checked={value.chatEnabled} onChange={(e) => set('chatEnabled', e.target.checked)} /> Chat messages</label>
      </div>
      <div>
        <small className="muted">Animals — biomes without any chosen animal are left out of the world</small>
        <div className="animal-picks">
          <button type="button" className="animal-pick on" onClick={() => set('animals', [...ANIMAL_KINDS])}>All</button>
          <button type="button" className="animal-pick on" onClick={() => set('animals', [])}>None</button>
          {ANIMAL_KINDS.map((a) => (
            <button type="button" key={a} className={`animal-pick ${value.animals.includes(a) ? 'on' : ''}`} onClick={() => toggleAnimal(a)}>{ANIMAL_ICON[a]} {a}</button>
          ))}
        </div>
      </div>
      <details>
        <summary className="muted">Advanced</summary>
        <div className="rs-grid">
          <label>World seed<div className="seed-row"><input type="number" value={value.worldSeed} onChange={num('worldSeed')} /><button type="button" onClick={() => set('worldSeed', 1 + Math.floor(Math.random() * 2_000_000_000))}>🎲</button></div></label>
          <label>Join an invite after (s)<input type="number" min={0} max={60} value={value.inviteAcceptDelaySec} onChange={num('inviteAcceptDelaySec')} /></label>
          <label>Rock Paper Scissors pick (s)<input type="number" min={2} max={15} value={value.rpsPickSec} onChange={num('rpsPickSec')} /></label>
          <label>Rock Paper Scissors best of<select value={value.rpsBestOf} onChange={num('rpsBestOf')}>{numberOptions([1, 3, 5, 7], (v) => `${v}`)}</select></label>
          <label>Tic Tac Toe turn (s)<input type="number" min={5} max={120} value={value.tttTurnSec} onChange={num('tttTurnSec')} /></label>
          <label>Chess turn (s)<input type="number" min={10} max={600} value={value.chessTurnSec} onChange={num('chessTurnSec')} /></label>
          <label>Ludo turn (s)<input type="number" min={3} max={60} value={value.ludoTurnSec} onChange={num('ludoTurnSec')} /></label>
        </div>
      </details>
    </div>
  );
}

function RoomCard({ room, onJoin, busy }: { room: RoomInfo; onJoin: (r: RoomInfo) => void; busy: boolean }) {
  const full = isFull(room);
  return (
    <div className={`room-card ${full ? 'full' : ''}`}>
      <div className="room-main">
        <div className="room-name" dir="auto">{room.name}</div>
        <div className="room-id" title={room.id}>{room.id.slice(0, 8)}…</div>
        {room.settings && <div className="room-summary">{summary(room.settings)}</div>}
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
  const [newSettings, setNewSettings] = useState<RoomSettings>({ ...DEFAULT_ROOM_SETTINGS, worldSeed: 1 + Math.floor(Math.random() * 2_000_000_000) });
  const [showSettings, setShowSettings] = useState(false);
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

  const join = (r: RoomInfo) => { lockLandscape(); void connect(sanitizeName(name), { multiplayerId: r.id, roomSettings: r.settings }); };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await platform.createRoom(newName.trim() || `${sanitizeName(name)}'s island`, newMax, newSettings);
      if (!r.settings) r.settings = newSettings; // backend didn't echo them: keep ours for joining
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
            {Array.from({ length: MAX_ROOM_PLAYERS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? '1 player' : `${n} players`}</option>)}
          </select>
          <button type="button" onClick={() => setShowSettings((v) => !v)}>⚙️ Settings</button>
          <button className="primary">Create</button>
        </form>
        {showSettings && <RoomSettingsForm value={newSettings} onChange={setNewSettings} />}
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
