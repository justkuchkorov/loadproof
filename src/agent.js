// LoadProof's agent loop: plan -> warehouse rules -> it stands -> 0.5 g truck test -> (fix and retry) ->
// build -> measure each box -> fix. Nothing is built until the plan has passed every check.
import { design, toPositions, checkRules, checkPhysics, checkTransport, BLOCKS } from './planner.js'
import { search } from './solver.js'

// Sizes in the log are real sizes: the model is 1:5.
const cm = (v) => (v * 100 * 5).toFixed(0)
const mm = (v) => (v * 1000 * 5).toFixed(0)

// Run the three checks on a plan and log them. Returns { pass, feedback } — feedback is for the AI.
// all: run every check even after a failure (to show the whole picture, e.g. for the rushed worker's stack).
export function checkPlan(plan, { mujoco, model, log, preview }, extra = [], { all = false } = {}) {
  preview(plan, 'checking')
  const rules = [...extra, ...checkRules(plan)]
  if (rules.length) {
    log('fail', `Warehouse rules: ${rules.join('; ')}`)
    preview(plan, 'bad')
    if (!all) return { pass: false, feedback: rules.join('; ') }
  } else
  log('ok', 'Warehouse rules: every box on the pallet, 70%+ supported, nothing heavy on much lighter, nothing on fragile')

  const phys = checkPhysics(mujoco, model, plan)
  if (!phys.stands) {
    log('fail', `Stands? No — ${phys.fell.map((b) => BLOCKS[b].name).join(', ')} fell over on the table`)
    preview(plan, 'bad')
    if (!all) return { pass: false, feedback: `even standing still, these boxes fell: ${phys.fell.join(', ')}` }
  } else log('ok', 'Stands on the table: yes (no box moved 5 mm in 2 s)')

  const t = checkTransport(mujoco, model, plan, 0.5)
  const lines = t.results.map((r) => `${r.name} ${mm(r.worst)} mm`).join(', ')
  if (!t.pass) {
    const bad = t.results.filter((r) => !r.pass).sort((a, b) => b.worst - a.worst)[0]
    log('fail', `🚚 Truck test 0.5 g (EUMOS 40509 style) FAILED: pushed ${bad.name}, ${BLOCKS[bad.block].name} moved ${mm(bad.worst)} mm; limit ${mm(t.limit)} mm (5% of ${cm(t.height)} cm). All: ${lines}`)
    preview(plan, 'bad')
    return { pass: false, feedback: `in the 0.5 g truck test, pushed ${bad.name}, ${bad.block} moved ${mm(bad.worst)} mm (limit ${mm(t.limit)} mm). Make the load more stable: heavy boxes low, full even layers, layers that interlock` }
  }
  log('ok', `🚚 Truck test 0.5 g (EUMOS 40509 style) PASSED: worst ${mm(Math.max(...t.results.map((r) => r.worst)))} mm, limit ${mm(t.limit)} mm. ${lines}`)
  preview(plan, 'good')
  return { pass: true, transport: t }
}

