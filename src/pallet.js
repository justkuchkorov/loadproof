// The pallet world at 1:5 scale: a half-EUR pallet (60 x 80 cm -> 12 x 16 cm) and the boxes of one order.
// Boxes keep their orientation (the hand does not turn them), so every size is given as x (depth) by y (width).

export const SCALE = 5
export const PALLET = { x: 0.26, y: 0, sx: 0.12, sy: 0.16, top: 0.029 } // centre and size in metres; top surface height
export const PALLET_B = { ...PALLET, y: -0.4 } // the comparison pallet, on the right (clear of the robot's reach)
// The robot cell: a UR10e on a pedestal behind the pallet (base centre and height), and where its pad waits.
export const ARM = { base: [0.40, 0, 0.2], park: [0.31, 0, 0.32] } // pedestal 1 m tall in real size; parked in front, over the pallet side
// The raised infeed table round the robot (a U, the pallet in its notch), where the boxes of the order wait:
// at waist height (50 cm real), like a conveyor's end. [x0, x1, y0, y1], top height INFEED_Z.
export const INFEED_Z = 0.1
export const INFEED = [[0.17, 0.64, 0.115, 0.3], [0.17, 0.64, -0.3, -0.115], [0.44, 0.64, -0.115, 0.115]]
// 'arm' (the UR10e cell, default) or 'hand' (the first version: a floating robot hand, kept for the camera demo)
export let CELL = 'arm'
export const setCell = (c) => { CELL = c }
export const FRICTION = 0.6 // cardboard with anti-slip sheets: slip angle 30-45 degrees -> tan 30 = 0.58 (Smurfit Kappa)

// One example order. kg and cm are the REAL box (the model is 1:5).
export const ORDER = [
  { id: 'b1', label: 'CHIPS', kg: 2, fragile: true, cm: [30, 40, 35] },
  { id: 'b2', label: 'CHIPS', kg: 2, fragile: true, cm: [30, 40, 35] },
  { id: 'b3', label: 'CEREAL', kg: 3, fragile: false, cm: [30, 40, 30] },
  { id: 'b4', label: 'RICE', kg: 10, fragile: false, cm: [30, 40, 25] },
  { id: 'b5', label: 'WATER', kg: 12, fragile: false, cm: [60, 40, 25] },
  { id: 'b6', label: 'WATER', kg: 12, fragile: false, cm: [60, 40, 25] },
  { id: 'b7', label: 'CANS', kg: 8, fragile: false, cm: [30, 80, 20] },
  { id: 'b8', label: 'CANS', kg: 8, fragile: false, cm: [30, 80, 20] },
]

// The catalogue: every box type comes in one of three footprints that fit the pallet's spots
// (small 30x40, wide 60x40, long 30x80 cm), with its own height, weight and fragility. Real sizes; the model is 1:5.
export const CATALOG = {
  WATER: { kg: 12, fragile: false, cm: [60, 40, 25] },
  PAPER: { kg: 20, fragile: false, cm: [60, 40, 25] },
  TOYS: { kg: 4, fragile: false, cm: [60, 40, 35] },
  PILLOWS: { kg: 1, fragile: false, cm: [60, 40, 35] },
  CANS: { kg: 8, fragile: false, cm: [30, 80, 20] },
  TILES: { kg: 14, fragile: false, cm: [30, 80, 20] },
  RUG: { kg: 5, fragile: false, cm: [30, 80, 20] },
  TV: { kg: 9, fragile: true, cm: [30, 80, 35] },
  BOOKS: { kg: 15, fragile: false, cm: [30, 40, 20] },
  RICE: { kg: 10, fragile: false, cm: [30, 40, 25] },
  DETERGENT: { kg: 9, fragile: false, cm: [30, 40, 30] },
  CEREAL: { kg: 3, fragile: false, cm: [30, 40, 30] },
  JARS: { kg: 6, fragile: true, cm: [30, 40, 25] },
  CHIPS: { kg: 2, fragile: true, cm: [30, 40, 35] },
}

