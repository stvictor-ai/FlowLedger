import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createPool } from './db/pool.js'
import { runMigrations } from './db/migrate.js'
import { createAuthRepository } from './modules/auth/repository.js'
import { createAuthService } from './modules/auth/service.js'
import { createSyncRepository } from './modules/sync/repository.js'
import { createSyncService } from './modules/sync/service.js'

const config = loadConfig()
const pool = createPool(config)
await runMigrations({ pool })
const authRepository = createAuthRepository(pool)
const authService = createAuthService({ repository: authRepository })
const syncRepository = createSyncRepository(pool)
const syncService = createSyncService({ repository: syncRepository })
const app = createApp({ authService, syncService, config })

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`touji-api listening on port ${config.port}`)
})

function shutdown(signal) {
  console.log(`${signal} received, closing HTTP server`)
  server.close(error => {
    if (error) {
      console.error(error)
      process.exitCode = 1
      return
    }
    pool.end().catch(console.error)
  })
}

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
