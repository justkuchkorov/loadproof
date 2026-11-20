// The agent loop: design -> check rules -> check physics -> (fix and retry) -> build -> measure each block -> fix.
import { design, snapHeights, checkRules, checkPhysics, BLOCKS } from './planner.js'

const cm = (v) => (v * 100).toFixed(1)

export async function runAgent({ request, mujoco, model, robot, log, preview, reset }) {
  let plan = null
  let feedback = null
  for (let attempt = 0; attempt < 3; attempt++) {
    log('step', attempt === 0 ? 'Asking the AI to design it…' : `Asking the AI to fix it (try ${attempt + 1} of 3)…`)
    const t0 = performance.now()
    const r = await design(request, plan, feedback, attempt)
    plan = snapHeights(r.plan)
    if (r.note) log('info', r.note)
    log('info', `${r.model} designed "${plan.name}" — ${plan.blocks.length} blocks, ${((performance.now() - t0) / 1000).toFixed(1)} s`)
    preview(plan, 'checking')

    const rules = checkRules(plan)
    if (rules.length) {
      feedback = rules.join('; ')
      log('fail', `Rule check failed: ${feedback}`)
      preview(plan, 'bad')
      continue
    }
    log('ok', 'Rule check passed: every block rests on something')

    const phys = checkPhysics(mujoco, model, plan)
    if (!phys.stands) {
      feedback = `in a physics test these blocks fell or slid: ${phys.fell.join(', ')}`
      log('fail', `Physics check: ${phys.fell.map((b) => BLOCKS[b].name).join(', ')} fell`)
      preview(plan, 'bad')
      continue
    }
    log('ok', 'Physics check passed: it stands (no block moved 5 mm in 2 s)')
    preview(plan, 'good')
    await build(plan, { robot, log, reset })
    log('done', plan.say)
    preview(null)
    return
  }
  log('fail', 'No design passed both checks after 3 tries. Try asking differently.')
}

async function build(plan, { robot, log, reset }) {
  log('step', 'Clearing the table, then building')
  reset()
  robot.start()
  const placed = []
  const n = plan.blocks.length
  for (const [i, b] of plan.blocks.entries()) {
    const name = BLOCKS[b.block].name
    for (let fix = 0; fix < 3; fix++) {
      const dest = onWhatIsReallyThere(b, placed, robot)
      log('step', `${i + 1}/${n}: ${name}${fix ? ' — trying again' : ''}`)
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

// A block that rests on others goes where those blocks REALLY ended up, not where the plan said.
function onWhatIsReallyThere(b, placed, robot) {
  const half = BLOCKS[b.block].size[2] / 2
  const supports = placed.filter((p) => {
    const top = p.z + BLOCKS[p.block].size[2] / 2
    const overlapX = Math.abs(p.x - b.x) < (BLOCKS[p.block].size[0] + BLOCKS[b.block].size[0]) / 2
    const overlapY = Math.abs(p.y - b.y) < (BLOCKS[p.block].size[1] + BLOCKS[b.block].size[1]) / 2
    return Math.abs(top - (b.z - half)) < 0.006 && overlapX && overlapY
  })
  if (supports.length === 0) return [b.x, b.y, b.z]
  const shift = [0, 1].map((k) => supports.reduce((a, s) => a + robot.P(s.block)[k] - [s.x, s.y][k], 0) / supports.length)
  return [b.x + shift[0], b.y + shift[1], b.z]
}
