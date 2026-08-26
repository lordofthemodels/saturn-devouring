// Flood-held compartments breathe through open doors instead of ending at a
// flat room veil. Two bounded instance pools cover the whole ship: soft fog
// lobes and sparse brown spores. The cost is two draw calls regardless of how
// many nearby thresholds are active, and the quality ladder controls both caps.

import * as THREE from '../engine/vendor/three.webgpu.module.js';
import { DOOR_W, elevOf } from './world.js';

const MAX_WISPS = 56;
const MAX_MOTES = 20;
const RANGE2 = 34 * 34;

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const fract = (n) => n - Math.floor(n);
const noise = (doorIndex, slot, channel = 0) => fract(Math.sin(
  (doorIndex + 1) * 12.9898 + (slot + 1) * 78.233 + channel * 37.719,
) * 43758.5453);

// Geometry, not room names, decides which way the growth exhales. This keeps
// the effect correct when the deck plan changes or a new room is added.
export function sporeDoorFlow(graph, sim, door) {
  if (!door?.edge || door.open01 <= 0.04) return null;
  const fogA = sim.fogAt(door.edge.a);
  const fogB = sim.fogAt(door.edge.b);
  if (fogA === fogB) return null;
  const fogNode = fogA ? door.edge.a : door.edge.b;
  const clearNode = fogA ? door.edge.b : door.edge.a;
  const clear = graph.node(clearNode);
  const doorway = door.edge.door;
  let dx = clear.x - (doorway?.x ?? graph.node(fogNode).x);
  let dz = clear.y - (doorway?.y ?? graph.node(fogNode).y);
  let length = Math.hypot(dx, dz);
  if (length < 0.001) {
    const fog = graph.node(fogNode);
    dx = clear.x - fog.x;
    dz = clear.y - fog.y;
    length = Math.hypot(dx, dz);
  }
  if (length < 0.001) return null;
  return {
    fogNode, clearNode,
    dx: dx / length,
    dz: dz / length,
    openness: clamp01((door.open01 - 0.04) / 0.96),
  };
}

function fogTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 96, 96);
  // Several overlapping radial lobes make one billboard read as a ragged
  // volume rather than a circular sprite. This texture is generated once.
  const lobes = [
    [46, 53, 39, 0.78], [25, 58, 25, 0.58], [68, 59, 24, 0.56],
    [34, 34, 24, 0.46], [61, 31, 22, 0.42], [48, 72, 22, 0.38],
  ];
  for (const [x, y, radius, alpha] of lobes) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.48, `rgba(255,255,255,${alpha * 0.52})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return new THREE.CanvasTexture(canvas);
}

function moteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(8, 8, 0.5, 8, 8, 7.5);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,.75)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(canvas);
}

function pool(capacity, material) {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

export class SporeFX {
  constructor(scene, camera, world, sim) {
    this.camera = camera;
    this.world = world;
    this.sim = sim;
    this.t = 0;
    this.wispBudget = MAX_WISPS;
    this.moteBudget = MAX_MOTES;

    const fogMap = fogTexture();
    this.wisps = pool(MAX_WISPS, new THREE.MeshBasicMaterial({
      color: 0x4b533b,
      map: fogMap,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    }));
    this.wisps.renderOrder = 6;

    const moteMap = moteTexture();
    this.motes = pool(MAX_MOTES, new THREE.MeshBasicMaterial({
      color: 0x735033,
      map: moteMap,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    }));
    this.motes.renderOrder = 7;
    scene.add(this.wisps, this.motes);

    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._flow = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  setBudget(wisps, motes) {
    this.wispBudget = Math.max(0, Math.min(MAX_WISPS, wisps));
    this.moteBudget = Math.max(0, Math.min(MAX_MOTES, motes));
  }

  _stamp(mesh, slot, x, y, z, width, height) {
    this._position.set(x, y, z);
    this._scale.set(width, height, 1);
    this._matrix.compose(this._position, this.camera.quaternion, this._scale);
    mesh.setMatrixAt(slot, this._matrix);
  }

  _stampFloor(mesh, slot, x, y, z, dx, dz, width, length) {
    // Plane local X runs across the hatch and local Y runs out of it. Keeping
    // this lobe nearly on the deck joins the vertical puffs into one spill.
    this._side.set(-dz, 0, dx);
    this._flow.set(dx, 0, dz);
    this._matrix.makeBasis(this._side, this._flow, this._up);
    this._matrix.scale(this._scale.set(width, length, 1));
    this._matrix.setPosition(x, y, z);
    mesh.setMatrixAt(slot, this._matrix);
  }

  update(dt, povNode, povDeck, povX, povZ) {
    this.t += Math.min(dt, 0.1);
    const candidates = [];
    for (const door of this.world.doors) {
      if (door.deck !== povDeck) continue;
      const d2 = (door.x - povX) ** 2 + (door.z - povZ) ** 2;
      if (d2 > RANGE2) continue;
      const flow = sporeDoorFlow(this.world.graph, this.sim, door);
      if (flow) candidates.push({ door, flow, d2 });
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    let wispCount = 0;
    let moteCount = 0;
    for (const { door, flow } of candidates) {
      const doorIndex = door.edge.i ?? this.world.doors.indexOf(door);
      const open = 0.35 + flow.openness * 0.65;
      const sideX = -flow.dz;
      const sideZ = flow.dx;
      // A low irregular sheet gives the plume continuity across the sill. It
      // is still part of the same instance pool and therefore adds no draw.
      if (wispCount < this.wispBudget) {
        this._stampFloor(this.wisps, wispCount++,
          door.x + flow.dx * 0.05, door.elev + 0.07, door.z + flow.dz * 0.05,
          flow.dx, flow.dz, DOOR_W * 1.22 * open, 2.9 * open);
      }
      if (wispCount < this.wispBudget) {
        this._stampFloor(this.wisps, wispCount++,
          door.x - flow.dx * 0.18, door.elev + 0.2, door.z - flow.dz * 0.18,
          flow.dx, flow.dz, DOOR_W * 0.92 * open, 2.1 * open);
      }

      const layers = Math.min(6, this.wispBudget - wispCount);
      for (let slot = 0; slot < layers; slot++) {
        const progress = slot / 5;
        // Starts inside the infected room and crosses just over a metre into
        // clean air. The floor layers above keep those lobes visually joined.
        const distance = -1.15 + progress * 2.45;
        const phase = this.t * (0.15 + noise(doorIndex, slot, 1) * 0.08)
          + noise(doorIndex, slot, 2) * Math.PI * 2;
        const lateral = (noise(doorIndex, slot, 3) - 0.5) * DOOR_W * 0.62
          + Math.sin(phase) * 0.1;
        const x = door.x + flow.dx * distance + sideX * lateral;
        const z = door.z + flow.dz * distance + sideZ * lateral;
        const outside = clamp01(distance / 1.3);
        const y = door.elev + 0.34 + noise(doorIndex, slot, 4) * 1.15
          - outside * 0.22 + Math.sin(phase * 0.7) * 0.05;
        const width = (DOOR_W * (0.65 + noise(doorIndex, slot, 5) * 0.3)
          + outside * 0.36) * open;
        const height = (0.62 + noise(doorIndex, slot, 6) * 0.58) * open;
        this._stamp(this.wisps, wispCount++, x, y, z, width, height);
      }

      // Just a few brown flecks per threshold. Their motion is slow enough to
      // read as organic fallout, not sparks or a particle fountain.
      const doorMotes = Math.min(2, this.moteBudget - moteCount);
      for (let slot = 0; slot < doorMotes; slot++) {
        const phase = this.t * (0.35 + noise(doorIndex, slot, 7) * 0.18)
          + noise(doorIndex, slot, 8) * Math.PI * 2;
        const distance = -0.85 + noise(doorIndex, slot, 9) * 2.2;
        const lateral = (noise(doorIndex, slot, 10) - 0.5) * DOOR_W * open;
        const x = door.x + flow.dx * distance + sideX * lateral + Math.sin(phase) * 0.08;
        const z = door.z + flow.dz * distance + sideZ * lateral + Math.cos(phase * 0.8) * 0.07;
        const y = door.elev + 0.28 + noise(doorIndex, slot, 11) * 1.75
          + Math.sin(phase * 0.6) * 0.12;
        const size = 0.026 + noise(doorIndex, slot, 12) * 0.035;
        this._stamp(this.motes, moteCount++, x, y, z, size, size);
      }
      if (wispCount >= this.wispBudget && moteCount >= this.moteBudget) break;
    }

    // Inside the murk, a sparse camera-local field supplies the same texture
    // away from doorways. It is bounded by the remaining mote budget.
    if (this.sim.fogAt(povNode)) {
      const ambient = Math.min(8, this.moteBudget - moteCount);
      for (let slot = 0; slot < ambient; slot++) {
        const phase = this.t * (0.22 + noise(povNode, slot, 13) * 0.16)
          + noise(povNode, slot, 14) * Math.PI * 2;
        const radius = 1.2 + noise(povNode, slot, 15) * 3.4;
        const angle = noise(povNode, slot, 16) * Math.PI * 2 + phase * 0.14;
        const x = povX + Math.cos(angle) * radius;
        const z = povZ + Math.sin(angle) * radius;
        const y = elevOf(povDeck) + 0.25 + noise(povNode, slot, 17) * 2.1
          + Math.sin(phase) * 0.12;
        const size = 0.024 + noise(povNode, slot, 18) * 0.038;
        this._stamp(this.motes, moteCount++, x, y, z, size, size);
      }
    }

    this.wisps.count = wispCount;
    this.wisps.visible = wispCount > 0;
    this.wisps.instanceMatrix.needsUpdate = wispCount > 0;
    this.motes.count = moteCount;
    this.motes.visible = moteCount > 0;
    this.motes.instanceMatrix.needsUpdate = moteCount > 0;
  }
}
