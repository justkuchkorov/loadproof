import { defineConfig } from 'vite'
import os from 'os'

// The phone remote (remote.html): the dev server's own WebSocket carries the phone's commands to the LoadProof page
// and the page's state back to the phone. /__remote-url tells the page which address to open on the phone.
const remoteRelay = {
  name: 'loadproof-remote',
  configureServer(server) {
    server.hot.on('remote:cmd', (data) => server.hot.send('remote:cmd', data))
    server.hot.on('remote:state', (data) => server.hot.send('remote:state', data))
    server.middlewares.use('/__remote-url', (req, res) => {
      const port = server.config.server.port
      const urls = Object.values(os.networkInterfaces()).flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal)
        .map((i) => `http://${i.address}:${port}/remote.html`)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ urls }))
    })
  },
}

export default defineConfig({
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
  server: { port: 5173, host: true }, // host: phones on the same network can open the remote
  plugins: [remoteRelay],
})
