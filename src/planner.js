// LoadProof's planner (Gemini) and the checks every pallet plan must pass before the hand touches a box:
// 1. warehouse rules  2. it stands (physics)  3. the 0.5 g truck test (physics, after EUMOS 40509).
import { ORDER, PALLET, size, kind, SPOTS, wrapBoxes, parkArm } from './pallet.js'

const KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? globalThis.GEMINI_KEY // the page reads .env.local; Node tests set GEMINI_KEY
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'] // fast first; the stronger one if the fast one keeps failing

// The boxes of the current order, by id: { size: [x, y, z] metres, name, kg, fragile }.
export const BLOCKS = {}
export function setOrder(order) {
  for (const k of Object.keys(BLOCKS)) delete BLOCKS[k]
  for (const b of order) BLOCKS[b.id] = { size: size(b), name: `${b.label} ${b.kg} kg${b.fragile ? ' (fragile)' : ''}`, kg: b.kg, fragile: b.fragile, kind: kind(b) }
}
setOrder(ORDER)

const area = { x0: PALLET.x - PALLET.sx / 2, x1: PALLET.x + PALLET.sx / 2, y0: PALLET.y - PALLET.sy / 2, y1: PALLET.y + PALLET.sy / 2 }

function systemPrompt() {
  const list = Object.entries(BLOCKS).map(([id, b]) => `- ${id}: ${b.name}, ${b.kind} box, ${(b.size[2] * 500).toFixed(0)} cm tall (real)`).join('\n')
  return `You plan how a robot stacks the boxes of one order onto a half-EUR pallet (60 x 80 cm), in layers.
Boxes (use every box exactly once; they cannot be turned):
${list}
The pallet has 4 spots per layer: near-left, near-right, far-left, far-right.
- A small box fills ONE spot: say "near-left", "near-right", "far-left" or "far-right".
- A wide box fills the near AND far spot of one side: say "left column" or "right column".
- A long box fills the left AND right spot of one row: say "near row" or "far row".
Answer with three lists — smallBoxes, wideBoxes, longBoxes — each box in the list of its kind, with a layer number
(1 = on the pallet) and a spot that fits its kind. Within a layer, spots must not overlap.
Rules:
1. Every box must stand on boxes below it (the layer below must be filled under it).
2. A box never rests on one that is much lighter (more than 1.5 times lighter). Nothing rests on a fragile box.
3. The load must survive a truck braking or swerving at 0.5 g (EU test EUMOS 40509). What survives: full, even layers;
   heavy boxes low; layers that interlock (a layer of long boxes crossing a layer of wide boxes). What falls: tall
   separate columns, half-empty layers with boxes on top, uneven layers under other boxes.
List the boxes in build order, layer 1 first. Give the plan a short name and tell the user in one sentence why it is stable.`
}

const SPOT_NAMES = [...new Set(Object.values(SPOTS).flatMap((s) => Object.keys(s)))]
const KIND_LIST = { small: 'smallBoxes', wide: 'wideBoxes', long: 'longBoxes' }
const SCHEMA = () => {
  const list = (kind) => {
    const ids = Object.keys(BLOCKS).filter((id) => BLOCKS[id].kind === kind)
    return { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      block: { type: 'STRING', enum: ids.length ? ids : ['none'] },
      layer: { type: 'INTEGER' },
      spot: { type: 'STRING', enum: Object.keys(SPOTS[kind]) } },
      required: ['block', 'layer', 'spot'] } }
  }
  return {
    type: 'OBJECT',
    properties: { name: { type: 'STRING' }, smallBoxes: list('small'), wideBoxes: list('wide'), longBoxes: list('long'), say: { type: 'STRING' } },
    required: ['name', 'smallBoxes', 'wideBoxes', 'longBoxes', 'say'],
  }
}

// Turn the AI's layers and spots into positions. A spot that does not fit the box's kind is reported as a problem.
export function toPositions(raw) {
  const problems = []
  const all = raw.boxes ?? [...(raw.smallBoxes ?? []), ...(raw.wideBoxes ?? []), ...(raw.longBoxes ?? [])].filter((b) => b.block !== 'none')
  const boxes = [...all].sort((a, b) => a.layer - b.layer)
  const blocks = []
  for (const b of boxes) {
    const box = BLOCKS[b.block]
    if (!box) { problems.push(`unknown box ${b.block}`); continue }
    const xy = SPOTS[box.kind][b.spot]
    if (!xy) { problems.push(`${b.block} is a ${box.kind} box and cannot use spot "${b.spot}" (it can use: ${Object.keys(SPOTS[box.kind]).join(', ')})`); continue }
    blocks.push({ block: b.block, x: xy[0], y: xy[1], z: 1, layer: b.layer, spot: b.spot })
  }
  return { plan: snapHeights({ name: raw.name, say: raw.say, blocks }), problems }
}

