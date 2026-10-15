import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { GAME_NAME, ISLAND_NAME, MAX_NAME_LENGTH, sanitizeName } from '@jp/blocksy-shared';
import { asset } from '../assets';
import { connect } from '../net/network';
import { UUID_RE, config, inviteLink, parseMatchInput } from '../net/config';
import { ApiError, MAX_ROOM_PLAYERS, isFull, platform, type RoomInfo, type UserInfo } from '../net/platform';
import { useGame } from '../state/store';

type Step = 'checking' | 'login' | 'lobby' | 'direct';

/**
 * Everything before the game starts:
 * - direct: launched with ?jwt=… by the Rastaar app → name + Play.
 * - login:  phone number + one-time code (Rastaar account).
 * - lobby:  room list (name, players/capacity, Join disabled when full), search by room id, create + share a room.
 */
export function Entry() {
  const [step, setStep] = useState<Step>(config.jwt ? 'direct' : 'checking');
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    if (step !== 'checking') return;
    if (!platform.configured() || !platform.hasSession()) { setStep('login'); return; }
    platform.me()
      .then((u) => { setUser(u); setStep('lobby'); })
      .catch(() => setStep('login'));
  }, [step]);

  return (
    <div className="join">
      <div className={`card join-card ${step === 'lobby' ? 'wide' : ''}`}>
        <div className="brand">
          <img className="brand-icon" src={asset('blocksy-icon.png')} alt="" />
          <img className="brand-word" src={asset('blocksy-wordmark-light.png')} alt={GAME_NAME} />
        </div>
        {step === 'checking' && <p>Connecting…</p>}
        {step === 'direct' && <Direct />}
        {step === 'login' && <Login onDone={(u) => { setUser(u); setStep('lobby'); }} />}
        {step === 'lobby' && <Lobby user={user} onSignOut={() => { platform.signOut(); setUser(null); setStep('login'); }} />}
      </div>
    </div>
  );
}

function useName(fallback: string) {
  const saved = useGame((s) => s.name);
  const [name, setName] = useState(saved || fallback);
  useEffect(() => { if (!name && fallback) setName(fallback); }, [fallback, name]);
  return [name, setName] as const;
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input value={value} maxLength={MAX_NAME_LENGTH} placeholder="Your name in the game" dir="auto" onChange={(e) => onChange(e.target.value)} />;
}

function ErrorLine() {
  const error = useGame((s) => s.error);
  return error ? <div className="error">{error}</div> : null;
}

/** Launched by the Rastaar app with a game token: only the name is asked. */
function Direct() {
  const phase = useGame((s) => s.phase);
  const [name, setName] = useName('');
  return (
    <form className="entry-form" onSubmit={(e) => { e.preventDefault(); void connect(sanitizeName(name)); }}>
      <p>Build together on <b>{ISLAND_NAME}</b>.</p>
      <NameField value={name} onChange={setName} />
      <button className="primary" disabled={phase === 'connecting'}>{phase === 'connecting' ? 'Joining…' : 'Play'}</button>
      <ErrorLine />
    </form>
  );
}

function Login({ onDone }: { onDone: (u: UserInfo | null) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!platform.configured()) {
    return (
      <div className="entry-form">
        <p>This copy of Blocksy is not connected to the Rastaar backend yet.</p>
        <small>Set <code>VITE_API_BASE_URL</code> when building, or open the game from the Rastaar app.</small>
      </div>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!sent) {
        await platform.sendCode(phone.trim());
        setSent(true);
      } else {
        const u = await platform.verifyCode(phone.trim(), code.trim());
        onDone(u ?? (await platform.me().catch(() => null)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="entry-form" onSubmit={submit}>
      <p>Sign in with your Rastaar account to play online.</p>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number (09…)" inputMode="tel" dir="ltr" autoFocus disabled={sent} />
      {sent && <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code from SMS" inputMode="numeric" dir="ltr" autoFocus />}
      <button className="primary" disabled={busy || !phone.trim() || (sent && !code.trim())}>
        {busy ? '…' : sent ? 'Sign in' : 'Send code'}
      </button>
      {sent && <button type="button" className="link" onClick={() => { setSent(false); setCode(''); }}>Change number</button>}
      {error && <div className="error">{error}</div>}
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

function Lobby({ user, onSignOut }: { user: UserInfo | null; onSignOut: () => void }) {
  const phase = useGame((s) => s.phase);
  const [name, setName] = useName(user?.name ?? '');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
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
      if (err instanceof ApiError && err.status === 401) { onSignOut(); return; }
      setListError(err instanceof Error ? err.message : 'Could not load rooms.');
    } finally {
      setLoading(false);
    }
  }, [onSignOut]);

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
  // An invite link (?room=…) opens the lobby with that room already looked up.
  useEffect(() => { if (config.multiplayerId) void search(config.multiplayerId); }, [search]);

  const join = (r: RoomInfo) => { void connect(sanitizeName(name), { multiplayerId: r.id }); };

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
      <div className="lobby-top">
        <NameField value={name} onChange={setName} />
        <button className="link" onClick={onSignOut}>Sign out</button>
      </div>
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
