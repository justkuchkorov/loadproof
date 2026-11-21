// Node test: how strong a push do the rushed stack and the AI plan survive? (0.3 g to 1.0 g)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { checkTransport } = await import('../src/planner.js')
const { sceneXml, workersStack } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml())
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
const ai = JSON.parse(fs.readFileSync(path.join(root, 'tests/plans/ai_1.json'), 'utf8'))
for (const [name, plan, wrap] of [['rushed', workersStack(), false], ['AI plan', ai, false], ['rushed+wrap', workersStack(), true], ['AI+wrap', ai, true]]) {
  const row = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((g) => { const t = checkTransport(mujoco, model, plan, g, { wrap }); return `${g} g ${t.pass ? 'PASS' : 'FAIL'} (${(Math.max(...t.results.map((r) => r.worst)) * 1000).toFixed(0)} mm)` })
  console.log(name.padEnd(12), row.join(' | '))
}