async function callGemini(model, contents, retries = 2) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    signal: AbortSignal.timeout(25000), // never hang the demo: give up after 25 s
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA() },
    }),
  })
  if ((res.status === 503 || res.status === 429) && retries > 0) { // busy: wait a moment and ask again
    await new Promise((r) => setTimeout(r, 1500))
    return callGemini(model, contents, retries - 1)
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(`HTTP ${res.status} ${e.error?.message?.slice(0, 80) ?? ''}`)
  }
  const d = await res.json()
  return JSON.parse(d.candidates[0].content.parts.at(-1).text)
}

// Ask for a plan. `feedback` = what was wrong with the last one, so the AI can fix it.
// The fast model is asked SAMPLES times in parallel; the answers are checked against the rules at once and the best
// one is kept (generate several, verify, keep the best). Each answer takes about a second.
const SAMPLES = 3
export async function design(request, previous, feedback, attempt) {
  const contents = [{ role: 'user', parts: [{ text: request }] }]
  if (previous) {
    contents.push({ role: 'model', parts: [{ text: JSON.stringify(previous) }] })
    contents.push({ role: 'user', parts: [{ text: `That plan failed: ${feedback}. Fix it and send the whole plan again.` }] })
  }
  const model = MODELS[0]
  const answers = (await Promise.allSettled(Array.from({ length: SAMPLES }, () => callGemini(model, contents))))
    .filter((r) => r.status === 'fulfilled').map((r) => r.value)
  if (answers.length === 0) {
    const other = MODELS[1]
    return { plan: await callGemini(other, contents), model: other, note: `${model} failed ${SAMPLES} times, used ${other}` }
  }
  const scored = answers.map((raw) => { const { plan, problems } = toPositions(raw); return { raw, n: problems.length + checkRules(plan).length } })
  scored.sort((x, y) => x.n - y.n)
  return { plan: scored[0].raw, model, note: `asked ${SAMPLES} times in parallel, kept the best (rule problems: ${scored.map((s) => s.n).join(', ')})` }
}

// Overlap area of two boxes seen from above.
function overlap(a, b) {
  const [ax, ay] = BLOCKS[a.block].size
  const [bx, by] = BLOCKS[b.block].size
  const ox = Math.min(a.x + ax / 2, b.x + bx / 2) - Math.max(a.x - ax / 2, b.x - bx / 2)
  const oy = Math.min(a.y + ay / 2, b.y + by / 2) - Math.max(a.y - ay / 2, b.y - by / 2)
  return ox > 0 && oy > 0 ? ox * oy : 0
}
const top = (b) => b.z + BLOCKS[b.block].size[2] / 2
const bottom = (b) => b.z - BLOCKS[b.block].size[2] / 2

// Snap every box's height to exactly where it would rest: on the pallet, or on the highest boxes under it.
export function snapHeights(plan) {
  const placed = []
  for (const b of plan.blocks) {
    if (!BLOCKS[b.block]) continue
    let rest = PALLET.top
    for (const p of placed) if (overlap(p, b) > 0 && top(p) < b.z + 0.012) rest = Math.max(rest, top(p))
    b.z = rest + BLOCKS[b.block].size[2] / 2
    placed.push(b)
  }
  return plan
}

