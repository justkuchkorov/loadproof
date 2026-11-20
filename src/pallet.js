// The pallet world at 1:5 scale: a half-EUR pallet (60 x 80 cm -> 12 x 16 cm) and the boxes of one order.
// Boxes keep their orientation (the hand does not turn them), so every size is given as x (depth) by y (width).

export const SCALE = 5
export const PALLET = { x: 0.26, y: 0, sx: 0.12, sy: 0.16, top: 0.029 } // centre and size in metres; top surface height
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

// Model size in metres, and model mass (1:5 scale -> volume and mass / 125).
export const size = (b) => b.cm.map((c) => c / 100 / SCALE)
export const mass = (b) => b.kg / SCALE ** 3

// Boxes wait off the table, on the floor far away (out of view). A conveyor at the right side of the table brings
// the next box to the pick spot, so nothing ever stands behind the box being picked (the forearm would hit it).
export const CONVEYOR = { x: 0.12, y0: -0.45, y1: -0.19, pick: [0.12, -0.27] }
export const FLOOR = -0.75
export function waitingSpot(i) { return [1.2 + i * 0.3, 0] }

const COLORS = { true: '0.80 0.62 0.42 1', false: '0.72 0.55 0.36 1' } // cardboard (fragile ones a little lighter)

export function sceneXml(order = ORDER) {
  const boxes = order.map((b, i) => {
    const [sx, sy, sz] = size(b)
    const [x, y] = waitingSpot(i)
    return `    <body name="${b.id}" pos="${x.toFixed(3)} ${y.toFixed(3)} ${(FLOOR + sz / 2).toFixed(4)}"><freejoint/>` +
      `<geom name="${b.id}" class="box" type="box" size="${sx / 2} ${sy / 2} ${sz / 2}" mass="${mass(b).toFixed(4)}" rgba="${COLORS[b.fragile]}"/></body>`
  }).join('\n')
  const grips = order.map((b) => `    <weld name="grip_${b.id}" body1="rh_palm" body2="${b.id}" active="false"/>`).join('\n')
  return `<mujoco model="LoadProof pallet scene">
  <include file="hand_free.xml"/>
  <option gravity="0 0 -9.81"/>
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
    <geom name="table" type="box" size="0.35 0.45 0.02" pos="0.2 0 -0.02" rgba="0.42 0.45 0.48 1" friction="1 0.01 0.001"/>
    <geom name="conveyor" type="box" size="0.05 ${(CONVEYOR.y1 - CONVEYOR.y0) / 2} 0.003" pos="${CONVEYOR.x} ${(CONVEYOR.y0 + CONVEYOR.y1) / 2} 0.003" rgba="0.15 0.16 0.18 1" friction="${FRICTION} 0.005 0.0005"/>
    <geom name="pallet" type="box" size="${PALLET.sx / 2} ${PALLET.sy / 2} ${PALLET.top / 2}" pos="${PALLET.x} ${PALLET.y} ${PALLET.top / 2}" rgba="0.76 0.6 0.38 1" friction="${FRICTION} 0.005 0.0005"/>
    <body name="hand_target" mocap="true" pos="-0.2 0 0.15" quat="1 0 1 0"/>
${boxes}
  </worldbody>
  <equality>
    <weld body1="hand_target" body2="rh_forearm" solref="0.02 1"/>
${grips}
  </equality>
</mujoco>
`
}

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

// Put a box on the conveyor's pick spot, standing still. (The conveyor itself is not simulated: the box arrives.)
export function bring(mujoco, model, data, id, order = ORDER) {
  const b = order.find((o) => o.id === id)
  const body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, id)
  const q = model.jnt_qposadr[model.body_jntadr[body]]
  const v = model.jnt_dofadr[model.body_jntadr[body]]
  data.qpos.set([CONVEYOR.pick[0], CONVEYOR.pick[1], 0.006 + size(b)[2] / 2, 1, 0, 0, 0], q)
  data.qvel.set([0, 0, 0, 0, 0, 0], v)
  mujoco.mj_forward(model, data)
}

// Is this box still waiting (not yet on the table)?
export function waiting(mujoco, model, data, id) {
  const body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, id)
  return data.xpos[3 * body + 2] < -0.3
}
