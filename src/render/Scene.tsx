import { useGame } from '../state/store';
import { Environment } from './Environment';
import { WorldMesh } from './WorldMesh';
import { LocalPlayer } from '../game/LocalPlayer';
import { BotSeats, GameCenterNpcs, LocalLabel, RemotePlayers, Shopkeepers } from './Characters';
import { GameTables } from './GameTables';
import { Animals } from './Animals';
import { Particles } from './Particles';
import { CullUpdater, PerfGuard } from './PerfGuard';

export function Scene() {
  const layout = useGame((s) => s.layout);
  if (!layout) return null;
  return (
    <>
      <CullUpdater />
      <PerfGuard />
      <Environment layout={layout} />
      <WorldMesh />
      <LocalPlayer />
      <LocalLabel />
      <RemotePlayers />
      <Shopkeepers layout={layout} />
      <GameTables />
      <GameCenterNpcs layout={layout} />
      <BotSeats />
      <Animals />
      <Particles />
    </>
  );
}
