// The box list (boxes.html), on the phone or the laptop: add boxes as data (name, fragility, footprint on the 60 x 40
// module, height, weight), print labels with a QR code, load them into LoadProof, and see the loading sheet. The list
// lives on the laptop's dev server (vite.config.js), so every device sees the same boxes. A label's QR code opens this
// page for that box (#box=7): what is inside, and its step on the loading sheet.
import qrcode from 'qrcode-generator'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const FIRM = { soft: 'SOFT · nothing on top', mid: 'MID · only lighter on top', hard: 'HARD' }
let db = { boxes: [], sheet: null }
let base = location.origin // the address a phone can open (the laptop's network address), for the QR codes

const api = async (body) => {
  const r = await fetch('/__boxes', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  db = await r.json()
  render()
}
fetch('/__remote-url').then((r) => r.json()).then((d) => { if (location.hostname === 'localhost' && d.bases?.[0]) base = d.bases[0] }).catch(() => {})

// choices: fragility and footprint are button groups
const pick = (group) => $(group).querySelector('.on').dataset.v
for (const g of ['firmness', 'footprint']) {
  $(g).querySelectorAll('button').forEach((b) => { b.onclick = () => { $(g).querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on') } })
}

$('add').onclick = async () => {
  const name = $('name').value.trim()
  if (!name) { $('msg').className = 'msg fail'; $('msg').textContent = 'Give the box a name (what is inside).'; return }
  const [w, d] = pick('footprint').split(',').map(Number)
  await api({ action: 'add', box: { name, firmness: pick('firmness'), cm: [w, d, Number($('h').value)], kg: Number($('kg').value) } })
  const b = db.boxes.at(-1)
  $('msg').className = 'msg ok'
  $('msg').textContent = `Added box #${b.n}: ${b.name}, ${b.kg} kg, ${b.cm.join(' × ')} cm, ${b.firmness}`
  $('name').value = ''; $('name').focus()
}
$('clear').onclick = () => { if (confirmClear()) api({ action: 'clear' }) }
function confirmClear() { // a second press within 3 s clears (no browser dialog)
  if ($('clear').dataset.armed) return true
  $('clear').dataset.armed = '1'; $('clear').textContent = '🗑 Press again to clear every box'
  setTimeout(() => { delete $('clear').dataset.armed; $('clear').textContent = '🗑 Clear the list' }, 3000)
  return false
}
$('load').onclick = () => {
  if (!db.boxes.length) { $('loadmsg').className = 'msg fail'; $('loadmsg').textContent = 'Add boxes first.'; return }
  import.meta.hot?.send('remote:cmd', { cmd: 'loadboxes' })
  $('loadmsg').className = 'msg ok'
  $('loadmsg').textContent = db.boxes.length > 9 ? 'Sent to the laptop. One half pallet takes 9 boxes: the first 9 are loaded.' : 'Sent to the laptop: LoadProof sets up the cell with your boxes.'
}
$('print').onclick = () => { labels(); window.print() }

function stepOf(n) { return db.sheet?.steps.find((s) => s.n === n) }
function render() {
  $('count').textContent = `(${db.boxes.length})`
  $('list').innerHTML = db.boxes.map((b) => {
    const s = stepOf(b.n)
    return `<div class="row"><span class="num">#${b.n}</span><div class="grow"><b>${esc(b.name)}</b> ${b.kg} kg <span class="tag ${b.firmness}">${b.firmness.toUpperCase()}</span><br>` +
      `<span class="dim">${b.cm.join(' × ')} cm${s ? ` · step ${s.step}: layer ${s.layer}, ${s.spot}` : ''}</span></div><button class="x" data-n="${b.n}" title="remove">✕</button></div>`
  }).join('') || '<div class="dim">No boxes yet.</div>'
  $('list').querySelectorAll('[data-n]').forEach((el) => { el.onclick = () => api({ action: 'delete', n: Number(el.dataset.n) }) })
  const sh = db.sheet
  $('sheet').innerHTML = sh ? `<div class="card"><b>${esc(sh.title)}</b><ol style="margin: 8px 0 0; padding-left: 22px">` +
    sh.steps.map((s) => `<li>${s.n ? `<b>#${s.n}</b> ` : ''}${esc(s.name)} → layer ${s.layer}, <b>${esc(s.spot)}</b></li>`).join('') +
    `</ol>${(sh.after ?? []).map((a) => `<div style="margin-top:6px">${esc(a)}</div>`).join('')}</div>` : $('sheet').innerHTML
  one()
}

// One box, opened from its label's QR code
function one() {
  const n = Number(new URLSearchParams(location.hash.slice(1)).get('box'))
  $('app').style.display = n ? 'none' : 'block'
  $('one').style.display = n ? 'block' : 'none'
  if (!n) return
  const b = db.boxes.find((x) => x.n === n)
  $('onenum').textContent = `#${n}`
  $('onebody').innerHTML = b ? `<b>${esc(b.name)}</b><br>${b.kg} kg · ${b.cm.join(' × ')} cm<br><span class="tag ${b.firmness}">${FIRM[b.firmness]}</span>` : 'This box is not in the list any more.'
  const s = stepOf(n)
  $('onestep').className = 'msg ' + (s ? 'ok' : '')
  $('onestep').textContent = s ? `Loading sheet: step ${s.step} of ${db.sheet.steps.length} — layer ${s.layer}, ${s.spot}` : 'Not on a loading sheet yet.'
}
window.addEventListener('hashchange', one)

// Labels: number, name, weight, size, fragility, and a QR code that opens this box's page
function labels() {
  $('labels').innerHTML = db.boxes.map((b) => {
    const qr = qrcode(0, 'M')
    qr.addData(`${base}/boxes.html#box=${b.n}`)
    qr.make()
    return `<div class="label">${qr.createSvgTag({ cellSize: 3, margin: 0 })}<div><div class="n">#${b.n}</div><div class="w">${esc(b.name)} · ${b.kg} kg</div>` +
      `<div class="t">${b.cm.join(' × ')} cm</div><div class="fr">${FIRM[b.firmness]}</div><div class="t">LoadProof</div></div></div>`
  }).join('')
}

import.meta.hot?.on('boxes:changed', () => api())
api()
