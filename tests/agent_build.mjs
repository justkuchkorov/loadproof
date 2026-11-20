// Node test: the real agent (Gemini design -> rule check -> physics check -> build -> measure -> fix)
// on the real build scene, with physics stepped in a loop instead of the browser's frames.
// Run: node tests/agent_build.mjs "Build a bridge"
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
globalThis.GEMINI_KEY = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^VITE_GEMINI_API_KEY=(.*)$/m)[1].trim()
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createRobot } = await import('../src/robot.js')
const { runAgent } = await import('../src/agent.js')

const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/scene_build.xml', 'shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_build.xml')
const data = new mujoco.MjData(model)
mujoco.mj_forward(model, data)
const robot = createRobot({ mujoco, model, data, debug: (s) => console.log('         robot:', s) })

let running = true
const dt = 1 / 60
;(async () => { // the "browser frames": tick the robot, step physics, yield so the agent's promises can run
  while (running) {
    robot.tick(dt)
    for (let i = 0; i < Math.round(dt / model.opt.timestep); i++) mujoco.mj_step(model, data)
    await new Promise((r) => setImmediate(r))
  }
})()
const reset = () => { robot.stop(); const m = Array.from(data.mocap_pos.subarray(0, 3)); mujoco.mj_resetData(model, data); data.mocap_pos.set(m); mujoco.mj_forward(model, data) }
const t0 = Date.now()
let lastPlan = null
await runAgent({ request: process.argv[2] || 'Build a bridge', mujoco, model, robot, reset,
  log: (k, t) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${k.padEnd(4)} ${t}`),
  preview: (plan) => { if (plan) { lastPlan = plan; console.log('         plan:', plan.blocks.map((b) => `${b.block}@(${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)})`).join(' ')) } } }).catch((e) => console.log("AGENT ERROR:", e.message))
running = false
await new Promise((r) => setTimeout(r, 50))
if (lastPlan) for (const b of lastPlan.blocks) {
  const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block)
  console.log(`  ${b.block.padEnd(6)} planned z ${(b.z * 100).toFixed(1)} cm, now ${(data.xpos[3 * id + 2] * 100).toFixed(1)} cm`)
}
