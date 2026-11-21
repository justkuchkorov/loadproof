// Node test: the real agent (Gemini design -> rule check -> physics check -> build -> measure -> fix)
// on the real build scene, with physics stepped in a loop instead of the browser's frames.
// Run: node tests/agent_build.mjs "Build a bridge"
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.env.UP === '0') globalThis.FINGERS_UP = false
globalThis.GEMINI_KEY = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^VITE_GEMINI_API_KEY=(.*)$/m)[1].trim()
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createRobot } = await import('../src/robot.js')
const { runAgent, build } = await import('../src/agent.js')

const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
const { sceneXml } = await import('../src/pallet.js')
mujoco.FS.writeFile('/w/shadow_hand/scene_build.xml', sceneXml())
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_build.xml')
const data = new mujoco.MjData(model)
mujoco.mj_forward(model, data)
const robot = createRobot({ mujoco, model, data, debug: (s) => console.log('         robot:', s) })

let running = true
const DT = 1 / 60
;(async () => { // the "browser frames": tick the robot, step physics, yield so the agent's promises can run
  while (running) {
    const dt = process.env.JITTER ? (1 / 120 + Math.random() * (1 / 30 - 1 / 120)) : DT // uneven frames, like a busy browser
    robot.tick(dt)
    for (let i = 0; i < Math.round(dt / model.opt.timestep); i++) mujoco.mj_step(model, data)
    await new Promise((r) => setImmediate(r))
  }
})()
const feed = undefined // no conveyor: the robot picks from the waiting group itself
const reset = () => { robot.stop(); const m = Array.from(data.mocap_pos.subarray(0, 3)); mujoco.mj_resetData(model, data); data.mocap_pos.set(m); mujoco.mj_forward(model, data) }
const t0 = Date.now()
if (process.argv[2] === '--plan-file') {
  const plan = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
  await build(plan, { robot, reset, feed, log: (k, t) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${k.padEnd(4)} ${t}`) })
  running = false
  await new Promise((r) => setTimeout(r, 50))
  for (const b of plan.blocks) { const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block); console.log(`  ${b.block} ${b.spot ?? ''} planned z ${(b.z * 100).toFixed(1)} cm, now ${(data.xpos[3 * id + 2] * 100).toFixed(1)} cm`) }
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
