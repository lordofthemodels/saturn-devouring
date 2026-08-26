import assert from 'node:assert/strict';
import { Sim } from '../sim/sim.js';
import { CLEAR_H, elevOf, floorBandOf } from '../shared/geometry.js';
import {
  exteriorObservationSpan,
  insideHullPoint,
  observationSideForRoom,
  observationWindowForRun,
} from './world.js';

for (let deck = 1; deck <= 5; deck++) {
  assert.equal(floorBandOf(elevOf(deck) + CLEAR_H / 2), deck,
    `deck ${deck} walls must remain in their physical render band`);
}
assert.equal(floorBandOf(elevOf(4) - 0.2), 5,
  'the expanded hangar airspace must remain on deck 5 below the deck-4 floor');
assert.equal(floorBandOf(elevOf(4) + 0.2), 4,
  'deck-4 geometry must become visible before a climber settles on deck 4');

const sim = new Sim('world-connector-check');
const { graph } = sim;
const connectors = graph.edges.filter((edge) => edge.doorA && edge.doorB && !edge.shared
  && graph.node(edge.a).deck === graph.node(edge.b).deck);
assert.ok(connectors.length, 'world fixture needs at least one non-flush room connector');

for (const edge of connectors) {
  const deck = graph.node(edge.a).deck;
  const x = (edge.doorA.x + edge.doorB.x) / 2;
  const y = (edge.doorA.y + edge.doorB.y) / 2;
  assert.equal(insideHullPoint(graph, deck, x, y), true,
    `${graph.node(edge.a).name} → ${graph.node(edge.b).name} connector must be inside the hull`);
}

const gym = graph.byId.get('gym');
const security = graph.byId.get('security');
const sideDoor = connectors.find((edge) => (edge.a === gym && edge.b === security)
  || (edge.a === security && edge.b === gym));
assert.ok(sideDoor, 'Gymnasium side-door fixture must remain a real connector');
const mx = (sideDoor.doorA.x + sideDoor.doorB.x) / 2;
const my = (sideDoor.doorA.y + sideDoor.doorB.y) / 2;
const dx = sideDoor.doorB.x - sideDoor.doorA.x;
const dy = sideDoor.doorB.y - sideDoor.doorA.y;
const length = Math.hypot(dx, dy);
assert.equal(insideHullPoint(graph, 3, mx - dy / length * 2, my + dx / length * 2), false,
  'containment must not widen a connector into the surrounding void');

const bridge = graph.node(graph.byId.get('bridge'));
assert.equal(observationSideForRoom(bridge), 'S', 'the bridge must face the outer command-deck hull');
assert.equal(exteriorObservationSpan(graph, bridge, 'S', bridge.x - 2, bridge.x + 2), true,
  'the bridge observation wall must be exposed to space');
const bridgeWindow = observationWindowForRun(graph, bridge,
  { key: 'S', horiz: true }, [[bridge.x - bridge.w / 2, bridge.x + bridge.w / 2]]);
assert.ok(bridgeWindow?.width >= 4, 'the bridge must receive a usable observation window');

const cic = graph.node(graph.byId.get('cic'));
assert.equal(exteriorObservationSpan(graph, cic, 'S', cic.x - 2, cic.x + 2), false,
  'an outboard compartment must block an interior room observation wall');
assert.equal(observationSideForRoom(graph.node(graph.byId.get('reactor'))), null,
  'hazard and power compartments must keep solid hull plating');

console.log('world connectors and observation windows ✓');
