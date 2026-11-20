// Where your hand is in the camera picture -> where the robot hand should be over the table.
//
// Left/right and up/down come from the palm's position in the picture.
// Forward/back comes from how big the hand looks: closer to the camera = bigger = reach further.

const ASPECT = 4 / 3 // camera picture width / height

const WORK = { x: [-0.05, 0.45], y: [-0.3, 0.3], z: [0.0, 0.35] } // metres, the space over the table
const GAIN = { x: 0.6, y: 0.6, z: 0.45 } // x: metres per relative change in hand size
const HOME = { x: 0.15, y: 0.0, z: 0.14 } // where the grasp point goes when your hand is at the calibrated spot

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v))

export function createReach() {
  let neutral = null // { cx, cy, size } of your hand at the calibrated spot

  function measure(img) {
    const ids = [0, 5, 9, 13, 17]
    const cx = ids.reduce((a, i) => a + img[i].x, 0) / ids.length
    const cy = ids.reduce((a, i) => a + img[i].y, 0) / ids.length
    const size = Math.hypot((img[0].x - img[9].x) * ASPECT, img[0].y - img[9].y) // wrist to middle knuckle
    return { cx, cy, size }
  }

  return {
    // Make the current hand position the middle of the workspace.
    calibrate(img) { neutral = measure(img) },

    // Returns the grasp-point goal [x, y, z] in the world.
    goal(img) {
      const m = measure(img)
      if (!neutral) neutral = m
      return [
        clamp(HOME.x + ((m.size - neutral.size) / neutral.size) * GAIN.x, WORK.x),
        clamp(HOME.y + (m.cx - neutral.cx) * GAIN.y, WORK.y), // the picture is not mirrored: your right = smaller x
        clamp(HOME.z + (neutral.cy - m.cy) * GAIN.z, WORK.z),
      ]
    },
  }
}
