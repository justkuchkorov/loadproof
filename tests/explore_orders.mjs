// Which orders make good experiments? For each: can it be stacked, does LoadProof's plan pass the EU test unwrapped
// or only wrapped, hard braking wrapped, and what happens to the rushed worker's stack. No robot build, no AI.
// Usage: node tests/explore_orders.mjs "WATER,WATER,CHIPS,CHIPS" "..."
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { orderFrom, workersStack, CATALOG } = await import('../src/pallet.js')
const { setOrder, BLOCKS, checkRules, checkTransport, checkPhysics } = await import('../src/planner.js')
const { createTools } = await import('../src/loadagent.js')
const mujoco = await loadMujoco()
const mm = (v) => Math.round(v * 5000)
for (const arg of process.argv.slice(2)) {
  // an argument starting with [ is a JSON list of your own boxes (as on boxes.html)
  const own = arg.startsWith('[') ? JSON.parse(arg).map((b, i) => ({ id: `b${i + 1}`, label: b.name, kg: b.kg, fragile: b.firmness === 'soft', firmness: b.firmness, cm: b.cm })) : null
  const labels = own ? own.map((b) => b.label) : arg.split(',')
  const order = own ?? orderFrom(labels)
  setOrder(order)
  const { model } = await loadScene(mujoco, order)
  const kg = order.reduce((s, b) => s + b.kg, 0)
  const over = order.filter((b) => b.kg > 12.5).map((b) => b.label)
  const { tools } = createTools({ mujoco, model, robot: null, log: () => {}, preview: () => {}, reset: () => {}, place: null, wrap: () => {} })
  let line = `${own ? labels.join(',') : arg} (${kg} kg${over.length ? `, over the UR10e payload: ${over.join(' ')}` : ''}): `
  let chosen = null, how = ''
  const skip = []
  for (let k = 0; k < 8 && !chosen; k++) {
    const p = tools.plan_pallet({ skip })
    if (p.error) { if (k === 0) line += 'NO safe stacking. '; break }
    if (checkTransport(mujoco, model, tools.plan(p.plan_id), 0.5).pass) { chosen = p.plan_id; how = 'EU 0.5 g unwrapped PASS' } else skip.push(p.plan_id)
  }
  if (!chosen && skip.length) {
    if (checkTransport(mujoco, model, tools.plan(skip[0]), 0.5, { wrap: true }).pass) { chosen = skip[0]; how = 'EU 0.5 g only WRAPPED' }
    else how = 'fails EU even wrapped'
  }
  if (chosen !== null) {
    const hb = checkTransport(mujoco, model, tools.plan(chosen), { forward: 0.8, other: 0.5 }, { wrap: true })
    line += `LoadProof: ${how}; hard braking wrapped ${hb.pass ? 'PASS' : 'FAIL'}. `
  } else if (how) line += `LoadProof: ${how}. `
  const rushed = workersStack(order)
  const rules = checkRules(rushed).filter((r) => !r.includes('missing'))
  const stands = checkPhysics(mujoco, model, rushed).stands
  const t = stands ? checkTransport(mujoco, model, rushed, 0.5) : null
  line += `Rushed: ${rules.length} rule problems, ${!stands ? 'falls standing still' : t.pass ? 'passes EU 0.5 g' : `fails EU 0.5 g (${mm(Math.max(...t.results.map((r) => r.worst)))} mm)`}`
  console.log(line)
}
process.exit(0)
