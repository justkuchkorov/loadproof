// Where each drawn part of the arm is, against the physics: for a few targets, the lowest point of every visual mesh
// (as three.js draws it: mesh vertices placed by geom_xpos / geom_xmat) and of the body it belongs to.
const { default: loadMujoco } = await import('../node_modules/@mujoco/mujoco/mujoco.js')
const { loadScene } = await import('./cell.mjs')
const { parkArm } = await import('../src/pallet.js')
const { createIK } = await import('../src/ik.js')
const mujoco = await loadMujoco()
const { model } = await loadScene(mujoco)
const data = new mujoco.MjData(model)
parkArm(mujoco, model, data)
mujoco.mj_forward(model, data)
const ik = createIK(mujoco, model)
const O = mujoco.mjtObj
const targets = (process.argv[2] || '0.5,0.08,0.3;0.261,-0.042,0.081;0.53,0.07,0.15;0.25,0.17,0.17').split(';').map((s) => s.split(',').map(Number))
let q = ik.qadr.map((a) => data.qpos[a])
for (const goal of targets) {
  const sol = ik.solve(goal, 0, q, 200)
  q = sol.q
  sol.q.forEach((v, i) => { data.qpos[ik.qadr[i]] = v })
  mujoco.mj_forward(model, data)
  console.log(`goal ${goal.join(',')} ik err ${sol.err.toFixed(4)}`)
  for (let g = 0; g < model.ngeom; g++) {
    if (model.geom_type[g] !== mujoco.mjtGeom.mjGEOM_MESH.value) continue
    const m = model.geom_dataid[g], va = model.mesh_vertadr[m], vn = model.mesh_vertnum[m]
    const R = data.geom_xmat.subarray(9 * g, 9 * g + 9), p = data.geom_xpos.subarray(3 * g, 3 * g + 3)
    let minz = Infinity
    for (let v = va; v < va + vn; v++) {
      const x = model.mesh_vert[3 * v], y = model.mesh_vert[3 * v + 1], z = model.mesh_vert[3 * v + 2]
      minz = Math.min(minz, p[2] + R[6] * x + R[7] * y + R[8] * z)
    }
    const b = model.geom_bodyid[g]
    console.log(`  ${mujoco.mj_id2name(model, O.mjOBJ_MESH.value, m).padEnd(12)} body ${mujoco.mj_id2name(model, O.mjOBJ_BODY.value, b).padEnd(15)} body z ${(data.xpos[3 * b + 2] * 100).toFixed(1).padStart(5)} cm  mesh lowest ${(minz * 100).toFixed(1).padStart(5)} cm  verts ${vn}`)
  }
}