// An order from a list of catalogue names, e.g. ['WATER', 'CHIPS'] -> boxes b1, b2, ...
export const orderFrom = (labels) => labels.map((label, i) => ({ id: `b${i + 1}`, label, ...CATALOG[label] }))

// A random order that CAN be stacked well: build a good stack in secret (full layers, heavy low, fragile on top),
// then shuffle the boxes, so the arrival order gives no hint. 2 or 3 layers, at most 9 boxes.
const LAYERS = [['wide', 'wide'], ['long', 'long'], ['small', 'small', 'small', 'small'], ['wide', 'small', 'small'], ['long', 'small', 'small']]
const footprint = (label) => { const [x, y] = CATALOG[label].cm; return x > 40 ? 'wide' : y > 50 ? 'long' : 'small' }
export function randomOrder(rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  for (let attempt = 0; attempt < 200; attempt++) {
    const layers = 2 + (rand() < 0.5 ? 1 : 0)
    const labels = []
    let ok = true
    let below = Infinity // lightest box of the layer below: nothing may be more than 1.5 times heavier
    for (let L = 0; L < layers && ok; L++) {
      const top = L === layers - 1
      // Layer 1 holds a wide box (60 cm deep): it ties the near and far rows together; without it the rows are thin
      // walls that tip over when the truck brakes. Layer 2 crosses it with long boxes when there are 3 layers.
      const shape = L === 0 ? pick(LAYERS.filter((s) => s.includes('wide'))) : L === 1 && !top ? pick(LAYERS.filter((s) => s.includes('long'))) : pick(LAYERS)
      const layer = []
      for (const kind of shape) {
        const minKg = L === 0 ? 10 : top ? 0 : 3 // a heavy base: light, bulky boxes at the bottom make a top-heavy pallet
        const options = Object.keys(CATALOG).filter((n) => footprint(n) === kind && (top || !CATALOG[n].fragile) && CATALOG[n].kg <= 1.5 * below && CATALOG[n].kg >= minKg)
        if (options.length === 0) { ok = false; break }
        const fresh = options.filter((n) => labels.concat(layer).filter((m) => m === n).length < 2) // variety: each type at most twice
        layer.push(pick(fresh.length ? fresh : options))
      }
      if (!ok) break
      const heights = new Set(layer.map((n) => CATALOG[n].cm[2]))
      if (!top && heights.size > 1) { ok = false; break } // lower layers must be even
      labels.push(...layer)
      below = Math.min(...layer.map((n) => CATALOG[n].kg))
    }
    if (!ok || labels.length > 9) continue
    for (let i = labels.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [labels[i], labels[j]] = [labels[j], labels[i]] }
    return labels
  }
  return ORDER.map((b) => b.label)
}

// Model size in metres, and model mass (1:5 scale -> volume and mass / 125).
export const size = (b) => b.cm.map((c) => c / 100 / SCALE)
export const mass = (b) => b.kg / SCALE ** 3

// The boxes of the order wait together on the left side of the table (y > 0.2); the robot finds and picks each box
// itself, in the order the plan needs. Gaps are wide enough that the open fingers and thumb clear the neighbours.
export const STAGING_Y = 0.2

// Waiting spots on the table, in order: rows along x with 8 cm gaps (7 cm between rows), a new row when the table ends.
// The open fingers reach about 8 cm forward and the thumb about 9 cm to the left, so neighbours stay clear.
export function stagingSpots(order = ORDER) {
  if (CELL === 'arm') return armStaging(order)
  const spots = {}
  let x = -0.1
  let rowY = STAGING_Y
  let rowDepth = 0
  for (const b of order) {
    const [sx, sy] = size(b)
    if (x + sx > 0.56) { rowY += rowDepth + 0.07; x = -0.1; rowDepth = 0 }
    spots[b.id] = [x + sx / 2, rowY + sy / 2]
    x += sx + 0.08
    rowDepth = Math.max(rowDepth, sy)
  }
  return spots
}

