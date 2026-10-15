import { asset } from '../assets';
import { useEffect, useState } from 'react';
import { AIR, HOTBAR_SLOTS, ISLAND_NAME, MAX_PLAYERS, getBlock } from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { getIconUrl } from '../render/textures';
import { now } from '../render/animState';
import { lockPointer, togglePanel } from '../game/pointer';
import { LookArea, TouchControls } from './TouchControls';
import { MiniGameOverlay } from './MiniGameOverlay';
import { send } from '../net/network';
import { ANIMAL_ICON, isAnimalKind, isBotId, miniGameInfo } from '@jp/blocksy-shared';

/** E near an invite → accept (after the delay); near a running game → watch. Returns true if handled. */
export function interactMiniGame(): boolean {
  const s = useGame.getState();
  if (s.mg || s.lobby) return true;
  if (s.nearInvite) {
    if (s.nearInvite.waitMs > 0) s.showToast(`You can join in ${Math.ceil(s.nearInvite.waitMs / 1000)} s`);
    else send('mgAccept', { hostId: s.nearInvite.hostId });
    return true;
  }
  if (s.nearNpc) { send('mgNpc', { npcId: s.nearNpc.id }); return true; }
  if (s.nearGame) { send('mgSpectate', { gameId: s.nearGame.id }); return true; }
  if (s.nearAnimal) { send('pet', { animalId: s.nearAnimal.id }); return true; }
  return false;
}

export function Keycap({ k }: { k: string }) { return <span className="keycap">{k}</span>; }

