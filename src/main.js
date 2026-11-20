import { createSim } from './sim.js'
import { createTracker } from './tracking.js'
import { retarget } from './retarget.js'

const status = document.getElementById('status')
const startButton = document.getElementById('start')
const SMOOTH = 0.5 // 0 = frozen, 1 = no smoothing

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

  let tracker = null
  status.textContent = 'Ready. Press "Start camera" and show your right hand.'

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
      status.textContent = `Tracking your ${hand.handedness.toLowerCase()} hand`
    } else if (tracker) {
      status.textContent = 'No hand in view'
    }
    for (let i = 0; i < model.nu; i++) data.ctrl[i] = target[i]

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
