// Load the scene into MuJoCo's file system for Node tests: the UR10e cell (default) or, with HAND=1, the first
// version with the floating hand. Returns { model, createRobot }.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const models = path.join(root, 'public/models/')
const P = await import('../src/pallet.js')
if (process.env.HAND) P.setCell('hand')

const mkdir = (mujoco, d) => { if (!mujoco.FS.analyzePath(d).exists) mujoco.FS.mkdir(d) }

export async function loadScene(mujoco, order) {
  mkdir(mujoco, '/w')
  if (P.CELL === 'arm') {
    mkdir(mujoco, '/w/cell'); mkdir(mujoco, '/w/cell/assets')
    for (const f of fs.readdirSync(models + 'cell/assets')) mujoco.FS.writeFile('/w/cell/assets/' + f, fs.readFileSync(models + 'cell/assets/' + f))
    mujoco.FS.writeFile('/w/cell/ur10e.xml', P.armXml(fs.readFileSync(models + 'cell/ur10e.xml', 'utf8')))
    mujoco.FS.writeFile('/w/cell/scene.xml', P.sceneXml(order))
    const model = mujoco.MjModel.from_xml_path('/w/cell/scene.xml')
    const { prepareArm, createArm } = await import('../src/arm.js')
    prepareArm(mujoco, model)
    return { model, createRobot: createArm }
  }
  mkdir(mujoco, '/w/shadow_hand'); mkdir(mujoco, '/w/shadow_hand/assets')
  for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
  mujoco.FS.writeFile('/w/shadow_hand/scene.xml', P.sceneXml(order))
  const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
  const { createRobot } = await import('../src/robot.js')
  return { model, createRobot }
}
