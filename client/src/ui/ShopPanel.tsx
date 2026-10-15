import { listings, type ShopCategory } from '@jp/block-sandbox-shared';
import { useGame } from '../state/store';
import { getIconUrl } from '../render/textures';
import { send } from '../net/network';
import { openPanel } from '../game/pointer';

/** One-time unlocks: buy a block once and it's yours forever (no counts). All prices are 0 for now. */
export function ShopPanel() {
  const { shopTab, profile, selectedSlot, equip } = useGame();
  const items = listings(shopTab);
  const tab = (c: ShopCategory, label: string) => (
    <button className={`tab ${shopTab === c ? 'active' : ''}`} onClick={() => useGame.setState({ shopTab: c })}>{label}</button>
  );
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) openPanel('none'); }}>
      <div className="card panel shop">
        <header>
          <h2>Shop</h2>
          <div className="tabs">{tab('blocks', '🧱 Blocks')}{tab('decor', '🌼 Decor')}</div>
          <div className="coins">🪙 {profile.coins}</div>
          <button className="close" onClick={() => openPanel('none')}>✕</button>
        </header>
        <p className="hint">Get a block once and it goes into your bag forever. Press T to choose which blocks are on keys 1–9; click an owned block here to put it in slot {selectedSlot + 1}.</p>
        <div className="grid">
          {items.map((b) => {
            const owned = profile.owned.includes(b.id);
            const slot = profile.hotbar.indexOf(b.id);
            return (
              <div key={b.id} className={`item ${owned ? 'owned' : ''}`}>
                <img src={getIconUrl(b.id) ?? ''} alt="" />
                <div className="item-name">{b.name}</div>
                <div className="price">{b.price === 0 ? 'Free' : `🪙 ${b.price}`}</div>
                {owned
                  ? <button onClick={() => equip(b.id)}>{slot >= 0 ? `In slot ${slot + 1}` : 'Equip'}</button>
                  : <button className="primary" onClick={() => send('buy', { id: b.id })}>Get</button>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
