// Node test: does physics separate a rushed "worker's stack" from a planned, interlocked one? (0.5 g truck test)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { sceneXml, ORDER, PALLET, size } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
mujoco.FS.writeFile('/w/shadow_hand/scene_pallet.xml', sceneXml())
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_pallet.xml')
const byId = Object.fromEntries(ORDER.map((b) => [b.id, b]))
const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
const qadr = (n) => model.jnt_qposadr[model.body_jntadr[body(n)]]

function test(plan, g) {
  const out = {}
  const height = Math.max(...plan.map((p) => p.z + size(byId[p.id])[2] / 2))
  for (const [name, dir] of [['right', [0, 1]], ['left', [0, -1]], ['brake', [1, 0]], ['speed up', [-1, 0]]]) {
    const d = new mujoco.MjData(model)
    d.qpos[qadr('rh_forearm')] = -0.8; d.qpos[qadr('rh_forearm') + 2] = 0.6; d.mocap_pos.set([-0.8, 0, 0.6])
    for (const p of plan) d.qpos.set([p.x, p.y, p.z, 1, 0, 0, 0], qadr(p.id))
    mujoco.mj_forward(model, d)
    const run = (s) => { for (let i = 0; i < Math.round(s / model.opt.timestep); i++) mujoco.mj_step(model, d) }
    run(0.5)
    const settled = plan.map((p) => [0, 1, 2].map((k) => d.xpos[3 * body(p.id) + k]))
    const staticMove = Math.max(...plan.map((p, i) => Math.hypot(settled[i][0] - p.x, settled[i][1] - p.y, settled[i][2] - p.z)))
    model.opt.gravity.set([dir[0] * g * 9.81, dir[1] * g * 9.81, -9.81]); run(0.5); model.opt.gravity.set([0, 0, -9.81]); run(1)
    const moved = plan.map((p, i) => Math.hypot(...[0, 1, 2].map((k) => d.xpos[3 * body(p.id) + k] - settled[i][k])))
    const w = moved.indexOf(Math.max(...moved))
    out[name] = { mm: moved[w] * 1000, box: plan[w].id, staticMm: staticMove * 1000 }
    d.delete()
  }
  return { height, limit: 0.05 * height * 1000, out }
}

const T = PALLET.top
const xs = [PALLET.x - 0.03, PALLET.x + 0.03]
const ys = [PALLET.y - 0.04, PALLET.y + 0.04]
const h = (id) => size(byId[id])[2]

// Rushed worker: arrival order, four corner columns; each box sits on whatever is below in its corner(s).
// A wide box takes the two corners of its row, a long box the two corners of its column.
function workersStack() {
  const top = { '00': T, '01': T, '10': T, '11': T }
  const plan = []
  const corners = ['00', '10', '01', '11']
  let next = 0
  let wides = 0
  let longs = 0
  for (const b of ORDER) {
    const [sx, sy] = size(b)
    let cells, x, y
    if (sx > 0.07) { const j = wides++ % 2; cells = [`0${j}`, `1${j}`]; x = PALLET.x; y = ys[j] }
    else if (sy > 0.1) { const i = longs++ % 2; cells = [`${i}0`, `${i}1`]; x = xs[i]; y = PALLET.y }
    else { const c = corners[next++ % 4]; cells = [c]; x = xs[+c[0]]; y = ys[+c[1]] }
    const base = Math.max(...cells.map((c) => top[c]))
    plan.push({ id: b.id, x, y, z: base + h(b.id) / 2 })
    for (const c of cells) top[c] = base + h(b.id)
  }
  return plan
}

// Planned: heavy wide boxes first, a crossing layer of long boxes, light and fragile on top.
function plannedStack() {
  const L1 = T + 0.05
  const L2 = L1 + 0.04
  return [
    { id: 'b5', x: PALLET.x, y: ys[0], z: T + 0.025 }, { id: 'b6', x: PALLET.x, y: ys[1], z: T + 0.025 },
    { id: 'b7', x: xs[0], y: PALLET.y, z: L1 + 0.02 }, { id: 'b8', x: xs[1], y: PALLET.y, z: L1 + 0.02 },
    { id: 'b4', x: xs[0], y: ys[0], z: L2 + h('b4') / 2 }, { id: 'b3', x: xs[1], y: ys[0], z: L2 + h('b3') / 2 },
    { id: 'b1', x: xs[0], y: ys[1], z: L2 + h('b1') / 2 }, { id: 'b2', x: xs[1], y: ys[1], z: L2 + h('b2') / 2 },
  ]
}

for (const [name, plan] of [['worker stack (arrival order)', workersStack()], ['planned stack (interlocked)', plannedStack()]]) {
  const r = test(plan, 0.5)
  console.log(`${name}: height ${(r.height * 100).toFixed(1)} cm, limit ${r.limit.toFixed(0)} mm, at 0.5 g -> ` +
    Object.entries(r.out).map(([k, v]) => `${k} ${v.mm.toFixed(0)} mm (${v.box})`).join(', ') +
    ` | settling before the push: ${Math.max(...Object.values(r.out).map((v) => v.staticMm)).toFixed(0)} mm`)
}
