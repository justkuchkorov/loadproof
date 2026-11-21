// The robot: a UR10e (Universal Robots' cobot, 1:5 like the whole cell) with a vacuum gripper, on a pedestal behind
// the pallet. It has the same skills as the hand had (move, grip, pick-and-place with checks), so the planner, the
// checks and the repair do not change. Every move is turned into joint angles by inverse kinematics (ik.js) and sent
// to the six joint motors; nothing is teleported.
import { createIK } from './ik.js'
import { BLOCKS } from './planner.js'
import { ARM, PALLET, PALLET_B, copyId, parkArm } from './pallet.js'

const SPEED = 0.22 // pad speed while travelling, m/s in the model
const CLEAR = 0.018 // pad (or held box) passes at least this far above anything
const KD = [0.4, 0.4, 0.25, 0.05, 0.05, 0.05] // joint damping of the motors, N m s/rad (model scale)

// Call once after loading the model: finds the joint angles of the parked pose (ARM.parkQ), and moves the motors'
// zero there, so with no command (ctrl = 0, as in every fresh test world) the arm HOLDS its parked pose.
// (A fresh world must still be put in that pose: parkArm in pallet.js.)
export function prepareArm(mujoco, model) {
  const ik = createIK(mujoco, model)
  const seed = ik.solve([0.26, 0, 0.2], 0, [-1.5708, -1.5708, 1.5708, -1.5708, -1.5708, 0], 300).q
  const parkQ = ik.solve(ARM.park, 0, seed, 300).q
  ARM.parkQ = parkQ
  for (let i = 0; i < 6; i++) {
    const kp = -model.actuator_biasprm[10 * i + 1] // the arm's six motors are the model's first six actuators
    model.actuator_biasprm[10 * i] = kp * parkQ[i] // force = kp (ctrl + park - q) - kd qdot
    model.actuator_ctrllimited[i] = 0
    // Damping matched to each joint (near critical): the menagerie values damp the small wrist joints about 20 times
    // too much, so their motors saturate on any speed error and the held box twists.
    model.actuator_biasprm[10 * i + 2] = -KD[i]
  }
  return parkQ
}

