// The AI designer (Gemini) and the two checks every design must pass before the hand touches a block:
// 1. rule check (does every block rest on something?)  2. physics check (put the blocks there and let MuJoCo run).

const KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? globalThis.GEMINI_KEY // the page reads .env.local; Node tests set GEMINI_KEY
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'] // fast first; the stronger one if the fast one keeps failing

export const BLOCKS = {
  cube1: { size: [0.05, 0.05, 0.05], name: 'red cube' },
  cube2: { size: [0.05, 0.05, 0.05], name: 'blue cube' },
  cube3: { size: [0.05, 0.05, 0.05], name: 'green cube' },
  cube4: { size: [0.05, 0.05, 0.05], name: 'yellow cube' },
  plank: { size: [0.04, 0.16, 0.04], name: 'purple beam' },
}

const SYSTEM = `You design block structures that a robot hand will build on a table. Units: metres. Table top is z=0.
Build area: x from 0.16 to 0.36 (forward), y from -0.20 to 0.20 (left/right). Stay inside it.
Blocks you may use (each at most once; you do not have to use all):
- cube1 (red), cube2 (blue), cube3 (green), cube4 (yellow): cubes 0.05 wide. On the table z=0.025; on a cube z=0.075; on two cubes z=0.125.
- plank (purple): a beam 0.04 (x) by 0.16 (y) by 0.04 (z), long side along y, it cannot be turned.
  Its centre z = (top of what it rests on) + 0.02. Lying on the table: z=0.02.
Rules: every block rests on the table or fully on blocks below it (same x and y for a cube on a cube).
The plank needs two supports, one under each end: support centres 0.10 to 0.13 apart in y, same x as the plank.
Leave at least 0.06 between separate stacks. List blocks in build order, lowest first.
Name the structure and tell the user in one short sentence what you built.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    blocks: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      block: { type: 'STRING', enum: Object.keys(BLOCKS) },
      x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, z: { type: 'NUMBER' } },
      required: ['block', 'x', 'y', 'z'] } },
    say: { type: 'STRING' },
  },
  required: ['name', 'blocks', 'say'],
}

async function callGemini(model, contents, retries = 2) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
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

// Ask for a design. `feedback` = what was wrong with the last one, so the AI can fix it.
export async function design(request, previous, feedback, attempt) {
  const contents = [{ role: 'user', parts: [{ text: request }] }]
  if (previous) {
    contents.push({ role: 'model', parts: [{ text: JSON.stringify(previous) }] })
    contents.push({ role: 'user', parts: [{ text: `That design has problems: ${feedback}. Fix them and send the whole design again.` }] })
  }
  const model = MODELS[attempt >= 2 ? 1 : 0]
  try {
    return { plan: await callGemini(model, contents), model }
  } catch (err) { // busy or failed: try the other model once
    const other = MODELS.find((m) => m !== model)
    return { plan: await callGemini(other, contents), model: other, note: `${model} failed (${err.message}), used ${other}` }
  }
}

// Snap every block's height to exactly where it would rest (on the table, or on the blocks under it).
export function snapHeights(plan) {
  const placed = []
  for (const b of plan.blocks) {
    const [sx, sy, sz] = BLOCKS[b.block]?.size ?? [0.05, 0.05, 0.05]
    let rest = 0
    for (const p of placed) {
      const [px, py, pz] = BLOCKS[p.block].size
      const top = p.z + pz / 2
      const overlap = Math.abs(p.x - b.x) < (px + sx) / 2 - 0.005 && Math.abs(p.y - b.y) < (py + sy) / 2 - 0.005
      if (overlap && top < b.z + 0.012) rest = Math.max(rest, top)
    }
    b.z = rest + sz / 2
    placed.push(b)
  }
  return plan
}

// Rule check: every block must sit on the table or on the blocks under it.
export function checkRules(plan) {
  const problems = []
  const seen = new Set()
  const placed = []
  for (const b of plan.blocks) {
    if (!BLOCKS[b.block]) { problems.push(`unknown block ${b.block}`); continue }
    if (seen.has(b.block)) problems.push(`${b.block} is used twice`)
    seen.add(b.block)
    if (b.x < 0.15 || b.x > 0.37 || b.y < -0.21 || b.y > 0.21) problems.push(`${b.block} is outside the build area`)
    const half = BLOCKS[b.block].size[2] / 2
    if (Math.abs(b.z - half) < 0.004) { placed.push(b); continue } // on the table
    if (b.block === 'plank') {
      const sup = placed.filter((p) => p.block.startsWith('cube') && Math.abs(p.x - b.x) < 0.015 &&
        Math.abs(p.z + 0.025 + 0.02 - b.z) < 0.006 && Math.abs(p.y - b.y) > 0.04 && Math.abs(p.y - b.y) < 0.08)
      if (new Set(sup.map((p) => p.y > b.y)).size < 2) problems.push(`the plank at x=${b.x.toFixed(2)}, y=${b.y.toFixed(2)} needs a cube under EACH end, at y≈${(b.y - 0.06).toFixed(2)} and y≈${(b.y + 0.06).toFixed(2)} with the same x and the same height — or leave the plank out`)
    } else {
      const under = placed.find((p) => Math.abs(p.x - b.x) < 0.01 && Math.abs(p.y - b.y) < 0.01 &&
        Math.abs(p.z + BLOCKS[p.block].size[2] / 2 + half - b.z) < 0.004)
      if (!under) problems.push(`${b.block} at z=${b.z.toFixed(3)} has nothing directly under it`)
    }
    placed.push(b)
  }
  return problems
}

// Physics check: in a separate copy of the world, put every block straight at its spot, run 2 s, see what moved.
export function checkPhysics(mujoco, model, plan) {
  const d = new mujoco.MjData(model)
  try {
    const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
    const qadr = (n) => model.jnt_qposadr[model.body_jntadr[body(n)]]
    const fa = qadr('rh_forearm')
    d.qpos[fa] = -0.8; d.qpos[fa + 2] = 0.6 // hand far away
    d.mocap_pos.set([-0.8, 0, 0.6])
    for (const b of plan.blocks) d.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], qadr(b.block))
    mujoco.mj_forward(model, d)
    const steps = Math.round(2 / model.opt.timestep)
    for (let i = 0; i < steps; i++) mujoco.mj_step(model, d)
    const moved = {}
    for (const b of plan.blocks) {
      const i = 3 * body(b.block)
      moved[b.block] = Math.hypot(d.xpos[i] - b.x, d.xpos[i + 1] - b.y, d.xpos[i + 2] - b.z) * 1000
    }
    const fell = Object.entries(moved).filter(([, mm]) => mm > 5).map(([n]) => n)
    return { stands: fell.length === 0, moved, fell }
  } finally {
    d.delete()
  }
}
