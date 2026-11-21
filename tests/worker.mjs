// Worker mode (src/worker.js) with a scripted worker: choose each box and take LoadProof's suggestion (two clicks on
// the spot), or BAD=1: put the first heavy box on a fragile one, to see the warning. Then the truck test's EU check.
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { parkArm } = await import('../src/pallet.js')
const { createCamera } = await import('../src/camera.js')
const { createWorker } = await import('../src/worker.js')
const { quickPlan } = await import('../src/loadagent.js')
const { BLOCKS, checkTransport } = await import('../src/planner.js')
const mujoco = await loadMujoco()
const { model, createRobot } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data); mujoco.mj_forward(model, data)
const robot = createRobot({ mujoco, model, data, eye: createCamera({ mujoco, model, data }) })
let running = true, carry = 0
;(async () => { while (running) { carry += 1 / 60; const n = Math.floor(carry / model.opt.timestep + 1e-9); carry -= n * model.opt.timestep; if (n) robot.tick(n * model.opt.timestep); for (let i = 0; i < n; i++) mujoco.mj_step(model, data); await new Promise((r) => setImmediate(r)) } })()
const log = (k, t) => console.log(`  ${k.padEnd(4)} ${t}`)
const suggestion = await quickPlan({ mujoco, model, robot, log: () => {}, preview: () => {}, reset: () => {}, place: null, wrap: () => {} })
const w = createWorker({ robot, log, preview: () => {}, suggestion })
const order = [...suggestion.blocks].sort((a, b) => a.z - b.z)
if (process.env.BAD) { // the chips first, then a water box on top of them
  const chips = order.find((b) => BLOCKS[b.block].fragile), water = order.find((b) => BLOCKS[b.block].name.startsWith('WATER'))
  w.select(chips.block); await w.choose('near-left'); await w.choose('near-left')
  w.select(water.block); await w.choose('left column'); await w.choose('left column')
} else {
  for (let i = 0; i < order.length; i++) {
    const b = order.find((x) => x.block === w.next()) // the worker follows LoadProof's order
    if (!b || !w.select(b.block)) { console.log('  could not select', b.block); continue }
    const s = w.pending ?? b.spot // LoadProof's suggestion (the green one)
    await w.choose(s); await w.choose(s) // show, then place
  }
  const p = { blocks: suggestion.blocks.map((b) => { const q = robot.P(b.block); return { ...b, x: q[0], y: q[1], z: q[2] } }) }
  const tt = checkTransport(mujoco, model, p, 0.5)
  console.log('stack as built: EU test', tt.pass ? 'PASSED' : 'FAILED', tt.results.map((r) => `${r.name} ${(r.worst * 5000).toFixed(0)} mm`).join(', '))
}
running = false
process.exit(0)
