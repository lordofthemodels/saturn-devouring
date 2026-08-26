import assert from 'node:assert/strict';
import { FACTION } from '../shared/agentBuffer.js';
import { PARAMS } from '../shared/params.js';
import { openingInfectionFormCount } from './init.js';
import { Sim } from './sim.js';

assert.equal(openingInfectionFormCount(PARAMS.flood, 3), 12);
assert.equal(openingInfectionFormCount(PARAMS.flood, 4), 10);
assert.equal(openingInfectionFormCount(PARAMS.flood, 5, 4), 19);
assert.equal(openingInfectionFormCount(PARAMS.flood, 3, 4), 21);

const countForms = (sim) => sim.agents.filter((agent) => agent.faction === FACTION.INFECTION).length;
const cases = [
  { seed: 'charon-1', deck: 5, solo: 10 },
  { seed: 'opening-count-5', deck: 3, solo: 12 },
];

for (const testCase of cases) {
  for (const players of [1, 2, 4]) {
    const sim = new Sim(testCase.seed, null, { playerCount: players });
    assert.equal(sim.graph.node(sim.graph.breachNode).deck, testCase.deck);
    const expected = testCase.solo + (players - 1) * 3;
    assert.equal(sim.P.flood.initialInfectionForms, expected);
    assert.equal(countForms(sim), expected);
  }
}

const explicit = new Sim(
  'charon-1',
  { flood: { initialInfectionForms: 7 } },
  { playerCount: 4 },
);
assert.equal(explicit.P.flood.initialInfectionForms, 7);
assert.equal(countForms(explicit), 7);

console.log('opening infection count check ok');
