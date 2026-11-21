// LoadProof's agent. Gemini does not place boxes: it reads the order and the instructions, then works through tools
// and decides what to do with each result. The search finds arrangements, the physics tests them, the robot builds.
// When a test fails the agent chooses: another arrangement, stretch wrap, or a second pallet; and it works out the
// straps for the truck floor (EN 12195-1). Without the AI (?noai, or no answer) fixed steps call the same tools.
import { BLOCKS, toPositions, checkRules, checkPhysics, checkTransport } from './planner.js'
import { search } from './solver.js'
import { build } from './agent.js'
import { strapsNeeded } from './securing.js'
import { PALLET, CATALOG } from './pallet.js'

const KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? globalThis.GEMINI_KEY
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash']
const REAL = 5 // the model is 1:5
const PALLET_KG = 10 // an empty half pallet, assumed
const labelOf = (id) => BLOCKS[id].name.split(' ')[0]
const mm = (v) => Math.round(v * 1000 * REAL) // model metres -> real millimetres

const SYSTEM = `You are LoadProof, the loading agent of a robot palletizing cell. A UR10e robot stacks the boxes of one
order on a half-EUR pallet (60 x 80 cm). You never place boxes yourself: you call tools, read their results, decide.
- plan_pallet: a classic search finds a stacking that passes the warehouse rules (full support, heavy low, nothing on
  fragile boxes) and stands. Pass keep_on_top for products the instructions want on top; pass skip with plan ids you
  rejected to get the next arrangement.
- truck_test: the physics simulation pushes the stacked pallet like a truck does and measures how far boxes shift on
  the pallet. Pass if no box moves more than 5% of the load height. Profile "eu_test" = 0.5 g in every direction (the
  EU load-unit test, EUMOS 40509) — always run it. Profile "hard_braking" = 0.8 g forward and 0.5 g sideways (road
  values of EN 12195-1) — always run it too: every road trip can brake hard.
  wrapped=true tests the load with stretch film.
- straps_needed: how many top-over straps keep the whole pallet from sliding or tipping on the truck floor (EN
  12195-1). Straps hold the pallet; they do not stop boxes shifting on the pallet — that is what the truck test and
  stretch wrap are for.
- build_pallet: the robot builds the chosen plan, measures every box and repairs what moved; wrap=true wraps it after.
Work like this: plan, run both tests, and if a test fails decide what to change (another arrangement first; stretch
wrap if arrangements keep failing or if only hard braking fails — tall light boxes on top need it; if nothing passes,
say which boxes should go on a second pallet). Then straps, then build — wrapped if the passing tests were wrapped.
Use only results from tools; never invent numbers. Finish with a short message (3-5 sentences, plain English) for the
warehouse worker and the manager: what was built, which tests passed with their numbers, wrap and straps, any warning.`

