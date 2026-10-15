import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { touch } from '../game/input';
import { useGame, selectedBlock } from '../state/store';
import { getIconUrl } from '../render/textures';
import { openPanel } from '../game/pointer';
import { toLocalDelta } from '../game/orientation';

const JOY_RADIUS = 52;
/** Radians per CSS pixel of drag is LOOK_SPEED × this (touch drags are shorter than mouse sweeps). */
const TOUCH_LOOK_SCALE = 1.7;

/** Drag anywhere on the free screen area to look around. Each finger is tracked separately. */
export function LookArea() {
  const last = useRef(new Map<number, { x: number; y: number }>());
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const p = last.current.get(e.pointerId);
    if (!p) return;
    const [dx, dy] = toLocalDelta(e.clientX - p.x, e.clientY - p.y);
    touch.lookDX += dx * TOUCH_LOOK_SCALE;
    touch.lookDY += dy * TOUCH_LOOK_SCALE;
    p.x = e.clientX; p.y = e.clientY;
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => { last.current.delete(e.pointerId); };
  return <div className="look-area" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />;
}

/** Virtual joystick (bottom-left), as in the references. Up = forward. */
function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const update = (e: RPointerEvent<HTMLDivElement>) => {
    const r = base.current!.getBoundingClientRect();
    let [dx, dy] = toLocalDelta(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    const len = Math.hypot(dx, dy);
    if (len > JOY_RADIUS) { dx *= JOY_RADIUS / len; dy *= JOY_RADIUS / len; }
    setKnob({ x: dx, y: dy });
    touch.moveX = dx / JOY_RADIUS;
    touch.moveY = -dy / JOY_RADIUS;
  };
  const release = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    touch.moveX = 0; touch.moveY = 0;
  };
  return (
    <div ref={base} className="joystick"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); active.current = e.pointerId; update(e); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) update(e); }}
      onPointerUp={release} onPointerCancel={release}>
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

/** Touch layout: look area, joystick, jump, use (place/remove), camera and interact buttons. */
export function TouchControls() {
  const tool = useGame((s) => s.tool);
  const held = useGame(selectedBlock);
  const nearby = useGame((s) => s.nearbyStall);
  const cameraMode = useGame((s) => s.cameraMode);
  const icon = tool === 'block' && held ? getIconUrl(held) : null;

  const useDown = (e: RPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'none') { openPanel('build'); return; } // empty hands: the button opens the build menu
    touch.usePressed = true;
    touch.useHeld = true;
  };
  const useUp = () => { touch.useHeld = false; };

  const inMg = useGame((st) => !!st.mg || (!!st.lobby && st.lobby.hostId !== st.sessionId));
  if (inMg) return <LookArea />; // in a mini-game you can only look around
  if (cameraMode === 'free') {
    const hold = (k: 'flyUp' | 'flyDown', v: boolean) => () => { touch[k] = v; };
    return (
      <>
        <LookArea />
        <Joystick />
        <div className="touch-buttons">
          <button className="touch-btn small" onPointerDown={() => { touch.flyUp = touch.flyDown = false; useGame.setState({ cameraMode: 'first' }); }}>🎥<span>back</span></button>
          <button className="touch-btn small" onPointerDown={hold('flyDown', true)} onPointerUp={hold('flyDown', false)} onPointerCancel={hold('flyDown', false)}>⬇<span>Down</span></button>
          <button className="touch-btn jump" onPointerDown={hold('flyUp', true)} onPointerUp={hold('flyUp', false)} onPointerCancel={hold('flyUp', false)}>⬆<span>Up</span></button>
        </div>
      </>
    );
  }
  return (
    <>
      <LookArea />
      <Joystick />
      <div className="touch-buttons">
        {nearby && (
          <button className="touch-btn small" onPointerDown={() => { useGame.setState({ shopTab: nearby.category }); openPanel('shop'); }}>
            🛒<span>{nearby.title}</span>
          </button>
        )}
        <button className="touch-btn small" onPointerDown={() => useGame.setState({ cameraMode: cameraMode === 'first' ? 'third' : cameraMode === 'third' ? 'free' : 'first' })}>
          🎥<span>{cameraMode === 'first' ? '1st' : cameraMode === 'third' ? '3rd' : 'free'}</span>
        </button>
        <button className={`touch-btn use ${tool}`} onPointerDown={useDown} onPointerUp={useUp} onPointerCancel={useUp}>
          {tool === 'destroy' ? '🔨' : icon ? <img src={icon} alt="" /> : tool === 'block' ? '➕' : '✋'}
          <span>{tool === 'destroy' ? 'Remove' : tool === 'block' ? 'Place' : 'Build'}</span>
        </button>
        <button className="touch-btn jump" onPointerDown={() => { touch.jump = true; }}>⬆<span>Jump</span></button>
      </div>
    </>
  );
}
