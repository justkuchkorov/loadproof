// Node test: rushed stack on pallet B, the AI's plan on pallet A, one live truck test (truck.js) - one verdict each.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as THREE from 'three'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createTruckTest } = await import('../src/truck.js')
const { sceneXml, workersStack, copyId, PALLET, PALLET_B } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml())
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
const data = new mujoco.MjData(model)
const place = (blocks) => { for (const b of blocks) { const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block); data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], model.jnt_qposadr[model.body_jntadr[id]]) } }
const fa = model.jnt_qposadr[model.body_jntadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'rh_forearm')]]
data.qpos[fa] = -0.8; data.qpos[fa + 2] = 0.6; data.mocap_pos.set([-0.8, 0, 0.6])
place(JSON.parse(fs.readFileSync(path.join(root, 'tests/plans/ai_1.json'), 'utf8')).blocks)
place(workersStack().blocks.map((b) => ({ ...b, block: copyId(b.block), y: b.y + PALLET_B.y - PALLET.y })))
mujoco.mj_forward(model, data)
for (let i = 0; i < 250; i++) mujoco.mj_step(model, data)
const truck = createTruckTest({ mujoco, model, data, scene: new THREE.Scene(), log: (k, t) => console.log(`${k}: ${t}`) })
truck.start(0.5)
const dt = 1 / 60
while (truck.tick(dt * truck.timeScale)) for (let i = 0; i < Math.round(dt * truck.timeScale / model.opt.timestep); i++) mujoco.mj_step(model, data)
