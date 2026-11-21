import * as THREE from 'three'
import { createSim } from './sim.js'
import { createTracker } from './tracking.js'
import { retarget } from './retarget.js'
import { createReach } from './reach.js'
import { createGrasp, FIST } from './grasp.js'
import { createRobot } from './robot.js'
import { createArm, prepareArm } from './arm.js'
import { createCamera } from './camera.js'
import { createWorker } from './worker.js'
import { checkPlan } from './agent.js'
import { runLoadAgent, readOrder, quickPlan } from './loadagent.js'
import { BLOCKS, setOrder } from './planner.js'
import { ORDER, CATALOG, PALLET, PALLET_B, sceneXml, workersStack, orderFrom, randomOrder, copyId, wrapBoxes, setCell, armXml } from './pallet.js'
import { createTruckTest } from './truck.js'
import * as memory from './memory.js'
import POOL from './pool.js'
import { openReport } from './report.js'

const status = document.getElementById('status')
const startButton = document.getElementById('start')
const SMOOTH = 0.5      // fingers: 0 = frozen, 1 = no smoothing
const SMOOTH_MOVE = 0.3 // hand position
const HELP = 'R = reset'
const PREVIEW_COLOR = { checking: 0x8b949e, bad: 0xf85149, good: 0x3fb950 }

// The UR10e cell by default; ?hand opens the first version (a floating robot hand you can steer with the camera).
const ARM_CELL = !new URLSearchParams(location.search).has('hand')
setCell(ARM_CELL ? 'arm' : 'hand')
globalThis.NO_AI = new URLSearchParams(location.search).has('noai') // offline: plan by search only