const DECLS = [
  { name: 'plan_pallet', description: 'Find a stacking for the current order that passes the warehouse rules and stands.',
    parameters: { type: 'OBJECT', properties: {
      keep_on_top: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Product names that must have nothing on them, e.g. ["CHIPS"]' },
      skip: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Plan ids already rejected' } } } },
  { name: 'truck_test', description: 'Shake the stacked pallet in the physics simulation like a truck and measure box shifts.',
    parameters: { type: 'OBJECT', properties: {
      plan_id: { type: 'INTEGER' },
      profile: { type: 'STRING', enum: ['eu_test', 'hard_braking'] },
      wrapped: { type: 'BOOLEAN' } }, required: ['plan_id', 'profile'] } },
  { name: 'straps_needed', description: 'Top-over straps needed to keep this pallet from sliding or tipping on the truck floor (EN 12195-1).',
    parameters: { type: 'OBJECT', properties: { plan_id: { type: 'INTEGER' } }, required: ['plan_id'] } },
  { name: 'build_pallet', description: 'The robot builds the plan, measures every box and repairs what moved. Optionally wraps it after.',
    parameters: { type: 'OBJECT', properties: { plan_id: { type: 'INTEGER' }, wrap: { type: 'BOOLEAN' } }, required: ['plan_id'] } },
]

// The tools, on the real world (mujoco, model) and the real robot. Each returns a small JSON answer for the agent.
export function createTools({ mujoco, model, robot, log, preview, reset, place, wrap, onChecked }) {
  let candidates = null
  const plans = []
  const heavyLow = (raw) => raw.boxes.reduce((s, b) => s + BLOCKS[b.block].kg * b.layer, 0) / raw.boxes.reduce((s, b) => s + BLOCKS[b.block].kg, 0)
  const uneven = (raw) => { const by = {}; for (const b of raw.boxes) (by[b.layer] ??= []).push(BLOCKS[b.block].size[2]); return Object.values(by).reduce((s, h) => s + Math.max(...h) - Math.min(...h), 0) }
  const topOf = (b) => b.z + BLOCKS[b.block].size[2] / 2
  const heightOf = (plan) => Math.max(...plan.blocks.map(topOf))
  const nothingOn = (plan, b) => !plan.blocks.some((o) => o !== b && o.z > b.z + 0.01 && Math.abs(o.x - b.x) < 0.05 && Math.abs(o.y - b.y) < 0.07)
  const describe = (plan) => [...new Set(plan.blocks.map((b) => b.layer))].map((L) =>
    `layer ${L}: ` + plan.blocks.filter((b) => b.layer === L).map((b) => `${BLOCKS[b.block].name} ${b.spot}`).join(', '))
  const get = (id) => { const p = plans[id]; if (!p) throw new Error(`no plan with id ${id}; call plan_pallet first`); return p }
  const state = { plan: null, built: false, wrapped: false, tests: [] }

  const tools = {
    plan_pallet({ keep_on_top = [], skip = [] } = {}) {
      if (!candidates) {
        const { found, tried } = search({ maxLayers: 4, limit: 60 })
        found.sort((x, y) => (heavyLow(x) - heavyLow(y)) || (uneven(x) - uneven(y)))
        candidates = found
        log('info', `Search: ${found.length} arrangements pass the warehouse rules (of ${tried} tried)`)
      }
      if (!candidates.length) return { error: 'No arrangement of this order passes the warehouse rules on one half pallet. Some boxes need a second pallet.' }
      const top = keep_on_top.map((s) => String(s).toUpperCase())
      for (let i = 0; i < candidates.length; i++) {
        if (skip.includes(i)) continue
        const plan = plans[i] ?? toPositions(candidates[i]).plan
        plans[i] = plan
        if (top.length && !plan.blocks.filter((b) => top.includes(labelOf(b.block))).every((b) => nothingOn(plan, b))) continue
        preview(plan, 'checking')
        const phys = checkPhysics(mujoco, model, plan)
        if (!phys.stands) { onChecked?.(plan, { pass: false, feedback: 'fell over on the table' }); continue }
        plan.name = `plan ${i}`
        state.plan = i
        return { plan_id: i, layers: describe(plan), rules: 'pass', stands: 'yes', height_cm: Math.round(heightOf(plan) * 100 * REAL) }
      }
      return { error: `No other arrangement ${top.length ? `keeps ${top.join(', ')} on top and ` : ''}passes the rules and stands.` }
    },

    truck_test({ plan_id, profile = 'eu_test', wrapped = false }) {
      const plan = get(plan_id)
      const g = profile === 'hard_braking' ? { forward: 0.8, other: 0.5 } : 0.5
      preview(plan, 'checking')
      const t = checkTransport(mujoco, model, plan, g, { wrap: wrapped })
      preview(plan, t.pass ? 'good' : 'bad')
      onChecked?.(plan, { pass: t.pass, feedback: t.pass ? '' : 'truck test failed' })
      const out = { plan_id, profile: profile === 'hard_braking' ? 'hard braking: 0.8 g forward, 0.5 g sideways (EN 12195-1)' : 'EU test 0.5 g (EUMOS 40509)',
        wrapped, pass: t.pass, limit_mm: mm(t.limit),
        pushes: t.results.map((r) => ({ push: r.name, worst_box: BLOCKS[r.block].name, moved_mm: mm(r.worst), ...(mm(r.worst) > 300 ? { fell_off_pallet: true } : {}), pass: r.pass })) }
      state.tests.push(out)
      log(t.pass ? 'ok' : 'fail', `🚚 ${out.profile}${wrapped ? ', wrapped' : ''}: ${t.pass ? 'PASSED' : 'FAILED'} — ` +
        out.pushes.map((p) => `${p.push} ${p.fell_off_pallet ? `the ${p.worst_box} fell off` : `${p.moved_mm} mm`}`).join(', ') + ` (limit ${out.limit_mm} mm)`)
      return out
    },

    straps_needed({ plan_id }) {
      const plan = get(plan_id)
      const kg = plan.blocks.reduce((s, b) => s + BLOCKS[b.block].kg, 0) + PALLET_KG
      const r = strapsNeeded({ kg, H: heightOf(plan) * REAL, L: PALLET.sx * REAL, B: PALLET.sy * REAL })
      state.straps = { plan_id, ...r, kg }
      log('ok', `🪢 Straps (EN 12195-1, top-over): ${r.straps} for ${kg} kg, ${r.assumptions.H} m tall — ` +
        r.rows.map((x) => `${x.dir} ${x.bySliding} by sliding`).join(', ') + ` (assumed: friction ${r.assumptions.mu}, straps of ${r.assumptions.ftKN * 100} daN)`)
      return { plan_id, straps: r.straps, load_kg: kg, by_direction: r.rows, assumptions: { ...r.assumptions, pallet_kg: PALLET_KG, note: 'friction 0.4 assumed for a dry wooden floor; an anti-slip mat raises it' } }
    },

    async build_pallet({ plan_id, wrap: doWrap = false }) {
      const plan = get(plan_id)
      preview(null)
      let measured = true
      if (place) { reset(); place(plan); log('step', 'Placed the plan at once (robot build switched off)') }
      else measured = await build(plan, { robot, log, reset })
      if (doWrap) { wrap(); state.wrapped = true }
      state.built = true
      // The record for the report: every test of this plan, wrap, straps.
      const tests = state.tests.filter((t) => t.plan_id === plan_id)
      const counted = tests.filter((t) => !!t.wrapped === doWrap) // the tests of the load as it leaves: wrapped or not
      plan.checks = { pass: counted.length > 0 && counted.every((t) => t.pass) }
      plan.agent = { tests, wrapped: doWrap, straps: state.straps?.plan_id === plan_id ? state.straps : null, instructions: state.instructions }
      state.builtPlan = plan
      return { plan_id, built: true, every_box_where_planned: !!measured, wrapped: doWrap }
    },
  }
  Object.defineProperty(tools, 'plan', { value: get, enumerable: false }) // not a tool for the agent: the plan itself
  return { tools, state, plans }
}

const describeCall = (name, a) => `${name}(${Object.entries(a ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || '—' : v}`).join(', ')})`

async function callAgent(model, contents) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: [{ functionDeclarations: DECLS }] }),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(`HTTP ${res.status} ${e.error?.message?.slice(0, 90) ?? ''}`) }
  const d = await res.json()
  const content = d.candidates?.[0]?.content
  if (!content?.parts?.length) throw new Error('empty answer')
  return content
}

// The agent loop: ask, run the tools it calls, send back the results, until it answers in words.
export async function runLoadAgent({ instructions = '', memoryText = '', ...deps }) {
  const { log } = deps
  const { tools, state } = createTools(deps)
  state.instructions = instructions
  const order = Object.values(BLOCKS).map((b) => b.name).join(', ')
  if (globalThis.NO_AI || !KEY) return fixedSteps(tools, state, deps, instructions)
  const contents = [{ role: 'user', parts: [{ text: `Order: ${order}.\nInstructions: ${instructions || 'none'}.${memoryText}\nPlan, test, secure and build this pallet.` }] }]
  let model = MODELS[0]
  for (let turn = 0; turn < 14; turn++) {
    let content
    try { content = await callAgent(model, contents) } catch (err) {
      if (model === MODELS[0]) { log('info', `${model} did not answer (${err.message}); asking ${MODELS[1]}`); model = MODELS[1]; turn--; continue }
      log('fail', `The AI did not answer (${err.message}). Going on with fixed steps, no AI.`)
      return fixedSteps(tools, state, deps, instructions)
    }
    contents.push(content)
    const calls = content.parts.filter((p) => p.functionCall)
    const said = content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join(' ').trim()
    if (calls.length === 0) { log('done', said || 'Done.'); return state }
    if (said) log('info', `💭 ${said}`)
    const replies = []
    for (const p of calls) {
      const { name, args, id } = p.functionCall
      log('step', `🧠 Agent → ${describeCall(name, args)}`)
      let result
      try { result = tools[name] ? await tools[name](args ?? {}) : { error: `unknown tool ${name}` } } catch (err) {
        if (err.message === 'stopped') throw err
        result = { error: err.message }
      }
      replies.push({ functionResponse: { ...(id ? { id } : {}), name, response: { result } } })
    }
    contents.push({ role: 'user', parts: replies })
  }
  log('fail', 'The agent used too many steps; stopped.')
  return state
}

// Without the AI: the same tools in a fixed order (plan, test, next plan or wrap, straps, build).
async function fixedSteps(tools, state, { log }, instructions) {
  log('info', 'No AI: fixed steps with the same tools')
  const hard = true // every road trip can brake hard (EN 12195-1: 0.8 g forward)
  const call = async (name, args) => { log('step', `⚙ ${describeCall(name, args)}`); return tools[name](args) }
  const skip = []
  let chosen = null, wrapIt = false
  for (let k = 0; k < 6 && chosen === null; k++) {
    const p = await call('plan_pallet', { skip })
    if (p.error) { log('fail', p.error); break }
    const t = await call('truck_test', { plan_id: p.plan_id, profile: 'eu_test' })
    const t2 = t.pass && hard ? await call('truck_test', { plan_id: p.plan_id, profile: 'hard_braking' }) : t
    if (t.pass && t2.pass) chosen = p.plan_id
    else skip.push(p.plan_id)
  }
  if (chosen === null && skip.length) { // wrapped, every test the trip needs
    const t = await call('truck_test', { plan_id: skip[0], profile: 'eu_test', wrapped: true })
    const t2 = t.pass && hard ? await call('truck_test', { plan_id: skip[0], profile: 'hard_braking', wrapped: true }) : t
    if (t.pass && t2.pass) { chosen = skip[0]; wrapIt = true }
  }
  if (chosen === null) { log('fail', 'Nothing passed, even wrapped: split the order over two pallets.'); return state }
  await call('straps_needed', { plan_id: chosen })
  await call('build_pallet', { plan_id: chosen, wrap: wrapIt })
  log('done', `Built plan ${chosen}${wrapIt ? ', wrapped' : ''}; every test result is above.`)
  return state
}

// A plan that passes the EU test, without the AI and without building (for Compare).
export async function quickPlan(deps) {
  const { tools } = createTools(deps)
  const skip = []
  for (let k = 0; k < 8; k++) {
    const p = tools.plan_pallet({ skip })
    if (p.error) { deps.log('fail', p.error); return null }
    if (tools.truck_test({ plan_id: p.plan_id, profile: 'eu_test' }).pass) return tools.plan(p.plan_id)
    skip.push(p.plan_id)
  }
  return null
}

// Reading a free-text order: which catalogue products, how many, and the instructions for the planning agent.
export async function readOrder(text) {
  const schema = { type: 'OBJECT', properties: {
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { product: { type: 'STRING', enum: Object.keys(CATALOG) }, count: { type: 'INTEGER' } }, required: ['product', 'count'] } },
    not_in_catalogue: { type: 'ARRAY', items: { type: 'STRING' } },
    instructions: { type: 'STRING', description: 'What the planning agent must respect: products to keep on top, the trip (hard braking?), anything else. Empty if nothing.' },
  }, required: ['items', 'instructions'] }
  const prompt = `Read this order for a warehouse. Map each item to one catalogue product (${Object.entries(CATALOG).map(([n, c]) => `${n} ${c.kg} kg${c.fragile ? ' fragile' : ''}`).join(', ')}).
At most 9 boxes in total. List what is not in the catalogue. Write the instructions for the loading agent in one or two sentences.\n\nOrder:\n${text}`
  let lastErr
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, signal: AbortSignal.timeout(25000),
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      const r = JSON.parse(d.candidates[0].content.parts.at(-1).text)
      const labels = r.items.flatMap((it) => Array(Math.max(0, Math.min(9, it.count))).fill(it.product)).slice(0, 9)
      return { labels, instructions: r.instructions ?? '', missing: r.not_in_catalogue ?? [], model }
    } catch (err) { lastErr = err }
  }
  throw lastErr
}
