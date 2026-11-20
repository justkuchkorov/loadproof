// Shared control: you choose WHERE and WHEN (move your hand, close it); the robot does the precise part
// (centre over the object, go down, grip, lift; and put it down again when you open your hand).

export const FIST = {
  rh_A_FFJ3: 1.4, rh_A_FFJ0: 2.2, rh_A_MFJ3: 1.4, rh_A_MFJ0: 2.2, rh_A_RFJ3: 1.4, rh_A_RFJ0: 2.2,
  rh_A_LFJ3: 1.4, rh_A_LFJ0: 2.2, rh_A_THJ4: 1.2, rh_A_THJ5: 0.8, rh_A_THJ1: 1.0, rh_A_THJ2: 0.4,
}

const HOVER = 0.14     // grasp-point height while moving, metres above the table
const REACH = 0.05     // how close (sideways) the ring must be to an object to grab it
const CLOSE_AT = 2.2   // average finger bend that counts as "closed"
const OPEN_AT = 1.0    // ... and as "open" again
const PHASE = { down: 0.6, grip: 0.7, up: 0.6, place: 0.6, release: 0.5, rise: 0.5 } // seconds

export function createGrasp({ mujoco, model, data, objects }) {
  const body = Object.fromEntries(objects.map((n) => [n, mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)]))
  const restZ = Object.fromEntries(objects.map((n) => [n, data.xpos[3 * body[n] + 2]]))
  const pos = (n) => [data.xpos[3 * body[n]], data.xpos[3 * body[n] + 1], data.xpos[3 * body[n] + 2]]

  let state = 'free'
  let t = 0
  let held = null
  let from = null // [x, y, z] where the current move started

  function nearest(xy) {
    let best = null
    let bestD = REACH
    for (const n of objects) {
      const p = pos(n)
      const d = Math.hypot(p[0] - xy[0], p[1] - xy[1])
      if (d < bestD) { best = n; bestD = d }
    }
    return best
  }

  const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, k)))
  const go = (next) => { state = next; t = 0 }

  // xy: where your hand points on the table. curl: average finger bend (0 open .. ~3.9 fist).
  // Returns { goal: [x, y, z] for the grasp point, fingers: 'mirror' | 'fist' | 'open', state, near, held }.
  function update(dt, xy, curl, current) {
    t += dt
    // Hover above the tallest thing on the table (not counting what the hand holds), so the hand never sweeps into it.
    const hover = Math.max(HOVER, ...objects.filter((n) => n !== held).map((n) => pos(n)[2] + 0.11))
    const near = state === 'free' ? nearest(xy) : null
    let goal = [xy[0], xy[1], hover]
    let fingers = 'mirror'

    if (state === 'free') {
      if (near && curl > CLOSE_AT) { held = near; from = current; go('down') }
    }
    if (state === 'down') {
      const p = pos(held)
      goal = lerp(from, [p[0], p[1], p[2] + 0.01], t / PHASE.down)
      fingers = 'open'
      if (t >= PHASE.down) { from = goal; go('grip') }
    } else if (state === 'grip') {
      goal = from
      fingers = 'fist'
      if (t >= PHASE.grip) go('up')
    } else if (state === 'up') {
      goal = lerp(from, [from[0], from[1], hover], t / PHASE.up)
      fingers = 'fist'
      if (t >= PHASE.up) go('hold')
    } else if (state === 'hold') {
      fingers = 'fist'
      if (curl < OPEN_AT) { from = current; go('place') }
    } else if (state === 'place') {
      // Lower until the held object touches the table.
      const drop = pos(held)[2] - restZ[held]
      goal = lerp(from, [from[0], from[1], from[2] - drop + 0.005], t / PHASE.place)
      fingers = 'fist'
      if (t >= PHASE.place) { from = goal; go('release') }
    } else if (state === 'release') {
      goal = from
      fingers = 'open'
      if (t >= PHASE.release) go('rise')
    } else if (state === 'rise') {
      goal = lerp(from, [from[0], from[1], hover], t / PHASE.rise)
      fingers = 'open'
      if (t >= PHASE.rise) { held = null; go('free') }
    }
    return { goal, fingers, state, near, held }
  }

  return { update, get state() { return state } }
}
