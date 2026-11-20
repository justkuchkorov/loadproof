// Node test: the hand builds the bridge (2 pillars + beam) 5 times from shuffled starts, with the grip assist.
// Run: node tests/bridge_build.mjs
import loadMujoco from 'file:///C:/Users/abdi/Documents/projects/robot-hand/node_modules/@mujoco/mujoco/mujoco.js'
import { FIST } from 'file:///C:/Users/abdi/Documents/projects/robot-hand/src/grasp.js'
import fs from 'fs'
const mujoco = await loadMujoco()
const root = 'C:/Users/abdi/Documents/projects/robot-hand/public/models/'
mujoco.FS.mkdir('/w'); mujoco.FS.mkdir('/w/shadow_hand'); mujoco.FS.mkdir('/w/shadow_hand/assets')
for (const f of ['shadow_hand/scene_build.xml','shadow_hand/hand_free.xml', ...fs.readdirSync(root+'shadow_hand/assets').map(n=>'shadow_hand/assets/'+n)]) mujoco.FS.writeFile('/w/'+f, fs.readFileSync(root+f))
const model = mujoco.MjModel.from_xml_path('/w/shadow_hand/scene_build.xml')
const data = new mujoco.MjData(model)
const O = mujoco.mjtObj
const A = (n) => mujoco.mj_name2id(model, O.mjOBJ_ACTUATOR.value, n)
const B = (n) => mujoco.mj_name2id(model, O.mjOBJ_BODY.value, n)
const site = mujoco.mj_name2id(model, O.mjOBJ_SITE.value, 'grasp_site')
const S = () => [0,1,2].map(k => data.site_xpos[3*site+k])
const P = (n) => [0,1,2].map(k => data.xpos[3*B(n)+k])
mujoco.mj_forward(model, data)
const offset = [0,1,2].map(k => S()[k] - data.mocap_pos[k])
let ctrl = {}
const setGoal = (g) => { for (let k=0;k<3;k++) data.mocap_pos[k] = g[k] - offset[k] }
function run(sec) { const n = Math.round(sec/model.opt.timestep); for (let i=0;i<n;i++) { if (i % 8 === 0) { for (let j=0;j<model.nu;j++) data.ctrl[j]=0; for (const [k,v] of Object.entries(ctrl)) data.ctrl[A(k)] = v } mujoco.mj_step(model, data) } }
function glide(to, sec) { const from = S(); const n = 30; for (let i=1;i<=n;i++) { setGoal(from.map((v,k)=>v+(to[k]-v)*i/n)); run(sec/n) } }
const HOVER = 0.14
const palm = B('rh_palm')
const eqId = (obj) => mujoco.mj_name2id(model, O.mjOBJ_EQUALITY.value, 'grip_' + obj)
const qconj = (q) => [q[0], -q[1], -q[2], -q[3]]
const qmul = (a, b) => [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]]
const qrot = (q, v) => { const r = qmul(qmul(q, [0, ...v]), qconj(q)); return [r[1], r[2], r[3]] }
const Q = (b) => [0,1,2,3].map(k => data.xquat[4*b+k])
function lock(obj) {
  const e = eqId(obj), o = B(obj)
  const dp = [0,1,2].map(k => data.xpos[3*o+k] - data.xpos[3*palm+k])
  const rel = qrot(qconj(Q(palm)), dp)
  const rq = qmul(qconj(Q(palm)), Q(o))
  const d = model.eq_data, a = mujoco.mjNEQDATA * e
  d[a]=0; d[a+1]=0; d[a+2]=0; d[a+3]=rel[0]; d[a+4]=rel[1]; d[a+5]=rel[2]; d[a+6]=rq[0]; d[a+7]=rq[1]; d[a+8]=rq[2]; d[a+9]=rq[3]; d[a+10]=1
  data.eq_active[e] = 1
}
const unlock = (obj) => { data.eq_active[eqId(obj)] = 0 }

