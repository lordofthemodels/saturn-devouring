import assert from 'node:assert/strict';
import { StandardGamepad, halo3Actions, radialDeadzone, singleActionPress } from './gamepad.js';

function button(pressed = false, value = pressed ? 1 : 0) {
  return { pressed, value };
}

function pad({ index = 0, id = 'Xbox Controller', mapping = 'standard', axes = [0, 0, 0, 0], held = [] } = {}) {
  const buttons = Array.from({ length: 17 }, () => button());
  for (const index of held) buttons[index] = button(true);
  return { index, id, mapping, connected: true, axes, buttons };
}

assert.deepEqual(radialDeadzone(0.1, 0.1), [0, 0], 'stick drift stays inside the dead zone');
const [edgeX, edgeY] = radialDeadzone(1, 1);
assert.ok(Math.abs(Math.hypot(edgeX, edgeY) - 1) < 1e-9, 'diagonal input is radially clamped');
const [halfX, halfY] = radialDeadzone(0.565, 0.565);
assert.ok(halfX > 0.45 && halfX < 0.65 && halfY > 0.45 && halfY < 0.65,
  'usable travel is rescaled after the dead zone');

let pads = [pad({ held: [0] })];
const reader = new StandardGamepad({ getGamepads: () => pads });
let state = reader.poll();
assert.equal(state.connected, true);
assert.equal(state.held('a'), false, 'buttons held while the page loads are suppressed until release');
assert.equal(state.pressed('a'), false, 'a held while the page loads does not bleed into the game');

pads = [pad()];
state = reader.poll();
assert.equal(state.released('a'), false, 'a suppressed press does not leak a release edge');
pads = [pad({ held: [0, 7], axes: [0.8, -0.8, 0.5, -0.5] })];
state = reader.poll();
assert.equal(state.pressed('a'), true);
assert.equal(state.held('rt'), true);
assert.ok(state.moveX > 0 && state.moveY > 0, 'left stick maps right and forward');
assert.ok(state.lookX > 0 && state.lookY < 0, 'right stick preserves look direction');
assert.equal(state.navX, 1);
assert.equal(state.navY, -1);

pads = [pad({ held: [14, 13] })];
state = reader.poll();
assert.equal(state.navX, -1, 'D-pad overrides the navigation axis');
assert.equal(state.navY, 1, 'D-pad overrides the navigation axis');

pads = [];
assert.equal(reader.poll().connected, false);
pads = [pad({ index: 2, mapping: '', held: [3] })];
state = reader.poll();
assert.equal(state.connected, false, 'unknown HID layouts are not guessed from their shape');

let multiPads = [pad({ index: 0 }), pad({ index: 1 })];
const multiReader = new StandardGamepad({ getGamepads: () => multiPads });
assert.equal(multiReader.poll().id, 'Xbox Controller');
multiPads = [pad({ index: 0 }), pad({ index: 1, id: 'External Xbox Controller', held: [0] })];
state = multiReader.poll();
assert.equal(state.id, 'External Xbox Controller', 'deliberate input transfers ownership to another pad');
assert.equal(state.held('a'), false, 'the ownership-changing press is suppressed');
multiPads = [pad({ index: 0 }), pad({ index: 1, id: 'External Xbox Controller' })];
multiReader.poll();
multiPads = [pad({ index: 0 }), pad({ index: 1, id: 'External Xbox Controller', held: [0] })];
assert.equal(multiReader.poll().pressed('a'), true, 'a fresh press on the active pad is delivered');

const heldNames = new Set(['a', 'rb', 'rt']);
const pressedNames = new Set(['a', 'b', 'y', 'rb', 'lt']);
const actionState = {
  held: (name) => heldNames.has(name),
  pressed: (name) => pressedNames.has(name),
};
assert.deepEqual(halo3Actions(actionState, true), {
  jumpHeld: true,
  jumpPressed: true,
  fireHeld: true,
  grenadePressed: true,
  interactHeld: true,
  interactPressed: true,
  reloadPressed: false,
  meleePressed: true,
  swapPressed: true,
}, 'Halo 3 actions map to A/B/Y/RB/LT/RT and context outranks reload');
assert.equal(halo3Actions(actionState, false).reloadPressed, true,
  'RB reloads only when no contextual action is available');
assert.deepEqual(singleActionPress(true, true), { interactPressed: true, reloadPressed: false },
  'the shared action resolver gives a live interaction priority over reload');
assert.deepEqual(singleActionPress(true, false), { interactPressed: true, reloadPressed: true },
  'the shared action resolver reloads when no interaction is available');

console.log('gamepad input checks passed');
