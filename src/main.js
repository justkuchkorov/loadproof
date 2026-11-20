import { createSim } from './sim.js'

const status = document.getElementById('status')

async function main() {
  const sim = await createSim(document.getElementById('view'))
  const { model, data } = sim
  status.textContent = `Shadow Hand loaded: ${model.nu} motors, ${model.ngeom} geoms`
  window.sim = sim

  // Test motion: every motor swings slowly inside its own range.
  const range = model.actuator_ctrlrange
  let last = performance.now()
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now
    const t = now / 1000
    for (let i = 0; i < model.nu; i++) {
      const lo = range[2 * i]
      const hi = range[2 * i + 1]
      data.ctrl[i] = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t * 1.5 + i * 0.3))
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
