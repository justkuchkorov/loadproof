// Make a 1:5 scale UR10e with a vacuum gripper from the mujoco_menagerie model (Apache 2.0).
// Lengths x s, masses x s^3, inertias x s^5, joint torques and gains x s^4 (gravity torque = mass x length).
// Run: node tools/make_ur10e_cell.cjs <path to menagerie universal_robots_ur10e>
const fs = require('fs')
const path = require('path')
const src = process.argv[2]
const out = path.join(__dirname, '..', 'public', 'models', 'cell')
const s = 0.2
fs.mkdirSync(path.join(out, 'assets'), { recursive: true })
for (const f of fs.readdirSync(path.join(src, 'assets'))) fs.copyFileSync(path.join(src, 'assets', f), path.join(out, 'assets', f))
fs.copyFileSync(path.join(src, 'LICENSE'), path.join(out, 'LICENSE'))

let x = fs.readFileSync(path.join(src, 'ur10e.xml'), 'utf8')
const nums = (v, k) => v.trim().split(/\s+/).map((n) => +(Number(n) * k).toPrecision(6)).join(' ')
// lengths: positions and geom sizes
x = x.replace(/ pos="([^"]+)"/g, (m, v) => ` pos="${nums(v, s)}"`)
x = x.replace(/(<geom[^>]*?) size="([^"]+)"/g, (m, a, v) => `${a} size="${nums(v, s)}"`)
x = x.replace(/(<site[^>]*?) size="([^"]+)"/g, (m, a, v) => `${a} size="${nums(v, s)}"`)
// masses and inertias
x = x.replace(/ mass="([^"]+)"/g, (m, v) => ` mass="${nums(v, s ** 3)}"`)
x = x.replace(/ diaginertia="([^"]+)"/g, (m, v) => ` diaginertia="${nums(v, s ** 5)}"`)
// joints: armature (inertia) x s^5, damping x s^4.5; actuators: gains and torques x s^4
x = x.replace(/ armature="([^"]+)"/g, (m, v) => ` armature="${nums(v, s ** 5)}"`)
x = x.replace(/ damping="([^"]+)"/g, (m, v) => ` damping="${nums(v, s ** 4.5)}"`)
x = x.replace(/ gainprm="([^"]+)"/g, (m, v) => ` gainprm="${nums(v, s ** 4)}"`)
x = x.replace(/ biasprm="([^"]+)"/g, (m, v) => ` biasprm="${nums(v, s ** 4)}"`)
x = x.replace(/ forcerange="([^"]+)"/g, (m, v) => ` forcerange="${nums(v, s ** 4)}"`)
// meshes are in metres at full size: scale each one (a class default does not reach them, they use the main class)
x = x.replace(/<mesh file="([^"]+)"\/>/g, `<mesh file="$1" scale="${s} ${s} ${s}"/>`)
if ((x.match(/<mesh file="[^"]+" scale="/g) || []).length !== 20) throw new Error('expected 20 scaled meshes')
// every arm body is gravity-compensated, as cobot controllers do
x = x.replace(/<body name="([^"]+)"/g, '<body name="$1" gravcomp="1"')
// the vacuum gripper on the tool flange: a body at the attachment site, a pad, and the grasp point at the pad face
x = x.replace('<site name="attachment_site" pos="0 0.02 0" quat="-1 1 0 0"/>',
  `<site name="attachment_site" pos="0 0.02 0" quat="-1 1 0 0"/>
                  <body name="suction" gravcomp="1" pos="0 0.02 0" quat="-1 1 0 0">
                    <inertial pos="0 0 0.01" mass="0.004" diaginertia="1e-7 1e-7 1e-7"/>
                    <geom name="gripper_body" type="cylinder" size="0.008 0.009" pos="0 0 0.009" rgba="0.15 0.15 0.17 1" contype="0" conaffinity="0" group="2"/>
                    <geom name="gripper_pad" type="cylinder" size="0.012 0.002" pos="0 0 0.02" rgba="0.85 0.35 0.1 1" group="2"/>
                    <site name="grasp_site" pos="0 0 0.022" size="0.002"/>
                  </body>`)
if (!x.includes('name="suction"')) throw new Error('attachment site not found')
// mount: the robot base stands on a pedestal; its pose is set by the scene (base_mount body)
x = x.replace('<body name="base" gravcomp="1" quat="0 0 0 -1" childclass="ur10e">', '<body name="base" gravcomp="1" pos="0 0 0" quat="0 0 0 -1" childclass="ur10e">')
x = x.replace('<mujoco model="ur10e">', '<!-- 1:5 scale UR10e with a vacuum gripper, made by tools/make_ur10e_cell.cjs from mujoco_menagerie (Apache 2.0). -->\n<mujoco model="ur10e_cell">')
// keyframe would not match a bigger scene: drop it
x = x.replace(/\s*<keyframe>[\s\S]*?<\/keyframe>/, '')
fs.writeFileSync(path.join(out, 'ur10e.xml'), x)
console.log('written', path.join(out, 'ur10e.xml'))
