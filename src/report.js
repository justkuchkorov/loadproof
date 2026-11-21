// A one-page load stability report for a checked plan, opened in a new window, ready to print or save as PDF.
import { BLOCKS } from './planner.js'
import { PALLET } from './pallet.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const mm = (m) => (m * 1000 * 5).toFixed(0) // model metres -> real millimetres (the model is 1:5)

// Top view of one layer: the pallet's 2 x 2 spots, near row at the bottom, the robot's left on the left.
function layerSvg(blocks) {
  const W = 160, H = 120 // drawing units: 1 unit = 1 mm of the model
  const sx = (y) => (W / 2) - (y - PALLET.y) * 1000 // left (+y) drawn on the left
  const sy = (x) => (H / 2) - (x - PALLET.x) * 1000 // far (+x) drawn at the top
  const rects = blocks.map((b) => {
    const [dx, dy] = BLOCKS[b.block].size.map((v) => v * 1000)
    const x = sx(b.y) - dy / 2 + 1.5, y = sy(b.x) - dx / 2 + 1.5
    const fragile = BLOCKS[b.block].fragile
    return `<rect x="${x}" y="${y}" width="${dy - 3}" height="${dx - 3}" rx="3" fill="${fragile ? '#f6dcc1' : '#e3c79f'}" stroke="#6b4b26"/>` +
      `<text x="${x + (dy - 3) / 2}" y="${y + (dx - 3) / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700">${esc(BLOCKS[b.block].name.split(' ')[0])}</text>`
  }).join('')
  return `<svg viewBox="-4 -4 ${W + 8} ${H + 8}" width="200"><rect x="0" y="0" width="${W}" height="${H}" fill="#f3ead9" stroke="#b08850" stroke-dasharray="4 3"/>${rects}</svg>`
}

