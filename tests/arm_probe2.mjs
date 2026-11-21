// Probe with many starting guesses: the arm's true reach (pad down). Run: node tests/arm_probe2.mjs bx by bz
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { createIK } = await import('../src/ik.js')
const mujoco = await loadMujoco()
const [bx, by, bz] = process.argv.slice(2).map(Number)
const cell = path.join(root, 'public/models/cell/')
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/cell'); mujoco.FS.mkdir('/w/cell/assets')
for (const f of fs.readdirSync(cell + 'assets')) mujoco.FS.writeFile('/w/cell/assets/' + f, fs.readFileSync(cell + 'assets/' + f))
mujoco.FS.writeFile('/w/cell/ur10e.xml', fs.readFileSync(cell + 'ur10e.xml', 'utf8').replace('<body name="base" gravcomp="1" pos="0 0 0"', `<body name="base" gravcomp="1" pos="${bx} ${by} ${bz}"`))
mujoco.FS.writeFile('/w/cell/scene.xml', `<mujoco><include file="ur10e.xml"/><worldbody><geom type="plane" size="1 1 0.1"/></worldbody></mujoco>`)
const model = mujoco.MjModel.from_xml_path('/w/cell/scene.xml')
const ik = createIK(mujoco, model)
const base = ik.solve([0.26, 0, 0.2], 0, [-1.5708, -1.5708, 1.5708, -1.5708, -1.5708, 0], 200).q
const reach = (x, y, z) => {
  for (const dp of [0, -0.8, 0.8, -1.6, 1.6, 2.4, -2.4]) { const s = base.slice(); s[0] += dp; if (ik.solve([x, y, z], 0, s, 150).err < 0.002) return true }
  return false
}
for (const z of (process.env.ZS || "0.07,0.12,0.26,0.3").split(",").map(Number)) {
  console.log(`pad height z = ${z}  (columns x 0.10 .. 0.60, rows y +0.32 .. -0.32, 4 cm steps)`)
  for (let y = 0.32; y >= -0.321; y -= 0.04) {
    let s = ''
    for (let x = 0.10; x <= 0.601; x += 0.04) s += reach(x, y, z) ? '#' : '.'
    console.log(`  y ${y >= 0 ? '+' : ''}${y.toFixed(2)} ${s}`)
  }
}