// Warehouse rules. Returns a list of problems in plain words (empty = all good).
export function checkRules(plan) {
  const problems = []
  const seen = new Set()
  const placed = []
  for (const b of plan.blocks) {
    const box = BLOCKS[b.block]
    if (!box) { problems.push(`unknown box ${b.block}`); continue }
    if (seen.has(b.block)) problems.push(`${b.block} is used twice`)
    seen.add(b.block)
    const [sx, sy] = box.size
    if (b.x - sx / 2 < area.x0 - 0.004 || b.x + sx / 2 > area.x1 + 0.004 || b.y - sy / 2 < area.y0 - 0.004 || b.y + sy / 2 > area.y1 + 0.004) {
      problems.push(`${b.block} (${box.name}) hangs over the pallet edge`)
    }
    if (Math.abs(bottom(b) - PALLET.top) > 0.004) {
      const under = placed.filter((p) => overlap(p, b) > 0 && Math.abs(top(p) - bottom(b)) < 0.004)
      const supported = under.reduce((a, p) => a + overlap(p, b), 0) / (sx * sy)
      if (supported < 0.7) problems.push(`${b.block} (${box.name}) is only ${Math.round(supported * 100)}% supported, needs 70%`)
      for (const p of under) {
        if (BLOCKS[p.block].fragile) problems.push(`${b.block} rests on fragile ${p.block} (${BLOCKS[p.block].name})`)
        else if (box.kg > 1.5 * BLOCKS[p.block].kg) problems.push(`heavy ${b.block} (${box.name}) rests on much lighter ${p.block} (${BLOCKS[p.block].name})`)
      }
    }
    placed.push(b)
  }
  for (const id of Object.keys(BLOCKS)) if (!seen.has(id)) problems.push(`${id} (${BLOCKS[id].name}) is missing`)
  return problems
}

// A fresh copy of the world with the plan's boxes placed straight at their spots and the hand far away.
function worldWith(mujoco, model, plan) {
  const d = new mujoco.MjData(model)
  const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
  const qadr = (n) => model.jnt_qposadr[model.body_jntadr[body(n)]]
  parkArm(mujoco, model, d) // the arm (if this is the arm cell) parked, out of the way
  if (body('rh_forearm') >= 0) { // the hand, moved far away
    const fa = qadr('rh_forearm')
    d.qpos[fa] = -0.8; d.qpos[fa + 2] = 0.6
    d.mocap_pos.set([-0.8, 0, 0.6])
  }
  for (const b of plan.blocks) d.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], qadr(b.block))
  mujoco.mj_forward(model, d)
  return { d, pos: (n) => { const i = 3 * body(n); return [d.xpos[i], d.xpos[i + 1], d.xpos[i + 2]] } }
}
const run = (mujoco, model, d, sec) => { for (let i = 0; i < Math.round(sec / model.opt.timestep); i++) mujoco.mj_step(model, d) }

// Physics check 1: does it stand? Place everything, run 2 s, see what moved.
export function checkPhysics(mujoco, model, plan) {
  const { d, pos } = worldWith(mujoco, model, plan)
  try {
    run(mujoco, model, d, 2)
    const moved = Object.fromEntries(plan.blocks.map((b) => [b.block, Math.hypot(...pos(b.block).map((v, k) => v - [b.x, b.y, b.z][k])) * 1000]))
    const fell = Object.entries(moved).filter(([, mm]) => mm > 5).map(([n]) => n)
    return { stands: fell.length === 0, moved, fell }
  } finally {
    d.delete()
  }
}

// Physics check 2, the truck test after EUMOS 40509: push at `g` for 0.5 s in each of four directions.
// Pass: every box moved less than 5% of the load's height.
export const PUSH_DIRECTIONS = [['to the right', [0, -1]], ['to the left', [0, 1]], ['forward (braking)', [1, 0]], ['backward', [-1, 0]]]
export function checkTransport(mujoco, model, plan, g = 0.5, { wrap = false } = {}) {
  const height = Math.max(...plan.blocks.map(top))
  const limit = 0.05 * height
  const gravity = Array.from(model.opt.gravity)
  const results = []
  for (const [name, dir] of PUSH_DIRECTIONS) {
    const { d, pos } = worldWith(mujoco, model, plan)
    try {
      run(mujoco, model, d, 0.5)
      if (wrap) wrapBoxes(mujoco, model, d, plan.blocks.map((b) => b.block))
      const before = plan.blocks.map((b) => pos(b.block))
      model.opt.gravity.set([dir[0] * g * 9.81, dir[1] * g * 9.81, -9.81]) // inside the truck, the push feels like tilted gravity
      run(mujoco, model, d, 0.5)
      model.opt.gravity.set(gravity)
      run(mujoco, model, d, 1.0)
      const moved = plan.blocks.map((b, i) => Math.hypot(...pos(b.block).map((v, k) => v - before[i][k])))
      const worst = Math.max(...moved)
      results.push({ name, worst, pass: worst < limit, block: plan.blocks[moved.indexOf(worst)].block })
    } finally {
      model.opt.gravity.set(gravity)
      d.delete()
    }
  }
  return { pass: results.every((r) => r.pass), limit, height, results }
}
