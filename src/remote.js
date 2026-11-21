// The phone remote: big buttons that send commands to the LoadProof page on the laptop, through the dev server's
// WebSocket (vite.config.js relays them), and show the state the page sends back: the boxes, LoadProof's suggestion,
// a verdict for every spot, and the log. Like a warehouse worker's handheld terminal.
const $ = (id) => document.getElementById(id)
const send = (cmd, extra = {}) => import.meta.hot?.send('remote:cmd', { cmd, ...extra })
let state = null, lastState = 0, chosenSpot = null, lastSelected = null
// Redraw a list only when it changed, so a tap never lands on a button that is being replaced.
const put = (el, html) => { if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; return true } return false }

// Where each spot sits in the pallet picture (2 x 2 grid, near side at the bottom, the robot's left on the left).
const AREA = {
  'far-left': '1 / 1 / 2 / 2', 'far-right': '1 / 2 / 2 / 3', 'near-left': '2 / 1 / 3 / 2', 'near-right': '2 / 2 / 3 / 3',
  'left column': '1 / 1 / 3 / 2', 'right column': '1 / 2 / 3 / 3', 'far row': '1 / 1 / 2 / 3', 'near row': '2 / 1 / 3 / 3',
}

$('build').onclick = () => send('build')
$('worker').onclick = () => send(state?.worker ? 'endworker' : 'worker')
$('stop').onclick = () => send('stop')
$('truck5').onclick = () => send('truck', { g: 0.5 })
$('truck8').onclick = () => send('truck', { g: 0.8 })
$('wrap').onclick = () => send('wrap')
$('place').onclick = () => { // the laptop places it when the spot is the one it shows; otherwise show it, then place
  if (!chosenSpot) return
  if (state?.pending !== chosenSpot) send('choose', { spot: chosenSpot })
  send('choose', { spot: chosenSpot })
}

function render() {
  const s = state
  $('dot').className = 'dot' + (s && performance.now() - lastState < 2000 ? ' on' : '')
  if (!s) return
  $('status').textContent = s.status
  $('worker').textContent = s.worker ? '👆 End' : '👆 I choose'
  $('workerui').classList.toggle('hidden', !s.worker)
  // boxes still waiting on the table
  const boxes = s.boxes.filter((b) => b.waiting).map((b) =>
    `<button class="box${b.id === s.selected ? ' sel' : ''}${b.id === s.next ? ' next' : ''}" data-box="${b.id}">${b.name.replace(' (fragile)', '')}${b.fragile ? '<br><span class="f">FRAGILE</span>' : ''}</button>`).join('')
    || '<div class="hint">Every box is on the pallet. Try 🚚.</div>'
  if (put($('boxes'), boxes)) $('boxes').querySelectorAll('[data-box]').forEach((el) => { el.onclick = () => send('select', { box: el.dataset.box }) })
  // the spots for the chosen box, coloured by LoadProof's verdict
  $('spotui').classList.toggle('hidden', !s.selected)
  if (s.selected !== lastSelected) { lastSelected = s.selected; chosenSpot = s.pending } // a new box: start from LoadProof's suggestion
  const spots = s.spots.map((v) =>
    `<button class="spot ${v.ok ? 'ok' : 'bad'}${v.suggested ? ' sugg' : ''}${v.spot === chosenSpot ? ' pend' : ''}" style="grid-area: ${AREA[v.spot]}" data-spot="${v.spot}">${v.spot}<br><small>layer ${v.layer}</small></button>`).join('')
  if (put($('pallet'), spots)) $('pallet').querySelectorAll('[data-spot]').forEach((el) => { el.onclick = () => {
    chosenSpot = el.dataset.spot
    if (chosenSpot !== state.pending) send('choose', { spot: chosenSpot }) // the laptop shows it; "Place it" places it
    render()
  } })
  const v = s.spots.find((x) => x.spot === chosenSpot)
  $('verdict').className = 'verdict ' + (v ? (v.ok ? 'ok' : 'bad') : '')
  $('verdict').textContent = v ? (v.ok ? `${v.spot}, layer ${v.layer}: warehouse rules OK` : `${v.spot}: ⚠ ${v.problems.join('; ')}`) : ''
  $('place').classList.toggle('hidden', !v)
  $('place').className = (v?.ok ? 'green' : 'red') + (v ? '' : ' hidden')
  $('place').textContent = v ? (v.ok ? `Place it on ${v.spot}` : `Place it anyway (against LoadProof's advice)`) : ''
  put($('log'), s.log.map(([k, t]) => `<div class="${k}">${t.replace(/</g, '&lt;')}</div>`).join(''))
}

import.meta.hot?.on('remote:state', (s) => { state = s; lastState = performance.now(); render() })
setInterval(() => { send('hello'); render() }, 1500) // tells the page a phone is here; shows when the link is lost
send('hello')
