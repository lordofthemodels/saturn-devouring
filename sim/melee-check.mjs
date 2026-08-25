import assert from 'node:assert/strict';
import { combatMeleeImpulse, humanDeathToCorpse, selectRifleTarget } from './combat.js';
import { PARAMS } from '../shared/params.js';
import { FACTION } from '../shared/agentBuffer.js';

const swing = PARAMS.combat.combatForm.swing;
const target = { x: 4, y: 3 };
const base = { x: 1, y: -1, heading: 0, charging: false, leaping: false, hoverY: 0 };
const standing = combatMeleeImpulse(base, target, swing);
const charging = combatMeleeImpulse({ ...base, charging: true }, target, swing);
const jumping = combatMeleeImpulse({ ...base, charging: true, leaping: true, hoverY: 0.8 }, target, swing);

assert.equal(standing.kind, 'melee');
assert.ok(Math.abs(Math.hypot(standing.dirX, standing.dirY) - 1) < 1e-9);
assert.ok(standing.speed < charging.speed && charging.speed < jumping.speed,
  'standing, charging, and jumping melee momentum must remain strictly ordered');
assert.ok(jumping.up > standing.up && jumping.spin > standing.spin && jumping.kick > standing.kick,
  'a jumping strike must loft and tumble a body harder than a standing strike');
assert.ok(standing.dirX > 0 && standing.dirY > 0, 'impact must point away from the attacker');

const far = { id: 10 }, near = { id: 20 }, newcomer = { id: 30 };
assert.equal(selectRifleTarget(undefined, [
  { target: far, range: 8 }, { target: near, range: 4 },
]).target, near, 'a fresh rifle acquisition must take the closest Flood form');
assert.equal(selectRifleTarget(near.id, [
  { target: near, range: 4 }, { target: newcomer, range: 4 },
]).target, near, 'an equal-range arrival must not make the shooter flick targets');
assert.equal(selectRifleTarget(near.id, [
  { target: near, range: 4 }, { target: newcomer, range: 3.9 },
]).target, newcomer, 'a newly closer form must take the shooter\'s attention');

const graph = { node: () => ({ x: 0, y: 0, deck: 1 }) };
const spawned = [];
const human = {
  id: 7, faction: FACTION.MARINE, state: 0, node: 0, x: 4, y: 3, deck: 1,
  lastHurtBy: 3, lastHurtTick: 12, deathImpulse: jumping,
};
humanDeathToCorpse({ graph, spawn: (agent) => spawned.push(agent) }, human);
assert.equal(spawned.length, 1);
assert.deepEqual(spawned[0].deathImpulse, jumping,
  'the fatal strike impulse must survive human-to-corpse conversion for the ragdoll');

console.log('melee physics ✓');
