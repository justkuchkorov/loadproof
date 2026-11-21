import { defineConfig } from 'vite'
import os from 'os'
import fs from 'fs'
import path from 'path'

// The phone remote (remote.html): the dev server's own WebSocket carries the phone's commands to the LoadProof page
// and the page's state back to the phone. /__remote-url tells the page which address to open on the phone.
// The box list (boxes.html) and the loading sheet live here too, in data/loadproof.json, so the phone and the laptop
// see the same boxes: /__boxes (GET the list and the sheet; POST add, delete, clear) and /__sheet (POST).
const STORE = path.resolve('data/loadproof.json')
const load = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { return { boxes: [], next: 1, sheet: null } } }
const save = (db) => { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(db, null, 1)) }
const body = (req) => new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c }); req.on('end', () => { try { resolve(JSON.parse(s || '{}')) } catch { resolve({}) } }) })
const lanUrls = (port) => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${port}`)

const remoteRelay = {
  name: 'loadproof-remote',
  configureServer(server) {
    server.hot.on('remote:cmd', (data) => server.hot.send('remote:cmd', data))
    server.hot.on('remote:state', (data) => server.hot.send('remote:state', data))
    const json = (res, data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)) }
    server.middlewares.use('/__remote-url', (req, res) => {
      const port = server.config.server.port
      json(res, { urls: lanUrls(port).map((u) => `${u}/remote.html`), bases: lanUrls(port) })
    })
    server.middlewares.use('/__boxes', async (req, res) => {
      const db = load()
      if (req.method === 'POST') {
        const { action, box, n } = await body(req)
        if (action === 'add' && box) {
          const clean = {
            n: db.next++, name: String(box.name || 'BOX').toUpperCase().slice(0, 12),
            firmness: ['soft', 'mid', 'hard'].includes(box.firmness) ? box.firmness : 'hard',
            cm: [[30, 40], [60, 40], [30, 80]].find(([a, b]) => a === box.cm?.[0] && b === box.cm?.[1]) ? [box.cm[0], box.cm[1], Math.max(5, Math.min(60, Math.round(box.cm[2]) || 25))] : [30, 40, 25],
            kg: Math.max(0.1, Math.min(40, Number(box.kg) || 1)),
          }
          db.boxes.push(clean)
        }
        if (action === 'delete') db.boxes = db.boxes.filter((b) => b.n !== n)
        if (action === 'clear') { db.boxes = []; db.next = 1; db.sheet = null }
        save(db)
        server.hot.send('boxes:changed', {})
      }
      json(res, db)
    })
    server.middlewares.use('/__sheet', async (req, res) => {
      const db = load()
      if (req.method === 'POST') { db.sheet = await body(req); save(db); server.hot.send('boxes:changed', {}) }
      json(res, db.sheet)
    })
  },
}

export default defineConfig({
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  server: { port: 5173, host: true, watch: { ignored: ['**/data/**'] } }, // host: phones on the same network can open the remote
  plugins: [remoteRelay],
})
