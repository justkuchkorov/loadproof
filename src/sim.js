// MuJoCo in the browser: load the scene, step the physics, draw every visible geom with three.js.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import loadMujoco from '@mujoco/mujoco'

const ARM_FILES = ['cell/ur10e.xml', ...['base_0', 'base_1', 'forearm_0', 'forearm_1', 'forearm_2', 'forearm_3', 'shoulder_0', 'shoulder_1',
  'shoulder_2', 'upperarm_0', 'upperarm_1', 'upperarm_2', 'upperarm_3', 'wrist1_0', 'wrist1_1', 'wrist1_2', 'wrist2_0', 'wrist2_1',
  'wrist2_2', 'wrist3'].map((n) => `cell/assets/${n}.obj`)]
const HAND_FILES = [
  'shadow_hand/hand_free.xml',
  ...['f_distal_pst', 'f_knuckle', 'f_middle', 'f_proximal', 'forearm_0', 'forearm_1',
    'forearm_collision', 'lf_metacarpal', 'mounting_plate', 'palm', 'th_distal_pst',
    'th_middle', 'th_proximal', 'wrist'].map((n) => `shadow_hand/assets/${n}.obj`),
]

const COLLISION_GROUP = 3

// arm: the UR10e cell (armXml puts its base on the pedestal; prepare runs once on the loaded model).
export async function createSim(container, { xml, labels = {}, arm = false, armXml = (t) => t, prepare = () => {} } = {}) {
  const SCENE = arm ? 'cell/scene_generated.xml' : 'shadow_hand/scene_generated.xml'
  const FILES = arm ? ARM_FILES : HAND_FILES
  const mujoco = await loadMujoco()

  // Copy the model files into MuJoCo's in-memory file system.
  mujoco.FS.mkdir('/working')
  for (const file of FILES) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = '/working/' + parts.slice(0, i).join('/')
      if (!mujoco.FS.analyzePath(dir).exists) mujoco.FS.mkdir(dir)
    }
    const bytes = new Uint8Array(await (await fetch(`/models/${file}`)).arrayBuffer())
    if (file === 'cell/ur10e.xml') mujoco.FS.writeFile(`/working/${file}`, armXml(new TextDecoder().decode(bytes)))
    else mujoco.FS.writeFile(`/working/${file}`, bytes)
  }

  mujoco.FS.writeFile(`/working/${SCENE}`, xml)
  const model = mujoco.MjModel.from_xml_path(`/working/${SCENE}`)
  prepare(mujoco, model)
  const data = new mujoco.MjData(model)
  mujoco.mj_forward(model, data)

  // three.js scene, z-up like MuJoCo.
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0f1720)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.01, 50)
  camera.up.set(0, 0, 1)
  // high in front of the cell, looking at the pallet with the robot behind it
  if (arm) camera.position.set(-0.42, -0.36, 0.78); else camera.position.set(-0.22, 0, 0.72)
  const controls = new OrbitControls(camera, renderer.domElement)
  if (arm) controls.target.set(0.34, -0.08, 0.06); else controls.target.set(0.2, 0, 0)
  controls.update()

  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(0.3, -0.5, 1.2)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-0.5, 0.6, 0.4)
  scene.add(fill)

  const meshes = buildMeshes(mujoco, model, scene, labels)

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(container.clientWidth, container.clientHeight)
  })

  // How much simulated time this frame gets: whole physics steps, the remainder carried to the next frame. Rounding each
  // frame on its own made the motion judder on fast screens (144 Hz: 3 or 4 steps a frame, at random).
  let carry = 0
  function advance(seconds) {
    const ts = model.opt.timestep
    carry += seconds
    const n = Math.floor(carry / ts + 1e-9)
    carry -= n * ts
    return n * ts
  }

  // Advance the physics by `seconds` of simulated time (a multiple of the timestep, from advance()).
  function step(seconds) {
    const steps = Math.round(seconds / model.opt.timestep)
    for (let i = 0; i < steps; i++) mujoco.mj_step(model, data)
  }

  function render() {
    const xpos = data.geom_xpos
    const xmat = data.geom_xmat
    for (const { mesh, id } of meshes) {
      const p = 3 * id
      const m = 9 * id
      mesh.matrix.set(
        xmat[m], xmat[m + 1], xmat[m + 2], xpos[p],
        xmat[m + 3], xmat[m + 4], xmat[m + 5], xpos[p + 1],
        xmat[m + 6], xmat[m + 7], xmat[m + 8], xpos[p + 2],
        0, 0, 0, 1)
      mesh.matrixWorldNeedsUpdate = true
      mesh.visible = model.geom_bodyid[id] === 0 || xpos[p + 2] > -0.3 // waiting under the floor = not drawn
    }
    controls.update()
    renderer.render(scene, camera)
  }

  // What is under the mouse: the geom and body names, and the point hit (for clicking boxes and pallet spots).
  const raycaster = new THREE.Raycaster()
  function pickAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera)
    const shown = meshes.filter((m) => m.mesh.visible)
    const hit = raycaster.intersectObjects(shown.map((m) => m.mesh), false)[0]
    if (!hit) return null
    const id = shown.find((m) => m.mesh === hit.object).id
    const O = mujoco.mjtObj
    return { geom: mujoco.mj_id2name(model, O.mjOBJ_GEOM.value, id), body: mujoco.mj_id2name(model, O.mjOBJ_BODY.value, model.geom_bodyid[id]), point: [hit.point.x, hit.point.y, hit.point.z] }
  }

  return { mujoco, model, data, scene, camera, canvas: renderer.domElement, advance, step, render, pickAt }
}

