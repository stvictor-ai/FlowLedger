import { createApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = createApp()

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`touji-api listening on port ${config.port}`)
})

function shutdown(signal) {
  console.log(`${signal} received, closing HTTP server`)
  server.close(error => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
