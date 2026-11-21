// Node test: the real agent (Gemini design -> rule check -> physics check -> build -> measure -> fix)
globalThis.NO_AI = !!process.env.NOAI // NOAI=1: the search plans, no Gemini (no quota used)
globalThis.SELF_TOUCH = !!process.env.SELF
globalThis.contactsOf = (mujoco, model, data, bodyName) => {
  const O = mujoco.mjtObj
  const name = (g) => mujoco.mj_id2name(model, O.mjOBJ_GEOM.value, g) || mujoco.mj_id2name(model, O.mjOBJ_BODY.value, model.geom_bodyid[g]) + '#' + g
  const out = []
  for (let i = 0; i < data.ncon; i++) {
    const c = data.contact.get(i)
    const a = name(c.geom1), b = name(c.geom2), dist = c.dist
    c.delete()
    if (a.includes(bodyName) || b.includes(bodyName)) out.push(`${a}/${b}(${(dist * 1000).toFixed(1)}mm)`)
  }
  return out.join(' ')
}
// on the real build scene, with physics stepped in a loop instead of the browser's frames.
// Run: node tests/agent_build.mjs "Build a bridge"   (HAND=1: the first version with the floating hand)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.env.UP === '0') globalThis.FINGERS_UP = false
globalThis.GEMINI_KEY = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^VITE_GEMINI_API_KEY=(.*)$/m)[1].trim()
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { runAgent, build } = await import('../src/agent.js')
const { loadScene } = await import('./cell.mjs')

const mujoco = await loadMujoco()
const { orderFrom } = await import('../src/pallet.js')
const { setOrder } = await import('../src/planner.js')
const ORDER_ENV = process.env.ORDER ? orderFrom(process.env.ORDER.split(',')) : undefined // a custom order, e.g. ORDER=WATER,WATER,CHIPS
// BOXES='[{"name":"WATER","firmness":"hard","cm":[60,40,25],"kg":12}, ...]': your own boxes, as from boxes.html
const BOXES_ENV = process.env.BOXES ? JSON.parse(process.env.BOXES).map((b, i) => ({ id: `b${i + 1}`, label: b.name, kg: b.kg, fragile: b.firmness === 'soft', firmness: b.firmness, cm: b.cm, num: i + 1 })) : undefined
if (ORDER_ENV || BOXES_ENV) setOrder(BOXES_ENV ?? ORDER_ENV)
const { model, createRobot } = await loadScene(mujoco, BOXES_ENV ?? ORDER_ENV)
const data = new mujoco.MjData(model)
require_park: { const { parkArm } = await import("../src/pallet.js"); parkArm(mujoco, model, data) }
mujoco.mj_forward(model, data)
const { createCamera } = await import('../src/camera.js')
const eye = process.env.EYE ? createCamera({ mujoco, model, data }) : null // EYE=1: the robot finds boxes with the depth camera
const robot = createRobot({ mujoco, model, data, eye, debug: (s) => console.log('         robot:', s) })