export async function runAgent({ request, mujoco, model, robot, log, preview, reset, feed, place, onChecked }) {
  let plan = null
  let raw = null
  let feedback = null
  if (globalThis.NO_AI) log('info', 'Offline mode (?noai): no AI, the search plans the pallet')
  for (let attempt = 0; attempt < (globalThis.NO_AI ? 0 : 3); attempt++) {
    log('step', attempt === 0 ? 'Asking the AI to plan the pallet…' : `Asking the AI to fix the plan (try ${attempt + 1} of 3)…`)
    const t0 = performance.now()
    let r
    try { r = await design(request, raw, feedback, attempt) } catch (err) {
      log('fail', `The AI did not answer (${err.message}). Going on without it.`)
      break
    }
    raw = r.plan
    const { plan: placed, problems } = toPositions(raw)
    plan = placed
    if (r.note) log('info', r.note)
    const layers = [...new Set(plan.blocks.map((b) => b.layer))]
    log('info', `${r.model} planned "${plan.name}" in ${((performance.now() - t0) / 1000).toFixed(1)} s: ` +
      layers.map((L) => `layer ${L}: ` + plan.blocks.filter((b) => b.layer === L).map((b) => `${BLOCKS[b.block].name} ${b.spot}`).join(', ')).join(' | '))
    const c = checkPlan(plan, { mujoco, model, log, preview }, problems)
    onChecked?.(plan, c)
    if (!c.pass) { feedback = c.feedback; continue }
    plan.checks = c
    if (place) { reset(); place(plan); log('step', 'Placed the checked plan at once (robot build switched off)') }
    else await build(plan, { robot, log, reset, feed })
    log('done', plan.say)
    preview(null)
    return plan
  }
  if (!globalThis.NO_AI) log('fail', 'The AI found no plan that passes every check in 3 tries.')

  // Second opinion, no AI: search every arrangement of layers and spots.
  log('step', 'Second opinion: searching every arrangement (no AI)…')
  const { found, tried } = search({ maxLayers: 4, limit: 60 })
  // Prefer even layers: boxes of one layer with the same height are what a robot builds cleanly.
  const unevenness = (raw) => {
    const byLayer = {}
    for (const b of raw.boxes) (byLayer[b.layer] ??= []).push(BLOCKS[b.block].size[2])
    return Object.values(byLayer).reduce((s, hs) => s + (Math.max(...hs) - Math.min(...hs)), 0) + 0.001 * Object.keys(byLayer).length
  }
  // Heavy boxes low first (the weight-weighted average layer, measured: the first arrangement that passes the truck
  // test moved from try 28 to try 4 on the demo order), even layers next.
  const heavyLow = (raw) => raw.boxes.reduce((s, b) => s + BLOCKS[b.block].kg * b.layer, 0) / raw.boxes.reduce((s, b) => s + BLOCKS[b.block].kg, 0)
  found.sort((x, y) => (heavyLow(x) - heavyLow(y)) || (unevenness(x) - unevenness(y)))
  let checked = 0
  for (const raw of found) {
    // one arrangement at a time, letting the page draw in between (the physics checks take a moment each)
    await new Promise((r) => setTimeout(r, 0))
    if (++checked % 10 === 0) log('info', `Checked ${checked} of ${found.length} arrangements in the physics simulation…`)
    const { plan: p } = toPositions(raw)
    preview(p, 'checking')
    if (!checkPhysics(mujoco, model, p).stands || !checkTransport(mujoco, model, p, 0.5).pass) continue
    log('ok', `The search found a stacking that passes the rules, stands and passes the truck test (${found.length} of ${tried} arrangements pass the rules). Using it.`)
    p.name = 'found by search'; p.say = 'A stacking found by searching every arrangement; it passed every check.'
    const c = checkPlan(p, { mujoco, model, log, preview })
    onChecked?.(p, c)
    if (!c.pass) break
    p.checks = c
    if (place) { reset(); place(p); log('step', 'Placed the checked plan at once (robot build switched off)') }
    else await build(p, { robot, log, reset, feed })
    log('done', p.say)
    preview(null)
    return p
  }
  if (found.length === 0) {
    log('fail', tried === 0
      ? 'No safe stacking exists for this order on a half pallet: in 4 layers there is no way to give every box a full support with nothing on the fragile ones.'
      : `No safe stacking exists for this order on a half pallet: all ${tried} ways to place every box break a warehouse rule.`)
    // Which single box, moved to a second pallet, would make it work?
    const entries = Object.entries(BLOCKS)
    const helps = []
    for (const [id, box] of entries) {
      delete BLOCKS[id]
      if (search({ maxLayers: 4, limit: 1 }).found.length) helps.push(box.name)
      for (const k of Object.keys(BLOCKS)) delete BLOCKS[k]
      for (const [k, v] of entries) BLOCKS[k] = v // restore, in the original order
    }
    log('info', helps.length
      ? `💡 It works without one of these: ${[...new Set(helps)].join(', ')}. Move it to a second pallet, or remove it from the order.`
      : '💡 Even without any single box it does not work. Split the order over two pallets.')
  } else {
    log('fail', `${found.length} arrangements pass the rules, but none of them passes the truck test unwrapped.`)
    // As in a real warehouse: would stretch wrap make the best of them pass?
    for (const raw of found.slice(0, 10)) {
      const { plan: p } = toPositions(raw)
      if (!checkPhysics(mujoco, model, p).stands) continue
      const t = checkTransport(mujoco, model, p, 0.5, { wrap: true })
      if (t.pass) { log('info', `🎞 With stretch wrap one of them passes (worst ${mm(Math.max(...t.results.map((r) => r.worst)))} mm, limit ${mm(t.limit)} mm). Recommendation: wrap this pallet, or move the lightest, tallest boxes to another pallet.`); break }
    }
  }
  log('fail', 'Nothing was built.')
  // Last resort, as in a real warehouse: would stretch wrap make the best plan pass?
  if (plan && checkRules(plan).length === 0 && checkPhysics(mujoco, model, plan).stands) {
    const t = checkTransport(mujoco, model, plan, 0.5, { wrap: true })
    const worst = Math.max(...t.results.map((r) => r.worst))
    if (t.pass) log('info', `🎞 With stretch wrap, the last plan passes the truck test (worst ${mm(worst)} mm, limit ${mm(t.limit)} mm). Recommendation: wrap this pallet.`)
    else log('fail', `🎞 Even wrapped, the last plan fails (${mm(worst)} mm). This order needs a different pallet or a second pallet.`)
  }
  return null
}