async function main() {
  // The order: from the address (#order=WATER,CHIPS,...) or the demo order #A-1042.
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('order')
  const labelsInHash = fromHash ? fromHash.split(',').filter((n) => CATALOG[n]) : []
  const demo = labelsInHash.length === 0
  const order = demo ? ORDER : orderFrom(labelsInHash)
  setOrder(order)
  const labels = Object.fromEntries(order.flatMap((b) => [[b.id, { title: b.label, kg: b.kg, fragile: b.fragile }], [copyId(b.id), { title: b.label, kg: b.kg, fragile: b.fragile }]]))
  const sim = await createSim(document.getElementById('view'), { xml: sceneXml(order), labels, arm: ARM_CELL, armXml, prepare: prepareArm })
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
  const offset = [0, 1, 2].map((k) => ARM_CELL ? 0 : data.site_xpos[3 * graspSite + k] - data.mocap_pos[k])
  const move = Array.from(data.mocap_pos.subarray(0, 3))
  const PARK = [0.47 - offset[0], -0.5 - offset[1], 0.34 - offset[2]] // hand parked high in the far right corner, clear of both pallets
  const reach = createReach()
  const grasp = createGrasp({ mujoco, model, data, objects: Object.keys(BLOCKS) })
  // The cell's depth camera: the arm finds boxes with it; a small live view shows what it sees.
  const eye = ARM_CELL ? createCamera({ mujoco, model, data }) : null
  if (eye) {
    const box = document.createElement('div')
    box.id = 'eye'
    box.innerHTML = '<div class="dim">📷 3D camera · what the robot sees</div>'
    box.appendChild(eye.canvas)
    document.body.appendChild(box)
  }
  const robot = ARM_CELL ? createArm({ mujoco, model, data, eye }) : createRobot({ mujoco, model, data })
  window.robot = robot
  let agentBusy = false
  let xy = [0.18, 0]
  let lastHand = null

  // Reset the world: boxes back to waiting, the hand straight to its parked spot (so it never brushes a stack).
  function reset() {
    truck?.cancel()
    robot.stop()
    mujoco.mj_resetData(model, data)
    if (ARM_CELL) robot.resetPose() // the arm stands parked, its motors holding it there
    else {
    const fa = model.jnt_qposadr[model.body_jntadr[mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'rh_forearm')]]
    for (let k = 0; k < 3; k++) { move[k] = PARK[k]; data.mocap_pos[k] = PARK[k]; data.qpos[fa + k] = PARK[k] }
    }
    parked = true
    mujoco.mj_forward(model, data)
    if (typeof signs !== 'undefined') signs.forEach((s) => { s.visible = false })
    if (typeof films !== 'undefined') { unwrap = null; films.clear() } // mj_resetData already switched the links off
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
  document.getElementById('ordername').textContent = demo ? 'order #A-1042 (demo)' : `custom order · ${order.length} boxes`
  document.getElementById('order').innerHTML = order.map((b) =>
    `<li><b>${b.label}</b> ${b.kg} kg${b.fragile ? ' <span class="fragile">FRAGILE</span>' : ''} <span class="dim">${b.cm.join('×')} cm</span></li>`).join('')

  // The order editor: add or remove boxes, or roll a random order; "Load" rebuilds the scene with it.
  let draft = order.map((b) => b.label)
  const draftEl = document.getElementById('draft')
  const spotsUsed = (list) => list.reduce((s, n) => s + (CATALOG[n].cm[0] > 40 || CATALOG[n].cm[1] > 50 ? 2 : 1), 0)
  function showDraft() {
    draftEl.innerHTML = draft.map((n, i) => `<button class="chip" data-i="${i}" title="remove">${n} ×</button>`).join('') +
      `<span class="dim"> ${draft.length} boxes · ${spotsUsed(draft)} spots (4 per layer)</span>` +
      (spotsUsed(draft) % 4 ? `<span class="fragile"> · not a multiple of 4: one layer stays incomplete, which may make the order impossible</span>` : '')
    draftEl.querySelectorAll('[data-i]').forEach((el) => { el.onclick = () => { draft.splice(+el.dataset.i, 1); showDraft() } })
  }
  document.getElementById('catalog').innerHTML = Object.entries(CATALOG).map(([n, c]) =>
    `<button class="chip add" data-n="${n}" title="${c.cm.join('×')} cm, ${c.kg} kg${c.fragile ? ', fragile' : ''}">+ ${n}</button>`).join('')
  document.querySelectorAll('#catalog [data-n]').forEach((el) => { el.onclick = () => { if (draft.length < 9) { draft.push(el.dataset.n); showDraft() } } })
  // 🎲 picks from orders known to be stackable (tests/make_pool.mjs); boxes in a random arrival order.
  document.getElementById('random').onclick = () => {
    draft = [...POOL[Math.floor(Math.random() * POOL.length)]]
    for (let i = draft.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [draft[i], draft[j]] = [draft[j], draft[i]] }
    showDraft()
  }
  document.getElementById('demo').onclick = () => { location.hash = ''; location.reload() }
  document.getElementById('load').onclick = () => {
    if (draft.length === 0) return
    location.hash = 'order=' + draft.join(',')
    location.reload()
  }
  document.getElementById('edit').onclick = () => { document.getElementById('editor').classList.toggle('open') }
  showDraft()

  // Memory: plans tested, failed, lessons learned.
  const names = Object.fromEntries(order.map((b) => [b.id, b.label]))
  const labelsOfOrder = order.map((b) => b.label)
  function showMemory() {
    const s = memory.stats()
    document.getElementById('memstats').textContent = `🧠 Memory: ${s.tested} plan${s.tested === 1 ? '' : 's'} tested · ${s.failed} failed · ${s.lessons} lesson${s.lessons === 1 ? '' : 's'}`
    document.getElementById('lessons').innerHTML = memory.lessons().map((l) => `<li>${l.text} <span class="dim">(${l.count}×)</span></li>`).join('') || '<li class="dim">No lessons yet.</li>'
  }
  const remember = (source) => (plan, c) => {
    memory.record({ labels: labelsOfOrder, names, plan, pass: c.pass, feedback: c.feedback ?? '', source })
    showMemory()
  }
  document.getElementById('forget').onclick = () => { memory.forget(); showMemory() }
  showMemory()

  // Put a plan's boxes straight on the pallet (used when the robot build is switched off, and for the rushed stack).
  function place(plan) {
    for (const b of plan.blocks) {
      const id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, b.block)
      data.qpos.set([b.x, b.y, b.z, 1, 0, 0, 0], model.jnt_qposadr[model.body_jntadr[id]])
    }
    data.qvel.fill(0)
    mujoco.mj_forward(model, data)
  }

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
  // The agent: reads a free-text order (a new order sets the cell up again: page reload, then it goes on), then plans,
  // tests, secures and builds through its tools (loadagent.js).
  const CONT = 'loadproof.continue'
  async function startBuild() {
    if (agentBusy) return
    const text = ask.value.trim()
    agentBusy = true
    parked = false
    buildButton.disabled = true
    logEl.innerHTML = ''
    try {
      let instructions = ''
      let cont = null
      try { cont = JSON.parse(sessionStorage.getItem(CONT) ?? 'null'); sessionStorage.removeItem(CONT) } catch { /* no storage */ }
      if (cont) {
        for (const [kind, line] of cont.lines) log(kind, line)
        log('ok', `The cell is set up for this order: ${labelsOfOrder.join(', ')}`)
        instructions = cont.instructions
      } else if (text) {
        log('you', `“${text}”`)
        if (globalThis.NO_AI) { instructions = text; log('info', 'No AI: your text goes to the fixed steps as instructions; the order stays as it is') }
        else {
          log('step', '🧠 Agent → reading the order…')
          try {
            const r = await readOrder(text)
            log('ok', `Read the order (${r.model}): ${r.labels.join(', ') || 'no catalogue products'}${r.missing.length ? ` · not in the catalogue: ${r.missing.join(', ')}` : ''}`)
            if (r.instructions) log('info', `Instructions for the agent: ${r.instructions}`)
            instructions = r.instructions
            const same = [...r.labels].sort().join(',') === [...labelsOfOrder].sort().join(',')
            if (r.labels.length && !same) {
              log('step', 'Setting up the cell for this order…')
              try { sessionStorage.setItem(CONT, JSON.stringify({ instructions, lines: [...logEl.children].map((li) => [li.className, li.textContent]) })) } catch { /* no storage */ }
              location.hash = 'order=' + r.labels.join(',')
              location.reload()
              return
            }
          } catch (err) { instructions = text; log('fail', `Could not read the order (${err.message}); your text goes on as instructions`) }
        }
      } else log('you', 'LoadProof: plan, test, secure and build this order')
      const useRobot = document.getElementById('userobot').checked
      const state = await runLoadAgent({ instructions, mujoco, model, robot, log, preview, reset, place: useRobot ? null : place, wrap: wrapLoad, onChecked: remember('AI') })
      if (state?.builtPlan) { lastGoodPlan = state.builtPlan; truck.forget() }
    } catch (err) {
      log('fail', err.message === 'stopped' ? 'Stopped. Your hand is in charge again.' : 'Error: ' + err.message)
      console.error(err)
    }
    for (let k = 0; k < 3; k++) move[k] = data.mocap_pos[k] // hand control continues from where the robot left off
    agentBusy = false
    buildButton.disabled = false
  }
  buildButton.onclick = startBuild

  // Signs over the two pallets, shown in Compare.
  function sign(text, color, y) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 512, 96)
    g.fillStyle = '#fff'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(text, 256, 66)
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))
    s.scale.set(0.16, 0.03, 1); s.position.set(PALLET.x - 0.1, y, 0.01); s.renderOrder = 11; s.visible = false // on the table in front of the pallet
    sim.scene.add(s)
    return s
  }
  const signs = [sign('🤖 LoadProof', '#1f6feb', PALLET.y), sign('👷 Rushed', '#6e4a1f', PALLET_B.y)]
  let lastGoodPlan = null

  // Compare: the rushed stack on the right pallet, the LoadProof plan on the left, both placed at once.
  document.getElementById('compare').onclick = async () => {
    if (agentBusy || truck.running) return
    agentBusy = true
    reset()
    logEl.innerHTML = ''
    log('you', 'Compare: rushed worker (right) against LoadProof (left), same boxes')
    try {
      if (!lastGoodPlan) {
        lastGoodPlan = await quickPlan({ mujoco, model, robot, log, preview, reset, place, wrap: wrapLoad, onChecked: remember('search') })
        preview(null)
      }
      if (!lastGoodPlan) throw new Error('no LoadProof plan passed the checks')
      reset()
      place(lastGoodPlan)
      const rushed = workersStack(order)
      place({ blocks: rushed.blocks.map((b) => ({ ...b, block: copyId(b.block), y: b.y + PALLET_B.y - PALLET.y })) })
      signs.forEach((s) => { s.visible = true })
      log('info', 'Both stand on the table. Press 🚚 Truck test to shake both at once.')
    } catch (err) {
      log('fail', 'Compare: ' + err.message)
    }
    agentBusy = false
  }

  // Record this tab as a video, with the browser's own screen recorder (no extra program): the backup for the pitch.
  const recButton = document.getElementById('rec')
  let recorder = null
  recButton.onclick = async () => {
    if (recorder) { recorder.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true })
      const chunks = []
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
        a.download = 'loadproof-demo.webm'
        a.click()
        recorder = null
        recButton.textContent = '⏺ Record'
        recButton.classList.remove('on')
      }
      stream.getVideoTracks()[0].onended = () => recorder?.stop() // stopped from the browser bar
      recorder.start()
      recButton.textContent = '⏹ Stop & save'
      recButton.classList.add('on')
    } catch (err) {
      recorder = null
      log('fail', 'Recording: ' + err.message)
    }
  }

  // The load stability report for the last LoadProof plan (and the last truck test, if one ran after it).
  document.getElementById('report').onclick = () => {
    if (!lastGoodPlan?.checks) { log('fail', '📄 Report: run LoadProof first'); return }
    const opened = openReport({ order, plan: lastGoodPlan, checks: lastGoodPlan.checks, truck: truck.last, orderName: demo ? 'order #A-1042' : 'custom order' })
    if (!opened) log('fail', '📄 The browser blocked the report window: allow pop-ups for this page')
  }

  // Stretch wrap: hold each load on its pallet with soft film; a see-through film is drawn around each load.
  const films = new THREE.Group()
  sim.scene.add(films)
  let unwrap = null
  document.getElementById('wrap').onclick = () => {
    if (worker && !worker.busy) endWorker()
    if (agentBusy || truck.running) return
    if (unwrap) { unwrap(); unwrap = null; films.clear(); log('info', '🎞 Wrap removed'); return }
    wrapLoad()
  }
  // Wrap what stands on the pallets (the button, and the agent when it decides to wrap).
  function wrapLoad() {
    if (unwrap) return
    const all = Object.keys(BLOCKS).flatMap((n) => [n, copyId(n)])
    const loads = [PALLET, PALLET_B].map((pal) => all.filter((n) => { const p = robot.P(n); return Math.abs(p[0] - pal.x) < 0.12 && Math.abs(p[1] - pal.y) < 0.13 && p[2] > 0 }))
    const names = loads.flat()
    if (names.length === 0) { log('fail', '🎞 Nothing on a pallet to wrap'); return }
    unwrap = wrapBoxes(mujoco, model, data, names)
    for (const [i, group] of loads.entries()) {
      if (!group.length) continue
      const pal = [PALLET, PALLET_B][i]
      const top = Math.max(...group.map((n) => robot.P(n)[2] + (BLOCKS[n] ?? BLOCKS['b' + n.slice(1)]).size[2] / 2))
      const film = new THREE.Mesh(new THREE.BoxGeometry(pal.sx + 0.01, pal.sy + 0.01, top - pal.top + 0.004),
        new THREE.MeshStandardMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, roughness: 0.2, metalness: 0.1, depthWrite: false }))
      film.position.set(pal.x, pal.y, (top + pal.top) / 2)
      films.add(film)
    }
    log('ok', `🎞 Wrapped ${loads.filter((l) => l.length).length === 2 ? 'both loads' : 'the load'} in stretch film`)
  }

  // The rushed worker's stack (arrival order, columns), placed at once, then checked in the computer.
  document.getElementById('worker').onclick = () => {
    if (agentBusy || truck.running) return
    reset()
    logEl.innerHTML = ''
    const plan = workersStack(order)
    place(plan)
    log('you', 'Rushed worker: boxes in the order they arrived, in columns')
    const c = checkPlan(plan, { mujoco, model, log, preview: () => {} }, [], { all: true })
    remember('rushed worker')(plan, { pass: false, feedback: [...document.querySelectorAll('#log li.fail')].map((li) => li.textContent).join('; ') })
    log('info', 'It is standing on the table right now. Press 🚚 Truck test to see what the truck does to it.')
  }
  ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') startBuild() })
  stopButton.onclick = () => robot.stop()

  // The truck test: push the load at 0.5 g and measure what moved.
  const truck = createTruckTest({ mujoco, model, data, scene: sim.scene, log })
  const truckButton = document.getElementById('truck')
  truckButton.onclick = () => {
    if (worker && !worker.busy) endWorker() // the worker's stack goes to the truck test
    if (agentBusy || truck.running) return
    logEl.innerHTML = ''
    if (truck.start(Number(gSlider.value))) parked = true
  }
  // How hard the truck pushes: 0.5 g is the EU load test (EUMOS 40509); 0.8 g is the braking value of EN 12195-1.
  const gSlider = document.getElementById('g')
  const NOTES = { 0.3: 'gentle', 0.4: 'moderate', 0.5: 'EU load test', 0.6: 'hard', 0.7: 'very hard', 0.8: 'hard braking, swerve 0.5 g (EN 12195-1 road)' }
  gSlider.oninput = () => {
    const g = Number(gSlider.value).toFixed(1)
    document.getElementById('gnote').textContent = `${g} g · ${NOTES[g]}`
    truckButton.textContent = `🚚 Truck test (${g} g)`
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
  status.textContent = ARM_CELL ? `Press 🤖 to plan and build. ${HELP}` : `Type what to build, or press "Start camera" and use your right hand. ${HELP}`
  if (ARM_CELL) startButton.style.display = 'none' // the camera steers the hand version (?hand)

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

  // 👆 You choose (worker mode): the worker clicks a box, then a spot; LoadProof suggests and checks, the robot places.
  let worker = null
  const workerButton = document.getElementById('youchoose')
  if (!ARM_CELL) workerButton.style.display = 'none'
  async function startWorker() {
    if (worker) { endWorker(); log('info', '👆 Worker mode ended'); return }
    if (agentBusy || truck.running) return
    agentBusy = true
    logEl.innerHTML = ''
    log('you', '👆 Worker mode: you choose the box and the spot, the robot places it, LoadProof checks every choice')
    reset()
    let suggestion = lastGoodPlan
    if (!suggestion) { log('step', 'LoadProof prepares its suggestions (search + EU test, no AI)…'); suggestion = await quickPlan({ mujoco, model, robot, log: () => {}, preview, reset, place, wrap: wrapLoad, onChecked: remember('search') }); preview(null) }
    worker = createWorker({ robot, log, preview, suggestion })
    workerButton.textContent = '👆 End worker mode'
    log('info', 'Click a box on the table.')
  }
  workerButton.onclick = startWorker
  function endWorker() { worker?.stop(); worker = null; agentBusy = false; workerButton.textContent = '👆 You choose' }
  // A click (not a drag) on the 3D view: a waiting box selects it; a point on the pallet chooses the spot.
  let downAt = null
  sim.canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY] })
  sim.canvas.addEventListener('pointerup', (e) => {
    if (!worker || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return
    const hit = sim.pickAt(e.clientX, e.clientY)
    if (!hit) return
    if (BLOCKS[hit.body] && worker.waiting().includes(hit.body)) worker.select(hit.body)
    else if (worker.selected && Math.abs(hit.point[0] - PALLET.x) < PALLET.sx / 2 + 0.02 && Math.abs(hit.point[1] - PALLET.y) < PALLET.sy / 2 + 0.02) worker.choose([hit.point[0], hit.point[1]])
  })
  // 📱 The phone remote (remote.html): its taps arrive here through the dev server; the page's state goes back to it.
  let remoteSeen = 0
  if (import.meta.hot && ARM_CELL) {
    import.meta.hot.on('remote:cmd', async (c) => {
      remoteSeen = performance.now()
      if (c.cmd === 'hello') return
      log('info', `📱 Remote: ${c.cmd}${c.box ? ' ' + BLOCKS[c.box]?.name : ''}${c.spot ? ' ' + c.spot : ''}`)
      if (c.cmd === 'worker') { if (!worker) await startWorker() }
      else if (c.cmd === 'endworker') { if (worker) await startWorker() }
      else if (c.cmd === 'select') worker?.select(c.box)
      else if (c.cmd === 'choose') worker?.choose(c.spot)
      else if (c.cmd === 'build') { if (worker && !worker.busy) endWorker(); startBuild() }
      else if (c.cmd === 'truck') { gSlider.value = String(c.g ?? 0.5); gSlider.oninput(); truckButton.onclick() }
      else if (c.cmd === 'wrap') document.getElementById('wrap').onclick()
      else if (c.cmd === 'stop') robot.stop()
    })
    setInterval(() => {
      if (performance.now() - remoteSeen > 10000) return // no phone connected
      import.meta.hot.send('remote:state', {
        status: status.textContent, worker: !!worker, busy: agentBusy, truck: truck.running,
        boxes: Object.keys(BLOCKS).map((id) => ({ id, name: BLOCKS[id].name, kind: BLOCKS[id].kind, fragile: !!BLOCKS[id].fragile, waiting: worker ? worker.waiting().includes(id) : null })),
        selected: worker?.selected ?? null, next: worker?.next() ?? null, pending: worker?.pending ?? null, spots: worker?.verdicts() ?? [],
        log: [...logEl.children].slice(-6).map((li) => [li.className, li.textContent]),
      })
    }, 400)
    fetch('/__remote-url').then((r) => r.json()).then(({ urls }) => {
      const el = document.getElementById('remoteurl')
      if (el && urls.length) el.innerHTML = '📱 Phone remote (same Wi-Fi): ' + urls.map((u) => `<b>${u}</b>`).join(' or ')
    }).catch(() => {})
  }
  if (new URLSearchParams(location.search).has('autostart')) startButton.click()
  const auto = new URLSearchParams(location.search).get('build')
  if (auto) { ask.value = auto; startBuild() }
  else { let next = null; try { next = sessionStorage.getItem(CONT) } catch { /* no storage */ } if (next) startBuild() } // the agent goes on after setting up the cell
  if (new URLSearchParams(location.search).has('worker')) document.getElementById('worker').click()
  if (new URLSearchParams(location.search).has('compare')) document.getElementById('compare').onclick().then(() => { if (new URLSearchParams(location.search).has('truck')) document.getElementById('truck').click() })
  if (new URLSearchParams(location.search).has('dowrap')) document.getElementById('wrap').click()
  if (new URLSearchParams(location.search).has('memopen')) document.getElementById('memory').open = true
  if (new URLSearchParams(location.search).has('editor')) document.getElementById('editor').classList.add('open')

  let last = performance.now()
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30)
    last = now

    // 1. Read your hand: finger angles, how closed it is, and where it points on the table.
    const hand = tracker ? tracker.update() : null
    let curl = 0
    if (hand && !ARM_CELL) {
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

    // Simulated time for this frame: whole 2 ms physics steps, so the robot moves at the same pace on any screen.
    const simDt = sim.advance(truck.running ? dt * truck.timeScale : dt)
    if (ARM_CELL) {
      // The UR10e: its controller always runs (building, holding still, or parked during the truck test).
      if (truck.running) truck.tick(simDt)
      ring.visible = !!worker?.selected // a ring on the chosen box's top
      if (worker?.selected) { const p = robot.P(worker.selected); ring.position.set(p[0], p[1], p[2] + BLOCKS[worker.selected].size[2] / 2 + 0.002); ring.material.color.set(0x3fb950) }
      else ring.position.z = 0.002
      if (simDt > 0) robot.tick(simDt)
      const text = worker ? worker.text : truck.running ? '🚚 Truck test running…' : agentBusy ? 'The UR10e is building · press Stop to stop it' : `Ready · ${HELP}`
      if (status.textContent !== text) status.textContent = text
    } else if (truck.running) {
      // 2c. Truck test: hand parked high and open, gravity tilted by the test, slow motion during the pushes.
      truck.tick(simDt)
      const aimT = move[2] < safe[2] - 0.02 ? [move[0], move[1], safe[2]] : safe // up first, then across
      for (let k = 0; k < 3; k++) { move[k] += 0.2 * (aimT[k] - move[k]); data.mocap_pos[k] = move[k] }
      for (let i = 0; i < model.nu; i++) data.ctrl[i] = 0
      ring.visible = false
      status.textContent = '🚚 Truck test running…'
    } else if (agentBusy) {
      // 2a. The agent is building: the robot's own skills drive the hand. (Checked before "parked".)
      robot.tick(dt)
      ring.visible = false
      status.textContent = `The robot is building · press Stop to take over`
    } else if (parked && !hand) {
      // Parked (at the start, after a reset or a truck test): straight up first, then across — never through a stack.
      const up = move[2] < safe[2] - 0.02
      const aim = up ? [move[0], move[1], safe[2]] : safe
      for (let k = 0; k < 3; k++) { move[k] += 0.2 * (aim[k] - move[k]); data.mocap_pos[k] = move[k] }
      for (let i = 0; i < model.nu; i++) data.ctrl[i] = 0
      ring.visible = false
      status.textContent = `Ready · ${HELP}`
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
    if (phase) banner.textContent = phase.pushing ? `🚚 ${{ brake: 'BRAKING', 'speed up': 'SPEEDING UP' }[phase.name] ?? 'SWERVING'} · ${phase.accel} g · slow motion` : '🚚 settling…'
    if (phase?.pushing) { // the whole world shakes a little, like the truck bed
      const a = 0.004 * Math.sin(now / 18)
      sim.scene.position.set(phase.dir[0] * a, phase.dir[1] * a, 0.0015 * Math.sin(now / 11))
    } else sim.scene.position.set(0, 0, 0)

    sim.step(simDt)
    eye?.tick(2) // the live camera view, two rows a frame
    sim.render()
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

main().catch((err) => {
  status.textContent = 'Error: ' + err.message
  console.error(err)
})
