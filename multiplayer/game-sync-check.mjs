import assert from 'node:assert/strict';
import { CLIP, FLAG, FACTION } from '../shared/agentBuffer.js';
import { makeAgent } from '../sim/init.js';
import { Sim } from '../sim/sim.js';
import { createGameSync } from './game-sync.js';
import { PROTOCOL_VERSION } from './protocol.js';

const listeners = new Map();
const session = {
  did: 'did:b',
  roster: () => [{ did: 'did:a' }],
  on(kind, listener) {
    listeners.set(kind, listener);
    return () => listeners.delete(kind);
  },
  sendDirect: async () => {},
};

const sim = new Sim('multiplayer-hidden-transit-check');
const cic = sim.graph.byId.get('cic');
const players = new Map([
  ['did:a', sim.attachPlayer(cic, { odst: true })],
  ['did:b', sim.attachPlayer(cic, { odst: true })],
]);
const player = {
  agent: players.get('did:b'),
  x: 0,
  z: 0,
  deck: 1,
  yaw: 0,
  talking: false,
};
const world = {
  worldToSim: (x, z) => [x, z],
  simToWorld: (x, y) => [x, y],
  roomAt: () => cic,
};
const sync = createGameSync({
  session,
  world,
  sim,
  player,
  agents: { playerShot() {} },
  members: ['did:a', 'did:b'],
  host: 'did:a',
  hostOrder: ['did:a', 'did:b'],
  playerAgents: players,
});

const target = sim.agents.find((agent) => agent.faction === FACTION.INFECTION && !agent.dead);
assert.ok(target, 'fixture needs a live infection form');

const row = (hiddenTransit, agent = target, wasArmed = 0, ammoRounds = 0) => [
  agent.id, agent.faction, agent.state, agent.node,
  Math.round(agent.x * 1_000), Math.round(agent.y * 1_000), agent.deck,
  Math.round(agent.hp * 1_000), Math.round(agent.maxHp * 1_000), Math.round(agent.damage * 1_000),
  Math.round(agent.heading * 1_000), Math.round(agent.animTime * 1_000),
  0, 0, 0, 0, -1_000, 0, 0, 0, hiddenTransit, -1, -1_000, wasArmed, ammoRounds,
];
const direct = listeners.get('direct');
assert.equal(typeof direct, 'function', 'game sync must subscribe to direct packets');

direct({
  from: 'did:a',
  data: {
    v: PROTOCOL_VERSION,
    kind: 'state',
    from: 'did:a',
    authority: 'did:a',
    authorityTerm: 1,
    seq: 1,
    x: 2_000,
    z: 3_000,
    deck: 1,
    yaw: 0,
    hp: 45_000,
    speed: 4_000,
    body: 1,
    talk: 0,
  },
});
assert.equal(players.get('did:a').followSpeed, 4,
  'a remote player must publish real ground speed for walk/run animation');
assert.equal(sim._clipFor(players.get('did:a')), CLIP.RUN,
  'remote ground speed must select a locomotion clip instead of idle');
assert.equal(players.get('did:a').bodyType, 'female',
  'a remote player must retain the body selected in the lobby');
sim.writeBuffer();
const remoteIndex = Array.from(sim.buffer.id.slice(0, sim.buffer.count)).indexOf(players.get('did:a').id);
assert.equal(sim.buffer.flags[remoteIndex] & FLAG.MALE_PLAYER, 0,
  'the female selection must keep the female armed-crew render rig');

direct({
  from: 'did:a',
  data: {
    v: PROTOCOL_VERSION,
    kind: 'snapshot',
    from: 'did:a',
    authority: 'did:a',
    authorityTerm: 1,
    seq: 2,
    tick: sim.tickCount + 1,
    t: Math.round((sim.t + sim.dt) * 1_000),
    full: false,
    complete: true,
    agents: [row(1)],
    removed: [],
  },
});
assert.deepEqual(target.move, { layer: 'vent', hidden: true },
  'a peer must retain authority-owned hidden vent transit');
const targetIndex = Array.from(sim.buffer.id.slice(0, sim.buffer.count)).indexOf(target.id);
assert.notEqual(targetIndex, -1, 'hidden form must remain represented in the sim buffer');
assert.ok(sim.buffer.flags[targetIndex] & FLAG.EXPOSED,
  'hidden vent transit must be excluded from peer rendering and targeting');

