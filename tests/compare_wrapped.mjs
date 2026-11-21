// Compare, both pallets wrapped, then the 🚚 button's test: the shake and the warehouse rules as each stack stands.
// Usage: node tests/compare_wrapped.mjs [g] [nowrap]
const g = Number(process.argv[2] || 0.8), wrap = process.argv[3] !== 'nowrap'
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const THREE = await import('three')
const { loadScene } = await import('./cell.mjs')
const { parkArm, wrapBoxes, workersStack, ORDER, PALLET, PALLET_B, copyId } = await import('../src/pallet.js')
const { quickPlan } = await import('../src/loadagent.js')
const { createTruckTest } = await import('../src/truck.js')
const mujoco = await loadMujoco()
const { model } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data); mujoco.mj_forward(model, data)
const plan = await quickPlan({ mujoco, model, robot: null, log: () => {}, preview: () => {}, reset: () => {}, place: null, wrap: () => {} }) // as Compare: a plan that passed the EU test
const rushed = workersStack(ORDER).blocks.map((b) => ({ ...b, block: copyId(b.block), y: b.y + PALLET_B.y - PALLET.y }))
const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
for (const b of [...plan.blocks, ...rushed]) data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], model.jnt_qposadr[model.body_jntadr[body(b.block)]])
mujoco.mj_forward(model, data)
for (let i = 0; i < 500; i++) mujoco.mj_step(model, data)
if (wrap) wrapBoxes(mujoco, model, data, [...plan.blocks, ...rushed].map((b) => b.block))
const truck = createTruckTest({ mujoco, model, data, scene: new THREE.Scene(), log: (k, t) => console.log(k.padEnd(4), t) })
truck.start(g)
for (let n = 0; n < 20000; n++) { const dt = (1 / 60) * truck.timeScale; if (!truck.tick(dt)) break; for (let i = 0; i < Math.round(dt / model.opt.timestep); i++) mujoco.mj_step(model, data) }
process.exit(0)
