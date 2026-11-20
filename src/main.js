import * as THREE from 'three'
import { createSim } from './sim.js'
import { createTracker } from './tracking.js'
import { retarget } from './retarget.js'
import { createReach } from './reach.js'
import { createGrasp, FIST } from './grasp.js'

const status = document.getElementById('status')
const startButton = document.getElementById('start')
const SMOOTH = 0.5      // fingers: 0 = frozen, 1 = no smoothing
const SMOOTH_MOVE = 0.3 // hand position
const OBJECTS = { ball: 'red ball', cube: 'blue cube', can: 'yellow can' }
const HELP = 'C = recentre · R = reset objects'

async function main() {
  const sim = await createSim(document.getElementById('view'))
  const { mujoco, model, data } = sim
  window.sim = sim

  // Actuator name -> index, and each actuator's allowed range.
  const actuator = {}
  for (let i = 0; i < model.nu; i++) {
    actuator[mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_ACTUATOR.value, i)] = i
  }
  const range = model.actuator_ctrlrange
  const target = new Float64Array(model.nu)
  const fist = new Float64Array(model.nu)
  for (const [name, v] of Object.entries(FIST)) fist[actuator[name]] = v

  // The hand follows an invisible "mocap" target. Keep the grasp point (in the palm) where the robot is told to go.
  const graspSite = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE.value, 'grasp_site')
  const offset = [0, 1, 2].map((k) => data.site_xpos[3 * graspSite + k] - data.mocap_pos[k])
  const move = Array.from(data.mocap_pos.subarray(0, 3))
  const reach = createReach()
  const grasp = createGrasp({ mujoco, model, data, objects: Object.keys(OBJECTS) })
  let xy = [0.18, 0]
  let lastHand = null

  // A ring on the table under the hand: grey = nothing below, green = close your hand to grab.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.03, 0.038, 48),
    new THREE.MeshBasicMaterial({ color: 0x8b949e, transparent: true, opacity: 0.9, depthTest: false }))
  ring.renderOrder = 10 // drawn on top, so the hand never hides it
  ring.position.z = 0.002
  sim.scene.add(ring)

  window.addEventListener('keydown', (e) => {
    if (e.key === 'c' && lastHand) reach.calibrate(lastHand.image)
    if (e.key === 'r') {
      mujoco.mj_resetData(model, data)
      for (let k = 0; k < 3; k++) data.mocap_pos[k] = move[k]
      mujoco.mj_forward(model, data)
    }
  })

  let tracker = null
  status.textContent = `Ready. Press "Start camera" and show your right hand. ${HELP}`

  startButton.onclick = async () => {
    startButton.disabled = true
    status.textContent = 'Starting camera…'
    try {
      tracker = await createTracker(document.getElementById('cam'), document.getElementById('overlay'))
      startButton.style.display = 'none'
      document.getElementById('camwrap').style.display = 'block'
    } catch (err) {
      status.textContent = 'Camera error: ' + err.message
      startButton.disabled = false
    }
  }

  if (new URLSearchParams(location.search).has('autostart')) startButton.click()

  let last = performance.now()
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now

    // 1. Read your hand: finger angles, how closed it is, and where it points on the table.
    const hand = tracker ? tracker.update() : null
    let curl = 0
    if (hand) {
      lastHand = hand
      const goals = retarget(hand.world, hand.handedness)
      for (const [name, value] of Object.entries(goals)) {
        const i = actuator[name]
        if (i === undefined) continue
        const clamped = Math.max(range[2 * i], Math.min(range[2 * i + 1], value))
        target[i] += SMOOTH * (clamped - target[i])
      }
      curl = ['FF', 'MF', 'RF', 'LF'].reduce((a, f) => a + goals[`rh_A_${f}J3`] + goals[`rh_A_${f}J0`], 0) / 4
      xy = reach.goal(hand.image)
    }

    // 2. Shared control decides the hand's goal and what the fingers do.
    //    If your hand leaves the picture while holding, keep holding.
    const current = [0, 1, 2].map((k) => data.site_xpos[3 * graspSite + k])
    const g = grasp.update(dt, xy, hand ? curl : (grasp.state === 'hold' ? 3 : 0), current)
    for (let k = 0; k < 3; k++) move[k] += SMOOTH_MOVE * (g.goal[k] - offset[k] - move[k])
    for (let k = 0; k < 3; k++) data.mocap_pos[k] = move[k]
    for (let i = 0; i < model.nu; i++) {
      data.ctrl[i] = g.fingers === 'mirror' ? target[i] : g.fingers === 'fist' ? fist[i] : 0
    }

    // 3. Show it.
    ring.position.x = xy[0]
    ring.position.y = xy[1]
    ring.material.color.set(g.near ? 0x3fb950 : 0x8b949e)
    if (tracker) {
      status.textContent = !hand ? `No hand in view · ${HELP}`
        : g.held ? `Holding the ${OBJECTS[g.held]}: move, then open your hand to put it down · ${HELP}`
        : g.near ? `Over the ${OBJECTS[g.near]}: close your hand to grab · ${HELP}`
        : `Move the ring onto an object · ${HELP}`
    }

    sim.step(dt)
    sim.render()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main().catch((err) => {
  status.textContent = 'Error: ' + err.message
  console.error(err)
})
