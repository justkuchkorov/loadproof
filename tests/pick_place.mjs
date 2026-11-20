// Node test: shared-control grab, carry and put down for the ball, cube and can.
// Run: node tests/pick_place.mjs
import loadMujoco from 'file:///C:/Users/abdi/Documents/projects/robot-hand/node_modules/@mujoco/mujoco/mujoco.js'
import { createGrasp, FIST } from 'file:///C:/Users/abdi/Documents/projects/robot-hand/src/grasp.js'
import fs from 'fs'
const mujoco = await loadMujoco()
const root = 'C:/Users/abdi/Documents/projects/robot-hand/public/models/'
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/scene_pick.xml','shadow_hand/hand_free.xml', ...fs.readdirSync(root+'shadow_hand/assets').map(n=>'shadow_hand/assets/'+n)]) mujoco.FS.writeFile('/w/'+f, fs.readFileSync(root+f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_pick.xml')
const data = new mujoco.MjData(model)
mujoco.mj_forward(model, data)
const O = mujoco.mjtObj
const A = (n) => mujoco.mj_name2id(model, O.mjOBJ_ACTUATOR.value, n)
const site = mujoco.mj_name2id(model, O.mjOBJ_SITE.value, 'grasp_site')
const offset = [0,1,2].map(k => data.site_xpos[3*site+k] - data.mocap_pos[k])
const grasp = createGrasp({ mujoco, model, data, objects: ['ball', 'cube', 'can'] })
const B = (n) => mujoco.mj_name2id(model, O.mjOBJ_BODY.value, n)
const f3 = (n) => Array.from(data.xpos.subarray(3*B(n), 3*B(n)+3)).map(x=>x.toFixed(3)).join(' ')
const dt = 1/60
let move = Array.from(data.mocap_pos.subarray(0,3))
function run(sec, xy, curl) {
  for (let f = 0; f < sec/dt; f++) {
    const cur = [0,1,2].map(k => data.site_xpos[3*site+k])
    const r = grasp.update(dt, xy, curl, cur)
    for (let k=0;k<3;k++) { move[k] += 0.3 * (r.goal[k] - offset[k] - move[k]); data.mocap_pos[k] = move[k] }
    for (let i=0;i<model.nu;i++) data.ctrl[i] = 0
    if (r.fingers === 'fist') for (const [k,v] of Object.entries(FIST)) data.ctrl[A(k)] = v
    for (let s=0; s<dt/model.opt.timestep; s++) mujoco.mj_step(model, data)
  }
  return grasp.state
}
for (const obj of ['ball', 'cube', 'can']) {
  mujoco.mj_resetData(model, data); mujoco.mj_forward(model, data); move = Array.from(data.mocap_pos.subarray(0,3))
  const p = Array.from(data.xpos.subarray(3*B(obj), 3*B(obj)+2))
  const xy = [p[0] + 0.02, p[1] - 0.02] // ring a bit off-centre, like a real user
  console.log(obj, 'hover over', run(1.0, xy, 0), '| close', run(2.5, xy, 3.5), obj, f3(obj), '| carry', run(1.5, [0.3, 0.2], 3.5), f3(obj), '| open', run(2.5, [0.3, 0.2], 0), f3(obj))
}
