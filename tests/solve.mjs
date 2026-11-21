// Node test: can an order be stacked at all? Exhaustive search over layers and spots, then the physics checks.
// Run: node tests/solve.mjs CHIPS,CHIPS,CEREAL,...
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { setOrder, toPositions, checkPhysics, checkTransport } = await import('../src/planner.js')
const { search } = await import('../src/solver.js')
const { sceneXml, orderFrom } = await import('../src/pallet.js')
const labels = (process.argv[2] || 'CHIPS,CHIPS,CEREAL,RICE,WATER,CANS,CANS,TV,BOOKS').split(',')
const order = orderFrom(labels)
setOrder(order)
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))
mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml(order))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
const t0 = Date.now()
const { found, tried } = search({ limit: 50, maxLayers: Number(process.env.LAYERS || 4) })
console.log(`${labels.join(',')}: ${found.length} arrangements pass the warehouse rules (${tried} complete ones tried, ${Date.now() - t0} ms)`)
let ok = 0
for (const raw of found.slice(0, 10)) {
  const { plan } = toPositions(raw)
  const s = checkPhysics(mujoco, model, plan)
  const t = s.stands ? checkTransport(mujoco, model, plan, 0.5) : null
  if (t?.pass) ok++
  console.log(`  ${raw.boxes.map((b) => `${labels[+b.block.slice(1) - 1]}:L${b.layer}:${b.spot}`).join(' ')} -> stands ${s.stands}, truck ${t ? (t.pass ? 'PASS' : 'FAIL') : '-'}`)
}
console.log(`${ok} of the first ${Math.min(10, found.length)} also pass the physics checks`)
