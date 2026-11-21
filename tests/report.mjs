// Node test: render the load stability report for the AI's plan to a file (open it in a browser to look).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { checkTransport } = await import('../src/planner.js')
const { reportHtml } = await import('../src/report.js')
const { sceneXml, ORDER } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml())
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
const plan = JSON.parse(fs.readFileSync(path.join(root, 'tests/plans/ai_1.json'), 'utf8'))
const t = checkTransport(mujoco, model, plan, 0.5)
const html = reportHtml({ order: ORDER, plan, checks: { pass: t.pass, transport: t }, orderName: 'order #A-1042',
  truck: { accel: 0.5, groups: [{ name: 'LoadProof pallet', worst: 0.001, worstName: 'RICE 10 kg', limit: 0.0094, pass: true }] } })
const out = process.argv[2] || path.join(root, 'tests/report_sample.html')
fs.writeFileSync(out, html)
console.log('written', out)
