import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { humanDeathToCorpse } from './combat.js';
import { Sim } from './sim.js';
import { MA5 } from '../game/fps-data.js';

const sim = new Sim('supply-check');
const cic = sim.graph.byId.get('cic');
const player = sim.attachPlayer(cic, { odst: true });

assert.equal(MA5.reserve, 720, 'the player starts with twelve reserve magazines');

assert.equal(sim.armorPacks.filter((pack) => pack.id >= 300 && pack.id < 400).length, 3,
  'one player keeps three armory armor packs');
assert.equal(sim.armorPacks.filter((pack) => pack.id >= 400).length, 5,
  'scattered armor supply increases from four to five per player');

const marine = sim.agents.find((agent) => agent.faction === FACTION.MARINE && agent.frags > 0);
assert.ok(marine, 'fixture needs a grenade-carrying marine');
player.node = marine.node;
player.deck = marine.deck;
player.x = marine.x;
player.y = marine.y;
humanDeathToCorpse(sim, marine);
const marineBody = sim.agents.find((agent) => agent.faction === FACTION.CORPSE
  && agent.x === marine.x && agent.y === marine.y);
assert.equal(marineBody?.ammoRounds, 120, 'a dead marine drops two recoverable magazines');
assert.equal(sim.claimAmmoDrop(player, marineBody.id, 120), 120,
  'a nearby player can recover both marine magazines');
assert.equal(sim.claimAmmoDrop(player, marineBody.id, 120), 0,
  'a spent marine ammo drop cannot be collected twice');

const drop = sim.grenadeDrops[0];
assert.deepEqual(drop && { node: drop.node, deck: drop.deck, count: drop.count }, {
  node: marine.node, deck: marine.deck, count: marine.frags,
}, 'a marine drops every unused frag where he died');
assert.equal(sim.claimGrenadeDrop(player, drop.id, 1), 1, 'a nearby player can pick up one frag');
assert.equal(drop.count, marine.frags - 1, 'partial pickup leaves the remaining frag on deck');

player.x += sim.P.grenade.pickupRadiusM + 1;
assert.equal(sim.claimGrenadeDrop(player, drop.id, 1), 0, 'pickup refuses a player outside reach');
player.x = marine.x;
assert.equal(sim.claimGrenadeDrop(player, drop.id, sim.P.grenade.playerMax), marine.frags - 1,
  'a nearby player can collect the remainder');
assert.equal(drop.count, 0, 'an exhausted drop cannot be collected twice');

console.log('player supplies ✓');
