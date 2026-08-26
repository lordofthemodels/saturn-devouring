// A charge pose must be deterministic without consuming the gameplay RNG:
// animation variety should not change who hits, converts, or survives a seed.
export function combatChargeArmsHigh(id, chargeSequence) {
  let hash = (Math.imul(id, 0x9e3779b1) ^ Math.imul(chargeSequence, 0x85ebca6b)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash % 3 === 0;
}

// The raised rush is a wide Y, not two limbs crossing over the head. This
// lift is written against the combat models' A-pose; the small oscillation
// keeps the shoulders alive without collapsing the hands back together.
export function combatChargeArmLift(side, phase) {
  return -side * (1.88 + Math.sin(phase * 0.73 + side) * 0.08);
}