export async function build(plan, { robot, log, reset, feed }) {
  // Layer by layer; inside a layer the NEAR row first (the open fingers reach 6-8 cm forward past the box), and inside
  // a row the RIGHT box first (the thumb sticks out to the left): the hand always reaches into empty space.
  plan = { ...plan, blocks: buildOrder(plan.blocks) }
  log('step', 'Only now the robot builds it')
  // Honest about the robot: boxes heavier than its payload are flagged (the simulation still lifts them).
  const heavy = robot.payloadKg ? plan.blocks.filter((b) => BLOCKS[b.block].kg > robot.payloadKg).map((b) => BLOCKS[b.block].name) : []
  if (heavy.length) log('info', `⚠ Over the UR10e's ${robot.payloadKg} kg payload (UR datasheet): ${heavy.join(', ')}. A real cell needs a bigger arm (UR20: 20 kg) or a person for these.`)
  reset()
  robot.start()
  const placed = []
  const n = plan.blocks.length
  for (const [i, b] of plan.blocks.entries()) {
    const name = BLOCKS[b.block].name
    for (let fix = 0; fix < 3; fix++) {
      const dest = clearOfNeighbours(onWhatIsReallyThere(b, placed, robot), b.block, placed, robot)
      log('step', `${i + 1}/${n}: ${name}${fix ? ' — trying again' : ''}`)
      if (feed) await feed(b.block) // the conveyor brings it, if it is still waiting
      const r = await robot.pickPlace(b.block, dest)
      if (r.dropped) { log('fail', `The vacuum lost the ${name}: it needed ${r.cupN} N, the cup holds ${robot.cupN} N — picking it up again`); continue }
      if (!r.ok) { log('fail', `Could not grab the ${name} after ${r.tries} tries (no vacuum seal)`); break }
      // Measure: is it where it should be?
      const p = robot.P(b.block)
      const off = Math.hypot(p[0] - dest[0], p[1] - dest[1]) * 1000
      const cup = r.cupN !== undefined ? ` · vacuum held ${r.cupN} of ${robot.cupN} N` : ''
      if (off < 15 && Math.abs(p[2] - dest[2]) < 0.006) {
        log('ok', `Measured the ${name}: ${(off * 5).toFixed(0)} mm off, right height${cup}${r.tries > 1 ? ` (grab worked on try ${r.tries})` : ''}`)
        break
      }
      log('fail', `Measured the ${name}: ${cm(p[2])} cm high, should be ${cm(dest[2])} cm — fixing it`)
    }
    placed.push(b)
  }
  await robot.home()
  // Final check: measure every box once more. A box knocked while placing a later one is found and put back.
  log('step', 'Final check: measuring every box against the plan')
  return repair(plan, { robot, log })
}

// Layer by layer; inside a layer the NEAR row first, inside a row the RIGHT box first (see build()).
export function buildOrder(blocks) {
  const bottomOf = (b) => Math.round((b.z - BLOCKS[b.block].size[2] / 2) * 200)
  return [...blocks].sort((p, q) => bottomOf(p) - bottomOf(q) || p.x - q.x || p.y - q.y)
}

// Is this box where the plan put it? (within 15 mm sideways and 6 mm in height)
const inPlace = (b, robot) => { const p = robot.P(b.block); return Math.hypot(p[0] - b.x, p[1] - b.y) < 0.015 && Math.abs(p[2] - b.z) < 0.006 }

