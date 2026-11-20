// Node test: the EUMOS 40509-style transport test on a few structures.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { checkPhysics, checkTransport } = await import('../src/planner.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/scene_build.xml', 'shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_build.xml')
const B = (block, x, y, z) => ({ block, x, y, z })
const plans = {
  'bridge (3 blocks, 9 cm tall)': [B('cube1', 0.25, -0.06, 0.025), B('cube2', 0.25, 0.06, 0.025), B('plank', 0.25, 0, 0.07)],
  'tall bridge (5 blocks, 14 cm)': [B('cube1', 0.25, -0.06, 0.025), B('cube2', 0.25, -0.06, 0.075), B('cube3', 0.25, 0.06, 0.025), B('cube4', 0.25, 0.06, 0.075), B('plank', 0.25, 0, 0.12)],
  'tower of 4 cubes (20 cm)': [B('cube1', 0.25, 0, 0.025), B('cube2', 0.25, 0, 0.075), B('cube3', 0.25, 0, 0.125), B('cube4', 0.25, 0, 0.175)],
  'two towers of 2 (10 cm)': [B('cube1', 0.25, -0.06, 0.025), B('cube2', 0.25, -0.06, 0.075), B('cube3', 0.25, 0.06, 0.025), B('cube4', 0.25, 0.06, 0.075)],
}
for (const [name, blocks] of Object.entries(plans)) {
  const plan = { blocks }
  const s = checkPhysics(mujoco, model, plan)
  const t = checkTransport(mujoco, model, plan)
  console.log(`${name.padEnd(30)} stands on the table: ${s.stands ? 'yes' : 'NO '} | 0.5 g transport test: ${t.pass ? 'PASS' : 'FAIL'} (limit ${(t.limit * 1000).toFixed(0)} mm) | ` +
    t.results.map((r) => `${r.name} ${(r.worst * 1000).toFixed(0)} mm`).join(', '))
}
