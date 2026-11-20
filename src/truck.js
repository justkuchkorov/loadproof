// Live truck test, after EUMOS 40509: push everything on the table at 0.5 g, like a truck swerving and braking,
// then measure how far each block moved. Pass: every block moved less than 5% of the load's height.
//
// Inside the moving truck, a push at 0.5 g feels like gravity tilted sideways by half its strength,
// so the test tilts MuJoCo's gravity for 0.6 s per push, then lets everything settle.
import * as THREE from 'three'
import { BLOCKS } from './planner.js'

const G = 9.81
const PUSHES = [
  { name: 'swerve', dir: [0, -1] }, // the load is pushed to the right of the screen
  { name: 'brake', dir: [1, 0] },   // the load is pushed forward
]
const PUSH_TIME = 0.6
const SETTLE_TIME = 1.2
const PARK_TIME = 1.5 // first the hand moves away and everything goes still; nothing may touch the load
const inBuildArea = (p) => p[0] > 0.12 && p[0] < 0.42 && Math.abs(p[1]) < 0.26

export function createTruckTest({ mujoco, model, data, scene, log }) {
  const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
  const P = (n) => { const b = body(n); return [0, 1, 2].map((k) => data.xpos[3 * b + k]) }
  const normal = Array.from(model.opt.gravity)

  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.25, 0, 0.2), 0.16, 0xf85149, 0.05, 0.035)
  arrow.visible = false
  scene.add(arrow)

  let run = null // { t, step, before, names, height, accel }

  function start(accel = 0.5) {
    const names = Object.keys(BLOCKS).filter((n) => inBuildArea(P(n)))
    if (names.length === 0) { log('fail', 'Truck test: nothing in the build area to test'); return false }
    const height = Math.max(...names.map((n) => P(n)[2] + BLOCKS[n].size[2] / 2))
    run = { t: 0, step: -1, before: null, names, height, accel }
    log('step', `🚚 Truck test at ${accel} g: hand away, then ${PUSHES.map((p) => p.name).join(', then ')} (load ${(height * 100).toFixed(1)} cm tall)`)
    return true
  }

  // Called every frame while a test runs. Returns true while it is still running.
  function tick(dt) {
    if (!run) return false
    run.t += dt
    if (run.step === -1) { // parking: no push yet
      if (run.t < PARK_TIME) return true
      run.before = Object.fromEntries(run.names.map((n) => [n, P(n)])) // start positions, measured when still
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

    // Done: how far did each block end up from where it started?
    model.opt.gravity.set(normal)
    arrow.visible = false
    const limit = Math.max(0.05 * run.height, 0.002)
    const moved = run.names.map((n) => [n, Math.hypot(...P(n).map((v, k) => v - run.before[n][k]))])
    const [worstName, worst] = moved.reduce((a, b) => (b[1] > a[1] ? b : a))
    const pass = worst < limit
    log(pass ? 'ok' : 'fail', `Truck test ${pass ? 'PASSED' : 'FAILED'}: the ${BLOCKS[worstName].name} moved ${(worst * 1000).toFixed(0)} mm ` +
      `(limit: 5% of ${(run.height * 100).toFixed(1)} cm = ${(limit * 1000).toFixed(0)} mm)`)
    run = null
    return false
  }

  return { start, tick, get running() { return !!run }, cancel() { run = null; model.opt.gravity.set(normal); arrow.visible = false } }
}
