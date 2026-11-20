// Webcam + MediaPipe hand tracking. Gives 21 points of one hand, every video frame.
import { FilesetResolver, HandLandmarker, DrawingUtils } from '@mediapipe/tasks-vision'

export async function createTracker(video, canvas) {
  const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 1,
  })

  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
  video.srcObject = stream
  await video.play()
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')
  const draw = new DrawingUtils(ctx)

  let lastTime = -1
  let latest = null

  // Call once per animation frame. Returns { world, image } or null when no hand is seen.
  function update() {
    if (video.currentTime === lastTime) return latest
    lastTime = video.currentTime
    const result = landmarker.detectForVideo(video, performance.now())
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (result.landmarks.length === 0) {
      latest = null
      return null
    }
    draw.drawConnectors(result.landmarks[0], HandLandmarker.HAND_CONNECTIONS, { color: '#3fb950', lineWidth: 3 })
    draw.drawLandmarks(result.landmarks[0], { color: '#f0f6fc', radius: 3 })
    latest = { world: result.worldLandmarks[0], image: result.landmarks[0], handedness: result.handedness[0]?.[0]?.categoryName ?? 'Right' }
    return latest
  }

  return { update }
}
