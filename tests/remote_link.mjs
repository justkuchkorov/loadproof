// The phone remote's link, without a phone: a WebSocket client like the remote page sends 'hello' through the dev
// server and waits for the LoadProof page's state (a LoadProof tab must be open). Usage: node tests/remote_link.mjs
const base = process.env.URL || 'http://localhost:5173'
const client = await (await fetch(base + '/@vite/client')).text()
const token = client.match(/const wsToken = "([^"]+)"/)[1]
const ws = new WebSocket(base.replace('http', 'ws') + '/?token=' + token, 'vite-hmr')
const send = (data) => ws.send(JSON.stringify({ type: 'custom', event: 'remote:cmd', data }))
let got = 0
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.type !== 'custom' || m.event !== 'remote:state') return
  if (got++ === 0) console.log('state from the page:', JSON.stringify({ status: m.data.status, worker: m.data.worker, boxes: m.data.boxes.length, log: m.data.log.at(-1) }))
}
ws.onopen = () => { console.log('connected'); send({ cmd: 'hello' }) }
setTimeout(() => { console.log(got ? `OK: ${got} state messages in 3 s` : 'NO state: is a LoadProof page open?'); process.exit(got ? 0 : 1) }, 3000)
