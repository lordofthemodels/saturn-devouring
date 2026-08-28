import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { makeAgent, STATE } from './init.js';
import { resolveCombat } from './combat.js';
import { Sim } from './sim.js';

const hazardSim = new Sim('flame-hazard-check');
const room = hazardSim.graph.node(hazardSim.graph.byId.get('cic'));
const form = makeAgent(FACTION.COMBAT, room.idx, hazardSim.graph);
form.hp = form.maxHp = 30;
form.x = room.x; form.y = room.y;
hazardSim.spawn(form);
hazardSim.t = 10;
const site = hazardSim.playerFlame(room.idx, room.x, room.y, 77);
assert.equal(site.expiresAt, 25, 'a fuel pool lasts no longer than fifteen seconds after contact');
assert.deepEqual([site.x, site.y], [room.x, room.y], 'the hazard starts at the aimed contact point');
const movedSite = hazardSim.playerFlame(room.idx, room.x + 1, room.y - 1, 77);
assert.equal(movedSite, site, 'one continuous stream reuses its bounded room patch');
assert.deepEqual([site.x, site.y], [room.x + 1, room.y - 1],
  'the live patch tracks the latest point of contact');
form.x = site.x; form.y = site.y;
hazardSim._fireDamage(1);
assert.ok(form.hp < 30, 'a live form touching the lingering pool takes fire damage');
const damagedHp = form.hp;
form.x += hazardSim.P.fire.radiusM + 1;
hazardSim._fireDamage(1);
assert.equal(form.hp, damagedHp, 'the pool does not damage a form outside its physical radius');
hazardSim.t = site.expiresAt;
form.x = site.x;
hazardSim._fireDamage(1);
assert.equal(form.hp, damagedHp, 'an expired pool stops damaging immediately');

const rangeSim = new Sim('flame-range-check');
for (const agent of rangeSim.agents) agent.dead = true;
const rangeRoom = [...rangeSim.graph.nodes].sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d))[0];
const marine = makeAgent(FACTION.MARINE, rangeRoom.idx, rangeSim.graph);
marine.hp = marine.maxHp = 100;
marine.state = STATE.FIGHT;
marine.flamer = true;
marine.fuel = 20;
const target = makeAgent(FACTION.COMBAT, rangeRoom.idx, rangeSim.graph);
target.hp = target.maxHp = 100;
const horizontal = rangeRoom.w >= rangeRoom.d;
marine.x = rangeRoom.x; marine.y = rangeRoom.y;
target.x = rangeRoom.x + (horizontal ? rangeSim.P.flamethrower.rangeM + 0.5 : 0);
target.y = rangeRoom.y + (horizontal ? 0 : rangeSim.P.flamethrower.rangeM + 0.5);
rangeSim.spawn(marine); rangeSim.spawn(target);
rangeSim._refreshOccupancy();
resolveCombat(rangeSim, rangeSim.dt);
assert.equal(marine.fuel, 20, 'a marine does not waste fuel beyond the stream range');

target.x = rangeRoom.x + (horizontal ? rangeSim.P.flamethrower.rangeM - 1 : 0);
target.y = rangeRoom.y + (horizontal ? 0 : rangeSim.P.flamethrower.rangeM - 1);
rangeSim._losAgentCache.clear();
rangeSim._refreshOccupancy();
resolveCombat(rangeSim, rangeSim.dt);
assert.ok(marine.fuel < 20, 'a marine fires once the target enters the finite range');
const marinePool = rangeSim.fires.find((fire) => fire.key === `marine:${marine.id}:${rangeRoom.idx}`);
assert.deepEqual(marinePool && [marinePool.x, marinePool.y], [target.x, target.y],
  'the marine pool lands on its target rather than the room center');

console.log('flamethrower contact, hazard, and range ✓');
