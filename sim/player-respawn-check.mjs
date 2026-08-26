import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent } from './init.js';
import { updateFloodTick } from './floodExec.js';
import { TASK } from './hive.js';
import { Sim } from './sim.js';

const sim = new Sim('player-respawn-check');
for (const agent of sim.agents) {
  if (agent.faction === FACTION.INFECTION || agent.faction === FACTION.COMBAT
    || agent.faction === FACTION.CARRIER) agent.dead = true;
}
const cic = sim.graph.byId.get('cic');
const anchor = sim.attachPlayer(cic, { odst: true });
const fallen = sim.attachPlayer(cic, { odst: true });
sim.hurtHuman(fallen, 1_000);

const body = sim.byId.get(fallen.afterlifeId);
assert.ok(body && body.faction === FACTION.CORPSE,
  'a dead player must retain a camera link to the physical corpse');
assert.equal(body.playerSourceId, fallen.id,
  'the corpse must retain the player lineage for later infection');

sim.t = fallen.respawnReadyAt;
const adjacent = [...sim.graph.neighbors(cic, ['std'], () => true)][0]?.to;
assert.notEqual(adjacent, undefined, 'fixture needs an adjacent room');
const threat = makeAgent(FACTION.COMBAT, adjacent, sim.graph);
threat.hp = threat.maxHp = 90;
sim.spawn(threat);
sim._respawnPlayers();
assert.equal(fallen.dead, true,
  'a Flood form in an adjacent room must block the revive');

threat.hp = 0; threat.downed = true; threat.damage = 95;
sim._respawnPlayers();
assert.equal(fallen.dead, true,
  'an unburned downed form must still make an adjacent room unsafe');

threat.damage = 100;
sim._respawnPlayers();
assert.equal(fallen.dead, false, 'a surviving teammate in a clear area must revive the player');
assert.equal(fallen.node, anchor.node, 'the player must return in the teammate room');
assert.equal(fallen.hp, fallen.maxHp, 'the returned player must have full health');
assert.equal(fallen.armor, sim.P.player.armor, 'the returned player must have fresh armor');
assert.equal(fallen.afterlifeId, -1, 'the live player must no longer follow the old body');

const conversionSim = new Sim('player-afterlife-conversion-check');
for (const agent of conversionSim.agents) {
  if (agent.faction === FACTION.INFECTION || agent.faction === FACTION.COMBAT
    || agent.faction === FACTION.CARRIER) agent.dead = true;
}
const conversionPlayer = conversionSim.attachPlayer(conversionSim.graph.byId.get('cic'), { odst: true });
conversionSim.hurtHuman(conversionPlayer, 1_000);
const conversionBody = conversionSim.byId.get(conversionPlayer.afterlifeId);
const pod = makeAgent(FACTION.INFECTION, conversionBody.node, conversionSim.graph);
pod.x = conversionBody.x; pod.y = conversionBody.y;
pod.task = { kind: TASK.CONVERT, corpseId: conversionBody.id };
pod.taskProgress = conversionSim.P.combat.burrowSec;
conversionSim.spawn(pod);
updateFloodTick(conversionSim, conversionSim.dt);
const wornBody = conversionSim.byId.get(conversionPlayer.afterlifeId);
assert.equal(wornBody?.faction, FACTION.COMBAT,
  'the camera link must transfer from the corpse to the infected combat form');
assert.equal(wornBody?.playerSourceId, conversionPlayer.id,
  'the infected body must retain the player lineage');
assert.equal(wornBody?.fromPlayer, true,
  'a player-derived combat form must never be converted into a carrier');

console.log('player respawn safety ✓');
