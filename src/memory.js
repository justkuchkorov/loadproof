// LoadProof's memory: every checked plan is kept (in this browser), failures are turned into lessons, and both go
// back to the AI with the next request: the lessons, and a plan that already passed for the same set of boxes.

const KEY = 'loadproof.memory.v1'
const store = (() => { try { return globalThis.localStorage ?? null } catch { return null } })()
let mem = load()

function load() {
  try { return JSON.parse(store?.getItem(KEY) ?? '') } catch { return { tested: [], lessons: {}, passed: {} } }
}
function save() { try { store?.setItem(KEY, JSON.stringify(mem)) } catch { /* private window: memory lasts this visit */ } }

// Plain lessons, recognised from the checks' own words.
const RULES = [
  [/rests on fragile/i, 'Never put a box on a fragile box (JARS, CHIPS, TV): fragile boxes go in the top layer.'],
  [/only \d+% supported/, 'Fill the layer below completely before putting boxes on it (each box needs 70% support).'],
  [/much lighter/i, 'Heavy boxes go low: a box may not sit on one more than 1.5 times lighter.'],
  [/hangs over the pallet edge/i, 'Keep every box inside the pallet.'],
  [/cannot use spot/i, 'A wide box uses a column, a long box uses a row, a small box uses one corner spot.'],
  [/fell over on the table|boxes fell/i, 'Uneven layers under other boxes topple even standing still.'],
  [/truck test/i, 'Tall separate columns fall in the truck: build full, even layers that interlock.'],
]

const key = (labels) => [...labels].sort().join(',')

// Record one checked plan. labels: the order's box names; plan: { blocks: [{ block, layer, spot }] } (may be null).
export function record({ labels, names, plan, pass, feedback = '', source = 'AI' }) {
  mem.tested.push({ at: Date.now(), source, pass, order: key(labels), why: feedback.slice(0, 300) })
  if (mem.tested.length > 500) mem.tested.splice(0, mem.tested.length - 500)
  if (!pass) for (const [re, text] of RULES) if (re.test(feedback)) mem.lessons[text] = (mem.lessons[text] ?? 0) + 1
  if (pass && plan && source === 'AI') {
    mem.passed[key(labels)] = plan.blocks.filter((b) => b.spot).map((b) => ({ label: names[b.block], layer: b.layer, spot: b.spot }))
  }
  save()
}

export function stats() {
  const t = mem.tested
  return { tested: t.length, failed: t.filter((e) => !e.pass).length, lessons: Object.keys(mem.lessons).length }
}

export const lessons = () => Object.entries(mem.lessons).sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }))

// What the AI gets with the next request.
export function promptText(labels) {
  const parts = []
  const ls = lessons()
  if (ls.length) parts.push('Lessons from earlier plans that failed the checks:\n' + ls.map((l) => `- ${l.text} (seen ${l.count}x)`).join('\n'))
  const before = mem.passed[key(labels)]
  if (before) {
    parts.push('For this same set of boxes, this plan passed every check before (box name, layer, spot):\n' +
      before.map((b) => `- ${b.label}: layer ${b.layer}, ${b.spot}`).join('\n'))
  }
  return parts.length ? '\n\n' + parts.join('\n\n') : ''
}

export function forget() { mem = { tested: [], lessons: {}, passed: {} }; save() }