// MOVES=1: after each placement, which boxes already placed moved, and by how much (real mm)
if (process.env.MOVES) {
  const placedAt = {}
  const pp = robot.pickPlace
  robot.pickPlace = async (id, dest, o) => {
    const r = await pp(id, dest, o)
    const moved = Object.entries(placedAt).map(([n, p]) => [n, Math.hypot(...robot.P(n).map((v, k) => v - p[k])) * 5000]).filter(([, d]) => d > 3)
    if (moved.length) console.log(`         MOVES while placing ${id}: ` + moved.map(([n, d]) => `${n} ${d.toFixed(0)} mm`).join(', '))
    placedAt[id] = robot.P(id)
    for (const n of Object.keys(placedAt)) placedAt[n] = robot.P(n)
    return r
  }
}
let running = true
const DT = 1 / 60
const HZ = Number(process.env.HZ || 0) // HZ=144: a fast screen, frames 1/144 s +-15 %
let carry = 0 // as sim.advance in the browser: whole physics steps, the remainder carried
;(async () => { // the "browser frames": tick the robot, step physics, yield so the agent's promises can run
  while (running) {
    carry += process.env.JITTER ? (1 / 120 + Math.random() * (1 / 30 - 1 / 120)) : HZ ? (1 + 0.3 * (Math.random() - 0.5)) / HZ : DT // uneven frames, like a busy browser
    const n = Math.floor(carry / model.opt.timestep + 1e-9), dt = n * model.opt.timestep
    carry -= dt
    if (dt > 0) robot.tick(dt)
    if (process.env.TRACE && (globalThis.tt = (globalThis.tt ?? 0) + 1) % 10 === 0 && (robot.phase.holding === process.env.TRACE || globalThis.tracing)) { globalThis.tracing = robot.phase.holding === process.env.TRACE || (globalThis.tracing && globalThis.tt % 600 !== 0); const b = robot.P(process.env.TRACE); console.log("         TRACE goal", robot.phase.goal, "pad", robot.S().map((v) => v.toFixed(3)).join(","), "box", b.map((v) => v.toFixed(3)).join(","), "ik", robot.phase.ikErr, "touch", robot.touching(), "| qerr", robot.phase.q.split(" ").map((v, i) => (Number(v) - data.qpos[i]).toFixed(2)).join(" "), "| force", Array.from(data.actuator_force.slice(0, 6)).map((v) => v.toFixed(3)).join(" "), "| b4 contacts", contactsOf(mujoco, model, data, process.env.TRACE)) }
    if (process.env.WATCH) { const w = process.env.WATCH, p = robot.P(w); const prev = globalThis.wp; if (prev && robot.phase.holding !== w && Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > 0.0015) console.log("         MOVED", w, prev.map((v) => v.toFixed(3)).join(","), "->", p.map((v) => v.toFixed(3)).join(","), "| goal", robot.phase.goal, "holding", robot.phase.holding, "ik", robot.phase.ikErr, robot.phase.q, "| pad", robot.S().map((v) => v.toFixed(3)).join(","), "| touch", robot.touching(), "| its contacts", contactsOf(mujoco, model, data, w), "| held", robot.phase.holding && robot.P(robot.phase.holding).map((v) => v.toFixed(3)).join(","), "yaw", robot.phase.holding && (() => { const b = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, robot.phase.holding), q = [0, 1, 2, 3].map((k) => data.xquat[4 * b + k]); return (Math.atan2(2 * (q[0] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3])) * 180 / Math.PI).toFixed(0) })(), "| cmd q", robot.phase.q, "| real q", ["shoulder_pan_joint","shoulder_lift_joint","elbow_joint","wrist_1_joint","wrist_2_joint","wrist_3_joint"].map((j) => data.qpos[model.jnt_qposadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT.value, j)]].toFixed(2)).join(" "), "pad yaw", (() => { const s = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE.value, "grasp_site"), R = data.site_xmat.subarray(9 * s, 9 * s + 9); return (Math.atan2(R[1], R[0]) * 180 / Math.PI).toFixed(0) })()); globalThis.wp = p }
    if (process.env.TOUCH && (globalThis.nt = (globalThis.nt ?? 0) + 1) % 12 === 0) { const tc = robot.touching(); if (tc && tc !== globalThis.lastTouch) console.log("         touch:", tc, "| goal", robot.phase.goal, "holding", robot.phase.holding); globalThis.lastTouch = tc }
    for (let i = 0; i < n; i++) mujoco.mj_step(model, data)
    if (process.env.ARMZ) { // lowest height each arm part reaches, and when (ARMZ=1)
      globalThis.armz ??= {}
      for (const b of ['shoulder_link', 'upper_arm_link', 'forearm_link', 'wrist_1_link', 'wrist_2_link', 'wrist_3_link', 'suction']) {
        const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b), z = data.xpos[3 * id + 2]
        if (!(b in globalThis.armz) || z < globalThis.armz[b].z) globalThis.armz[b] = { z, goal: robot.phase.goal, holding: robot.phase.holding }
      }
    }
    await new Promise((r) => setImmediate(r))
  }
})()
const feed = undefined // no conveyor: the robot picks from the waiting group itself
const reset = () => { robot.stop(); const m = Array.from(data.mocap_pos.subarray(0, 3)); mujoco.mj_resetData(model, data); data.mocap_pos.set(m); robot.resetPose?.(); mujoco.mj_forward(model, data) }
const t0 = Date.now()
if (process.argv[2] === '--plan-file') {
  const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  await build(plan, { robot, reset, feed, log: (k, t) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${k.padEnd(4)} ${t}`) })
  running = false
  await new Promise((r) => setTimeout(r, 50))
  for (const b of plan.blocks) { const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block); console.log(`  ${b.block} ${b.spot ?? ''} planned z ${(b.z * 100).toFixed(1)} cm, now ${(data.xpos[3 * id + 2] * 100).toFixed(1)} cm`) }
  if (process.env.ARMZ) for (const [b, v] of Object.entries(globalThis.armz)) console.log('  lowest', b.padEnd(15), (v.z * 100).toFixed(1), 'cm  goal', v.goal, 'holding', v.holding)
  process.exit(0)
}
if (process.argv[2] === '--planned') {
  const { PALLET, ORDER, size } = await import('../src/pallet.js')
  const T = PALLET.top, xs = [PALLET.x - 0.032, PALLET.x + 0.032], ys = [PALLET.y - 0.042, PALLET.y + 0.042]
  const h = (id) => size(ORDER.find((b) => b.id === id))[2]
  const L1 = T + 0.05, L2 = L1 + 0.04
  const plan = { blocks: [
    { block: 'b5', x: PALLET.x, y: ys[0], z: T + 0.025 }, { block: 'b6', x: PALLET.x, y: ys[1], z: T + 0.025 },
    { block: 'b7', x: xs[0], y: PALLET.y, z: L1 + 0.02 }, { block: 'b8', x: xs[1], y: PALLET.y, z: L1 + 0.02 },
    { block: 'b4', x: xs[0], y: ys[0], z: L2 + h('b4') / 2 }, { block: 'b3', x: xs[1], y: ys[0], z: L2 + h('b3') / 2 },
    { block: 'b1', x: xs[0], y: ys[1], z: L2 + h('b1') / 2 }, { block: 'b2', x: xs[1], y: ys[1], z: L2 + h('b2') / 2 } ] }
  await build(plan, { robot, reset, feed, log: (k, t) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${k.padEnd(4)} ${t}`) })
  running = false
  await new Promise((r) => setTimeout(r, 50))
  for (const b of plan.blocks) { const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block); console.log(`  ${b.block} planned z ${(b.z * 100).toFixed(1)} cm, now ${(data.xpos[3 * id + 2] * 100).toFixed(1)} cm`) }
  if (process.env.ARMZ) for (const [b, v] of Object.entries(globalThis.armz)) console.log('  lowest', b.padEnd(15), (v.z * 100).toFixed(1), 'cm  goal', v.goal, 'holding', v.holding)
  process.exit(0)
}
let lastPlan = null
await runAgent({ request: process.argv[2] || 'Stack this order on the pallet so it survives the truck.', mujoco, model, robot, reset, feed,
  log: (k, t) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${k.padEnd(4)} ${t}`),
  preview: (plan, state) => { if (plan && state === 'good') fs.writeFileSync('tests/last_good_plan.json', JSON.stringify(plan)); if (plan) { lastPlan = plan; console.log('         plan:', plan.blocks.map((b) => `${b.block}@(${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)})`).join(' ')) } } }).catch((e) => console.log("AGENT ERROR:", e.message))
running = false
await new Promise((r) => setTimeout(r, 50))
if (lastPlan) for (const b of lastPlan.blocks) {
  const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block)
  console.log(`  ${b.block.padEnd(6)} planned z ${(b.z * 100).toFixed(1)} cm, now ${(data.xpos[3 * id + 2] * 100).toFixed(1)} cm`)
}
