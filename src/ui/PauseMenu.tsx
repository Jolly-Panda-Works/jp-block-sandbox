import { asset } from '../assets';
import { useState } from 'react';
import { MAX_NAME_LENGTH, sanitizeName } from '@jp/blocksy-shared';
import { saveName, useGame } from '../state/store';
import { send } from '../net/network';
import { platform } from '../net/platform';
import { inviteLink } from '../net/config';
import { openPanel } from '../game/pointer';
import { Keycap } from './Hud';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['Mouse', 'Look'],
  ['1–9', 'Hold a block (again = put away)'], ['0', 'Destroy tool'], ['Left click', 'Use: place / destroy'], ['Wheel', 'Next tool while building'],
  ['Q', 'Hands empty'], ['T', 'Build menu (choose blocks)'], ['V', 'First / third person'], ['E', 'Interact (shop stall)'],
  ['B', 'Shop'], ['C', 'Style'], ['G', 'Social'], ['H', 'Hide hints'], ['Esc', 'Menu / close'],
];

export function PauseMenu() {
  const { sensitivity, invertY, multiplayerId, showToast, name } = useGame();
  const [newName, setNewName] = useState(name);
  const rename = () => {
    const clean = sanitizeName(newName);
    saveName(clean);
    setNewName(clean);
    send('rename', { name: clean });
    if (platform.configured()) void platform.updateName(clean).catch(() => undefined);
    showToast(`You are now ${clean}`);
  };
  const invite = async () => {
    const link = inviteLink(multiplayerId);
    try { await navigator.clipboard.writeText(link); showToast('Invite link copied'); } catch { window.prompt('Invite link', link); }
  };
  return (
    <div className="overlay">
      <div className="card panel pause">
        <header><span className="muted">⚙️ Settings</span><img className="menu-logo" src={asset("blocksy-logo-light.png")} alt="Blocksy" /><h2>Menu</h2></header>
        <button className="primary wide" onClick={() => openPanel('none')}>Resume</button>
        <div className="pause-row">
          <button onClick={() => openPanel('shop')}>🧱 Shop</button>
          <button onClick={() => openPanel('customize')}>👕 Style</button>
          <button onClick={() => openPanel('build')}>🔨 Build</button>
          <button onClick={() => openPanel('social')}>😊 Social</button>
        </div>
        {multiplayerId && <button className="wide" onClick={invite}>🔗 Copy invite link</button>}
        <form className="setting" onSubmit={(e) => { e.preventDefault(); rename(); }}>
          <span>Your name</span>
          <input value={newName} maxLength={MAX_NAME_LENGTH} dir="auto" onChange={(e) => setNewName(e.target.value)} />
          <button disabled={!newName.trim() || sanitizeName(newName) === name}>Save</button>
        </form>
        <div className="setting">
          <span>Mouse sensitivity</span>
          <button onClick={() => useGame.setState({ sensitivity: Math.max(0.2, +(sensitivity - 0.1).toFixed(1)) })}>−</button>
          <b>{sensitivity.toFixed(1)}</b>
          <button onClick={() => useGame.setState({ sensitivity: Math.min(4, +(sensitivity + 0.1).toFixed(1)) })}>+</button>
        </div>
        <div className="setting">
          <span>Invert Y</span>
          <button onClick={() => useGame.setState({ invertY: !invertY })}>{invertY ? 'On' : 'Off'}</button>
        </div>
        <div className="controls">
          {CONTROLS.map(([k, v]) => <div key={k}><Keycap k={k} /> <span>{v}</span></div>)}
        </div>
      </div>
    </div>
  );
}
