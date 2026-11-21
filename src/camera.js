// The cell's 3D camera, looking straight down on the infeed and the pallet: a height map made by casting rays in the
// physics scene (MuJoCo's mj_ray), with sensor noise. The robot finds boxes in this map, as a real palletizing cell
// does with its depth camera; it does not read box positions from the simulation. The arm is left out of the picture
// (a real cell takes its picture while the arm is out of the way).
const NOISE = 0.0004 // height noise, metres in the model (2 mm real), like a good industrial depth camera
const STEP = 0.003 // grid spacing when looking for a box, metres in the model (1.5 cm real)
const VIEW_STEP = 0.006 // grid spacing of the live view
const SKY = 1.0 // the camera's height; rays go straight down
const STATIC = [0, 0.1, 0.029] // table, infeed and pallet tops: surfaces, not boxes

export function createCamera({ mujoco, model, data, area = { x: [0.14, 0.66], y: [-0.32, 0.32] } }) {
  const gid = new mujoco.IntBuffer(1)
  const groups = [1, 1, 0, 0, 0, 0] // boxes and the cell; not the arm (groups 2 and 3)
  const noise = () => { let s = 0; for (let i = 0; i < 6; i++) s += Math.random(); return (s - 3) * NOISE / 0.7071 }
  function height(x, y) {
    const d = mujoco.mj_ray(model, data, [x, y, SKY], [0, 0, -1], groups, 1, -1, gid, null)
    return d < 0 ? 0 : SKY - d + noise()
  }

  // Find a box of size [sx, sy, sz] near `near` [x, y]: the flat top patch that matches its footprint best.
  // Returns { x, y, top, sx, sy, off } (off: how far from `near`), or null.
  function find(near, size, radius = 0.1) {
    const [ex, ey] = size
    const nx = Math.ceil(2 * radius / STEP), ny = nx
    const x0 = near[0] - radius, y0 = near[1] - radius
    const h = new Float64Array(nx * ny)
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) h[i * ny + j] = height(x0 + i * STEP, y0 + j * STEP)
    const label = new Int32Array(nx * ny).fill(-1)
    const isSurface = (v) => STATIC.some((s) => Math.abs(v - s) < 0.003)
    const segs = []
    for (let k = 0; k < h.length; k++) {
      if (label[k] >= 0 || isSurface(h[k])) continue
      const seg = { n: 0, sx: 0, sy: 0, hs: [], i0: 1e9, i1: -1, j0: 1e9, j1: -1 }
      const stack = [k]; label[k] = segs.length
      while (stack.length) { // flood fill: neighbours at the same height belong to the same top face
        const c = stack.pop(), i = Math.floor(c / ny), j = c % ny
        seg.n++; seg.sx += i; seg.sy += j; seg.hs.push(h[c])
        seg.i0 = Math.min(seg.i0, i); seg.i1 = Math.max(seg.i1, i); seg.j0 = Math.min(seg.j0, j); seg.j1 = Math.max(seg.j1, j)
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue
          const q = a * ny + b
          if (label[q] < 0 && Math.abs(h[q] - h[c]) < 0.003) { label[q] = segs.length; stack.push(q) }
        }
      }
      segs.push(seg)
    }
    let best = null
    for (const s of segs) {
      if (s.n < 20) continue
      const fx = (s.i1 - s.i0 + 1) * STEP, fy = (s.j1 - s.j0 + 1) * STEP // footprint seen from above
      const touchesEdge = s.i0 === 0 || s.j0 === 0 || s.i1 === nx - 1 || s.j1 === ny - 1
      const x = x0 + (s.sx / s.n) * STEP, y = y0 + (s.sy / s.n) * STEP
      const mismatch = Math.abs(fx - ex) + Math.abs(fy - ey)
      if (touchesEdge || mismatch > 0.02) continue
      const score = mismatch + 0.3 * Math.hypot(x - near[0], y - near[1])
      if (!best || score < best.score) {
        const hs = s.hs.sort((a, b) => a - b)
        best = { score, x, y, top: hs[Math.floor(hs.length / 2)], sx: fx, sy: fy, off: Math.hypot(x - near[0], y - near[1]) }
      }
    }
    if (best) lastSeen = best
    return best
  }

  // The live view: a small picture of the height map, refreshed a few rows every frame (cheap), with the last box found.
  const nx = Math.round((area.x[1] - area.x[0]) / VIEW_STEP), ny = Math.round((area.y[1] - area.y[0]) / VIEW_STEP)
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  let ctx = null, img = null, row = 0, lastSeen = null
  if (canvas) { canvas.width = ny; canvas.height = nx; ctx = canvas.getContext('2d'); img = ctx.createImageData(ny, nx) }
  const color = (z) => { // low = dark blue, high = yellow
    const t = Math.max(0, Math.min(1, z / 0.26))
    return [Math.round(20 + 235 * t), Math.round(40 + 170 * t * t), Math.round(90 + 80 * (1 - t))]
  }
  let first = true
  function tick(rows = 4) {
    if (!ctx) return
    if (first) { first = false; rows = nx } // the whole picture at once the first time, then a few rows a frame
    for (let r = 0; r < rows; r++, row = (row + 1) % nx) {
      const x = area.x[0] + row * VIEW_STEP
      for (let j = 0; j < ny; j++) {
        const [cr, cg, cb] = color(height(x, area.y[0] + j * VIEW_STEP))
        const p = 4 * ((nx - 1 - row) * ny + (ny - 1 - j)) // picture: far side up, robot's left on the left
        img.data[p] = cr; img.data[p + 1] = cg; img.data[p + 2] = cb; img.data[p + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    if (lastSeen) { // the box the robot found last, outlined
      const px = (y) => ny - 1 - (y - area.y[0]) / VIEW_STEP, py = (x) => nx - 1 - (x - area.x[0]) / VIEW_STEP
      ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 1.5
      ctx.strokeRect(px(lastSeen.y + lastSeen.sy / 2), py(lastSeen.x + lastSeen.sx / 2), lastSeen.sy / VIEW_STEP, lastSeen.sx / VIEW_STEP)
    }
  }
  return { find, tick, canvas, height }
}
