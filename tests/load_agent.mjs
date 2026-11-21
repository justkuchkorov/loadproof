// Node test of the tool-using agent (src/loadagent.js) on the real cell: the robot builds what the agent decides.
// Run: node tests/load_agent.mjs ["instructions"]   AI=1 uses Gemini (costs requests); without it, the fixed steps.
//      ORDER=WATER,WATER,CHIPS for a custom order; TEXT="free text order" also tests reading an order (AI=1 only).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
globalThis.GEMINI_KEY = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^VITE_GEMINI_API_KEY=(.*)$/m)[1].trim()
globalThis.NO_AI = !process.env.AI
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { runLoadAgent, readOrder } = await import('../src/loadagent.js')
const { loadScene } = await import('./cell.mjs')
const { orderFrom, parkArm, wrapBoxes } = await import('../src/pallet.js')
const { setOrder, BLOCKS } = await import('../src/planner.js')

let instructions = process.argv[2] || ''
let labels = process.env.ORDER ? process.env.ORDER.split(',') : null
if (process.env.TEXT) {
  const r = await readOrder(process.env.TEXT)
  console.log('read order:', JSON.stringify(r))
  labels = r.labels; instructions = r.instructions
}
const order = labels ? orderFrom(labels) : undefined
if (order) setOrder(order)
const mujoco = await loadMujoco()
const { model, createRobot } = await loadScene(mujoco, order)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data)
mujoco.mj_forward(model, data)
const robot = createRobot({ mujoco, model, data })

let running = true, carry = 0
;(async () => { // the browser's frames: whole physics steps, the remainder carried
  while (running) {
    carry += 1 / 60
    const n = Math.floor(carry / model.opt.timestep + 1e-9); carry -= n * model.opt.timestep
    if (n) robot.tick(n * model.opt.timestep)
    for (let i = 0; i < n; i++) mujoco.mj_step(model, data)
    await new Promise((r) => setImmediate(r))
  }
})()
const t0 = Date.now()
const log = (k, t) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s] ${k.padEnd(4)} ${t}`)
const reset = () => { robot.stop(); mujoco.mj_resetData(model, data); robot.resetPose(); mujoco.mj_forward(model, data) }
const wrap = () => { wrapBoxes(mujoco, model, data, Object.keys(BLOCKS)); log('ok', '🎞 wrapped') }
const state = await runLoadAgent({ instructions, mujoco, model, robot, log, preview: () => {}, reset, place: null, wrap })
running = false
console.log('state:', JSON.stringify({ plan: state.plan, built: state.built, wrapped: state.wrapped, tests: state.tests.length }))
process.exit(0)
