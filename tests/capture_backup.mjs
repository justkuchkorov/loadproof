// Capture a backup recording of the demo (Compare, then the truck test) as frames, played by pitch/backup.html.
// Needs the dev server on http://localhost:5173. Run: node tests/capture_backup.mjs [seconds]
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const seconds = Number(process.argv[2] || 75)
const outDir = path.join(root, 'pitch/backup')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'))}`,
  '--window-size=1366,800', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250)
  try { target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page') } catch { /* not up yet */ }
}
if (!target) { chrome.kill(); throw new Error('Chrome did not start') }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0
const pending = new Map()
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 800, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://localhost:5173/?compare&truck' })
const t0 = Date.now()
let n = 0
while (Date.now() - t0 < seconds * 1000) {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 })
  if (shot.result?.data) fs.writeFileSync(path.join(outDir, `f${String(++n).padStart(4, '0')}.jpg`), Buffer.from(shot.result.data, 'base64'))
  await sleep(200)
}
fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify({ count: n, seconds }))
ws.close()
chrome.kill()
console.log(`${n} frames in ${seconds} s -> pitch/backup/`)
