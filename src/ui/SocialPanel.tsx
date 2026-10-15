import { useState } from 'react';
import { EMOJIS, EMOTES, MAX_MESSAGE_LENGTH, PRESET_MESSAGES, sanitizeMessage } from '@jp/blocksy-shared';
import { send } from '../net/network';
import { useGame } from '../state/store';
import { openPanel } from '../game/pointer';

type Tab = 'emojis' | 'messages' | 'emotes';

/** Social panel (reference images 9–11): emoji and text bubbles above your head, and animated emotes. */
export function SocialPanel() {
  const seated = useGame((s) => s.mg?.role === 'player');
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
            <div className="emoji-grid">
              {EMOJIS.map((e) => <button key={e.id} onClick={() => { send('emoji', { id: e.id }); openPanel('none'); }}>{e.char}</button>)}
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
              {EMOTES.map((e) => (
                <button key={e.id} disabled={seated} title={seated ? 'Emotes are off while you play' : ''} onClick={() => { send('emote', { id: e.id }); openPanel('none'); }}>
                  <span className="big">{e.icon}</span>{e.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
