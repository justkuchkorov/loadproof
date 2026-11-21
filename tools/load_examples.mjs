// Put the example boxes (examples/demo-boxes.json) into the running dev server's box list, replacing it.
// Usage: node tools/load_examples.mjs [file] [http://localhost:5173]
import fs from 'fs'
const file = process.argv[2] || 'examples/demo-boxes.json'
const base = process.argv[3] || 'http://localhost:5173'
const post = (body) => fetch(base + '/__boxes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json())
await post({ action: 'clear' })
let db
for (const box of JSON.parse(fs.readFileSync(file, 'utf8'))) db = await post({ action: 'add', box })
console.log(db.boxes.map((b) => `#${b.n} ${b.name} ${b.kg} kg ${b.cm.join('x')} ${b.firmness}`).join('\n'))
