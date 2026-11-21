// Manual takeover: a person steers the UR10e with their own hand through the webcam, like jogging a robot with its
// teach pendant when the automatic mode cannot go on. The palm moves the vacuum cup over the cell; a pinch (thumb tip
// on index tip) picks the box under it; opening the hand puts it down. The robot does the precise part: the height,
// the slow touchdown, snapping to the pallet's spots. LoadProof checks each placement against the warehouse rules
// before you let go (green or red preview), and the truck test checks the finished pallet as usual.
import { BLOCKS, checkRules, snapHeights } from './planner.js'
import { PALLET, SPOTS, INFEED, INFEED_Z } from './pallet.js'

const WORK = { x: [0.16, 0.62], y: [-0.3, 0.3] } // where the cup may go (model metres)
const HOME = [0.38, 0] // where the cup goes with the hand where it was when the takeover started
const GAIN = 1.0 // model metres per full picture width or height
const SMOOTH = 0.25 // 0..1: how quickly the target follows the hand (less = steadier)
const PINCH_ON = 0.3, PINCH_OFF = 0.5 // thumb-index gap / hand size: closed below, open above
const SNAP = 0.04 // a held box snaps to a pallet spot within 4 cm (model)

const clamp = (v, [a, b]) => Math.max(a, Math.min(b, v))
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export function createTakeover({ robot, log, preview }) {
  let neutral = null, target = null, pinched = false, lost = 0
  let state = 'free' // free | busy | holding
  let held = null, dest = null, verdict = null
  const sizeOf = (n) => BLOCKS[n].size
  const name = (n) => BLOCKS[n].name

  // The palm in the picture -> a point over the cell; the pinch with hysteresis.
  function read(img) {
    const ids = [0, 5, 9, 13, 17]
    const palm = { x: ids.reduce((s, i) => s + img[i].x, 0) / 5, y: ids.reduce((s, i) => s + img[i].y, 0) / 5 }
    if (!neutral) neutral = palm
    const raw = [clamp(HOME[0] + (neutral.y - palm.y) * GAIN, WORK.x), clamp(HOME[1] + (palm.x - neutral.x) * GAIN, WORK.y)]
    target = target ? target.map((v, k) => v + SMOOTH * (raw[k] - v)) : raw
    const gap = dist2(img[4], img[8]) / Math.max(1e-6, dist2(img[0], img[9]))
    const was = pinched
    pinched = pinched ? gap < PINCH_OFF : gap < PINCH_ON
    return { pinchNow: pinched && !was, openNow: !pinched && was }
  }

  // The box whose top is under the cup (a top box: nothing on it), or null.
  function boxUnder([x, y]) {
    let best = null
    for (const n of Object.keys(BLOCKS)) {
      const p = robot.P(n), s = sizeOf(n)
      if (p[2] < -0.3 || Math.abs(p[0] - x) > s[0] / 2 - 0.01 || Math.abs(p[1] - y) > s[1] / 2 - 0.01) continue
      const top = p[2] + s[2] / 2
      if (!best || top > best.top) best = { n, top }
    }
    return best?.n ?? null
  }

  // Where the held box would land: snapped to the nearest pallet spot of its kind, else straight down where it is.
  function landing([x, y]) {
    const kind = BLOCKS[held].kind
    let snap = null
    for (const [spot, [sx, sy]] of Object.entries(SPOTS[kind])) {
      const d = Math.hypot(sx - x, sy - y)
      if (d < SNAP && (!snap || d < snap.d)) snap = { spot, x: sx, y: sy, d }
    }
    const onPallet = (p) => Math.abs(p[0] - PALLET.x) < PALLET.sx / 2 && Math.abs(p[1] - PALLET.y) < PALLET.sy / 2 && p[2] > PALLET.top
    const there = Object.keys(BLOCKS).filter((n) => n !== held && onPallet(robot.P(n)))
      .map((n) => { const p = robot.P(n); return { block: n, x: p[0], y: p[1], z: p[2] } }).sort((a, b) => a.z - b.z)
    const at = snap ?? { x, y }
    const plan = snapHeights({ blocks: [...there, { block: held, x: at.x, y: at.y, z: 1 }] })
    const me = plan.blocks.at(-1)
    const inside = Math.abs(at.x - PALLET.x) < PALLET.sx / 2 && Math.abs(at.y - PALLET.y) < PALLET.sy / 2
    let z = me.z
    if (!inside) { // set aside: on the infeed table or the table itself, on top of whatever is there
      const s = sizeOf(held)
      const onInfeed = INFEED.some((w) => at.x > w[0] && at.x < w[1] && at.y > w[2] && at.y < w[3])
      let floor = onInfeed ? INFEED_Z : 0
      for (const n of Object.keys(BLOCKS)) {
        if (n === held) continue
        const p = robot.P(n), t = sizeOf(n)
        if (Math.abs(p[0] - at.x) < (s[0] + t[0]) / 2 && Math.abs(p[1] - at.y) < (s[1] + t[1]) / 2) floor = Math.max(floor, p[2] + t[2] / 2)
      }
      z = floor + s[2] / 2
    }
    const problems = inside ? checkRules(plan).filter((t) => t.includes(held) && !t.includes('missing')) : []
    return { x: at.x, y: at.y, z: z + 0.001, spot: snap?.spot ?? null, inside, problems }
  }

  // Up first, then across: the cup (and the held box) pass above everything between here and the target.
  function hover([x, y]) {
    const g = robot.goal
    const need = Math.max(robot.clearAt(g[0], g[1]), robot.clearAt(x, y), robot.clearAt((g[0] + x) / 2, (g[1] + y) / 2)) + 0.01
    robot.steer(g[2] < need - 0.004 ? [g[0], g[1], need] : [x, y, need])
  }

  // Called every frame with the tracked hand (or null). Returns { text, ring: [x, y] | null, near }.
  function update(hand) {
    if (!hand) {
      lost++
      if (lost > 10) robot.steer(null) // no hand: the robot holds still
      return { text: '✋ Takeover: no hand in view — the robot holds still', ring: null }
    }
    lost = 0
    const { pinchNow, openNow } = read(hand.image)
    if (state === 'busy') return { text: '✋ Takeover: the robot is working…', ring: target }

    if (state === 'holding') {
      if (robot.holding !== held) { // the vacuum lost it
        log('fail', `✋ The vacuum lost the ${name(held)}`)
        state = 'free'; held = null; preview(null)
        return { text: '✋ Takeover', ring: target }
      }
      dest = landing(target)
      verdict = dest.problems.length ? 'bad' : 'good'
      preview({ blocks: [{ block: held, x: dest.x, y: dest.y, z: dest.z }] }, dest.inside ? verdict : 'checking')
      hover([dest.x, dest.y])
      if (openNow) {
        state = 'busy'; robot.steer(null); preview(null)
        const n = held, d = dest
        robot.place(n, [d.x, d.y, d.z]).then((r) => {
          if (!r.ok) log('fail', `✋ The ${name(n)} was lost on the way${r.dropped ? ` (the vacuum needed ${r.cupN} N)` : ''}`)
          else if (!d.inside) log('info', `✋ You set the ${name(n)} aside`)
          else if (d.problems.length) log('fail', `✋ You put the ${name(n)} ${d.spot ? `on ${d.spot}` : 'on the pallet'} — ⚠ ${d.problems.join('; ')}`)
          else log('ok', `✋ You put the ${name(n)} ${d.spot ? `on ${d.spot}` : 'on the pallet'} — warehouse rules OK`)
          state = 'free'; held = null
        }).catch(() => { state = 'free'; held = null })
      }
      const where = !dest.inside ? 'off the pallet (set aside)' : dest.spot ? dest.spot : 'not on a spot'
      return { text: `✋ Holding the ${name(held)} · ${where}${dest.problems.length ? ' · ⚠ ' + dest.problems[0] : ''} · open your hand to put it down`, ring: [dest.x, dest.y], near: verdict === 'good' }
    }

    // free: hover over the cell; pinch over a box to pick it
    const over = boxUnder(target)
    hover(target)
    if (pinchNow && over) {
      state = 'busy'; robot.steer(null)
      robot.pick(over).then((r) => {
        if (r.ok) { state = 'holding'; held = over; log('you', `✋ You picked the ${name(over)}`) }
        else { state = 'free'; log('fail', `✋ Could not grab the ${name(over)} (no vacuum seal)`) }
      }).catch(() => { state = 'free' })
    }
    return { text: over ? `✋ Over the ${name(over)}: pinch (thumb on index finger) to pick it` : '✋ Takeover: move your palm over a box', ring: target, near: !!over }
  }

  return {
    update,
    recentre() { neutral = null; target = null },
    get state() { return state },
  }
}
