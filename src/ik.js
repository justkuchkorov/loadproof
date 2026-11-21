// Inverse kinematics for the 6-joint arm: which joint angles put the suction pad at a point, pointing straight down?
// Damped least squares on MuJoCo's Jacobian (how each joint moves the pad), run on a scratch copy of the state so the
// real simulation is not touched. Each call starts from the last answer, so the arm moves smoothly.

const JOINTS = ['shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint', 'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint']

export function createIK(mujoco, model) {
  const O = mujoco.mjtObj
  const scratch = new mujoco.MjData(model)
  const jid = JOINTS.map((n) => mujoco.mj_name2id(model, O.mjOBJ_JOINT.value, n))
  const qadr = jid.map((j) => model.jnt_qposadr[j])
  const dadr = jid.map((j) => model.jnt_dofadr[j])
  const lo = jid.map((j) => model.jnt_range[2 * j]), hi = jid.map((j) => model.jnt_range[2 * j + 1])
  const site = mujoco.mj_name2id(model, O.mjOBJ_SITE.value, 'grasp_site')
  const nv = model.nv
  // out-parameters live in MuJoCo's own memory (DoubleBuffer), read back through a view
  const jpBuf = new mujoco.DoubleBuffer(3 * nv), jrBuf = new mujoco.DoubleBuffer(3 * nv)

  // Pad position and frame for joint angles q (on the scratch state).
  function fk(q) {
    for (let i = 0; i < 6; i++) scratch.qpos[qadr[i]] = q[i]
    mujoco.mj_kinematics(model, scratch)
    mujoco.mj_comPos(model, scratch)
    const p = [0, 1, 2].map((k) => scratch.site_xpos[3 * site + k])
    const R = Array.from(scratch.site_xmat.subarray(9 * site, 9 * site + 9)) // row-major
    return { p, R }
  }

  // Target frame: pad axis (z) straight down, turned by yaw about the vertical.
  const target = (yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    // columns: x = (c, s, 0), y = (s, -c, 0), z = (0, 0, -1)  -> right-handed
    return [c, s, 0, s, -c, 0, 0, 0, -1] // row-major
  }

  // Solve for q near q0. Returns { q, err } (err in metres).
  function solve(goal, yaw, q0, iters = 30) {
    const q = q0.slice()
    const Rt = target(yaw)
    let err = Infinity
    for (let it = 0; it < iters; it++) {
      const { p, R } = fk(q)
      const ep = [0, 1, 2].map((k) => goal[k] - p[k])
      // orientation error: 0.5 * sum over columns of (current col x target col)
      const eo = [0, 0, 0]
      for (let c = 0; c < 3; c++) {
        const a = [R[c], R[3 + c], R[6 + c]], b = [Rt[c], Rt[3 + c], Rt[6 + c]]
        eo[0] += 0.5 * (a[1] * b[2] - a[2] * b[1]); eo[1] += 0.5 * (a[2] * b[0] - a[0] * b[2]); eo[2] += 0.5 * (a[0] * b[1] - a[1] * b[0])
      }
      err = Math.hypot(...ep) + 0.02 * Math.hypot(...eo)
      if (Math.hypot(...ep) < 2e-4 && Math.hypot(...eo) < 2e-3) break
      mujoco.mj_jacSite(model, scratch, jpBuf, jrBuf, site)
      const jacp = jpBuf.GetView(), jacr = jrBuf.GetView()
      // J: 6 x 6 (rows: position xyz, rotation xyz; columns: the arm's joints); weight rotation less
      const w = 0.3
      const J = [0, 1, 2].map((r) => dadr.map((d) => jacp[r * nv + d])).concat([0, 1, 2].map((r) => dadr.map((d) => w * jacr[r * nv + d])))
      const e = [...ep, ...eo.map((v) => w * v)]
      // dq = J^T (J J^T + lambda^2 I)^-1 e
      const lambda = 0.01
      const A = J.map((ri, i) => J.map((rj, j) => ri.reduce((s, v, k) => s + v * rj[k], 0) + (i === j ? lambda * lambda : 0)))
      const y = solveLinear(A, e)
      for (let k = 0; k < 6; k++) {
        let dq = 0
        for (let i = 0; i < 6; i++) dq += J[i][k] * y[i]
        q[k] = Math.min(hi[k], Math.max(lo[k], q[k] + Math.max(-0.3, Math.min(0.3, dq))))
      }
    }
    return { q, err }
  }

  return { solve, fk, qadr, dadr, JOINTS }
}

// Gaussian elimination with partial pivoting (6 x 6).
function solveLinear(A, b) {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / M[r][r]
  }
  return x
}
