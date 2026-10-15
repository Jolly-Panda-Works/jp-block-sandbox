import { AIR, HOTBAR_SLOTS, getBlock } from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { getIconUrl } from '../render/textures';
import { openPanel } from '../game/pointer';

/**
 * Build menu (T): pick up to 9 blocks from your bag (owned blocks) for keys 1–9.
 * Key 0 is always the destroy tool. Choose a slot, then click a block to put it there.
 */
export function BuildPanel() {
  const { profile, selectedSlot, tool, equip, clearSlot, selectSlot, setTool } = useGame();
  const bag = profile.owned.map((id) => getBlock(id)).filter((b) => !!b);
  const start = (t: 'block' | 'destroy' | 'none') => { setTool(t); openPanel('none'); };
  const put = (id: number) => {
    equip(id);
    // Move on to the next empty slot so filling the hotbar is just a row of clicks.
    const hotbar = useGame.getState().profile.hotbar;
    for (let k = 1; k <= HOTBAR_SLOTS; k++) {
      const i = (selectedSlot + k) % HOTBAR_SLOTS;
      if (hotbar[i] === AIR) { selectSlot(i); break; }
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) openPanel('none'); }}>
      <div className="card panel build">
        <header>
          <h2>🔨 Build</h2>
          <span className="hint inline">Pick a slot, then a block from your bag. Right-click a slot to empty it.</span>
          <button className="close" onClick={() => openPanel('none')}>✕</button>
        </header>

        <div className="build-slots">
          {Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
            const id = profile.hotbar[i] ?? AIR;
            const def = getBlock(id);
            return (
              <button key={i} className={`bslot ${i === selectedSlot ? 'selected' : ''}`} onClick={() => selectSlot(i)}
                onContextMenu={(e) => { e.preventDefault(); clearSlot(i); }} title={def?.name ?? 'Empty'}>
                <span className="num">{i + 1}</span>
                {def ? <img src={getIconUrl(id) ?? ''} alt="" /> : <span className="empty">+</span>}
                <span className="name">{def?.name ?? 'Empty'}</span>
              </button>
            );
          })}
          <div className="bslot destroy" title="Destroy tool">
            <span className="num">0</span><span className="tool-icon">🔨</span><span className="name">Destroy</span>
          </div>
        </div>

        <h3>Your bag <span className="count">{bag.length}</span></h3>
        {bag.length === 0 ? (
          <div className="empty-bag">
            Your bag is empty. Visit the 🧱 Blocks or 🌼 Decor stall at the market and press E — everything is free.
          </div>
        ) : (
          <div className="bag">
            {bag.map((b) => {
              const slot = profile.hotbar.indexOf(b!.id);
              return (
                <button key={b!.id} className={`bag-item ${slot >= 0 ? 'equipped' : ''}`} onClick={() => put(b!.id)}>
                  <img src={getIconUrl(b!.id) ?? ''} alt="" />
                  <span>{b!.name}</span>
                  {slot >= 0 && <span className="badge-slot">{slot + 1}</span>}
                </button>
              );
            })}
          </div>
        )}

        <footer>
          <button onClick={() => start('none')} className={tool === 'none' ? 'active-tool' : ''}>✋ Hands empty</button>
          <button onClick={() => start('destroy')} className={tool === 'destroy' ? 'active-tool' : ''}>🔨 Destroy (0)</button>
          <button className="primary" onClick={() => start('block')}>Build with slot {selectedSlot + 1}</button>
        </footer>
      </div>
    </div>
  );
}
