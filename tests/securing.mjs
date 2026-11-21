// The strap formulas against the worked example in the CARING Cargo Calculator guide (EN 12195-1:2010):
// mu 0.4, top-over lashings with 400 daN pre-tension: each holds 0.63 t forward and 2.9 t sideways from sliding;
// a 2.0 x 2.0 x 2.8 m box (H/L 1.4): each holds 5.3 t forward from tipping, no tipping sideways.
const { perStrap, strapsNeeded } = await import('../src/securing.js')
const r = perStrap({ mu: 0.4, ftKN: 4, H: 2.8, L: 2.0, B: 2.0 })
const near = (a, b, tol) => Math.abs(a - b) <= tol
const checks = [
  ['sliding forward 0.63 t', near(r[0].slide, 0.63, 0.01)],
  ['sliding sideways 2.9 t', near(r[1].slide, 2.9, 0.06)],
  ['sliding backward 2.9 t', near(r[2].slide, 2.9, 0.06)],
  ['tipping forward 5.3 t', near(r[0].tip, 5.3, 0.06)],
  ['no tipping sideways', r[1].tip === Infinity],
]
for (const [name, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', name)
console.log('demo pallet (61 kg goods + 15 kg pallet, 1.1 m tall):', JSON.stringify(strapsNeeded({ kg: 76, H: 1.1 })))
process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
