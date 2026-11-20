import { createSim } from './sim.js'
import { createTracker } from './tracking.js'
import { retarget } from './retarget.js'
import { createReach } from './reach.js'

const status = document.getElementById('status')
const startButton = document.getElementById('start')
const SMOOTH = 0.5 // fingers: 0 = frozen, 1 = no smoothing
const SMOOTH_MOVE = 0.3 // hand position

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

  // The hand follows an invisible "mocap" target. Keep the grasp point (in the palm) where your hand points.
  const graspSite = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE.value, 'grasp_site')
  const offset = [0, 1, 2].map((k) => data.site_xpos[3 * graspSite + k] - data.mocap_pos[k])
  const move = Array.from(data.mocap_pos.subarray(0, 3))
  const reach = createReach()
  let lastHand = null

  window.addEventListener('keydown', (e) => {
    if (e.key === 'c' && lastHand) reach.calibrate(lastHand.image)
    if (e.key === 'r') {
      mujoco.mj_resetData(model, data)
      for (let k = 0; k < 3; k++) data.mocap_pos[k] = move[k]
      mujoco.mj_forward(model, data)
    }
  })

  let tracker = null
  status.textContent = 'Ready. Press "Start camera" and show your right hand. C = recentre, R = reset objects.'

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

    const hand = tracker ? tracker.update() : null
    if (hand) {
      const goals = retarget(hand.world, hand.handedness)
      for (const [name, value] of Object.entries(goals)) {
        const i = actuator[name]
        if (i === undefined) continue
        const clamped = Math.max(range[2 * i], Math.min(range[2 * i + 1], value))
        target[i] += SMOOTH * (clamped - target[i])
      }
      lastHand = hand
      const goal = reach.goal(hand.image)
      for (let k = 0; k < 3; k++) move[k] += SMOOTH_MOVE * (goal[k] - offset[k] - move[k])
      status.textContent = `Tracking your ${hand.handedness.toLowerCase()} hand · C = recentre · R = reset objects`
    } else if (tracker) {
      status.textContent = 'No hand in view'
    }
    for (let i = 0; i < model.nu; i++) data.ctrl[i] = target[i]
    for (let k = 0; k < 3; k++) data.mocap_pos[k] = move[k]

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