const formatTime = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** In-game overlay modelled on the references. */
export function Hud() {
  const s = useGame();
  const count = Object.keys(s.players).filter((id) => !isBotId(id)).length; // people only, not bots
  const playing = s.panel === 'none';
  return (
    <div className="hud">
      {(s.mg || (s.lobby && s.lobby.hostId !== s.sessionId)) && !s.touch && <LookArea />}
      {s.touch && playing && <TouchControls />}
      <MiniGameOverlay />
      {s.timeLeftMs > 0 && <div className="card session-timer">⏱ {formatTime(s.timeLeftMs)}</div>}
      {s.reconnecting && <div className="card reconnecting">Connection lost — reconnecting…</div>}
      {s.sessionEnded && (
        <div className="session-ended">
          <div className="card panel">
            <img src={asset("blocksy-icon.png")} alt="" />
            <h2>Session ended</h2>
            <p>Thanks for building on Sunny Isle!</p>
            <button className="primary wide" onClick={() => location.reload()}>Play again</button>
          </div>
        </div>
      )}
      <div className="card island">
        <img className="badge" src={asset("blocksy-icon.png")} alt="Blocksy" />
        <div><div className="title">{ISLAND_NAME}</div><div className="sub">👥 {count} / {MAX_PLAYERS} players</div></div>
      </div>
      <div className="top-buttons">
        <button onClick={() => togglePanel('games')}>🎲 Games <Keycap k="P" /></button>
        <button onClick={() => togglePanel('build')}>🔨 Build <Keycap k="T" /></button>
        <button onClick={() => togglePanel('social')}>😊 Social <Keycap k="G" /></button>
        <button onClick={() => togglePanel('customize')}>👕 Style <Keycap k="C" /></button>
        <button onClick={() => togglePanel('shop')}>🧱 Shop <Keycap k="B" /></button>
        <button onClick={() => togglePanel('pause')}>⚙️</button>
      </div>
      {playing && s.pointerLocked && <div className="crosshair" />}
      {playing && s.touch && <div className="crosshair" />}
      {playing && !s.mg && !s.lobby && !s.touch && !s.pointerLocked && <div className="click-to-play" onClick={lockPointer}>Click to play</div>}
      {playing && !s.mg && s.nearInvite && (
        <button className="card prompt mg-prompt" onClick={() => interactMiniGame()}>
          <Keycap k="E" /> {miniGameInfo(s.nearInvite.kind).icon} {s.nearInvite.waitMs > 0 ? `${miniGameInfo(s.nearInvite.kind).name} with ${s.nearInvite.name} — in ${Math.ceil(s.nearInvite.waitMs / 1000)} s` : `Play ${miniGameInfo(s.nearInvite.kind).name} with ${s.nearInvite.name}`}
        </button>
      )}
      {playing && !s.mg && !s.nearInvite && s.nearNpc && (
        <button className="card prompt mg-prompt" onClick={() => interactMiniGame()}>
          <Keycap k="E" /> {miniGameInfo(s.nearNpc.kind).icon} Play {miniGameInfo(s.nearNpc.kind).name} with 🤖 {s.nearNpc.name}
        </button>
      )}
      {playing && !s.mg && !s.nearInvite && !s.nearNpc && s.nearGame && (
        <button className="card prompt mg-prompt" onClick={() => interactMiniGame()}>
          <Keycap k="E" /> 👁 Watch {miniGameInfo(s.nearGame.kind).name}
        </button>
      )}
      {playing && !s.mg && !s.nearInvite && !s.nearNpc && !s.nearGame && s.nearAnimal && (
        <button className="card prompt mg-prompt" onClick={() => interactMiniGame()}>
          <Keycap k="E" /> {isAnimalKind(s.nearAnimal.kind) ? ANIMAL_ICON[s.nearAnimal.kind] : ''} Pet the {s.nearAnimal.kind}
        </button>
      )}
      {s.nearbyStall && playing && !s.touch && !s.nearInvite && !s.nearGame && !s.nearNpc && !s.nearAnimal && <div className="card prompt"><Keycap k="E" /> Open {s.nearbyStall.title} shop</div>}
      <SelfBubble />
      <Toast />
      {s.showHints && !s.touch && (
        <div className="card hints">
          <span><Keycap k="W" /><Keycap k="A" /><Keycap k="S" /><Keycap k="D" /> Move</span>
          <span><Keycap k="Space" /> Jump</span>
          <span><Keycap k="1–9" /> Build</span>
          <span><Keycap k="0" /> Destroy</span>
          <span><Keycap k="LMB" /> Use</span>
          <span><Keycap k="T" /> Choose blocks</span>
          <span><Keycap k="V" /> Camera</span>
          <span><Keycap k="E" /> Interact</span>
          <span><Keycap k="P" /> Games</span>
          <span><Keycap k="H" /> Hide</span>
        </div>
      )}
      {!s.touch && <div className="card mode"><Keycap k="V" /> {s.cameraMode === 'first' ? 'First person' : 'Third person'}</div>}
      {s.tool === 'none' && playing && !s.touch && (
        <div className="card hands">✋ Hands empty — <Keycap k="1–9" /> build · <Keycap k="0" /> destroy · <Keycap k="T" /> choose blocks</div>
      )}
      <div className={`card hotbar ${s.tool === 'none' ? 'idle' : ''}`}>
        {Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
          const id = s.profile.hotbar[i] ?? AIR;
          const def = getBlock(id);
          const icon = def ? getIconUrl(id) : null;
          return (
            <button key={i} className={`slot ${s.tool === 'block' && i === s.selectedSlot ? 'selected' : ''}`} onClick={() => s.selectTool(i)}>
              <span className="num">{i + 1}</span>
              {icon && <img src={icon} alt="" />}
              <span className="name">{def?.name ?? ''}</span>
            </button>
          );
        })}
        <button className={`slot destroy ${s.tool === 'destroy' ? 'selected' : ''}`} onClick={() => s.selectTool('destroy')}>
          <span className="num">0</span>
          <span className="tool-icon">🔨</span>
          <span className="name">Destroy</span>
        </button>
      </div>
    </div>
  );
}

function Toast() {
  const toast = useGame((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const h = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(h);
  }, [toast]);
  return <div className={`toast ${visible ? 'show' : ''}`}>{toast?.text}</div>;
}

/** In first person your own head bubble is out of view, so it is mirrored at the top of the screen. */
function SelfBubble() {
  const id = useGame((s) => s.sessionId);
  const bubble = useGame((s) => (id ? s.bubbles[id] : undefined));
  const mode = useGame((s) => s.cameraMode);
  const [, force] = useState(0);
  useEffect(() => {
    if (!bubble) return;
    const h = setTimeout(() => force((n) => n + 1), Math.max(0, (bubble.until - now()) * 1000) + 30);
    return () => clearTimeout(h);
  }, [bubble]);
  if (mode !== 'first' || !bubble || bubble.until <= now()) return null;
  return <div className="self-bubble">{bubble.emoji ?? bubble.text}</div>;
}
