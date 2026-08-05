import pg from 'pg'

const { Pool } = pg

export function createPool(config) {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.isProduction ? 10 : 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  })

  pool.on('error', error => {
    console.error('Unexpected PostgreSQL pool error', error)
  })

  return pool
}
