// Build src/pool.js: random orders that are known to be stackable (the search finds a plan that passes the rules,
// stands and passes the 0.5 g truck test). The 🎲 button picks from this pool. Run: node tests/make_pool.mjs 30
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { setOrder, toPositions, checkPhysics, checkTransport, BLOCKS } = await import('../src/planner.js')
const { search } = await import('../src/solver.js')
const { sceneXml, orderFrom, randomOrder } = await import('../src/pallet.js')
const mujoco = await loadMujoco()
const models = path.join(root, 'public/models/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/hand_free.xml', ...fs.readdirSync(models + 'shadow_hand/assets').map((n) => 'shadow_hand/assets/' + n)]) mujoco.FS.writeFile('/w/' + f, fs.readFileSync(models + f))

const want = Number(process.argv[2] || 30)
const pool = new Map()
let tried = 0
while (pool.size < want && tried < want * 6) {
  tried++
  const labels = randomOrder()
  const key = [...labels].sort().join(',')
  if (pool.has(key)) continue
  const order = orderFrom(labels)
  setOrder(order)
  mujoco.FS.writeFile('/w/shadow_hand/scene.xml', sceneXml(order))
  const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene.xml')
  const { found } = search({ maxLayers: 4, limit: 60 })
  const uneven = (raw) => { const by = {}; for (const b of raw.boxes) (by[b.layer] ??= []).push(BLOCKS[b.block].size[2]); return Object.values(by).reduce((s, h) => s + Math.max(...h) - Math.min(...h), 0) }
  found.sort((x, y) => uneven(x) - uneven(y))
  let ok = false
  for (const raw of found.slice(0, 15)) {
    const { plan } = toPositions(raw)
    if (checkPhysics(mujoco, model, plan).stands && checkTransport(mujoco, model, plan, 0.5).pass) { ok = true; break }
  }
  if (ok) pool.set(key, labels)
  console.log(`${tried}: ${labels.join(',')} -> ${ok ? 'kept' : 'dropped'}`)
  model.delete()
}
const out = `// Random orders known to be stackable: for each, a search found a plan that passes the warehouse rules, stands, and
// passes the 0.5 g truck test. Made by tests/make_pool.mjs. The 🎲 button picks from these.
export default ${JSON.stringify([...pool.values()], null, 0).replace(/\],\[/g, '],\n  [')}
`
fs.writeFileSync(path.join(root, 'src/pool.js'), out)
console.log(`${pool.size} stackable orders kept out of ${tried} tried -> src/pool.js`)