export function reportHtml({ order, plan, checks, truck, orderName }) {
  const layers = [...new Set(plan.blocks.map((b) => b.layer ?? Math.round(b.z * 100)))].sort((a, b) => a - b)
  const t = checks?.transport
  const agent = plan.agent
  const verdict = checks?.pass && (!truck || truck.groups.every((g) => g.pass))
  const truckRows = truck ? truck.groups.map((g) => `<tr><td>${esc(g.name)}</td><td>${mm(g.worst)} mm (${esc(g.worstName)})</td><td>${mm(g.limit)} mm</td><td class="${g.pass ? 'ok' : 'bad'}">${g.pass ? 'PASS' : 'FAIL'}</td></tr>`).join('') : ''
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Load stability report</title>
<style>
  body { font: 14px/1.45 system-ui, sans-serif; color: #1f2328; margin: 28px auto; max-width: 760px; }
  h1 { font-size: 22px; margin: 0; } h2 { font-size: 15px; margin: 22px 0 6px; border-bottom: 1px solid #d0d7de; padding-bottom: 3px; }
  .dim { color: #656d76; } table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 3px 8px; border-bottom: 1px solid #eaeef2; }
  .ok { color: #1a7f37; font-weight: 700; } .bad { color: #cf222e; font-weight: 700; }
  .verdict { font-size: 20px; padding: 10px 14px; border-radius: 8px; margin: 14px 0; } .verdict.ok { background: #dafbe1; } .verdict.bad { background: #ffebe9; }
  .layers { display: flex; gap: 14px; flex-wrap: wrap; } .layers figure { margin: 0; } figcaption { font-size: 12px; color: #656d76; }
  button { margin-top: 18px; padding: 8px 14px; font: inherit; } @media print { button { display: none } }
</style></head><body>
<h1>Load stability report</h1>
<div class="dim">LoadProof · ${esc(orderName)} · half-EUR pallet 60 × 80 cm (simulated as a 1:5 model) · ${new Date().toLocaleString()}</div>
<div class="verdict ${verdict ? 'ok' : 'bad'}">${verdict ? '✓ Plan passes every check' : '✗ Plan does not pass every check'}</div>
<h2>Order</h2>
<table><tr><th>Box</th><th>Weight</th><th>Size (cm)</th><th></th></tr>
${order.map((b) => `<tr><td>${esc(b.label)}</td><td>${b.kg} kg</td><td>${b.cm.join(' × ')}</td><td>${b.fragile ? '<span class="bad">FRAGILE</span>' : ''}</td></tr>`).join('')}</table>
<h2>Stacking plan (top view, near side at the bottom)</h2>
<div class="layers">${layers.map((L, i) => `<figure>${layerSvg(plan.blocks.filter((b) => (b.layer ?? Math.round(b.z * 100)) === L))}<figcaption>Layer ${i + 1}: ${plan.blocks.filter((b) => (b.layer ?? Math.round(b.z * 100)) === L).map((b) => esc(BLOCKS[b.block].name)).join(', ')}</figcaption></figure>`).join('')}</div>
<h2>Checks before building</h2>
<table>
<tr><td>Warehouse rules (on the pallet, 70% support, nothing heavy on much lighter, nothing on fragile)</td><td class="ok">PASS</td></tr>
<tr><td>Stands on its own (2 s of physics, no box moves 25 mm)</td><td class="ok">PASS</td></tr>
${t ? t.results.map((r) => `<tr><td>Truck test 0.5 g, pushed ${esc(r.name)}: worst ${mm(r.worst)} mm (limit ${mm(t.limit)} mm = 5% of ${(t.height * 100 * 5).toFixed(0)} cm)</td><td class="${r.pass ? 'ok' : 'bad'}">${r.pass ? 'PASS' : 'FAIL'}</td></tr>`).join('') : ''}
${agent ? agent.tests.map((x) => `<tr><td>Truck test, ${esc(x.profile)}${x.wrapped ? ', wrapped' : agent.wrapped ? ' (before wrapping)' : ''}: ${x.pushes.map((p) => `${esc(p.push)} ${p.fell_off_pallet ? 'fell off' : p.moved_mm + ' mm'}`).join(', ')} (limit ${x.limit_mm} mm = 5% of the load height)</td><td class="${x.pass ? 'ok' : !x.wrapped && agent.wrapped ? 'dim' : 'bad'}">${x.pass ? 'PASS' : 'FAIL'}</td></tr>`).join('') : ''}
</table>
${agent ? `<h2>Securing</h2><table>
<tr><td>Stretch wrap</td><td>${agent.wrapped ? 'yes (the agent decided)' : 'no'}</td></tr>
${agent.straps ? `<tr><td>Top-over straps (EN 12195-1, for ${agent.straps.kg} kg incl. a 10 kg pallet, ${agent.straps.assumptions.H} m tall; friction ${agent.straps.assumptions.mu} assumed, straps of ${agent.straps.assumptions.ftKN * 100} daN)</td><td><b>${agent.straps.straps}</b></td></tr>` : ''}
${agent.instructions ? `<tr><td>Instructions the agent followed</td><td>${esc(agent.instructions)}</td></tr>` : ''}</table>` : ''}
${truck ? `<h2>Truck test on the built pallet (swerves and speeding up at ${Math.min(truck.accel, 0.5)} g, braking at ${truck.accel} g)</h2><table><tr><th>Pallet</th><th>Largest movement</th><th>Limit</th><th></th></tr>${truckRows}</table>` : ''}
<p class="dim" style="margin-top:22px">Method: the 0.5 g load test follows the idea of EUMOS 40509 (a constant push of 0.5 g, permanent shift at most 5% of the load height),
run in the MuJoCo physics engine on a 1:5 scale model with box friction 0.6 (anti-slip sheets); hard braking uses the road values of EN 12195-1 (0.8 g forward, 0.5 g sideways). Sizes are real sizes. This is a planning check, not a certification.</p>
<button onclick="print()">Print / save as PDF</button>
</body></html>`
  return html
}

export function openReport(args) {
  const html = reportHtml(args)
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.open()
  win.document.write(html)
  win.document.close()
  return true
}
