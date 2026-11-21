// A classic search (no AI): try every way to put the order's boxes into layers and spots, keep the arrangements that
// pass the warehouse rules. Used to tell whether an order CAN be stacked at all, and as a second opinion to the AI.
import { BLOCKS, toPositions, checkRules } from './planner.js'
import { SPOTS } from './pallet.js'

const CORNERS = { 'near-left': ['nl'], 'near-right': ['nr'], 'far-left': ['fl'], 'far-right': ['fr'],
  'left column': ['nl', 'fl'], 'right column': ['nr', 'fr'], 'near row': ['nl', 'nr'], 'far row': ['fl', 'fr'] }

// Returns up to `limit` rule-passing raw plans ({ boxes: [{ block, layer, spot }] }), and how many were tried.
export function search({ maxLayers = 4, limit = 20, budget = 200000 } = {}) {
  const ids = Object.keys(BLOCKS).sort((a, b) => BLOCKS[b].kg - BLOCKS[a].kg) // heavy first: they belong low
  const used = Array.from({ length: maxLayers }, () => new Set()) // occupied corners per layer
  const fragileUnder = Array.from({ length: maxLayers + 1 }, () => new Set()) // corners with a fragile box below
  const pick = []
  const found = []
  let tried = 0
  function go(i) {
    if (found.length >= limit || tried >= budget) return
    if (i === ids.length) {
      tried++
      const raw = { name: 'search', say: '', boxes: pick.map((p) => ({ ...p })) }
      const { plan, problems } = toPositions(raw)
      if (problems.length === 0 && checkRules(plan).length === 0) found.push(raw)
      return
    }
    const id = ids[i]
    for (let L = 0; L < maxLayers; L++) {
      for (const spot of Object.keys(SPOTS[BLOCKS[id].kind])) {
        const cs = CORNERS[spot]
        if (cs.some((c) => used[L].has(c))) continue
        if (L > 0 && cs.some((c) => !used[L - 1].has(c))) continue // must stand on something in every corner
        if (cs.some((c) => fragileUnder[L].has(c))) continue // nothing on a fragile box
        cs.forEach((c) => used[L].add(c))
        if (BLOCKS[id].fragile) cs.forEach((c) => fragileUnder[L + 1].add(c))
        pick.push({ block: id, layer: L + 1, spot })
        go(i + 1)
        pick.pop()
        cs.forEach((c) => used[L].delete(c))
        if (BLOCKS[id].fragile) cs.forEach((c) => fragileUnder[L + 1].delete(c))
      }
    }
  }
  go(0)
  return { found, tried }
}

// How many pallet spots an order fills (4 per layer), and a plain warning if it cannot make full layers.
export function spotCount(labels, catalog) {
  return labels.reduce((s, n) => s + (catalog[n].cm[0] > 40 || catalog[n].cm[1] > 50 ? 2 : 1), 0)
}
