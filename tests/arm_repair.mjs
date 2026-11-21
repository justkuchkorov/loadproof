// Build the demo plan with the arm, shove a top box off its spot, let the robot measure and repair.
import fs from 'fs'
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { build, repair } = await import('../src/agent.js')
const { parkArm } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const { model, createRobot } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data); mujoco.mj_forward(model, data)
const { createCamera } = await import('../src/camera.js')
const eye = process.env.EYE ? createCamera({ mujoco, model, data }) : null // EYE=1: the robot finds the knocked box with the depth camera
const robot = createRobot({ mujoco, model, data, eye, debug: process.env.DEBUG ? (s) => console.log('   robot:', s) : undefined })
let running = true
;(async () => { while (running) { robot.tick(1 / 60); for (let i = 0; i < 8; i++) mujoco.mj_step(model, data); await new Promise((r) => setImmediate(r)) } })()
const plan = JSON.parse(fs.readFileSync('tests/plans/ai_1.json', 'utf8'))
const log = (k, t) => { if (k !== 'step' || /back|Final/.test(t)) console.log(k, t) }
await build(plan, { robot, log: () => {}, reset: () => {} })
for (const victim of ['b1', 'b3']) {
  const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, victim)
  data.qvel.set([0.05, 0.45, 0.15, 0, 0, 0], model.jnt_dofadr[model.body_jntadr[id]])
  console.log('knocked', victim)
  await new Promise((r) => setTimeout(r, 400))
  await repair(plan, { robot, log })
}
running = false
