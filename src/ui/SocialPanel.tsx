import { useState } from 'react';
import { EMOJIS, PLAYER_EMOTES, MAX_MESSAGE_LENGTH, PRESET_MESSAGES, sanitizeMessage, type RestPose } from '@jp/blocksy-shared';
import { send } from '../net/network';
import { useGame } from '../state/store';
import { openPanel } from '../game/pointer';

type Tab = 'emojis' | 'messages' | 'emotes';

/** Social panel (reference images 9–11): emoji and text bubbles above your head, and animated emotes. */
const drawable = new Map<string, boolean>();
/**
 * Can this device's emoji font draw the emoji? Newer emoji show up as empty boxes on older systems
 * (e.g. Windows 10), so those are left out of the picker. Colour pixels in a tiny canvas = drawn.
 */
function canDrawEmoji(ch: string): boolean {
  let ok = drawable.get(ch);
  if (ok !== undefined) return ok;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 20;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.textBaseline = 'top';
    g.font = '16px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.fillText(ch, 0, 0);
    const d = g.getImageData(0, 0, 20, 20).data;
    ok = false;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i + 1] - d[i + 2]) > 20)) { ok = true; break; }
  } catch { ok = true; }
  drawable.set(ch, ok);
  return ok;
}

export function SocialPanel() {
  const seated = useGame((s) => s.mg?.role === 'player');
  const mgActive = useGame((s) => s.mg || s.lobby);
  const [tab, setTab] = useState<Tab>('emojis');
  const [text, setText] = useState('');
  const sendText = (t: string) => {
    const clean = sanitizeMessage(t);
    if (!clean) return;
    send('chat', { text: clean });
    setText('');
    openPanel('none');
  };
  const tabBtn = (t: Tab, icon: string, label: string) => (
    <button className={`side-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}><span>{icon}</span>{label}</button>
  );
  return (
    <div className="overlay right" onMouseDown={(e) => { if (e.target === e.currentTarget) openPanel('none'); }}>
      <div className="card panel social">
        <div className="side-tabs">
          {tabBtn('emojis', '😊', 'Emojis')}
          {tabBtn('messages', '💬', 'Messages')}
          {tabBtn('emotes', '🕺', 'Emotes')}
        </div>
        <div className="social-content">
          {tab === 'emojis' && (
            <div className="emoji-groups">
              {(['faces', 'hands', 'other'] as const).map((group) => (
                <div key={group}>
                  {group !== 'other' && <h4 className="emoji-group-title">{group === 'faces' ? 'Faces' : 'Hands'}</h4>}
                  <div className="emoji-grid">
                    {EMOJIS.filter((e) => e.group === group && canDrawEmoji(e.char)).map((e) => (
                      <button key={e.id} onClick={() => { send('emoji', { id: e.id }); openPanel('none'); }}>{e.char}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tab === 'messages' && (
            <div className="messages">
              {PRESET_MESSAGES.map((m) => <button key={m} onClick={() => sendText(m)}>{m}</button>)}
              <div className="compose">
                <input value={text} maxLength={MAX_MESSAGE_LENGTH} placeholder="Say something…" dir="auto" autoFocus
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendText(text); }} />
                <button className="primary" onClick={() => sendText(text)}>Send</button>
              </div>
            </div>
          )}
          {tab === 'emotes' && (
            <div className="emotes">
              {PLAYER_EMOTES.map((e) => (
                <button key={e.id} disabled={seated} title={seated ? 'Emotes are off while you play' : ''} onClick={() => { useGame.setState({ myPose: '' }); send('emote', { id: e.id }); openPanel('none'); }}>
                  <span className="big">{e.icon}</span>{e.label}
                </button>
              ))}
              {([['sit', '🪑', 'Sit down'], ['sleep', '😴', 'Lie down'], ['', '🧍', 'Stand up']] as [RestPose, string, string][]).map(([pose, icon, label]) => (
                <button key={label} disabled={!!mgActive} onClick={() => { useGame.setState({ myPose: pose }); send('pose', { pose }); openPanel('none'); }}>
                  <span className="big">{icon}</span>{label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