// Arm cell: the boxes wait in a ring around the robot, inside its reach (pad centre at most 22 cm from the base),
// clear of the pallets and the pedestal, 2 cm apart (a suction pad needs no room for fingers).
// Filled from the front-left, round the back, to the right.
function armStaging(order) {
  const [bx, by] = ARM.base
  const R = 0.23
  const rects = [] // [x0, x1, y0, y1], keep-out areas first
  const grow = (pal, m) => [pal.x - pal.sx / 2 - m, pal.x + pal.sx / 2 + m, pal.y - pal.sy / 2 - m, pal.y + pal.sy / 2 + m]
  rects.push(grow(PALLET, 0.035), grow(PALLET_B, 0.02), [bx - 0.05, bx + 0.05, by - 0.05, by + 0.05])
  const free = (r) => rects.every((o) => r[1] + 0.015 <= o[0] || r[0] >= o[1] + 0.015 || r[3] + 0.015 <= o[2] || r[2] >= o[3] + 0.015)
  const cands = []
  for (let x = 0.15; x <= 0.64; x += 0.01) for (let y = -0.3; y <= 0.3; y += 0.01) {
    const r = Math.hypot(x - bx, y - by)
    if (r < 0.1 || r > R) continue
    let ang = Math.atan2(y - by, x - bx) // front-left is about +2.4, behind 0, front-right about -2.4
    cands.push({ x, y, key: -ang * 100 - r }) // by angle (left first, round the back), outer ring first
  }
  cands.sort((a, b) => a.key - b.key)
  const spots = {}
  for (const b of order) {
    const [sx, sy] = size(b)
    // No room inside the reach: the box waits further out, and the robot reports that it cannot pick it.
    const onInfeed = (r) => INFEED.some((w) => r[0] >= w[0] && r[1] <= w[1] && r[2] >= w[2] && r[3] <= w[3])
    const c = cands.find(({ x, y }) => { const r = [x - sx / 2, x + sx / 2, y - sy / 2, y + sy / 2]; return onInfeed(r) && free(r) }) ?? { x: 0.62, y: 0.3 - 0.06 * Object.keys(spots).length }
    spots[b.id] = [c.x, c.y]
    rects.push([c.x - sx / 2, c.x + sx / 2, c.y - sy / 2, c.y + sy / 2])
  }
  return spots
}

const COLORS = { true: '0.80 0.62 0.42 1', false: '0.72 0.55 0.36 1' } // cardboard (fragile ones a little lighter)

