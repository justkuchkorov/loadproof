// Human hand (21 MediaPipe points) -> Shadow Hand motor targets (radians).
//
// MediaPipe points: 0 wrist; thumb 1-4; index 5-8; middle 9-12; ring 13-16; little 17-20.
// The bend of a joint is the angle between the bone before it and the bone after it.

const sub = (a, b) => [a.x - b.x, a.y - b.y, a.z - b.z]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a) => Math.hypot(a[0], a[1], a[2]) || 1
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n] }
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))))
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

// Signed angle of v around axis n, measured from ref, after both are flattened onto the plane of n.
function signedAngleInPlane(v, ref, n) {
  const flat = (a) => { const d = dot(a, n); return [a[0] - d * n[0], a[1] - d * n[1], a[2] - d * n[2]] }
  const a = unit(flat(v))
  const b = unit(flat(ref))
  return Math.atan2(dot(cross(b, a), n), dot(a, b))
}

const FINGERS = {
  FF: [5, 6, 7, 8],    // index ("first finger")
  MF: [9, 10, 11, 12], // middle
  RF: [13, 14, 15, 16],
  LF: [17, 18, 19, 20], // little
}

// Spread sign per finger. In the human frame, spreading away from the middle finger is negative for the index
// and positive for ring and little; on the Shadow Hand, away from the middle is negative for all three.
const SPREAD_SIGN = { FF: 1, RF: -1, LF: -1 }

// Which side of the palm `cross(across, palmUp)` points to depends on left or right hand.
// PALM_SIDE[handedness] turns it into the normal that points out of the palm. Flip here if the thumb goes the wrong way.
export const PALM_SIDE = { Right: -1, Left: 1 }

// Returns { actuatorName: target } for the Shadow Hand.
export function retarget(p, handedness = 'Right') {
  const wrist = p[0]
  const palmUp = unit(sub(p[9], wrist))     // wrist -> middle knuckle
  const across = unit(sub(p[5], p[17]))     // little knuckle -> index knuckle
  const normal = unit(cross(across, palmUp))
  const s = PALM_SIDE[handedness] ?? -1
  const palmNormal = [s * normal[0], s * normal[1], s * normal[2]] // out of the palm side

  const out = {}
  for (const [name, [mcp, pip, dip, tip]] of Object.entries(FINGERS)) {
    const prox = sub(p[pip], p[mcp])
    const mid = sub(p[dip], p[pip])
    const dist = sub(p[tip], p[dip])
    // Knuckle bend: how far the first bone leaves the palm plane (the fan of the knuckles does not count).
    out[`rh_A_${name}J3`] = Math.atan2(Math.abs(dot(prox, normal)), dot(prox, palmUp))
    out[`rh_A_${name}J0`] = angle(prox, mid) + angle(mid, dist) // middle + tip bend, one tendon
    if (name !== 'MF') out[`rh_A_${name}J4`] = signedAngleInPlane(prox, palmUp, normal) * SPREAD_SIGN[name] * 0.8
  }
  out.rh_A_MFJ4 = 0
  out.rh_A_LFJ5 = clamp(out.rh_A_LFJ3 * 0.3, 0, 0.785)        // little-finger palm cup follows its bend

  // Thumb: 1 base, 2 knuckle, 3 middle, 4 tip.
  // On the Shadow Hand, THJ4 swings the thumb in front of the palm; THJ5 turns it across, toward the little finger.
  const thMeta = sub(p[2], p[1])
  const thProx = sub(p[3], p[2])
  const thDist = sub(p[4], p[3])
  const thDir = unit(sub(p[4], p[1]))
  const inFront = Math.asin(clamp(dot(thDir, palmNormal), -1, 1)) // radians out of the palm plane, palm side +
  const towardLittle = -dot(thDir, across)                        // +1 pointing at the little finger
  out.rh_A_THJ4 = clamp(inFront * 2.0 + 0.2, 0, 1.22)
  out.rh_A_THJ5 = clamp(towardLittle * 1.4 + 0.3, -1.05, 1.05)
  out.rh_A_THJ3 = 0
  out.rh_A_THJ2 = clamp(angle(thMeta, thProx) - 0.2, -0.7, 0.7)
  out.rh_A_THJ1 = clamp(angle(thProx, thDist), -0.26, 1.57)

  out.rh_A_WRJ1 = 0
  out.rh_A_WRJ2 = 0
  return out
}
