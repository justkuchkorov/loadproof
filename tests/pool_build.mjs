// Run the full agent (AI plan, checks, robot build, final check) on N orders from the pool, one process each.
// Run: node tests/pool_build.mjs 4
import { execFileSync } from 'child_process'
const POOL = (await import('../src/pool.js')).default
const n = Number(process.argv[2] || 4)
let ok = 0
for (let k = 0; k < n; k++) {
  const order = POOL[Math.floor(Math.random() * POOL.length)]
  let out = ''
  try { out = execFileSync('node', ['tests/agent_build.mjs'], { env: { ...process.env, ORDER: order.join(',') }, encoding: 'utf8', timeout: 400000 }) } catch (e) { out = (e.stdout || '') + ' ERROR ' + e.message }
  const lines = out.split('\n').filter((l) => !l.includes('robot:'))
  const final = lines.filter((l) => l.includes('Measured every box') || l.includes('Still out of place') || l.includes('Nothing was built') || l.includes('ERROR')).pop() || '(no final line)'
  const good = final.includes('all where the plan says')
  if (good) ok++
  console.log(`order ${k + 1}: ${order.join(',')} -> ${good ? 'BUILT' : 'PROBLEM'} | ${final.trim().slice(0, 160)}`)
  if (!good) console.log(lines.filter((l) => /fail|step \d/.test(l)).slice(-8).join('\n').slice(0, 1500))
}
console.log(`${ok}/${n} orders planned and built by the arm`)
