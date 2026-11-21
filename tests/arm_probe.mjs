// Probe: where can the 1:5 UR10e reach with the pad pointing down? Run: node tests/arm_probe.mjs [bx by bz]
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createIK } = await import('../src/ik.js')
const mujoco = await loadMujoco()
const [bx, by, bz] = (process.argv.slice(2).length ? process.argv.slice(2) : ['0.36', '0', '0.12']).map(Number)
const cell = path.join(root, 'public/models/cell/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/cell'); mujoco.FS.mkdir('/w/cell/assets')
for (const f of fs.readdirSync(cell + 'assets')) mujoco.FS.writeFile('/w/cell/assets/' + f, fs.readFileSync(cell + 'assets/' + f))
const arm = fs.readFileSync(cell + 'ur10e.xml', 'utf8').replace('<body name="base" gravcomp="1" pos="0 0 0"', `<body name="base" gravcomp="1" pos="${bx} ${by} ${bz}"`)
mujoco.FS.writeFile('/w/cell/ur10e.xml', arm)
mujoco.FS.writeFile('/w/cell/scene.xml', `<mujoco><include file="ur10e.xml"/><worldbody><geom type="plane" size="1 1 0.1"/></worldbody></mujoco>`)
const model = mujoco.MjModel.from_xml_path('/w/cell/scene.xml')
const ik = createIK(mujoco, model)
const home = [-1.5708, -1.5708, 1.5708, -1.5708, -1.5708, 0]
const h = ik.fk(home)
console.log('home pad at', h.p.map((v) => v.toFixed(3)).join(' '), 'R', h.R.map((v) => v.toFixed(2)).join(' '))
// face the pallet first
let seed = ik.solve([0.26, 0, 0.2], 0, home, 200)
console.log('over pallet: err', (seed.err * 1000).toFixed(1), 'mm q', seed.q.map((v) => v.toFixed(2)).join(' '))
const reach = (x, y, z) => { const r = ik.solve([x, y, z], 0, seed.q, 200); return r.err < 0.002 }
for (const z of [0.04, 0.1, 0.2, 0.28, 0.32]) {
  let line = `z ${z.toFixed(2)}: `
  for (let y = 0.3; y >= -0.3; y -= 0.05) {
    let s = ''
    for (let x = 0.1; x <= 0.6; x += 0.05) s += reach(x, y, z) ? '#' : '.'
    line += s + ' '
  }
  console.log(line)
}
console.log('(each block: one y from +0.30 down to -0.30; inside, x from 0.10 to 0.60 in 5 cm steps)')
