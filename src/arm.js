// The robot: a UR10e (Universal Robots' cobot, 1:5 like the whole cell) with a vacuum gripper, on a pedestal behind
// the pallet. It has the same skills as the hand had (move, grip, pick-and-place with checks), so the planner, the
// checks and the repair do not change. Every move is turned into joint angles by inverse kinematics (ik.js) and sent
// to the six joint motors; nothing is teleported.
import { createIK } from './ik.js'
import { BLOCKS } from './planner.js'
import { ARM, PALLET, PALLET_B, copyId, parkArm } from './pallet.js'

const SPEED = 0.22 // pad speed while travelling, m/s in the model
const ACC = 1.2 // speeding up and slowing down, m/s^2 (a UR's usual tool acceleration; same in the 1:5 model)
const CLEAR = 0.018 // pad (or held box) passes at least this far above anything
const KD = [0.4, 0.4, 0.25, 0.05, 0.05, 0.05] // joint damping of the motors, N m s/rad (model scale)
// The vacuum cup, in real size (our gripper's assumed specification): 12 cm across, 0.6 bar of vacuum.
// Holding force = vacuum x area = 60 kPa x pi x (6 cm)^2 = 679 N; with a safety factor of 2, 339 N may be used.
const SCALE = 0.2
const CUP_R = 0.012 // cup radius in the model (6 cm real)
export const CUP_N = Math.round(60e3 * Math.PI * (CUP_R / SCALE) ** 2 / 2)

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

