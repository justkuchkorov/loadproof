// Straps that keep the pallet from sliding or tipping on the truck floor: top-over lashing after EN 12195-1:2010
// (the formulas as used in the CARING Cargo Calculator, sites.utu.fi/cargosecuring). Real sizes, not the 1:5 model.
//   sliding:  one strap holds  m = 2 mu FT sin(a) / (g (c - mu cz) fs)
//   tipping:  one strap holds  m = 2 FT sin(a) / (g (c H/L - cz) fs)   (centre of mass in the middle)
// Checked against the guide's worked example: mu 0.4, FT 4 kN -> 0.63 t forward, 2.9 t sideways (tests/securing.mjs).

const G = 9.81
// Road transport: forward (braking) 0.8 g, sideways 0.5 g, backward 0.5 g; safety factor 1.25 forward, else 1.1.
export const ROAD = [
  { dir: 'forward (braking)', c: 0.8, fs: 1.25, along: 'L' },
  { dir: 'sideways', c: 0.5, fs: 1.1, along: 'B' },
  { dir: 'backward', c: 0.5, fs: 1.1, along: 'L' },
]

// One strap: how many tonnes it holds against sliding / tipping in each direction.
export function perStrap({ mu = 0.4, ftKN = 4, alphaDeg = 75, H, L, B }) {
  const s = Math.sin(alphaDeg * Math.PI / 180)
  return ROAD.map(({ dir, c, fs, along }) => {
    const slide = c <= mu ? Infinity : (2 * mu * ftKN * s) / (G * (c - mu) * fs)
    const ratio = H / (along === 'L' ? L : B)
    const tip = c * ratio <= 1 ? Infinity : (2 * ftKN * s) / (G * (c * ratio - 1) * fs)
    return { dir, slide, tip }
  })
}

// Straps needed for a load of `kg` (pallet + goods), H x L x B metres (height, length along the truck, width).
// mu: friction pallet/floor (0.4 assumed: a dry wooden floor; an anti-slip mat raises it). ftKN: the strap's
// standard tension force (STF, on its label; 400 daN = 4 kN is a common ratchet strap).
export function strapsNeeded({ kg, H, L = 0.8, B = 0.6, mu = 0.4, ftKN = 4, alphaDeg = 75 }) {
  const t = kg / 1000
  const rows = perStrap({ mu, ftKN, alphaDeg, H, L, B }).map((r) => {
    const n = Math.max(t / r.slide, t / r.tip)
    return { dir: r.dir, straps: Math.ceil(n - 1e-9), bySliding: +(t / r.slide).toFixed(2), byTipping: Number.isFinite(r.tip) ? +(t / r.tip).toFixed(2) : 0 }
  })
  return { straps: Math.max(1, ...rows.map((r) => r.straps)), rows, assumptions: { mu, ftKN, alphaDeg, kg, H: +H.toFixed(2), L, B } }
}