export function sceneXml(order = ORDER) {
  const boxes = order.map((b, i) => {
    const [sx, sy, sz] = size(b)
    const [x, y] = stagingSpots(order)[b.id]
    const z0 = CELL === 'arm' ? INFEED_Z : 0 // waiting on the infeed table
    return `    <body name="${b.id}" pos="${x.toFixed(3)} ${y.toFixed(3)} ${(z0 + sz / 2).toFixed(4)}"><freejoint/>` +
      `<geom name="${b.id}" class="box" type="box" size="${sx / 2} ${sy / 2} ${sz / 2}" mass="${mass(b).toFixed(4)}" rgba="${COLORS[b.fragile]}"/></body>`
  }).join('\n')
  // Copies (c1..cn) for the comparison pallet; they wait under the floor until "Compare" places them.
  const copies = order.map((b, i) => {
    const [sx, sy, sz] = size(b)
    const id = copyId(b.id)
    return `    <body name="${id}" pos="${(-1.6 - i * 0.3).toFixed(3)} 0 ${(-0.75 + sz / 2).toFixed(4)}"><freejoint/>` +
      `<geom name="${id}" class="box" type="box" size="${sx / 2} ${sy / 2} ${sz / 2}" mass="${mass(b).toFixed(4)}" rgba="${COLORS[b.fragile]}"/></body>`
  }).join('\n')
  const arm = CELL === 'arm'
  const grips = order.map((b) => `    <weld name="grip_${b.id}" body1="${arm ? 'suction' : 'rh_palm'}" body2="${b.id}" active="false"/>`).join('\n')
  // Stretch wrap: each box held to where it stands by a soft, springy link (off until the load is wrapped).
  const wraps = order.flatMap((b) => [b.id, copyId(b.id)]).map((id) => `    <weld name="wrap_${id}" body1="${id}" active="false" solref="0.06 1"/>`).join('\n')
  return `<mujoco model="LoadProof pallet scene">
  <include file="${arm ? 'ur10e.xml' : 'hand_free.xml'}"/>
  <option gravity="0 0 -9.81"${arm ? ' cone="elliptic" impratio="10"' : ''}/>
  <statistic extent="0.5"/>
  <default>
    <default class="box">
      <geom condim="4" priority="1" friction="${FRICTION} 0.005 0.0005"/>
    </default>
  </default>
  <worldbody>
    <light pos="0 0 1.5"/>
    <light pos="0.3 0 1.5" dir="0 0 -1" directional="true"/>
    <geom name="floor" pos="0 0 -0.75" size="0 0 0.05" type="plane" rgba="0.2 0.3 0.4 1"/>
    <geom name="table" type="box" size="${arm ? '0.43 0.68 0.02' : '0.35 0.68 0.02'}" pos="${arm ? '0.28 0.1 -0.02' : '0.2 0.1 -0.02'}" rgba="0.42 0.45 0.48 1" friction="1 0.01 0.001"/>
    <geom name="pallet" type="box" size="${PALLET.sx / 2} ${PALLET.sy / 2} ${PALLET.top / 2}" pos="${PALLET.x} ${PALLET.y} ${PALLET.top / 2}" rgba="0.76 0.6 0.38 1" friction="${FRICTION} 0.005 0.0005"/>
    <geom name="pallet_b" type="box" size="${PALLET.sx / 2} ${PALLET.sy / 2} ${PALLET.top / 2}" pos="${PALLET_B.x} ${PALLET_B.y} ${PALLET.top / 2}" rgba="0.76 0.6 0.38 1" friction="${FRICTION} 0.005 0.0005"/>
${arm ? `    <geom name="pedestal" type="cylinder" size="0.03 ${ARM.base[2] / 2}" pos="${ARM.base[0]} ${ARM.base[1]} ${ARM.base[2] / 2}" rgba="0.25 0.27 0.3 1"/>
` +
    INFEED.map((w, i) => `    <geom name="infeed${i}" type="box" size="${(w[1] - w[0]) / 2} ${(w[3] - w[2]) / 2} ${INFEED_Z / 2}" pos="${(w[0] + w[1]) / 2} ${(w[2] + w[3]) / 2} ${INFEED_Z / 2}" rgba="0.33 0.36 0.4 1" friction="1 0.01 0.001"/>`).join('\n')
    : '    <body name="hand_target" mocap="true" pos="-0.2 0 0.15" quat="1 0 1 0"/>'}
${boxes}
${copies}
  </worldbody>
  <equality>
${arm ? '' : '    <weld body1="hand_target" body2="rh_forearm" solref="0.02 1"/>\n'}${grips}
${wraps}
  </equality>
</mujoco>
`
}

// Put the arm in its parked pose in a fresh or reset world d (its motors then hold it there by themselves).
export function parkArm(mujoco, model, d) {
  if (CELL !== 'arm' || !ARM.parkQ) return
  const names = ['shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint', 'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint']
  names.forEach((n, i) => {
    const j = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT.value, n)
    d.qpos[model.jnt_qposadr[j]] = ARM.parkQ[i]
    d.qvel[model.jnt_dofadr[j]] = 0
  })
  d.ctrl.fill(0)
}

// The UR10e model file with its base put on the pedestal.
export const armXml = (text) => text.replace('<body name="base" gravcomp="1" pos="0 0 0"', `<body name="base" gravcomp="1" pos="${ARM.base.join(' ')}"`)

export const copyId =(id) => 'c' + id.slice(1)

