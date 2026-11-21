// Node test: the rushed stack and the AI plan, each tested at 0.5 g without and with stretch wrap.
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
for (const [name, plan] of [['rushed', workersStack()], ['AI plan', ai]]) for (const wrap of [false, true]) {
  const t = checkTransport(mujoco, model, plan, 0.5, { wrap })
  console.log(`${name.padEnd(8)} ${wrap ? 'wrapped  ' : 'unwrapped'}: ${t.pass ? 'PASS' : 'FAIL'} — ` + t.results.map((r) => `${r.name} ${(r.worst * 1000).toFixed(0)} mm`).join(', '))
}
