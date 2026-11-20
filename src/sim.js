// MuJoCo in the browser: load the scene, step the physics, draw every visible geom with three.js.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import loadMujoco from '@mujoco/mujoco'

const SCENE = 'shadow_hand/scene_pick.xml'
const HAND_FILES = [
  SCENE,
  'shadow_hand/hand_free.xml',
  ...['f_distal_pst', 'f_knuckle', 'f_middle', 'f_proximal', 'forearm_0', 'forearm_1',
    'forearm_collision', 'lf_metacarpal', 'mounting_plate', 'palm', 'th_distal_pst',
    'th_middle', 'th_proximal', 'wrist'].map((n) => `shadow_hand/assets/${n}.obj`),
]

const COLLISION_GROUP = 3

export async function createSim(container) {
  const mujoco = await loadMujoco()

  // Copy the model files into MuJoCo's in-memory file system.
  mujoco.FS.mkdir('/working')
  for (const file of HAND_FILES) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = '/working/' + parts.slice(0, i).join('/')
      if (!mujoco.FS.analyzePath(dir).exists) mujoco.FS.mkdir(dir)
    }
    const bytes = new Uint8Array(await (await fetch(`/models/${file}`)).arrayBuffer())
    mujoco.FS.writeFile(`/working/${file}`, bytes)
  }

  const model = mujoco.MjModel.from_xml_path(`/working/${SCENE}`)
  const data = new mujoco.MjData(model)
  mujoco.mj_forward(model, data)

  // three.js scene, z-up like MuJoCo.
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0f1720)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(container.clientWidth, container.clientHeight)
  container.appendChild(renderer.domElement)

  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.01, 50)
  camera.up.set(0, 0, 1)
  camera.position.set(-0.22, 0, 0.72) // high behind the table: screen up = forward, screen right = robot right
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0.2, 0, 0)
  controls.update()

  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.6)
  sun.position.set(0.3, -0.5, 1.2)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xffffff, 0.5)
  fill.position.set(-0.5, 0.6, 0.4)
  scene.add(fill)

  const meshes = buildMeshes(mujoco, model, scene)

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(container.clientWidth, container.clientHeight)
  })

  // Advance the physics by `seconds` of simulated time.
  function step(seconds) {
    const steps = Math.max(1, Math.round(seconds / model.opt.timestep))
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
    }
    controls.update()
    renderer.render(scene, camera)
  }

  return { mujoco, model, data, scene, step, render }
}

function buildMeshes(mujoco, model, scene) {
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
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgba[0], rgba[1], rgba[2]),
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
