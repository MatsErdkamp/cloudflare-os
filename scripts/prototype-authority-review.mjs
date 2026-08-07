// PROTOTYPE helper — starts the ordinary backend and Vite frontend together with dev auto-login.
import { spawn } from 'node:child_process'

const environment = { ...process.env, VITE_DEV_AUTO_LOGIN: 'true' }
const children = [
  spawn('pnpm', ['dev-server'], { env: environment, stdio: 'inherit' }),
  spawn('pnpm', ['dev-client', '--', '--host', '127.0.0.1'], { env: environment, stdio: 'inherit' }),
]

let stopping = false
function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

const exitCode = await new Promise((resolve) => {
  for (const child of children) {
    child.once('exit', (code, signal) => {
      stop(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM')
      resolve(code ?? (signal ? 1 : 0))
    })
  }
})

process.exitCode = exitCode
