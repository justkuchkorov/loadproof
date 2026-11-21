// Node test: the AI's plan placed on the pallet, one top box shoved off its spot, the robot measures and repairs.
// Run: node tests/sabotage.mjs [box id]   (default: each top box once)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createRobot } = await import('../src/robot.js')
const { repair } = await import('../src/agent.js')
const { sceneXml, PALLET } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml())
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
const plan = JSON.parse(fs.readFileSync(path.join(root, 'tests/plans/ai_1.json'), 'utf8'))
const tops = plan.blocks.filter((b) => !plan.blocks.some((o) => o !== b && o.z > b.z + 0.01 && Math.abs(o.x - b.x) < 0.05 && Math.abs(o.y - b.y) < 0.07))
const victims = process.argv[2] ? [process.argv[2]] : tops.map((b) => b.block)
let fixed = 0
for (const victimId of victims) {
  const data = new mujoco.MjData(model)
  const body = (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
  for (const b of plan.blocks) data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], model.jnt_qposadr[model.body_jntadr[body(b.block)]])
  const fa = model.jnt_qposadr[model.body_jntadr[body('rh_forearm')]]
  data.qpos[fa] = 0.18; data.qpos[fa + 1] = -0.3; data.qpos[fa + 2] = 0.35; data.mocap_pos.set([0.18, -0.3, 0.35])
  mujoco.mj_forward(model, data)
  for (let i = 0; i < 250; i++) mujoco.mj_step(model, data)
  const robot = createRobot({ mujoco, model, data, debug: process.env.DEBUG ? (s) => console.log("     robot:", s) : undefined })
  let running = true
  let watch = null, reported = false
  ;(async () => { while (running) { robot.tick(1 / 60); for (let i = 0; i < 8; i++) mujoco.mj_step(model, data); if (watch && !reported && process.env.DEBUG) { const d = Math.hypot(...robot.P(watch.id).map((v, k) => v - watch.p[k])); if (d > 0.002) { reported = true; const ph = robot.phase; console.log('   ' + watch.id + ' starts moving: goal ' + ph.goal + ', fingers ' + ph.fingers + ', holding ' + ph.holding + ', touching: ' + robot.touching()) } } await new Promise((r) => setImmediate(r)) } })()
  const victim = plan.blocks.find((b) => b.block === victimId)
  const v = model.jnt_dofadr[model.body_jntadr[body(victimId)]]
  data.qvel.set([0.05, 0.45 * (Math.sign(victim.y - PALLET.y) || 1), 0.15, 0, 0, 0], v)
  const snap = () => Object.fromEntries(plan.blocks.map((b) => [b.block, robot.P(b.block)]))
  const s0 = snap()
  await new Promise((r) => setTimeout(r, 300))
  const after = robot.P(victimId)
  const moved = (a, b) => plan.blocks.filter((p) => p.block !== victimId).map((p) => [p.block, Math.hypot(...a[p.block].map((v, k) => v - b[p.block][k])) * 1000]).filter(([, d]) => d > 2).map(([n, d]) => n + ' ' + d.toFixed(0) + 'mm').join(', ') || 'none'
  if (process.env.DEBUG) console.log('   moved by the shove itself:', moved(snap(), s0))
  const s1 = snap()
  if (process.env.WATCH) watch = { id: process.env.WATCH, p: robot.P(process.env.WATCH) }
  globalThis.REPORT_MOVES = () => console.log('   moved since the shove:', moved(snap(), s1))
  const lines = []
  const ok = await repair(plan, { robot, log: (k, t) => lines.push(`${k}: ${t}`) })
  running = false
  await new Promise((r) => setTimeout(r, 30))
  if (process.env.DEBUG) globalThis.REPORT_MOVES()
  if (ok) fixed++
  console.log(`${victimId}: shoved to (${after.map((x) => x.toFixed(3)).join(', ')}) -> ${ok ? 'REPAIRED' : 'not repaired'} | ${lines.filter((l) => !l.startsWith('step')).join(' | ').slice(0, 260)}`)
  data.delete()
}
console.log(`${fixed}/${victims.length} repaired`)