function buildMeshes(mujoco, model, scene, labels) {
  const T = mujoco.mjtGeom
  const out = []
  for (let g = 0; g < model.ngeom; g++) {
    if (model.geom_group[g] === COLLISION_GROUP) continue
    const type = model.geom_type[g]
    const s = model.geom_size.subarray(3 * g, 3 * g + 3)
    let geometry
    if (type === T.mjGEOM_MESH.value) geometry = meshGeometry(model, model.geom_dataid[g])
    else if (type === T.mjGEOM_PLANE.value) geometry = new THREE.PlaneGeometry(4, 4)
    else if (type === T.mjGEOM_SPHERE.value) geometry = new THREE.SphereGeometry(s[0], 24, 16)
    else if (type === T.mjGEOM_ELLIPSOID.value) geometry = new THREE.SphereGeometry(1, 24, 16).scale(s[0], s[1], s[2])
    else if (type === T.mjGEOM_BOX.value) geometry = new THREE.BoxGeometry(2 * s[0], 2 * s[1], 2 * s[2])
    else if (type === T.mjGEOM_CAPSULE.value) geometry = new THREE.CapsuleGeometry(s[0], 2 * s[1], 8, 16).rotateX(Math.PI / 2)
    else if (type === T.mjGEOM_CYLINDER.value) geometry = new THREE.CylinderGeometry(s[0], s[0], 2 * s[1], 24).rotateX(Math.PI / 2)
    else continue

    const matId = model.geom_matid[g]
    const rgba = matId >= 0 ? model.mat_rgba.subarray(4 * matId, 4 * matId + 4) : model.geom_rgba.subarray(4 * g, 4 * g + 4)
    const name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM.value, g)
    const material = new THREE.MeshStandardMaterial({
      map: labels[name] ? labelTexture(labels[name], rgba) : null,
      color: labels[name] ? 0xffffff : new THREE.Color(rgba[0], rgba[1], rgba[2]),
      roughness: 0.55,
      metalness: 0.1,
      transparent: rgba[3] < 1,
      opacity: rgba[3],
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.matrixAutoUpdate = false
    scene.add(mesh)
    out.push({ mesh, id: g })
  }
  return out
}

function meshGeometry(model, meshId) {
  const vAdr = model.mesh_vertadr[meshId]
  const vNum = model.mesh_vertnum[meshId]
  const fAdr = model.mesh_faceadr[meshId]
  const fNum = model.mesh_facenum[meshId]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(model.mesh_vert.subarray(3 * vAdr, 3 * (vAdr + vNum))), 3))
  geometry.setIndex(Array.from(model.mesh_face.subarray(3 * fAdr, 3 * (fAdr + fNum))))
  geometry.computeVertexNormals()
  return geometry
}

// A cardboard-coloured texture with the box's printed label (name, weight, FRAGILE).
function labelTexture({ title, kg, fragile }, rgba) {
  const c = document.createElement('canvas')
  c.width = 256; c.height = 256
  const ctx = c.getContext('2d')
  ctx.fillStyle = `rgb(${rgba[0] * 255}, ${rgba[1] * 255}, ${rgba[2] * 255})`
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(60, 40, 20, 0.5)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 250, 250)
  ctx.fillStyle = '#2b1d0e'; ctx.textAlign = 'center'
  ctx.font = 'bold 54px system-ui, sans-serif'; ctx.fillText(title, 128, 92)
  ctx.font = 'bold 64px system-ui, sans-serif'; ctx.fillText(`${kg} kg`, 128, 168)
  if (fragile) { ctx.fillStyle = '#b42318'; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.fillText('FRAGILE', 128, 226) }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
