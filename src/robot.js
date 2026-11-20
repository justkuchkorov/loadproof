// The robot's own skills: move, grip (with the grip assist), pick-and-place with checks.
// Skills are async: they set a goal, then wait while the physics loop (tick) moves the hand there.
import { FIST } from './grasp.js'
import { BLOCKS } from './planner.js'

const HOVER = 0.14 // grasp-point height while travelling, metres above the table

export function createRobot({ mujoco, model, data, debug = () => {} }) {
  const O = mujoco.mjtObj
  const body = (n) => mujoco.mj_name2id(model, O.mjOBJ_BODY.value, n)
  const actuator = {}
  for (let i = 0; i < model.nu; i++) actuator[mujoco.mj_id2name(model, O.mjOBJ_ACTUATOR.value, i)] = i
  const site = mujoco.mj_name2id(model, O.mjOBJ_SITE.value, 'grasp_site')
  const S = () => [0, 1, 2].map((k) => data.site_xpos[3 * site + k])
  const P = (n) => { const b = body(n); return [0, 1, 2].map((k) => data.xpos[3 * b + k]) }
  const offset = S().map((v, k) => v - data.mocap_pos[k])

  let goal = S()
  let fingers = 'open'
  let motion = null
  let waiters = []
  let time = 0
  let stopped = false

  // Called every frame while the robot is in charge.
  function tick(dt) {
    time += dt
    if (motion) {
      motion.t += dt
      const k = Math.min(1, motion.t / motion.T)
      goal = motion.from.map((v, i) => v + (motion.to[i] - v) * k)
      if (k >= 1) { const done = motion.resolve; motion = null; done() }
    }
    waiters = waiters.filter((w) => (w.until <= time ? (w.resolve(), false) : true))
    for (let k = 0; k < 3; k++) data.mocap_pos[k] = goal[k] - offset[k]
    for (let i = 0; i < model.nu; i++) data.ctrl[i] = 0
    if (fingers === 'fist') for (const [n, v] of Object.entries(FIST)) data.ctrl[actuator[n]] = v
  }

  const check = () => { if (stopped) throw new Error('stopped') }
  const glide = (to, sec) => { check(); return new Promise((resolve) => { motion = { from: goal.slice(), to, t: 0, T: sec, resolve } }) }
  const wait = (sec) => { check(); return new Promise((resolve) => waiters.push({ until: time + sec, resolve })) }

  // Grip assist: lock the block to the palm in its current pose (like a magnet or suction gripper).
  const palm = body('rh_palm')
  const eq = (n) => mujoco.mj_name2id(model, O.mjOBJ_EQUALITY.value, 'grip_' + n)
  const qconj = (q) => [q[0], -q[1], -q[2], -q[3]]
  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]
  const qrot = (q, v) => qmul(qmul(q, [0, ...v]), qconj(q)).slice(1)
  const Q = (b) => [0, 1, 2, 3].map((k) => data.xquat[4 * b + k])
  function lock(n) {
    const e = eq(n)
    const o = body(n)
    const rel = qrot(qconj(Q(palm)), [0, 1, 2].map((k) => data.xpos[3 * o + k] - data.xpos[3 * palm + k]))
    const rq = qmul(qconj(Q(palm)), Q(o))
    const a = mujoco.mjNEQDATA * e // 12 numbers per constraint in MuJoCo 4.0
    const d = model.eq_data
    d.set([0, 0, 0, ...rel, ...rq, 1], a)
    data.eq_active[e] = 1
  }
  const unlock = (n) => { data.eq_active[eq(n)] = 0 }
  const releaseAll = () => { for (const n of Object.keys(BLOCKS)) unlock(n) }

  // Safe travel height: well above the tallest block on the table (not counting the one in the hand).
  let holding = null
  const travelZ = () => Math.max(HOVER + 0.05, ...Object.keys(BLOCKS).filter((n) => n !== holding).map((n) => P(n)[2] + BLOCKS[n].size[2] / 2 + 0.12))

  // Like a real arm: up to the travel height, across, then down. Never sweeps through what is already built.
  async function moveTo(xyz, sec) {
    const T = travelZ()
    if (goal[2] < T - 0.005) await glide([goal[0], goal[1], T], 0.5)
    await glide([xyz[0], xyz[1], Math.max(T, xyz[2])], sec)
    await glide(xyz, 0.6)
  }

  // Pick `obj` and set it down with its centre at `dest`. Checks the grab by measuring, retries up to 4 times.
  async function pickPlace(obj, dest) {
    let ok = false
    let tries = 0
    while (!ok && tries < 4) {
      tries++
      const p = P(obj)
      fingers = 'open'
      const top = p[2] + BLOCKS[obj].size[2] / 2 // aim at the box's TOP: boxes have different heights
      await moveTo([p[0], p[1], top + 0.045], 0.8)
      await wait(0.15)
      await glide([p[0], p[1], top - 0.015], 0.5)
      const s = S()
      const gap = Math.hypot(s[0] - P(obj)[0], s[1] - P(obj)[1]) // sideways distance, palm to box centre
      debug(`${obj} try ${tries}: block at ${p.map((v) => v.toFixed(3))}, palm-to-block ${(gap * 1000).toFixed(0)} mm, touching: ${touching()}`)
      if (gap < 0.035 && s[2] < top + 0.03) lock(obj) // palm on the box: grip assist on
      fingers = 'fist'
      await wait(0.5)
      holding = obj
      await glide([p[0], p[1], top + 0.05], 0.5)
      ok = P(obj)[2] > p[2] + 0.03 // did it really come up?
      debug(`  lifted: block z ${P(obj)[2].toFixed(3)} -> ${ok ? 'holding' : 'NOT holding'}`)
      if (!ok) { unlock(obj); holding = null; fingers = 'open'; await wait(0.4) }
    }
    if (!ok) return { ok: false, tries }

    // Closed loop on the BLOCK, not the palm: the arm sags under the load (about 1.5 cm), so measure where the
    // block really is and shift the goal by the error, until the block itself is `up` metres above `dest`.
    const toward = (up) => { const o = P(obj); return [goal[0] + dest[0] - o[0], goal[1] + dest[1] - o[1], goal[2] + dest[2] + up - o[2]] }
    const settle = async (up, times) => { for (let i = 0; i < times; i++) { await wait(0.25); await glide(toward(up), 0.35) } }
    { const s = S(); const o = P(obj); await moveTo([dest[0] + s[0] - o[0], dest[1] + s[1] - o[1], dest[2] + s[2] - o[2] + 0.06], 0.9) }
    await settle(0.06, 3)
    await glide(toward(0.03), 0.5)
    fingers = 'open'      // the grip assist holds the block, so the fingers can open: they would hit the table
    await wait(0.5)
    await settle(0.03, 2)
    await glide(toward(0.002), 0.6) // same sag as at 3 cm, so the last 2.8 cm come out right
    await wait(0.3)
    debug(`  lowered: block ${P(obj).map((v) => v.toFixed(3))}, dest ${dest.map((v) => v.toFixed(3))}, touching: ${touching()}`)
    unlock(obj)
    holding = null
    await wait(0.3)
    await glide([goal[0], goal[1], goal[2] + 0.06], 1.2)
    await wait(0.3)
    debug(`  after release: block at ${P(obj).map((v) => v.toFixed(3))}`)
    return { ok: true, tries }
  }

  function touching() {
    const out = []
    const name = (g) => mujoco.mj_id2name(model, O.mjOBJ_BODY.value, model.geom_bodyid[g])
    for (let i = 0; i < data.ncon; i++) {
      const c = data.contact.get(i)
      const a = name(c.geom1), b = name(c.geom2)
      c.delete()
      if ((a?.startsWith('rh_') || b?.startsWith('rh_')) && !(a?.startsWith('rh_') && b?.startsWith('rh_'))) out.push(a + '/' + b)
    }
    return [...new Set(out)].join(', ')
  }

  return {
    tick, pickPlace, P, S,
    home: () => moveTo([0.18, 0, travelZ()], 0.8),
    stop() { stopped = true; motion = null; waiters = []; fingers = 'open'; releaseAll() },
    start() { stopped = false; goal = S() },
  }
}
