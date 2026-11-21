// Collect distinct AI plans that pass every check, for the build benchmark. Run: node tests/collect_plans.mjs 6
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
globalThis.GEMINI_KEY = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^VITE_GEMINI_API_KEY=(.*)$/m)[1].trim()
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { design, toPositions } = await import('../src/planner.js')
const { checkPlan } = await import('../src/agent.js')
const { sceneXml } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml())
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')

const want = Number(process.argv[2] || 6)
const seen = new Set()
let tries = 0
const dir = path.join(root, 'tests/plans')
fs.mkdirSync(dir, { recursive: true })
while (seen.size < want && tries < 20) {
  tries++
  const r = await design('Plan the pallet for this order so it passes the 0.5 g truck test.', null, null, 0)
  const { plan, problems } = toPositions(r.plan)
  const c = checkPlan(plan, { mujoco, model, log: () => {}, preview: () => {} }, problems)
  const key = plan.blocks.map((b) => `${b.block}:${b.layer}:${b.spot}`).sort().join(' ')
  console.log(`try ${tries}: ${c.pass ? 'PASS' : 'fail'} ${seen.has(key) ? '(same as before)' : ''}`)
  if (c.pass && !seen.has(key)) {
    seen.add(key)
    fs.writeFileSync(path.join(dir, `ai_${seen.size}.json`), JSON.stringify(plan))
  }
}
console.log(`${seen.size} distinct passing plans saved in tests/plans/ after ${tries} tries`)
