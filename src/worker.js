// Worker mode: a person decides, the robot does it, LoadProof checks. The worker chooses a box and a spot on the pallet
// (a click on the screen, or a tap on the phone remote); LoadProof shows its own suggestion for that box (green), and
// checks the worker's choice against the warehouse rules before the robot moves (red, with the reason). The robot
// picks and places with its usual skills (camera, vacuum, paths). Like a palletizing cell's operator screen.
import { BLOCKS, checkRules, snapHeights } from './planner.js'
import { PALLET, SPOTS, ARM } from './pallet.js'
import { buildOrder } from './agent.js'

export function createWorker({ robot, log, preview, suggestion }) {
  let selected = null // the box the worker chose
  let pending = null // the spot shown, waiting for a confirming click
  let busy = false
  const name = (n) => BLOCKS[n].name
  const onPallet = (p) => Math.abs(p[0] - PALLET.x) < PALLET.sx / 2 && Math.abs(p[1] - PALLET.y) < PALLET.sy / 2 && p[2] > PALLET.top
  const placed = () => Object.keys(BLOCKS).filter((n) => onPallet(robot.P(n)))
  const waiting = () => Object.keys(BLOCKS).filter((n) => !onPallet(robot.P(n)) && robot.P(n)[2] > -0.3)

  // A spot for the selected box: where it would rest, and which rules it would break.
  function spotFor(spot) {
    const [x, y] = SPOTS[BLOCKS[selected].kind][spot]
    // Boxes on the pallet, each counted on its spot when within 1 cm of it: millimetres of placing error must not make
    // two neighbours overlap in the check.
    const there = placed().map((n) => {
      const p = robot.P(n)
      const near = Object.values(SPOTS[BLOCKS[n].kind]).map(([sx, sy]) => [sx, sy, Math.hypot(sx - p[0], sy - p[1])]).sort((a, b) => a[2] - b[2])[0]
      return { block: n, x: near[2] < 0.01 ? near[0] : p[0], y: near[2] < 0.01 ? near[1] : p[1], z: p[2] }
    }).sort((a, b) => a.z - b.z)
    const plan = snapHeights({ blocks: [...there, { block: selected, x, y, z: 1 }] })
    const me = plan.blocks.at(-1)
    const [sx, sy] = BLOCKS[selected].size
    const problems = checkRules(plan).filter((t) => t.includes(selected) && !t.includes('missing'))
    // The robot stands behind the pallet: to put a box here it reaches over what stands between (farther, toward the
    // robot). A box there as tall as this one would be hit.
    const myTop = me.z + BLOCKS[selected].size[2] / 2
    for (const b of there) {
      const s = BLOCKS[b.block].size
      const between = (b.x - x) * Math.sign(ARM.base[0] - x) > (s[0] + sx) / 2 - 0.01 && Math.abs(b.y - y) < (s[1] + sy) / 2 - 0.005
      if (between && b.z + s[2] / 2 > myTop - 0.02) problems.push(`the robot's arm would reach over the ${name(b.block)} behind it and hit it — place the near row first`)
    }
    const under = there.filter((b) => b.z < me.z - 0.01 && Math.abs(b.x - x) < (sx + BLOCKS[b.block].size[0]) / 2 - 0.005 && Math.abs(b.y - y) < (sy + BLOCKS[b.block].size[1]) / 2 - 0.005)
    const layer = 1 + new Set(under.map((b) => Math.round(b.z * 200))).size // levels below it
    return { spot, x, y, z: me.z + 0.001, problems, layer }
  }
  const nearestSpot = ([x, y]) => Object.entries(SPOTS[BLOCKS[selected].kind])
    .map(([spot, [sx, sy]]) => ({ spot, d: Math.hypot(sx - x, sy - y) })).sort((a, b) => a.d - b.d)[0].spot
  // LoadProof's own spot for this box: from the checked plan, if its spot is still free and supported now.
  function suggest() {
    const b = suggestion?.blocks.find((x) => x.block === selected)
    if (b?.spot) { const s = spotFor(b.spot); if (!s.problems.length) return s }
    for (const spot of Object.keys(SPOTS[BLOCKS[selected].kind])) { const s = spotFor(spot); if (!s.problems.length) return s }
    return null
  }
  function next() {
    const left = waiting()
    return suggestion ? buildOrder(suggestion.blocks).map((b) => b.block).find((n) => left.includes(n)) ?? left[0] : left[0]
  }
  const show = (s) => preview(s ? { blocks: [{ block: selected, x: s.x, y: s.y, z: s.z }] } : null, s?.problems.length ? 'bad' : 'good')

  function select(n) {
    if (busy || !BLOCKS[n] || !waiting().includes(n)) return false
    selected = n
    pending = suggest()
    show(pending)
    log('you', `👆 You chose the ${name(n)}`)
    const nx = next()
    if (nx && nx !== n && name(nx) !== name(n)) log('info', `LoadProof would place the ${name(nx)} first (layer by layer, near row before far row: the robot reaches over the far row)`)
    log('info', pending ? `LoadProof suggests: ${pending.spot}, layer ${pending.layer} (green). Click it to place there, or click another spot.` : 'No spot on the pallet takes this box without breaking a rule now — place other boxes first.')
    return true
  }

  // The worker points at a spot (by name, or a point on the pallet). Shown first; the same spot again places the box.
  async function choose(spotOrPoint) {
    if (busy || !selected) return
    const spot = typeof spotOrPoint === 'string' ? spotOrPoint : nearestSpot(spotOrPoint)
    if (!SPOTS[BLOCKS[selected].kind][spot]) return
    const s = spotFor(spot)
    if (!pending || pending.spot !== spot) { // first click: show it, with LoadProof's verdict
      pending = s
      show(s)
      log(s.problems.length ? 'fail' : 'ok', s.problems.length ? `${spot}: ⚠ ${s.problems.join('; ')} — click it again to place it anyway` : `${spot}, layer ${s.layer}: warehouse rules OK — click again to place`)
      return
    }
    busy = true
    const n = selected
    preview(null)
    log('step', `The robot places the ${name(n)} on ${spot}`)
    try {
      robot.start()
      const r = await robot.pickPlace(n, [s.x, s.y, s.z])
      if (!r.ok) log('fail', r.dropped ? `The vacuum lost the ${name(n)} (it needed ${r.cupN} N)` : `Could not grab the ${name(n)}`)
      else log(s.problems.length ? 'fail' : 'ok', `Placed the ${name(n)} on ${spot}, layer ${s.layer}${s.problems.length ? ' — against LoadProof\'s advice' : ''}`)
      await robot.home()
    } catch (err) { if (err.message !== 'stopped') log('fail', err.message) }
    busy = false; selected = null; pending = null
    if (waiting().length === 0) log('done', 'Every box is on the pallet. Press 🚚 Truck test to see whether your stack survives the truck.')
  }

  return {
    select, choose, next,
    waiting, placed,
    get selected() { return selected },
    get pending() { return pending?.spot ?? null }, // the spot shown now (LoadProof's suggestion after a choice)
    get busy() { return busy },
    get text() {
      if (busy) return '👆 Worker mode · the robot is placing the box…'
      if (!selected) return `👆 Worker mode · click a box on the table (${waiting().length} waiting${next() ? ` · LoadProof's next: ${name(next())}` : ''})`
      return `👆 ${name(selected)} · click a spot on the pallet (green = LoadProof's suggestion)`
    },
    stop() { selected = null; pending = null; preview(null) },
  }
}
