// Where your hand is in the camera picture -> where the robot hand is over the table (a flat map, like a mouse).
//
// Your hand right/left in the picture -> robot right/left. Your hand up/down in the picture -> robot forward/back.
// Height is not yours to control: the robot handles it (see grasp.js).

const WORK = { x: [0.0, 0.42], y: [-0.3, 0.3] } // metres over the table
const GAIN = 0.7                                // metres per full picture width
const HOME = { x: 0.18, y: 0.0 }                // where the ring goes when your hand is at the calibrated spot

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v))

export function createReach() {
  let neutral = null // palm centre in the picture at the calibrated spot

  function palm(img) {
    const ids = [0, 5, 9, 13, 17]
    return {
      cx: ids.reduce((a, i) => a + img[i].x, 0) / ids.length,
      cy: ids.reduce((a, i) => a + img[i].y, 0) / ids.length,
    }
  }

  return {
    // Make the current hand position the middle of the table.
    calibrate(img) { neutral = palm(img) },

    // Returns [x, y] on the table.
    goal(img) {
      const m = palm(img)
      if (!neutral) neutral = m
      return [
        clamp(HOME.x + (neutral.cy - m.cy) * GAIN, WORK.x), // hand up in the picture = forward
        clamp(HOME.y + (m.cx - neutral.cx) * GAIN, WORK.y), // the picture is not mirrored: your right = smaller x
      ]
    },
  }
}
