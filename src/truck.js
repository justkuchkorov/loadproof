// Live truck test, after EUMOS 40509: push everything on the table at 0.5 g, like a truck swerving and braking,
// then measure how far each block moved. Pass: every block moved less than 5% of the load's height.
//
// Inside the moving truck, a push at 0.5 g feels like gravity tilted sideways by half its strength,
// so the test tilts MuJoCo's gravity for 0.6 s per push, then lets everything settle.
import * as THREE from 'three'
import { BLOCKS } from './planner.js'
import { PALLET, PALLET_B, copyId } from './pallet.js'

const G = 9.81
const PUSHES = [
  { name: 'swerve', dir: [0, -1] }, // the load is pushed to the right of the screen
  { name: 'brake', dir: [1, 0] },   // the load is pushed forward
]
const PUSH_TIME = 0.6
const SETTLE_TIME = 1.2
const PARK_TIME = 1.5 // first the hand moves away and everything goes still; nothing may touch the load
const SLOW = 0.3      // slow motion during the pushes, so you can watch the load tilt
const near = (pal) => (p) => Math.abs(p[0] - pal.x) < 0.12 && Math.abs(p[1] - pal.y) < 0.13 && p[2] > -0.3
const AREAS = [{ name: 'LoadProof pallet', test: near(PALLET) }, { name: 'rushed pallet', test: near(PALLET_B) }]

export function createTruckTest({ mujoco, model, data, scene, log }) {
  const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
  const P = (n) => { const b = body(n); return [0, 1, 2].map((k) => data.xpos[3 * b + k]) }
  const normal = Array.from(model.opt.gravity)

  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(PALLET.x, PALLET.y, 0.26), 0.16, 0xf85149, 0.05, 0.035)
  arrow.visible = false
  scene.add(arrow)

  let run = null // { t, step, before, groups, accel }
  let last = null // the last finished test, for the report

  // Every box name, copies included (a copy exists for every box of the order).
  const allNames = () => Object.keys(BLOCKS).flatMap((n) => [n, copyId(n)])
  const sizeOf = (n) => BLOCKS[n]?.size ?? BLOCKS['b' + n.slice(1)].size
  const nameOf = (n) => BLOCKS[n]?.name ?? BLOCKS['b' + n.slice(1)].name

  function start(accel = 0.5) {
    const groups = AREAS.map((a) => ({ ...a, names: allNames().filter((n) => a.test(P(n))) })).filter((g) => g.names.length)
    if (groups.length === 0) { log('fail', 'Truck test: nothing on a pallet to test'); return false }
    for (const g of groups) g.height = Math.max(...g.names.map((n) => P(n)[2] + sizeOf(n)[2] / 2))
    run = { t: 0, step: -1, before: null, groups, accel }
    log('step', `🚚 Truck test at ${accel} g: robot parked, then ${PUSHES.map((p) => p.name).join(', then ')} (${groups.map((g) => `${g.name} ${(g.height * 100 * 5).toFixed(0)} cm tall`).join('; ')})`)
    return true
  }

  // Called every frame while a test runs. Returns true while it is still running.
  function tick(dt) {
    if (!run) return false
    run.t += dt
    if (run.step === -1) { // parking: no push yet
      if (run.t < PARK_TIME) return true
      run.before = Object.fromEntries(run.groups.flatMap((g) => g.names).map((n) => [n, P(n)])) // start positions, measured when still
      run.step = 0
      run.t = 0
    }
    const push = PUSHES[run.step]
    const pushing = run.t < PUSH_TIME
    model.opt.gravity.set(pushing ? [push.dir[0] * run.accel * G, push.dir[1] * run.accel * G, -G] : normal)
    arrow.visible = pushing
    if (pushing) arrow.setDirection(new THREE.Vector3(push.dir[0], push.dir[1], 0))
    if (run.t >= PUSH_TIME + SETTLE_TIME) { run.step++; run.t = 0 }
    if (run.step < PUSHES.length) return true

    // Done: how far did each box end up from where it started? One verdict per pallet.
    model.opt.gravity.set(normal)
    arrow.visible = false
    last = { accel: run.accel, groups: [] }
    for (const g of run.groups) {
      const limit = Math.max(0.05 * g.height, 0.002)
      const moved = g.names.map((n) => [n, Math.hypot(...P(n).map((v, k) => v - run.before[n][k]))])
      const [worstName, worst] = moved.reduce((a, b) => (b[1] > a[1] ? b : a))
      const pass = worst < limit
      last.groups.push({ name: g.name, worst, worstName: nameOf(worstName), limit, pass })
      log(pass ? 'ok' : 'fail', `${g.name}: truck test ${pass ? 'PASSED' : 'FAILED'} — the ${nameOf(worstName)} moved ${(worst * 1000 * 5).toFixed(0)} mm ` +
        `(limit: 5% of ${(g.height * 100 * 5).toFixed(0)} cm = ${(limit * 1000 * 5).toFixed(0)} mm)`)
    }
    run = null
    return false
  }

  return {
    start, tick,
    get running() { return !!run },
    get last() { return last },
    forget() { last = null },
    get timeScale() { return run && run.step >= 0 ? SLOW : 1 },
    // What is happening now, for the banner and the shake: null, or { name, accel, pushing }
    get phase() { return run && run.step >= 0 ? { name: PUSHES[run.step]?.name, accel: run.accel, pushing: run.t < PUSH_TIME, dir: PUSHES[run.step]?.dir } : null },
    cancel() { run = null; model.opt.gravity.set(normal); arrow.visible = false },
  }
}