const thumbOf = (src) => Object.fromEntries(['THJ4','THJ5','THJ1','THJ2'].map(k => ['rh_A_'+k, src['rh_A_'+k]]))
const REL = { ...thumbOf(FIST), rh_A_FFJ3:-0.2, rh_A_MFJ3:-0.2, rh_A_RFJ3:-0.2, rh_A_LFJ3:-0.2 }
const st = { rel: REL, wait: 1.2, rise: 1.5 }
function pickPlace(obj, dest) {
  let ok = false, tries = 0
  while (!ok && tries < 4) { // grab, then CHECK by measuring that the object came up; if not, let go and retry
    tries++
    const p = P(obj)
    ctrl = {}; glide([p[0], p[1], HOVER], 0.6); run(0.2)
    glide([p[0], p[1], p[2] + 0.01], 0.6); if (Math.hypot(...S().map((v,k)=>v-P(obj)[k])) < 0.045) { const before = P(obj); lock(obj); run(0.05); jump.push((Math.hypot(...P(obj).map((v,k)=>v-before[k]))*1000).toFixed(1)) } ctrl = FIST; run(0.6)
    glide([p[0], p[1], p[2] + 0.06], 0.5)
    ok = P(obj)[2] > p[2] + 0.03
    if (!ok) { unlock(obj); ctrl = {}; run(0.5) }
  }
  if (!ok) return { failed: true, tries }
  const q = S(); glide([q[0], q[1], HOVER + 0.05], 0.4)
  for (let it = 0; it < 3; it++) { const s = S(), o = P(obj); glide([dest[0] + (s[0]-o[0]), dest[1] + (s[1]-o[1]), HOVER + 0.05], 0.5) }
  const s = S(), o = P(obj)
  glide([dest[0] + (s[0]-o[0]), dest[1] + (s[1]-o[1]), dest[2] + (s[2]-o[2]) + 0.002], 0.8)
  ctrl = {}; run(0.7); unlock(obj); run(0.3)
  const s2 = S()
  if (st.slide) glide([s2[0] + st.slide, s2[1], s2[2] + 0.01], 0.6) // slide out along the fingers first
  const s3 = S(); glide([s3[0], s3[1], s3[2] + 0.06], st.rise); ctrl = {}; glide([s3[0], s3[1], HOVER + 0.05], 0.5); run(1.0)
  const f = P(obj)
  return { xy: Math.hypot(f[0]-dest[0], f[1]-dest[1]) * 1000, tries }
}

const PLAN = [ // the bridge: two pillars of two cubes, a plank on top
  ['cube1', [0.22, -0.065, 0.025]], ['cube2', [0.22, -0.065, 0.075]],
  ['cube3', [0.22,  0.065, 0.025]], ['cube4', [0.22,  0.065, 0.075]],
  ['plank', [0.22,  0.0,   0.12]],
]
// Check 1: does the design stand? Put every block straight at its planned spot, let physics run 2 s.
const jnt = (b) => model.body_jntadr[B(b)]
for (const [b, p] of PLAN) { const a = model.jnt_qposadr[jnt(b)]; data.qpos[a]=p[0]; data.qpos[a+1]=p[1]; data.qpos[a+2]=p[2]; data.qpos[a+3]=1; data.qpos[a+4]=0; data.qpos[a+5]=0; data.qpos[a+6]=0 }
// keep the hand out of the way
for (let k=0;k<3;k++) data.mocap_pos[k] = [-0.3, 0, 0.4][k]; const fa = model.jnt_qposadr[model.body_jntadr[B('rh_forearm')]]; data.qpos[fa]=-0.3; data.qpos[fa+2]=0.4
mujoco.mj_forward(model, data); run(2)
console.log('physics check (design placed directly):', PLAN.map(([b, p]) => b + ' ' + (Math.hypot(...P(b).map((v,k)=>v-p[k]))*1000).toFixed(0) + 'mm').join(', '))

const on = { cube2: 'cube1', cube4: 'cube3' }
const destOf = (b, p) => b === 'plank' ? [(P('cube2')[0] + P('cube4')[0]) / 2, (P('cube2')[1] + P('cube4')[1]) / 2, p[2]] : on[b] ? [P(on[b])[0], P(on[b])[1], p[2]] : p
const jump = []
let wins = 0
for (let trial = 1; trial <= 5; trial++) {
  mujoco.mj_resetData(model, data)
  for (const b of ['cube1','cube2','cube3','cube4','plank']) { const a = model.jnt_qposadr[model.body_jntadr[B(b)]]; data.qpos[a] += (Math.random()-0.5)*0.03; data.qpos[a+1] += (Math.random()-0.5)*0.03 }
  mujoco.mj_forward(model, data); run(0.5)
  let tries = 0
  for (const [b, p] of PLAN) { const e = pickPlace(b, destOf(b, p)); tries += e.tries || 9 }
  run(2)
  const h = PLAN.map(([b]) => P(b)[2]*100)
  const ok = PLAN.every(([b, p], i) => Math.abs(h[i] - p[2]*100) < 0.6)
  if (ok) wins++
  console.log('trial', trial, ok ? 'STANDS' : 'fell  ', 'heights', h.map(v=>v.toFixed(1)).join(' '), 'grab tries', tries)
}
console.log('bridge built', wins + '/5')
