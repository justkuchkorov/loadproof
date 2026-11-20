import * as THREE from 'three'
import { createSim } from './sim.js'
import { createTracker } from './tracking.js'
import { retarget } from './retarget.js'
import { createReach } from './reach.js'
import { createGrasp, FIST } from './grasp.js'
import { createRobot } from './robot.js'
import { runAgent, checkPlan } from './agent.js'
import { BLOCKS } from './planner.js'
import { ORDER, sceneXml, bring, waiting, workersStack } from './pallet.js'
import { createTruckTest } from './truck.js'

const status = document.getElementById('status')
const startButton = document.getElementById('start')
const SMOOTH = 0.5      // fingers: 0 = frozen, 1 = no smoothing
const SMOOTH_MOVE = 0.3 // hand position
const HELP = 'R = reset'
const PREVIEW_COLOR = { checking: 0x8b949e, bad: 0xf85149, good: 0x3fb950 }

async function main() {
  const labels = Object.fromEntries(ORDER.map((b) => [b.id, { title: b.label, kg: b.kg, fragile: b.fragile }]))
  const sim = await createSim(document.getElementById('view'), { xml: sceneXml(ORDER), labels })
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

  // The hand follows an invisible "mocap" target. Keep the grasp point (in the palm) where it is told to go.
  const graspSite = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE.value, 'grasp_site')
  const offset = [0, 1, 2].map((k) => data.site_xpos[3 * graspSite + k] - data.mocap_pos[k])
  const move = Array.from(data.mocap_pos.subarray(0, 3))
  const PARK = [0.06 - offset[0], 0.3 - offset[1], 0.3 - offset[2]] // hand parked up and to the left, clear of the camera's view
  const reach = createReach()
  const grasp = createGrasp({ mujoco, model, data, objects: Object.keys(BLOCKS) })
  const robot = createRobot({ mujoco, model, data })
  let agentBusy = false
  let xy = [0.18, 0]
  let lastHand = null

  // Reset the world: boxes back to waiting, the hand straight to its parked spot (so it never brushes a stack).
  function reset() {
    truck?.cancel()
    robot.stop()
    mujoco.mj_resetData(model, data)
    const fa = model.jnt_qposadr[model.body_jntadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'rh_forearm')]]
    for (let k = 0; k < 3; k++) { move[k] = PARK[k]; data.mocap_pos[k] = PARK[k]; data.qpos[fa + k] = PARK[k] }
    parked = true
    mujoco.mj_forward(model, data)
  }

  // A ring on the table under the hand: grey = nothing below, green = close your hand to grab.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.03, 0.038, 48),
    new THREE.MeshBasicMaterial({ color: 0x8b949e, transparent: true, opacity: 0.9, depthTest: false }))
  ring.renderOrder = 10 // drawn on top, so the hand never hides it
  ring.position.z = 0.002
  sim.scene.add(ring)

  // See-through preview of the AI's design: grey while checking, red if it fails, green if it stands.
  const ghosts = new THREE.Group()
  sim.scene.add(ghosts)
  function preview(plan, state) {
    ghosts.clear()
    if (!plan) return
    for (const b of plan.blocks) {
      const [sx, sy, sz] = BLOCKS[b.block]?.size ?? [0.05, 0.05, 0.05]
      const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshBasicMaterial({ color: PREVIEW_COLOR[state], transparent: true, opacity: 0.28, depthWrite: false }))
      box.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: PREVIEW_COLOR[state] })))
      box.position.set(b.x, b.y, b.z)
      ghosts.add(box)
    }
  }

  // The order, shown in the panel.
  document.getElementById('order').innerHTML = ORDER.map((b) =>
    `<li><b>${b.label}</b> ${b.kg} kg${b.fragile ? ' <span class="fragile">FRAGILE</span>' : ''} <span class="dim">${b.cm.join('×')} cm</span></li>`).join('')

  // The conveyor brings a box to the pick spot when the robot needs it.
  const feed = async (id) => { if (waiting(mujoco, model, data, id)) bring(mujoco, model, data, id) }

  // The agent's log panel.
  const logEl = document.getElementById('log')
  function log(kind, text) {
    console.log('[agent]', kind, text)
    const li = document.createElement('li')
    li.className = kind
    li.textContent = text
    logEl.appendChild(li)
    logEl.scrollTop = logEl.scrollHeight
  }

  const ask = document.getElementById('ask')
  const buildButton = document.getElementById('build')
  const stopButton = document.getElementById('stop')
  async function startBuild() {
    const notes = ask.value.trim()
    const request = 'Plan the pallet for this order so it passes the 0.5 g truck test.' + (notes ? ' Extra wishes: ' + notes : '')
    if (agentBusy) return
    agentBusy = true
    parked = false
    buildButton.disabled = true
    logEl.innerHTML = ''
    log('you', notes ? `LoadProof plan · “${notes}”` : 'LoadProof plan')
    try {
      await runAgent({ request, mujoco, model, robot, log, preview, reset, feed })
    } catch (err) {
      log('fail', err.message === 'stopped' ? 'Stopped. Your hand is in charge again.' : 'Error: ' + err.message)
      console.error(err)
    }
    for (let k = 0; k < 3; k++) move[k] = data.mocap_pos[k] // hand control continues from where the robot left off
    agentBusy = false
    buildButton.disabled = false
  }
  buildButton.onclick = startBuild

  // The rushed worker's stack (arrival order, columns), placed at once, then checked in the computer.
  document.getElementById('worker').onclick = () => {
    if (agentBusy || truck.running) return
    reset()
    logEl.innerHTML = ''
    const plan = workersStack(ORDER)
    for (const b of plan.blocks) {
      const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block)
      const q = model.jnt_qposadr[model.body_jntadr[id]]
      data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], q)
    }
    data.qvel.fill(0)
    mujoco.mj_forward(model, data)
    log('you', 'Rushed worker: boxes in the order they arrived, in columns')
    checkPlan(plan, { mujoco, model, log, preview: () => {} }, [], { all: true })
    log('info', 'It is standing on the table right now. Press 🚚 Truck test to see what the truck does to it.')
  }
  ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBuild() })
  stopButton.onclick = () => robot.stop()

  // The truck test: push the load at 0.5 g and measure what moved.
  const truck = createTruckTest({ mujoco, model, data, scene: sim.scene, log })
  const truckButton = document.getElementById('truck')
  truckButton.onclick = () => {
    if (agentBusy || truck.running) return
    logEl.innerHTML = ''
    if (truck.start(0.5)) parked = true
  }
  const safe = PARK
  let parked = true // starts parked high (the pallet stays visible); after a truck test it parks again
  const banner = document.getElementById('banner')

  window.addEventListener('keydown', (e) => {
    if (e.target === ask) return
    if (e.key === 'c' && lastHand) reach.calibrate(lastHand.image)
    if (e.key === 'r' && !agentBusy) reset()
  })

  let tracker = null
  reset() // start with the hand parked
  status.textContent = `Type what to build, or press "Start camera" and use your right hand. ${HELP}`

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
  const auto = new URLSearchParams(location.search).get('build')
  if (auto) { ask.value = auto; startBuild() }
  if (new URLSearchParams(location.search).has('worker')) document.getElementById('worker').click()

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

    let simDt = dt
    if (truck.running) {
      // 2c. Truck test: hand parked high and open, gravity tilted by the test, slow motion during the pushes.
      simDt = dt * truck.timeScale
      truck.tick(simDt)
      for (let k = 0; k < 3; k++) { move[k] += 0.15 * (safe[k] - move[k]); data.mocap_pos[k] = move[k] }
      for (let i = 0; i < model.nu; i++) data.ctrl[i] = 0
      ring.visible = false
      status.textContent = '🚚 Truck test running…'
    } else if (parked && !hand) {
      // After a truck test: stay parked, do not come down onto whatever fell.
      for (let k = 0; k < 3; k++) { move[k] += 0.15 * (safe[k] - move[k]); data.mocap_pos[k] = move[k] }
      for (let i = 0; i < model.nu; i++) data.ctrl[i] = 0
      ring.visible = false
    } else if (agentBusy) {
      // 2a. The agent is building: the robot's own skills drive the hand.
      robot.tick(dt)
      ring.visible = false
      status.textContent = `The robot is building · press Stop to take over`
    } else {
      parked = false
      // 2b. Shared control: you choose where and when, the robot does the precise part.
      const current = [0, 1, 2].map((k) => data.site_xpos[3 * graspSite + k])
      if (!tracker) xy = [current[0], current[1]] // no camera: stay put
      const g = grasp.update(dt, xy, hand ? curl : (grasp.state === 'hold' ? 3 : 0), current)
      for (let k = 0; k < 3; k++) move[k] += SMOOTH_MOVE * (g.goal[k] - offset[k] - move[k])
      for (let k = 0; k < 3; k++) data.mocap_pos[k] = move[k]
      for (let i = 0; i < model.nu; i++) {
        data.ctrl[i] = g.fingers === 'mirror' ? target[i] : g.fingers === 'fist' ? fist[i] : 0
      }
      ring.visible = !!tracker
      ring.position.x = xy[0]
      ring.position.y = xy[1]
      ring.material.color.set(g.near ? 0x3fb950 : 0x8b949e)
      if (tracker) {
        status.textContent = !hand ? `No hand in view · ${HELP}`
          : g.held ? `Holding the ${BLOCKS[g.held].name}: move, then open your hand to put it down · ${HELP}`
          : g.near ? `Over the ${BLOCKS[g.near].name}: close your hand to grab · ${HELP}`
          : `Move the ring onto a block · ${HELP}`
      }
    }

    const phase = truck.phase
    banner.style.display = phase ? 'block' : 'none'
    if (phase) banner.textContent = phase.pushing ? `🚚 ${phase.name === 'brake' ? 'BRAKING' : 'SWERVING'} · ${phase.accel} g · slow motion` : '🚚 settling…'
    if (phase?.pushing) { // the whole world shakes a little, like the truck bed
      const a = 0.004 * Math.sin(now / 18)
      sim.scene.position.set(phase.dir[0] * a, phase.dir[1] * a, 0.0015 * Math.sin(now / 11))
    } else sim.scene.position.set(0, 0, 0)

    sim.step(simDt)
    sim.render()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main().catch((err) => {
  status.textContent = 'Error: ' + err.message
  console.error(err)
})