// Measure every box of a built pallet against the plan; pick up whatever moved and put it back, lowest first.
export async function repair(plan, { robot, log }) {
  const order = buildOrder(plan.blocks)
  const off = order.filter((b) => !inPlace(b, robot))
  if (off.length === 0) { log('ok', 'Measured every box: all where the plan says'); return true }
  const mmOff = (b) => (Math.hypot(...robot.P(b.block).map((v, k) => v - [b.x, b.y, b.z][k])) * 1000 * 5).toFixed(0)
  log('fail', `Measured every box: ${off.map((b) => `${BLOCKS[b.block].name} is ${mmOff(b)} mm off`).join(', ')}`)
  robot.start()
  for (const b of off) {
    const below = order.slice(0, order.indexOf(b))
    for (let fix = 0; fix < 2; fix++) {
      log('step', `Putting the ${BLOCKS[b.block].name} back${fix ? ' (again)' : ''}`)
      const r = await robot.pickPlace(b.block, clearOfNeighbours(onWhatIsReallyThere(b, below, robot), b.block, below, robot), { gentle: true })
      if (r.ok && inPlace(b, robot)) { log('ok', `The ${BLOCKS[b.block].name} is back in place`); break }
    }
  }
  await robot.home()
  const still = order.filter((b) => !inPlace(b, robot))
  if (still.length) log('fail', `Still out of place: ${still.map((b) => BLOCKS[b.block].name).join(', ')}`)
  else log('done', 'Pallet repaired: every box measured and in place')
  return still.length === 0
}

// A small gap to the boxes already standing beside it (1.5 mm in the model, 7.5 mm real), as real palletizers leave:
// the spots fit with no gap, and a box lowered right against another rubs it sideways. dest: [x, y, z] of box `id`;
// placed: [{ block }] already on the pallet (where they really are is measured).
export function clearOfNeighbours(dest, id, placed, robot) {
  const GAP = 0.0015
  const [sx, sy, sz] = BLOCKS[id].size
  let [x, y] = dest
  for (const p of placed) {
    const [px, py, pz] = robot.P(p.block), [qx, qy, qz] = BLOCKS[p.block].size
    const sideBySide = Math.min(dest[2] + sz / 2, pz + qz / 2) - Math.max(dest[2] - sz / 2, pz - qz / 2) > 0.005
    if (!sideBySide) continue
    const push = (gap) => Math.min(0.003, GAP - gap)
    if (Math.abs(py - y) < (sy + qy) / 2 - 0.002) { const gap = Math.abs(px - x) - (sx + qx) / 2; if (gap < GAP && gap > -0.01) x += Math.sign(x - px || 1) * push(gap) }
    if (Math.abs(px - x) < (sx + qx) / 2 - 0.002) { const gap = Math.abs(py - y) - (sy + qy) / 2; if (gap < GAP && gap > -0.01) y += Math.sign(y - py || 1) * push(gap) }
  }
  return [x, y, dest[2]]
}

// A box that rests on others goes where those boxes REALLY ended up, not where the plan said.
function onWhatIsReallyThere(b, placed, robot) {
  const half = BLOCKS[b.block].size[2] / 2
  const supports = placed.filter((p) => {
    const top = p.z + BLOCKS[p.block].size[2] / 2
    const overlapX = Math.abs(p.x - b.x) < (BLOCKS[p.block].size[0] + BLOCKS[b.block].size[0]) / 2 - 0.005
    const overlapY = Math.abs(p.y - b.y) < (BLOCKS[p.block].size[1] + BLOCKS[b.block].size[1]) / 2 - 0.005
    return Math.abs(top - (b.z - half)) < 0.006 && overlapX && overlapY
  })
  // Only trust supports that really are near their planned spot; and never shift by more than 1.5 cm.
  const there = supports.filter((s) => Math.hypot(...robot.P(s.block).map((v, k) => v - [s.x, s.y, s.z][k])) < 0.03)
  if (there.length === 0) return [b.x, b.y, b.z]
  const cap = (v) => Math.max(-0.015, Math.min(0.015, v))
  const shift = [0, 1].map((k) => cap(there.reduce((a, s) => a + robot.P(s.block)[k] - [s.x, s.y][k], 0) / there.length))
  return [b.x + shift[0], b.y + shift[1], b.z]
}
