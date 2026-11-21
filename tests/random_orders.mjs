// Node test: can the AI plan random orders it has never seen? Plan + checks only (placed at once, no robot).
// Run: node tests/random_orders.mjs 6
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
globalThis.GEMINI_KEY = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^VITE_GEMINI_API_KEY=(.*)$/m)[1].trim()
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { setOrder } = await import('../src/planner.js')
const { runAgent } = await import('../src/agent.js')
const { sceneXml, randomOrder, orderFrom } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))

const n = Number(process.argv[2] || 6)
let passed = 0
for (let k = 1; k <= n; k++) {
  const labels = randomOrder()
  const order = orderFrom(labels)
  setOrder(order)
  mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml(order))
  const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
  const data = new mujoco.MjData(model)
  const lines = []
  const t0 = Date.now()
  const place = (plan) => {
    for (const b of plan.blocks) {
      const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block)
      data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], model.jnt_qposadr[model.body_jntadr[id]])
    }
    mujoco.mj_forward(model, data)
  }
  const plan = await runAgent({ request: 'Plan the pallet for this order so it passes the 0.5 g truck test.', mujoco, model, robot: null,
    log: (kind, text) => lines.push(`${kind}: ${text}`), preview: () => {}, reset: () => mujoco.mj_resetData(model, data), place })
    .catch((e) => { lines.push('ERROR ' + e.message); return null })
  const ok = !!plan
  if (ok) passed++
  console.log(`order ${k}: ${labels.join(',')} -> ${ok ? 'PASSED' : 'no safe plan'} in ${((Date.now() - t0) / 1000).toFixed(0)} s, tries ${lines.filter((l) => l.includes('planned "')).length}`)
  if (!ok) console.log('   ' + lines.filter((l) => l.startsWith('fail')).slice(-2).join('\n   ').slice(0, 400))
  data.delete(); model.delete()
}
console.log(`${passed}/${n} random orders got a plan that passed every check`)
