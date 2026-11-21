// LoadProof's agent loop: plan -> warehouse rules -> it stands -> 0.5 g truck test -> (fix and retry) ->
// build -> measure each box -> fix. Nothing is built until the plan has passed every check.
import { design, toPositions, checkRules, checkPhysics, checkTransport, BLOCKS } from './planner.js'

const cm = (v) => (v * 100).toFixed(1)
const mm = (v) => (v * 1000).toFixed(0)

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
  return { pass: true }
}

export async function runAgent({ request, mujoco, model, robot, log, preview, reset, feed, place, onChecked }) {
  let plan = null
  let raw = null
  let feedback = null
  for (let attempt = 0; attempt < 3; attempt++) {
    log('step', attempt === 0 ? 'Asking the AI to plan the pallet…' : `Asking the AI to fix the plan (try ${attempt + 1} of 3)…`)
    const t0 = performance.now()
    const r = await design(request, raw, feedback, attempt)
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
    if (place) { reset(); place(plan); log('step', 'Placed the checked plan at once (robot build switched off)') }
    else await build(plan, { robot, log, reset, feed })
    log('done', plan.say)
    preview(null)
    return plan
  }
  log('fail', 'No plan passed every check after 3 tries. Nothing was built.')
  return null
}

export async function build(plan, { robot, log, reset, feed }) {
  // Layer by layer; inside a layer the NEAR row first (the open fingers reach 6-8 cm forward past the box), and inside
  // a row the RIGHT box first (the thumb sticks out to the left): the hand always reaches into empty space.
  const bottomOf = (b) => Math.round((b.z - BLOCKS[b.block].size[2] / 2) * 200)
  plan = { ...plan, blocks: [...plan.blocks].sort((p, q) => bottomOf(p) - bottomOf(q) || p.x - q.x || p.y - q.y) }
  log('step', 'Only now the robot builds it')
  reset()
  robot.start()
  const placed = []
  const n = plan.blocks.length
  for (const [i, b] of plan.blocks.entries()) {
    const name = BLOCKS[b.block].name
    for (let fix = 0; fix < 3; fix++) {
      const dest = onWhatIsReallyThere(b, placed, robot)
      log('step', `${i + 1}/${n}: ${name}${fix ? ' — trying again' : ''}`)
      if (feed) await feed(b.block) // the conveyor brings it, if it is still waiting
      const r = await robot.pickPlace(b.block, dest)
      if (!r.ok) { log('fail', `Could not grab the ${name} after ${r.tries} tries`); break }
      // Measure: is it where it should be?
      const p = robot.P(b.block)
      const off = Math.hypot(p[0] - dest[0], p[1] - dest[1]) * 1000
      if (off < 15 && Math.abs(p[2] - dest[2]) < 0.006) {
        log('ok', `Measured the ${name}: ${off.toFixed(0)} mm off, right height${r.tries > 1 ? ` (grab worked on try ${r.tries})` : ''}`)
        break
      }
      log('fail', `Measured the ${name}: ${cm(p[2])} cm high, should be ${cm(dest[2])} cm — fixing it`)
    }
    placed.push(b)
  }
  await robot.home()
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