// The stack a rushed worker makes: boxes in arrival order, four corner columns, each box on whatever is already
// in its corner(s). A wide box takes both corners of its row, a long box both corners of its column.
export function workersStack(order = ORDER) {
  const T = PALLET.top
  const xs = [PALLET.x - 0.032, PALLET.x + 0.032]
  const ys = [PALLET.y - 0.042, PALLET.y + 0.042]
  const height = { '00': T, '01': T, '10': T, '11': T }
  const corners = ['00', '10', '01', '11']
  const blocks = []
  let next = 0
  let wides = 0
  let longs = 0
  for (const b of order) {
    const [sx, sy, sz] = size(b)
    let cells, x, y
    if (sx > 0.07) { const j = wides++ % 2; cells = [`0${j}`, `1${j}`]; x = PALLET.x; y = ys[j] }
    else if (sy > 0.1) { const i = longs++ % 2; cells = [`${i}0`, `${i}1`]; x = xs[i]; y = PALLET.y }
    else { const c = corners[next++ % 4]; cells = [c]; x = xs[+c[0]]; y = ys[+c[1]] }
    const base = Math.max(...cells.map((c) => height[c]))
    blocks.push({ block: b.id, x, y, z: base + sz / 2 })
    for (const c of cells) height[c] = base + sz
  }
  return { name: 'arrival order', blocks, say: 'Boxes stacked in the order they arrived, in columns.' }
}

// The pallet's spots, with a 4 mm gap between neighbours (2 cm in real size): boxes placed a few mm off
// must not land on a neighbour's edge. Rows run across (near = closer to the robot), columns run away from it.
// Seen from the camera: left = +y, right = -y.
export const ROWS = { near: PALLET.x - 0.032, far: PALLET.x + 0.032 }
export const COLS = { left: PALLET.y + 0.042, right: PALLET.y - 0.042 }
export const kind = (b) => { const [sx, sy] = size(b); return sx > 0.07 ? 'wide' : sy > 0.1 ? 'long' : 'small' }
export const SPOTS = {
  small: { 'near-left': [ROWS.near, COLS.left], 'near-right': [ROWS.near, COLS.right], 'far-left': [ROWS.far, COLS.left], 'far-right': [ROWS.far, COLS.right] },
  wide: { 'left column': [PALLET.x, COLS.left], 'right column': [PALLET.x, COLS.right] },
  long: { 'near row': [ROWS.near, PALLET.y], 'far row': [ROWS.far, PALLET.y] },
}

// Is this box still waiting (in the staging area on the left)?
export function waiting(mujoco, model, data, id) {
  const body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, id)
  const p = [0, 1, 2].map((k) => data.xpos[3 * body + k])
  if (CELL === 'arm') return Math.abs(p[0] - PALLET.x) > PALLET.sx / 2 || Math.abs(p[1] - PALLET.y) > PALLET.sy / 2 // not on the pallet
  return p[1] > STAGING_Y - 0.01
}

// Wrap: hold each named box to its CURRENT pose (soft weld to the world, like film holding the load).
// d: the MjData to wrap in; names: boxes to wrap. Returns a function that unwraps.
export function wrapBoxes(mujoco, model, d, names) {
  const ids = []
  for (const n of names) {
    const e = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_EQUALITY.value, 'wrap_' + n)
    if (e < 0) continue
    const b = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, n)
    const p = [0, 1, 2].map((k) => d.xpos[3 * b + k])
    const q = [0, 1, 2, 3].map((k) => d.xquat[4 * b + k])
    // the world's pose seen from the box: position -R^T p, orientation conj(q)
    const c = [q[0], -q[1], -q[2], -q[3]]
    const rot = (qq, v) => { const m = (a, b2) => [a[0] * b2[0] - a[1] * b2[1] - a[2] * b2[2] - a[3] * b2[3], a[0] * b2[1] + a[1] * b2[0] + a[2] * b2[3] - a[3] * b2[2], a[0] * b2[2] - a[1] * b2[3] + a[2] * b2[0] + a[3] * b2[1], a[0] * b2[3] + a[1] * b2[2] - a[2] * b2[1] + a[3] * b2[0]]; return m(m(qq, [0, ...v]), [qq[0], -qq[1], -qq[2], -qq[3]]).slice(1) }
    const rel = rot(c, p).map((v) => -v)
    model.eq_data.set([0, 0, 0, ...rel, ...c, 1], mujoco.mjNEQDATA * e)
    d.eq_active[e] = 1
    ids.push(e)
  }
  return () => { for (const e of ids) d.eq_active[e] = 0 }
}
