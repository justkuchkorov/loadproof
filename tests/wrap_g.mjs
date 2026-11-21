// Does the wrapped load survive? The agent's first plan for the demo order, wrapped and unwrapped, at several pushes.
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { createTools } = await import('../src/loadagent.js')
const { checkTransport } = await import('../src/planner.js')
const mujoco = await loadMujoco()
const { model } = await loadScene(mujoco)
const { tools } = createTools({ mujoco, model, robot: null, log: () => {}, preview: () => {}, reset: () => {}, place: null, wrap: () => {} })
const p = tools.plan_pallet({})
const plan = tools.plan(p.plan_id)
for (const g of [0.5, 0.8, { forward: 0.8, other: 0.5 }]) for (const wrap of [false, true]) {
  const t = checkTransport(mujoco, model, plan, g, { wrap })
  console.log(JSON.stringify(g).padEnd(26), wrap ? 'wrapped  ' : 'unwrapped', t.pass ? 'PASS' : 'FAIL', t.results.map((r) => `${r.name} ${(r.worst * 5000).toFixed(0)} mm`).join(', '))
}
