// The takeover (src/takeover.js) with a scripted hand instead of the webcam: move the palm over a box, pinch, carry it
// to a pallet spot, open. Prints what the takeover says and where the box ends up.
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { parkArm, SPOTS } = await import('../src/pallet.js')
const { createCamera } = await import('../src/camera.js')
const { createTakeover } = await import('../src/takeover.js')
const { BLOCKS } = await import('../src/planner.js')
const mujoco = await loadMujoco()
const { model, createRobot } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data); mujoco.mj_forward(model, data)
const eye = createCamera({ mujoco, model, data })
const robot = createRobot({ mujoco, model, data, eye })
robot.start()
const logs = []
const take = createTakeover({ robot, log: (k, t) => { logs.push(t); console.log('  log:', k, t) }, preview: () => {} })

// A fake hand: palm at (px, py) in the picture, thumb and index tips together (pinched) or apart.
const N = { x: 0.5, y: 0.5 } // where the palm is at the start = the middle (HOME)
const HOME = [0.38, 0], GAIN = 1.0
const handAt = ([x, y], pinch) => {
  const palm = { x: N.x + (y - HOME[1]) / GAIN, y: N.y - (x - HOME[0]) / GAIN }
  const pts = Array.from({ length: 21 }, () => ({ ...palm }))
  pts[0] = { x: palm.x, y: palm.y + 0.08 }; pts[9] = { x: palm.x, y: palm.y - 0.08 }
  pts[4] = { x: palm.x - 0.05, y: palm.y }; pts[8] = pinch ? { ...pts[4] } : { x: palm.x + 0.1, y: palm.y }
  return { image: pts }
}
let carry = 0
async function frames(sec, hand) {
  for (let t = 0; t < sec; t += 1 / 60) {
    const r = take.update(hand())
    carry += 1 / 60
    const n = Math.floor(carry / model.opt.timestep + 1e-9); carry -= n * model.opt.timestep
    if (n) robot.tick(n * model.opt.timestep)
    for (let i = 0; i < n; i++) mujoco.mj_step(model, data)
    await new Promise((res) => setImmediate(res))
    frames.last = r
  }
}
const box = 'b5' // a WATER box, waiting on the infeed
const b = robot.P(box)
console.log('box', box, BLOCKS[box].name, 'at', b.map((v) => v.toFixed(3)).join(','))
await frames(0.5, () => handAt(HOME, false)) // start: hand in the middle
await frames(3, () => handAt([b[0], b[1]], false)) // move over the box
console.log('over the box:', frames.last.text)
await frames(6, () => handAt([b[0], b[1]], true)) // pinch: pick
console.log('after pinch:', frames.last.text, '| state', take.state, '| holding', robot.holding)
const spot = SPOTS.wide['left column']
await frames(5, () => handAt([spot[0] + 0.01, spot[1] - 0.012], true)) // carry near the left column (snaps)
console.log('over the pallet:', frames.last.text)
await frames(6, () => handAt([spot[0] + 0.01, spot[1] - 0.012], false)) // open: put it down
const e = robot.P(box)
console.log('box now at', e.map((v) => v.toFixed(3)).join(','), '| spot', spot.map((v) => v.toFixed(3)).join(','), '| off', (Math.hypot(e[0] - spot[0], e[1] - spot[1]) * 5000).toFixed(0), 'mm real')
await frames(1, () => null) // hand gone: holds still
console.log('no hand:', frames.last.text)
process.exit(0)
