import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { Scene } from './render/Scene';
import { Hud } from './ui/Hud';
import { JoinScreen } from './ui/JoinScreen';
import { ShopPanel } from './ui/ShopPanel';
import { CustomizePanel } from './ui/CustomizePanel';
import { SocialPanel } from './ui/SocialPanel';
import { BuildPanel } from './ui/BuildPanel';
import { PauseMenu } from './ui/PauseMenu';
import { clearHeld, installInput } from './game/input';
import { lockPointer, openPanel, takeSuppressPause, togglePanel } from './game/pointer';
import { useGame } from './state/store';

function onKey(code: string): void {
  const s = useGame.getState();
  if (s.phase !== 'playing') return;
  if (code === 'Escape') {
    if (s.panel !== 'none') s.setPanel('none'); // browsers don't allow re-locking from Escape; the overlay asks for a click
    return;
  }
  if (code === 'KeyB') return togglePanel('shop');
  if (code === 'KeyC') return togglePanel('customize');
  if (code === 'KeyT') return togglePanel('build');
  if (code === 'KeyG') return togglePanel('social');
  if (s.panel !== 'none') return;
  if (code === 'KeyH') useGame.setState({ showHints: !s.showHints });
  else if (code === 'KeyV') useGame.setState({ cameraMode: s.cameraMode === 'first' ? 'third' : 'first' });
  else if (code === 'KeyE' && s.nearbyStall) { useGame.setState({ shopTab: s.nearbyStall.category }); openPanel('shop'); }
  else if (code === 'Digit0' || code === 'Numpad0') s.selectTool('destroy');
  else if (/^(Digit|Numpad)[1-9]$/.test(code)) s.selectTool(Number(code.slice(-1)) - 1);
  else if (code === 'KeyQ' && s.tool !== 'none') s.setTool('none'); // put away
}

export function App() {
  const phase = useGame((s) => s.phase);
  const panel = useGame((s) => s.panel);

  useEffect(() => installInput(onKey), []);
  useEffect(() => {
    const change = () => {
      const locked = !!document.pointerLockElement;
      useGame.setState({ pointerLocked: locked });
      const suppressed = takeSuppressPause();
      if (locked) return;
      clearHeld();
      const s = useGame.getState();
      // Losing the lock without opening a panel means the player pressed Escape: show the pause menu.
      if (!suppressed && s.phase === 'playing' && s.panel === 'none') s.setPanel('pause');
    };
    document.addEventListener('pointerlockchange', change);
    return () => document.removeEventListener('pointerlockchange', change);
  }, []);

  if (phase !== 'playing') return <JoinScreen />;

  return (
    <div className="app">
      <Canvas className="game" shadows flat dpr={[1, 2]} camera={{ fov: 72, near: 0.05, far: 600 }} gl={{ antialias: true }}
        onPointerDown={() => { if (useGame.getState().panel === 'none') lockPointer(); }}>
        <Scene />
      </Canvas>
      <Hud />
      {panel === 'shop' && <ShopPanel />}
      {panel === 'customize' && <CustomizePanel />}
      {panel === 'social' && <SocialPanel />}
      {panel === 'build' && <BuildPanel />}
      {panel === 'pause' && <PauseMenu />}
    </div>
  );
}