// eye: the cell's depth camera (camera.js). With it the robot finds each box in the camera's picture, and knows the
// held box from its own joint angles plus the offset the camera measured at the pick. Without it (tests that want
// it so), it reads box positions from the simulation.
export function createArm({ mujoco, model, data, debug = () => {}, eye = null }) {
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
  // The force the cup must hold while carrying: the box's real mass times (its acceleration minus gravity), from its
  // measured velocity. Above CUP_N the seal breaks and the box drops.
  let carrying = false, vPrev = null, aF = null, cupPeak = 0, dropped = null
  let manual = null // a point a person steers the pad to (takeover.js); followed when no planned motion runs

  // Called every frame: move the goal along the path, turn it into joint angles, send them to the motors.
  function tick(dt) {
    time += dt
    if (motion) {
      // Speed up and slow down at ACC, like a robot controller's motion profile, instead of jumping to full speed.
      const m = motion
      m.v = Math.min(m.speed, m.v + ACC * dt, Math.sqrt(2 * ACC * Math.max(0, m.total - m.done)) + ACC * dt)
      let step = Math.max(m.v * dt, 1e-5)
      while (motion && step > 0) {
        const a = m.pts[m.i], b = m.pts[m.i + 1], len = m.lens[m.i]
        const use = Math.min(step, len - m.s)
        m.s += use; m.done += use; step -= use
        const k = len > 0 ? Math.min(1, m.s / len) : 1
        goal = a.map((v, j) => v + (b[j] - v) * k)
        if (k >= 1) {
          m.i++; m.s = 0
          if (m.i >= m.pts.length - 1) { motion = null; m.resolve() }
        }
      }
    }
    if (!motion && manual) { // followed in a straight line at the normal speed
      const d = manual.map((v, k) => v - goal[k]), dist = Math.hypot(...d)
      if (dist > 1e-5) goal = goal.map((v, k) => v + d[k] * Math.min(1, SPEED * dt / dist))
    }
    waiters = waiters.filter((w) => (w.until <= time ? (w.resolve(), false) : true))
    if (holding && carrying && dt > 0) {
      const v0 = model.jnt_dofadr[model.body_jntadr[body(holding)]]
      const vel = [0, 1, 2].map((k) => data.qvel[v0 + k])
      if (vPrev) {
        const a = vel.map((x, k) => (x - vPrev[k]) / dt)
        aF = aF ? aF.map((x, k) => x + 0.3 * (a[k] - x)) : a // smoothed over a few frames
        const need = kgOf(holding) * Math.hypot(aF[0], aF[1], aF[2] + 9.81)
        cupPeak = Math.max(cupPeak, need)
        if (need > CUP_N) { debug(`suction lost: ${holding} needed ${need.toFixed(0)} N`); dropped = holding; unlock(holding); holding = null; carrying = false }
      }
      vPrev = vel
    } else { vPrev = null; aF = null }
    const prev = qT
    const sol = ik.solve(goal, 0, qT, 8)
    qT = sol.q; ikErr = sol.err
    for (let i = 0; i < 6; i++) data.ctrl[i] = qT[i] - parkQ[i] + (dt > 0 ? ff[i] * (qT[i] - prev[i]) / dt : 0)
  }

  const check = () => { if (stopped) throw new Error('stopped') }
  const along = (pts, speed = SPEED) => {
    check()
    const all = [goal.slice(), ...pts]
    const lens = all.slice(1).map((b, i) => Math.hypot(...b.map((v, k) => v - all[i][k])))
    return new Promise((resolve) => { motion = { pts: all, lens, total: lens.reduce((x, y) => x + y, 0), done: 0, i: 0, s: 0, v: 0, speed, resolve } })
  }
  const glide = (to, sec) => along([to], Math.max(0.005, Math.hypot(...to.map((v, k) => v - goal[k])) / sec))
  const wait = (sec) => { check(); return new Promise((resolve) => waiters.push({ until: time + sec, resolve })) }

  // Vacuum on: hold the box to the pad in the pose it has (no correction), as a sealed cup does.
  const pad = body('suction')
  const padGeom = mujoco.mj_name2id(model, O.mjOBJ_GEOM.value, 'gripper_pad')
  const eq = (n) => mujoco.mj_name2id(model, O.mjOBJ_EQUALITY.value, 'grip_' + n)
  const qconj = (q) => [q[0], -q[1], -q[2], -q[3]]
  const qmul = (a, b) => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]
  const qrot = (q, v) => qmul(qmul(q, [0, ...v]), qconj(q)).slice(1)
  const Q = (b) => [0, 1, 2, 3].map((k) => data.xquat[4 * b + k])
  // A cup seals only when it touches the box and sits wholly on its top face (not over an edge).
  function sealed(n) {
    const o = body(n)
    let touch = false
    for (let i = 0; i < data.ncon && !touch; i++) {
      const c = data.contact.get(i)
      touch = (c.geom1 === padGeom && model.geom_bodyid[c.geom2] === o) || (c.geom2 === padGeom && model.geom_bodyid[c.geom1] === o)
      c.delete()
    }
    const R = data.xmat.subarray(9 * o, 9 * o + 9), d = S().map((v, k) => v - data.xpos[3 * o + k]), s = sizeOf(n)
    const lx = R[0] * d[0] + R[3] * d[1] + R[6] * d[2], ly = R[1] * d[0] + R[4] * d[1] + R[7] * d[2] // cup centre in the box frame
    const inside = Math.abs(lx) <= s[0] / 2 - CUP_R && Math.abs(ly) <= s[1] / 2 - CUP_R
    return { ok: touch && inside, touch, inside }
  }
  function lock(n) {
    const e = eq(n), o = body(n)
    const rel = qrot(qconj(Q(pad)), [0, 1, 2].map((k) => data.xpos[3 * o + k] - data.xpos[3 * pad + k]))
    const rq = qmul(qconj(Q(pad)), Q(o))
    model.eq_data.set([0, 0, 0, ...rel, ...rq, 1], mujoco.mjNEQDATA * e)
    data.eq_active[e] = 1
    model.body_gravcomp[o] = 1 // payload set in the controller, as on a real UR: the motors carry the box without sagging
  }
  const unlock = (n) => { data.eq_active[eq(n)] = 0; model.body_gravcomp[body(n)] = 0 }
  const releaseAll = () => { for (const n of Object.keys(BLOCKS)) unlock(n) }

  // The lowest safe pad height above (x, y): over the tallest thing there, plus the held box hanging below the pad.
  const sizeOf = (n) => BLOCKS[n]?.size ?? BLOCKS['b' + n.slice(1)].size
  const kgOf = (n) => BLOCKS[n]?.kg ?? BLOCKS['b' + n.slice(1)].kg // real kilograms
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

  // Where the order system expects each box: where it was put on the infeed (the scene's start pose), later where the
  // robot set it down. The camera looks there.
  const expected = {}
  const expectedAt = (n) => {
    if (expected[n]) return expected[n]
    const a = model.jnt_qposadr[model.body_jntadr[body(n)]]
    return [model.qpos0[a], model.qpos0[a + 1]]
  }
  let seen = null // the last box the camera found
  function look(obj) {
    if (!eye) { const p = P(obj); return { p, top: p[2] + sizeOf(obj)[2] / 2 } }
    const s = sizeOf(obj)
    const f = eye.find(expectedAt(obj), s, 0.1) ?? eye.find(expectedAt(obj), s, 0.2)
    if (!f) return null
    seen = f
    return { p: [f.x, f.y, f.top - s[2] / 2], top: f.top }
  }
  let grip = [0, 0, 0] // the held box's centre relative to the pad, as measured at the pick
  const est = (obj) => eye ? S().map((v, k) => v + grip[k]) : P(obj)

  // Pick `obj`: find it, put the cup on it, vacuum on, lift. Checks the grab (vacuum), retries up to 3 times.
  async function pick(obj) {
    let ok = false
    let tries = 0
    while (!ok && tries < 3) {
      tries++
      const at = look(obj)
      if (!at) { debug(`camera: ${obj} not found near ${expectedAt(obj).map((v) => v.toFixed(3))}`); return { ok: false, tries, unseen: true } }
      const { p, top } = at
      await moveTo([p[0], p[1], top + 0.02])
      await glide([p[0], p[1], top - 0.001], 0.35) // pad on the box top
      await wait(0.1)
      let seal = sealed(obj)
      if (!seal.ok && !seal.touch) { await glide([p[0], p[1], top - 0.003], 0.2); await wait(0.1); seal = sealed(obj) } // press a little more
      if (!seal.ok) { debug(`${obj} try ${tries}: no seal (${seal.touch ? 'cup over the edge' : 'cup not touching'})`); await glide([p[0], p[1], top + 0.03], 0.3); continue }
      grip = p.map((v, k) => v - S()[k]) // box centre relative to the pad, from the camera's measurement
      lock(obj) // vacuum on
      holding = obj
      await wait(0.2)
      await glide([p[0], p[1], top + 0.03], 0.35)
      ok = P(obj)[2] > p[2] + 0.02 // the vacuum sensor: did the box come up with the cup?
      debug(`${obj} try ${tries}: lifted -> ${ok ? 'holding' : 'NOT holding'}`)
      if (!ok) { unlock(obj); holding = null; await wait(0.3) }
    }
    if (!ok) return { ok: false, tries }
    cupPeak = 0; dropped = null; carrying = true
    return { ok: true, tries }
  }

  // Set the held box `obj` down with its centre at `dest`.
  async function place(obj, dest, tries = 1) {
    if (dropped || holding !== obj) return { ok: false, tries, dropped: !!dropped, cupN: Math.round(cupPeak) }
    // Closed loop on the BOX: the arm bends a little under the load, so measure where the box really is and shift
    // the goal by the error until the box itself is `up` metres above `dest`.
    const cap = (v) => Math.max(-0.02, Math.min(0.02, v)) // a box that slipped must not send the arm away
    const toward = (up) => { const o = est(obj); return [goal[0] + cap(dest[0] - o[0]), goal[1] + cap(dest[1] - o[1]), goal[2] + cap(dest[2] + up - o[2])] }
    const settle = async (up, times) => { for (let i = 0; i < times; i++) { await wait(0.15); await glide(toward(up), 0.25) } }
    { const s = S(), o = est(obj); await moveTo([dest[0] + s[0] - o[0], dest[1] + s[1] - o[1], dest[2] + s[2] - o[2] + 0.03]) }
    carrying = false
    if (dropped) return { ok: false, tries, dropped: true, cupN: Math.round(cupPeak) }
    await settle(0.03, 2)
    await glide(toward(0.004), 0.5)
    await settle(0.002, 1)
    await wait(0.15)
    debug(`  lowered: box ${P(obj).map((v) => v.toFixed(3))}, dest ${dest.map((v) => v.toFixed(3))}`)
    unlock(obj) // vacuum off
    holding = null
    expected[obj] = [dest[0], dest[1]]
    await wait(0.2)
    await glide([goal[0], goal[1], goal[2] + 0.03], 0.4)
    return { ok: true, tries, cupN: Math.round(cupPeak) }
  }

  // Pick `obj` and set it down with its centre at `dest`.
  async function pickPlace(obj, dest) {
    const r = await pick(obj)
    return r.ok ? place(obj, dest, r.tries) : r
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
    tick, pickPlace, pick, place, clearAt, P, S, touching,
    steer(p) { manual = p ? p.slice() : null }, // the takeover's target for the pad (null: stop following)
    get goal() { return goal.slice() },
    get holding() { return holding },
    payloadKg: 12.5, // UR10e datasheet (universal-robots.com)
    cupN: CUP_N,
    get seen() { return seen },
    hasEye: !!eye,
    get phase() { return { goal: goal.map((v) => v.toFixed(3)).join(","), holding, ikErr: (ikErr * 1000).toFixed(0) + " mm", q: qT.map((v) => v.toFixed(2)).join(" ") } },
    get busy() { return !!motion },
    home: () => moveTo(ARM.park),
    park() { if (!motion) moveTo(ARM.park).catch(() => {}) },
    // Stop: let the waiting skill wake up; its next move then throws 'stopped', so the agent ends cleanly.
    stop() { manual = null; stopped = true; const m = motion, w = waiters; motion = null; waiters = []; holding = null; carrying = false; releaseAll(); m?.resolve(); w.forEach((x) => x.resolve()) },
    start() { stopped = false; goal = S() },
    // After mj_resetData the arm stands parked again (its motors hold the parked pose): match the controller to it.
    resetPose() { motion = null; waiters = []; holding = null; stopped = false; goal = ARM.park.slice(); qT = parkQ.slice(); for (const k of Object.keys(expected)) delete expected[k]; parkArm(mujoco, model, data) },
  }
}