export function createArm({ mujoco, model, data, debug = () => {} }) {
  const O = mujoco.mjtObj
  const ik = createIK(mujoco, model)
  const body = (n) => mujoco.mj_name2id(model, O.mjOBJ_BODY.value, n)
  const site = mujoco.mj_name2id(model, O.mjOBJ_SITE.value, 'grasp_site')
  const S = () => [0, 1, 2].map((k) => data.site_xpos[3 * site + k])
  const P = (n) => { const b = body(n); return [0, 1, 2].map((k) => data.xpos[3 * b + k]) }
  const ff = KD.map((d, i) => d / -model.actuator_biasprm[10 * i + 1]) // damping / stiffness (s): feeding the joint speed forward removes the lag

  const parkQ = ARM.parkQ
  let goal = ARM.park.slice()
  let qT = parkQ.slice()
  let motion = null // { pts, i, t, seg }
  let waiters = []
  let time = 0
  let stopped = false
  let holding = null
  let ikErr = 0

  // Called every frame: move the goal along the path, turn it into joint angles, send them to the motors.
  function tick(dt) {
    time += dt
    if (motion) {
      let left = dt
      while (motion && left > 0) {
        const a = motion.pts[motion.i], b = motion.pts[motion.i + 1]
        const T = Math.max(0.02, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / motion.speed)
        const use = Math.min(left, T - motion.t)
        motion.t += use; left -= use
        const k = Math.min(1, motion.t / T)
        goal = a.map((v, j) => v + (b[j] - v) * k)
        if (k >= 1) {
          motion.i++; motion.t = 0
          if (motion.i >= motion.pts.length - 1) { const done = motion.resolve; motion = null; done() }
        }
      }
    }
    waiters = waiters.filter((w) => (w.until <= time ? (w.resolve(), false) : true))
    const prev = qT
    const sol = ik.solve(goal, 0, qT, 8)
    qT = sol.q; ikErr = sol.err
    for (let i = 0; i < 6; i++) data.ctrl[i] = qT[i] - parkQ[i] + (dt > 0 ? ff[i] * (qT[i] - prev[i]) / dt : 0)
  }

  const check = () => { if (stopped) throw new Error('stopped') }
  const along = (pts, speed = SPEED) => { check(); return new Promise((resolve) => { motion = { pts: [goal.slice(), ...pts], i: 0, t: 0, speed, resolve } }) }
  const glide = (to, sec) => along([to], Math.max(0.005, Math.hypot(...to.map((v, k) => v - goal[k])) / sec))
  const wait = (sec) => { check(); return new Promise((resolve) => waiters.push({ until: time + sec, resolve })) }

  // Vacuum on: hold the box to the pad in its current pose, kept level and square to the pallet grid.
  const pad = body('suction')
  const eq = (n) => mujoco.mj_name2id(model, O.mjOBJ_EQUALITY.value, 'grip_' + n)
  const qconj = (q) => [q[0], -q[1], -q[2], -q[3]]
  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]
  const qrot = (q, v) => qmul(qmul(q, [0, ...v]), qconj(q)).slice(1)
  const Q = (b) => [0, 1, 2, 3].map((k) => data.xquat[4 * b + k])
  function lock(n) {
    const e = eq(n), o = body(n)
    const rel = qrot(qconj(Q(pad)), [0, 1, 2].map((k) => data.xpos[3 * o + k] - data.xpos[3 * pad + k]))
    const q = Q(o)
    const yaw = Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]))
    const square = Math.round(yaw / Math.PI) * Math.PI
    const rq = qmul(qconj(Q(pad)), [Math.cos(square / 2), 0, 0, Math.sin(square / 2)])
    model.eq_data.set([0, 0, 0, ...rel, ...rq, 1], mujoco.mjNEQDATA * e)
    data.eq_active[e] = 1
    model.body_gravcomp[o] = 1 // payload set in the controller, as on a real UR: the motors carry the box without sagging
  }
  const unlock = (n) => { data.eq_active[eq(n)] = 0; model.body_gravcomp[body(n)] = 0 }
  const releaseAll = () => { for (const n of Object.keys(BLOCKS)) unlock(n) }

  // The lowest safe pad height above (x, y): over the tallest thing there, plus the held box hanging below the pad.
  const sizeOf = (n) => BLOCKS[n]?.size ?? BLOCKS['b' + n.slice(1)].size
  const others = () => Object.keys(BLOCKS).flatMap((n) => [n, copyId(n)]).filter((n) => n !== holding && P(n)[2] > -0.3)
  function clearAt(x, y) {
    const h = holding ? sizeOf(holding) : [0.024, 0.024, 0]
    let top = 0
    for (const n of others()) {
      const p = P(n), s = sizeOf(n)
      if (Math.abs(p[0] - x) < (s[0] + h[0]) / 2 + 0.012 && Math.abs(p[1] - y) < (s[1] + h[1]) / 2 + 0.012) top = Math.max(top, p[2] + s[2] / 2)
    }
    for (const pal of [PALLET, PALLET_B]) { // the pallets themselves
      if (Math.abs(pal.x - x) < (pal.sx + h[0]) / 2 + 0.012 && Math.abs(pal.y - y) < (pal.sy + h[1]) / 2 + 0.012) top = Math.max(top, pal.top)
    }
    return top + h[2] + CLEAR
  }

  // Like a real palletizer's path: the base turns and the arm reaches (round the robot, never through it), and the
  // pad stays above the skyline of what stands on the table; up first, down last.
  const [bx, by] = ARM.base
  const polar = (p) => [Math.atan2(p[1] - by, p[0] - bx), Math.hypot(p[0] - bx, p[1] - by)]
  async function moveTo(xyz) {
    const a = goal.slice()
    // Angles measured from straight behind the robot (0 .. 2 pi): the arm never turns through the direction behind
    // it, so its base joint never winds up against its limit (+-360 degrees).
    const around = (p) => { const [t, r] = polar(p); return [((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), r] }
    const [ta, ra] = around(a), [tb, rb] = around(xyz)
    const len = Math.abs(tb - ta) * Math.max(ra, rb) + Math.abs(rb - ra)
    const n = Math.max(2, Math.ceil(len / 0.01))
    const xy = Array.from({ length: n + 1 }, (_, i) => {
      const t = ta + (tb - ta) * i / n, r = Math.max(0.1, ra + (rb - ra) * i / n)
      return [bx + r * Math.cos(t), by + r * Math.sin(t)]
    })
    xy[0] = [a[0], a[1]]; xy[n] = [xyz[0], xyz[1]]
    const need = xy.map(([x, y]) => clearAt(x, y))
    const env = need.map((_, i) => Math.max(...need.slice(Math.max(0, i - 3), i + 4))) // look 3 cm ahead and behind
    const pts = [[a[0], a[1], Math.max(a[2], env[0])]]
    const floor = Math.min(a[2], xyz[2]) // no dipping between two high points
    for (let i = 1; i < n; i++) pts.push([xy[i][0], xy[i][1], Math.max(floor, env[i])])
    pts.push([xyz[0], xyz[1], Math.max(xyz[2], env[n])], xyz)
    await along(pts)
  }

  // Pick `obj` and set it down with its centre at `dest`. Checks the grab by measuring, retries up to 3 times.
  async function pickPlace(obj, dest) {
    let ok = false
    let tries = 0
    while (!ok && tries < 3) {
      tries++
      const p = P(obj)
      const top = p[2] + sizeOf(obj)[2] / 2
      await moveTo([p[0], p[1], top + 0.02])
      await glide([p[0], p[1], top - 0.001], 0.35) // pad on the box top
      await wait(0.1)
      lock(obj) // vacuum on
      holding = obj
      await wait(0.2)
      await glide([p[0], p[1], top + 0.03], 0.35)
      ok = P(obj)[2] > p[2] + 0.02 // did it really come up?
      debug(`${obj} try ${tries}: lifted to z ${P(obj)[2].toFixed(3)} -> ${ok ? 'holding' : 'NOT holding'}`)
      if (!ok) { unlock(obj); holding = null; await wait(0.3) }
    }
    if (!ok) return { ok: false, tries }

    // Closed loop on the BOX: the arm bends a little under the load, so measure where the box really is and shift
    // the goal by the error until the box itself is `up` metres above `dest`.
    const cap = (v) => Math.max(-0.02, Math.min(0.02, v)) // a box that slipped must not send the arm away
    const toward = (up) => { const o = P(obj); return [goal[0] + cap(dest[0] - o[0]), goal[1] + cap(dest[1] - o[1]), goal[2] + cap(dest[2] + up - o[2])] }
    const settle = async (up, times) => { for (let i = 0; i < times; i++) { await wait(0.15); await glide(toward(up), 0.25) } }
    { const s = S(), o = P(obj); await moveTo([dest[0] + s[0] - o[0], dest[1] + s[1] - o[1], dest[2] + s[2] - o[2] + 0.03]) }
    await settle(0.03, 2)
    await glide(toward(0.004), 0.5)
    await settle(0.002, 1)
    await wait(0.15)
    debug(`  lowered: box ${P(obj).map((v) => v.toFixed(3))}, dest ${dest.map((v) => v.toFixed(3))}`)
    unlock(obj) // vacuum off
    holding = null
    await wait(0.2)
    await glide([goal[0], goal[1], goal[2] + 0.03], 0.4)
    return { ok: true, tries }
  }

  const ARM_BODIES = new Set(['base', 'shoulder_link', 'upper_arm_link', 'forearm_link', 'wrist_1_link', 'wrist_2_link', 'wrist_3_link', 'suction'])
  function touching() {
    const out = []
    const name = (g) => mujoco.mj_id2name(model, O.mjOBJ_BODY.value, model.geom_bodyid[g])
    for (let i = 0; i < data.ncon; i++) {
      const c = data.contact.get(i)
      const a = name(c.geom1), b = name(c.geom2)
      c.delete()
      if (ARM_BODIES.has(a) !== ARM_BODIES.has(b) || (globalThis.SELF_TOUCH && ARM_BODIES.has(a) && ARM_BODIES.has(b))) out.push(a + "/" + b)
    }
    return [...new Set(out)].join(', ')
  }

  return {
    tick, pickPlace, P, S, touching,
    payloadKg: 12.5, // UR10e datasheet (universal-robots.com)
    get phase() { return { goal: goal.map((v) => v.toFixed(3)).join(","), holding, ikErr: (ikErr * 1000).toFixed(0) + " mm", q: qT.map((v) => v.toFixed(2)).join(" ") } },
    get busy() { return !!motion },
    home: () => moveTo(ARM.park),
    park() { if (!motion) moveTo(ARM.park).catch(() => {}) },
    // Stop: let the waiting skill wake up; its next move then throws 'stopped', so the agent ends cleanly.
    stop() { stopped = true; const m = motion, w = waiters; motion = null; waiters = []; holding = null; releaseAll(); m?.resolve(); w.forEach((x) => x.resolve()) },
    start() { stopped = false; goal = S() },
    // After mj_resetData the arm stands parked again (its motors hold the parked pose): match the controller to it.
    resetPose() { motion = null; waiters = []; holding = null; stopped = false; goal = ARM.park.slice(); qT = parkQ.slice(); parkArm(mujoco, model, data) },
  }
}
