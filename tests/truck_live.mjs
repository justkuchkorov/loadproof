// Node test: the live truck test (truck.js) on a low bridge and a tall bridge placed straight on the table.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as THREE from 'three'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createTruckTest } = await import('../src/truck.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/scene_build.xml', 'shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_build.xml')
const B = (block, x, y, z) => ({ block, x, y, z })
for (const [name, blocks] of Object.entries({
  'low bridge': [B('cube1', 0.25, -0.06, 0.025), B('cube2', 0.25, 0.06, 0.025), B('plank', 0.25, 0, 0.07)],
  'tall bridge': [B('cube1', 0.25, -0.06, 0.025), B('cube2', 0.25, -0.06, 0.075), B('cube3', 0.25, 0.06, 0.025), B('cube4', 0.25, 0.06, 0.075), B('plank', 0.25, 0, 0.12)],
})) {
  const data = new mujoco.MjData(model)
  const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
  const qadr = (n) => model.jnt_qposadr[model.body_jntadr[body(n)]]
  data.qpos[qadr('rh_forearm')] = -0.8; data.qpos[qadr('rh_forearm') + 2] = 0.6; data.mocap_pos.set([-0.8, 0, 0.6])
  for (const b of blocks) data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], qadr(b.block))
  mujoco.mj_forward(model, data)
  for (let i = 0; i < 250; i++) mujoco.mj_step(model, data)
  const truck = createTruckTest({ mujoco, model, data, scene: new THREE.Scene(), log: (k, t) => console.log(`  ${name}: ${t}`) })
  truck.start(0.5)
  const dt = 1 / 60
  while (truck.tick(dt)) for (let i = 0; i < Math.round(dt / model.opt.timestep); i++) mujoco.mj_step(model, data)
  data.delete()
}
