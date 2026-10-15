import { useGame } from '../state/store';
import { openPanel } from '../game/pointer';
import { Keycap } from './Hud';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['Mouse', 'Look'],
  ['1–9', 'Hold a block (again = put away)'], ['0', 'Destroy tool'], ['Left click', 'Use: place / destroy'], ['Wheel', 'Next tool while building'],
  ['Q', 'Hands empty'], ['T', 'Build menu (choose blocks)'], ['V', 'First / third person'], ['E', 'Interact (shop stall)'],
  ['B', 'Shop'], ['C', 'Style'], ['G', 'Social'], ['H', 'Hide hints'], ['Esc', 'Menu / close'],
];

export function PauseMenu() {
  const { sensitivity, invertY } = useGame();
  return (
    <div className="overlay">
      <div className="card panel pause">
        <header><h2>Menu</h2></header>
        <button className="primary wide" onClick={() => openPanel('none')}>Resume</button>
        <div className="pause-row">
          <button onClick={() => openPanel('shop')}>🧱 Shop</button>
          <button onClick={() => openPanel('customize')}>👕 Style</button>
          <button onClick={() => openPanel('build')}>🔨 Build</button>
          <button onClick={() => openPanel('social')}>😊 Social</button>
        </div>
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
