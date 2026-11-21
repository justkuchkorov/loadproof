// The live truck test of the 🚚 button (src/truck.js) on the agent's first plan for the demo order, placed at once,
// wrapped or not. Usage: node tests/truck_button.mjs [g] [wrap]
const g = Number(process.argv[2] || 0.8), wrap = process.argv[3] === 'wrap'
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const THREE = await import('three')
const { loadScene } = await import('./cell.mjs')
const { parkArm, wrapBoxes } = await import('../src/pallet.js')
const { createTools } = await import('../src/loadagent.js')
const { createTruckTest } = await import('../src/truck.js')
const mujoco = await loadMujoco()
const { model } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data); mujoco.mj_forward(model, data)
const { tools } = createTools({ mujoco, model, robot: null, log: () => {}, preview: () => {}, reset: () => {}, place: null, wrap: () => {} })
const plan = tools.plan(tools.plan_pallet({}).plan_id)
const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
for (const b of plan.blocks) data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], model.jnt_qposadr[model.body_jntadr[body(b.block)]])
mujoco.mj_forward(model, data)
for (let i = 0; i < 500; i++) mujoco.mj_step(model, data) // settle
if (wrap) wrapBoxes(mujoco, model, data, plan.blocks.map((b) => b.block))
const truck = createTruckTest({ mujoco, model, data, scene: new THREE.Scene(), log: (k, t) => console.log(k, t) })
truck.start(g)
let n = 0
while (n++ < 20000) {
  const dt = (1 / 60) * truck.timeScale
  if (!truck.tick(dt)) break
  for (let i = 0; i < Math.round(dt / model.opt.timestep); i++) mujoco.mj_step(model, data)
}
process.exit(0)
