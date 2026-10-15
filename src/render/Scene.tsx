import { useGame } from '../state/store';
import { Environment } from './Environment';
import { WorldMesh } from './WorldMesh';
import { LocalPlayer } from '../game/LocalPlayer';
import { LocalLabel, RemotePlayers, Shopkeepers } from './Characters';
import { GameTables } from './GameTables';

export function Scene() {
  const layout = useGame((s) => s.layout);
  if (!layout) return null;
  return (
    <>
      <Environment layout={layout} />
      <WorldMesh />
      <LocalPlayer />
      <LocalLabel />
      <RemotePlayers />
      <Shopkeepers layout={layout} />
      <GameTables />
    </>
  );
}
