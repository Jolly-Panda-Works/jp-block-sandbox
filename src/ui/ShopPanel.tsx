import { useEffect } from 'react';
import { listings } from '@jp/blocksy-shared';
import { useGame } from '../state/store';
import { getIconUrl } from '../render/textures';
import { send } from '../net/network';
import { openPanel } from '../game/pointer';

const TITLES = { blocks: { icon: '🧱', title: 'Block shop', hint: 'Building blocks: stone, wood, wool, glass…' },
  decor: { icon: '🌼', title: 'Decor shop', hint: 'Furniture, lanterns, flowers, fences and other decorations.' } } as const;

/**
 * The shop of the stall you are standing at (opened with E there): the Blocks stall sells building blocks,
 * the Decor stall sells decorations. It closes when you walk away. Unlocks are one-time and free for now.
 */
export function ShopPanel() {
  const { shopTab, profile, selectedSlot, equip, nearbyStall } = useGame();
  const items = listings(shopTab);
  const t = TITLES[shopTab];
  // Walked away from the stall → close the shop.
  useEffect(() => { if (!nearbyStall || nearbyStall.category !== shopTab) openPanel('none'); }, [nearbyStall, shopTab]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) openPanel('none'); }}>
      <div className="card panel shop">
        <header>
          <h2>{t.icon} {t.title}</h2>
          <div className="coins">🪙 {profile.coins}</div>
          <button className="close" onClick={() => openPanel('none')}>✕</button>
        </header>
        <p className="hint">{t.hint} Get an item once and it is yours forever. Press T to choose what is on keys 1–9; click an owned item here to put it in slot {selectedSlot + 1}.</p>
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
