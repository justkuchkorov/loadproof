// Debug one pick-and-place with the arm: print goal vs pad, and the box, every 0.25 s.
import fs from 'fs'
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const mujoco = await loadMujoco()
const { model, createRobot } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
require_park: { const { parkArm } = await import("../src/pallet.js"); parkArm(mujoco, model, data) }
mujoco.mj_forward(model, data)
const robot = createRobot({ mujoco, model, data, debug: (s) => console.log('   robot:', s) })
console.log('timestep', model.opt.timestep, 'pad at start', robot.S().map((v) => v.toFixed(3)).join(','))
const id = process.argv[2] || 'b5'
const dest = (process.argv[3] || '0.26,0.042,0.054').split(',').map(Number)
let t = 0, next = 0, running = true
;(async () => {
  while (running) {
    robot.tick(1 / 60)
    for (let i = 0; i < Math.round(1 / 60 / model.opt.timestep); i++) mujoco.mj_step(model, data)
    t += 1 / 60
    if (t >= next) { next += 0.25; console.log(`t ${t.toFixed(2)} goal ${robot.phase.goal} pad ${robot.S().map((v) => v.toFixed(3)).join(',')} box ${robot.P(id).map((v) => v.toFixed(3)).join(',')} touch ${robot.touching()}`) }
    await new Promise((r) => setImmediate(r))
  }
})()
robot.start()
const r = await robot.pickPlace(id, dest)
await new Promise((res) => setTimeout(res, 300))
running = false
console.log('result', JSON.stringify(r), 'box', robot.P(id).map((v) => v.toFixed(3)).join(','), 'dest', dest.join(','))