direct({
  from: 'did:a',
  data: {
    v: PROTOCOL_VERSION,
    kind: 'snapshot',
    from: 'did:a',
    authority: 'did:a',
    authorityTerm: 1,
    seq: 3,
    tick: sim.tickCount + 1,
    t: Math.round((sim.t + sim.dt) * 1_000),
    full: false,
    complete: true,
    agents: [row(0)],
    removed: [],
  },
});
assert.equal(target.move, null, 'the form must reappear when the authority reports its exit');

direct({
  from: 'did:a',
  data: {
    v: PROTOCOL_VERSION,
    kind: 'snapshot',
    from: 'did:a',
    authority: 'did:a',
    authorityTerm: 1,
    seq: 4,
    tick: sim.tickCount + 1,
    t: Math.round((sim.t + sim.dt) * 1_000),
    full: false,
    complete: true,
    agents: [row(0)],
    removed: [],
    world: { grenadedrops: [[900, cic, 1, 2_000, 3_000, 2]] },
  },
});
assert.deepEqual(sim.grenadeDrops, [{ id: 900, node: cic, deck: 1, x: 2, y: 3, count: 2 }],
  'authority snapshots must recreate marine grenade drops on peers');

const remoteCorpse = makeAgent(FACTION.CORPSE, cic, sim.graph);
sim.spawn(remoteCorpse);
direct({
  from: 'did:a',
  data: {
    v: PROTOCOL_VERSION,
    kind: 'snapshot',
    from: 'did:a',
    authority: 'did:a',
    authorityTerm: 1,
    seq: 5,
    tick: sim.tickCount + 1,
    t: Math.round((sim.t + sim.dt) * 1_000),
    full: false,
    complete: true,
    agents: [row(0, remoteCorpse, 1, 120)],
    removed: [],
  },
});
assert.equal(remoteCorpse.wasArmed, true,
  'authority snapshots must preserve an armed corpse as an ammo source');
assert.equal(remoteCorpse.ammoRounds, 120,
  'authority snapshots must preserve the marine two-magazine drop');

sync.close();

const authorityListeners = new Map();
const authoritySession = {
  did: 'did:a',
  roster: () => [{ did: 'did:b' }],
  on(kind, listener) {
    authorityListeners.set(kind, listener);
    return () => authorityListeners.delete(kind);
  },
  sendDirect: async () => {},
};
const authoritySim = new Sim('multiplayer-grenade-pickup-check');
const authorityCic = authoritySim.graph.byId.get('cic');
const authorityPlayers = new Map([
  ['did:a', authoritySim.attachPlayer(authorityCic, { odst: true })],
  ['did:b', authoritySim.attachPlayer(authorityCic, { odst: true })],
]);
const remote = authorityPlayers.get('did:b');
authoritySim.grenadeDrops = [{
  id: 901, node: remote.node, deck: remote.deck, x: remote.x, y: remote.y, count: 2,
}];
const authoritySync = createGameSync({
  session: authoritySession,
  world,
  sim: authoritySim,
  player: { ...player, agent: authorityPlayers.get('did:a') },
  agents: { playerShot() {} },
  members: ['did:a', 'did:b'],
  host: 'did:a',
  hostOrder: ['did:a', 'did:b'],
  playerAgents: authorityPlayers,
});
authorityListeners.get('direct')({
  from: 'did:b',
  data: {
    v: PROTOCOL_VERSION, kind: 'grenadepickup', from: 'did:b',
    authority: 'did:a', authorityTerm: 1, seq: 1, dropId: 901, count: 1,
  },
});
assert.equal(authoritySim.grenadeDrops[0].count, 1,
  'authority must validate and consume a remote grenade pickup claim');
const ammoCorpse = makeAgent(FACTION.CORPSE, remote.node, authoritySim.graph);
ammoCorpse.x = remote.x;
ammoCorpse.y = remote.y;
ammoCorpse.wasArmed = true;
ammoCorpse.ammoRounds = 120;
authoritySim.spawn(ammoCorpse);
authorityListeners.get('direct')({
  from: 'did:b',
  data: {
    v: PROTOCOL_VERSION, kind: 'ammopickup', from: 'did:b',
    authority: 'did:a', authorityTerm: 1, seq: 2, corpseId: ammoCorpse.id, rounds: 120,
  },
});
assert.equal(ammoCorpse.wasArmed, false,
  'authority must validate and consume a remote marine-ammo pickup');
assert.equal(ammoCorpse.ammoRounds, 0,
  'a remote marine-ammo pickup cannot be collected twice');
authoritySync.close();

console.log('multiplayer hidden transit ✓');
