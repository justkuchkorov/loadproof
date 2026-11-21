// How long one screen frame (1/60 s) costs in the UR10e cell: the arm's controller, the physics steps, contacts and
// solver iterations, while it moves one box. Usage: node tests/arm_perf.mjs [box] [x,y,z]
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { parkArm } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const { model, createRobot } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data)
mujoco.mj_forward(model, data)
const robot = createRobot({ mujoco, model, data })
const id = process.argv[2] || 'b5'
const dest = (process.argv[3] || '0.26,0.042,0.054').split(',').map(Number)
// HZ=144: a fast screen, frames 1/144 s ± 15 %, physics in whole steps with the remainder carried (as sim.advance).
const HZ = Number(process.env.HZ || 60)
const ts = model.opt.timestep
let carry = 0, steps = Math.round(1 / HZ / ts)
const tick = [], phys = [], ncon = [], iters = []
let running = true
;(async () => {
  while (running) {
    if (process.env.HZ) { carry += (1 + 0.3 * (Math.random() - 0.5)) / HZ; steps = Math.floor(carry / ts + 1e-9); carry -= steps * ts }
    let t0 = performance.now()
    if (steps > 0) robot.tick(steps * ts)
    tick.push(performance.now() - t0)
    t0 = performance.now()
    let it = 0
    for (let i = 0; i < steps; i++) { mujoco.mj_step(model, data); it += data.solver_niter[0] }
    phys.push(performance.now() - t0)
    ncon.push(data.ncon); iters.push(it / steps)
    await new Promise((r) => setImmediate(r))
  }
})()
robot.start()
const r = await robot.pickPlace(id, dest)
running = false
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return `mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)} p95 ${s[Math.floor(0.95 * s.length)].toFixed(2)} max ${s[s.length - 1].toFixed(2)}` }
console.log('result', r.ok ?? JSON.stringify(r), 'frames', tick.length, 'timestep', model.opt.timestep, 'steps/frame', steps)
console.log('controller ms/frame', stat(tick))
console.log('physics ms/frame   ', stat(phys))
console.log('contacts           ', stat(ncon))
console.log('solver iters/step  ', stat(iters))
console.log('ngeom', model.ngeom, 'nbody', model.nbody, 'nv', model.nv)
