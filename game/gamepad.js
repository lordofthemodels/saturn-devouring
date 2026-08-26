const STANDARD_BUTTONS = Object.freeze({
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  view: 8,
  menu: 9,
  leftStick: 10,
  rightStick: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  home: 16,
});

export const HALO3_BINDINGS = Object.freeze({
  jump: 'a',
  melee: 'b',
  swapWeapon: 'y',
  action: 'rb',
  grenade: 'lt',
  fire: 'rt',
});

export function halo3Actions(state, contextualAction = false) {
  return {
    jumpHeld: state.held(HALO3_BINDINGS.jump),
    jumpPressed: state.pressed(HALO3_BINDINGS.jump),
    fireHeld: state.held(HALO3_BINDINGS.fire),
    grenadePressed: state.pressed(HALO3_BINDINGS.grenade),
    interactHeld: state.held(HALO3_BINDINGS.action),
    interactPressed: state.pressed(HALO3_BINDINGS.action),
    reloadPressed: state.pressed(HALO3_BINDINGS.action) && !contextualAction,
    meleePressed: state.pressed(HALO3_BINDINGS.melee),
    swapPressed: state.pressed(HALO3_BINDINGS.swapWeapon),
  };
}

const EMPTY_STATE = Object.freeze({
  connected: false,
  id: '',
  mapping: '',
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  navX: 0,
  navY: 0,
  used: false,
  held: () => false,
  pressed: () => false,
  released: () => false,
});

export function radialDeadzone(x, y, inner = 0.18, outer = 0.95) {
  const magnitude = Math.hypot(x, y);
  if (!Number.isFinite(magnitude) || magnitude <= inner) return [0, 0];
  const span = Math.max(0.001, outer - inner);
  const scaled = Math.min(1, (Math.min(magnitude, outer) - inner) / span);
  return [x / magnitude * scaled, y / magnitude * scaled];
}

function curvedPair(x, y, exponent) {
  const magnitude = Math.hypot(x, y);
  if (!magnitude) return [0, 0];
  const curved = Math.pow(magnitude, exponent);
  return [x / magnitude * curved, y / magnitude * curved];
}

function buttonDown(button) {
  return !!button && (button.pressed || Number(button.value) >= 0.5);
}

function usablePad(pad) {
  return pad?.connected !== false && pad?.mapping === 'standard'
    && pad?.buttons?.length >= 16 && pad?.axes?.length >= 4;
}

export class StandardGamepad {
  constructor({ getGamepads, deadzone = 0.18, outerThreshold = 0.95 } = {}) {
    this.getGamepads = getGamepads ?? (() => globalThis.navigator?.getGamepads?.() ?? []);
    this.deadzone = deadzone;
    this.outerThreshold = outerThreshold;
    this.index = null;
    this.previousByIndex = new Map();
    this.suppressedByIndex = new Map();
  }

  poll() {
    const pads = [...(this.getGamepads() ?? [])].filter(usablePad);
    const snapshots = pads.map((pad) => ({
      pad,
      down: pad.buttons.map(buttonDown),
      previous: this.previousByIndex.get(pad.index),
    }));
    let selected = snapshots.find((snapshot) => snapshot.pad.index === this.index);
    const deliberate = (snapshot) => !!snapshot.previous && (
      snapshot.down.some((value, index) => value && !snapshot.previous[index])
      || Math.hypot(Number(snapshot.pad.axes[0]) || 0, Number(snapshot.pad.axes[1]) || 0) > 0.65
      || Math.hypot(Number(snapshot.pad.axes[2]) || 0, Number(snapshot.pad.axes[3]) || 0) > 0.65
    );
    const takeover = snapshots.find((snapshot) => snapshot !== selected && deliberate(snapshot));
    if (!selected || (!deliberate(selected) && takeover)) selected = takeover ?? snapshots[0];
    const pad = selected?.pad;
    if (!pad) {
      this.index = null;
      this.previousByIndex.clear();
      this.suppressedByIndex.clear();
      return EMPTY_STATE;
    }

    const changedPad = this.index !== pad.index;
    this.index = pad.index;
    const rawDown = selected.down;
    if (changedPad) {
      this.suppressedByIndex.set(pad.index,
        new Set(rawDown.flatMap((value, index) => value ? [index] : [])));
    }
    const suppressed = this.suppressedByIndex.get(pad.index) ?? new Set();
    const wasSuppressed = new Set(suppressed);
    for (const index of [...suppressed]) if (!rawDown[index]) suppressed.delete(index);
    const down = rawDown.map((value, index) => value && !suppressed.has(index));
    const previous = selected.previous ?? rawDown;
    const pressed = down.map((value, index) => value && !previous[index]);
    const released = rawDown.map((value, index) => (
      !value && !!previous[index] && !wasSuppressed.has(index)
    ));
    const online = new Set(pads.map((candidate) => candidate.index));
    for (const index of this.previousByIndex.keys()) {
      if (!online.has(index)) {
        this.previousByIndex.delete(index);
        this.suppressedByIndex.delete(index);
      }
    }
    for (const snapshot of snapshots) this.previousByIndex.set(snapshot.pad.index, snapshot.down);

    const [moveX, moveAxisY] = radialDeadzone(
      Number(pad.axes[0]) || 0,
      Number(pad.axes[1]) || 0,
      this.deadzone,
      this.outerThreshold,
    );
    const lookLinear = radialDeadzone(
      Number(pad.axes[2]) || 0,
      Number(pad.axes[3]) || 0,
      this.deadzone,
      this.outerThreshold,
    );
    const [lookX, lookY] = curvedPair(lookLinear[0], lookLinear[1], 1.6);
    const held = (name) => !!down[STANDARD_BUTTONS[name]];
    const justPressed = (name) => !!pressed[STANDARD_BUTTONS[name]];
    const justReleased = (name) => !!released[STANDARD_BUTTONS[name]];
    const navX = held('dpadLeft') ? -1 : held('dpadRight') ? 1
      : moveX < -0.55 ? -1 : moveX > 0.55 ? 1 : 0;
    const navY = held('dpadUp') ? -1 : held('dpadDown') ? 1
      : moveAxisY < -0.55 ? -1 : moveAxisY > 0.55 ? 1 : 0;
    const used = (changedPad && deliberate(selected)) || pressed.some(Boolean)
      || Math.hypot(moveX, moveAxisY) > 0.35
      || Math.hypot(lookX, lookY) > 0.35;

    return {
      connected: true,
      id: String(pad.id || 'Standard gamepad'),
      mapping: pad.mapping || '',
      moveX,
      moveY: -moveAxisY,
      lookX,
      lookY,
      navX,
      navY,
      used,
      held,
      pressed: justPressed,
      released: justReleased,
    };
  }
}
