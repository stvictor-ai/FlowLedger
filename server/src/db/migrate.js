import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import { createPool } from './pool.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const defaultMigrationsDir = path.resolve(currentDir, '../../migrations')

export async function loadMigrations(migrationsDir = defaultMigrationsDir) {
  const names = (await readdir(migrationsDir))
    .filter(name => /^\d+.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b))

  return Promise.all(names.map(async name => ({
    version: name.replace(/\.sql$/, ''),
    name,
    sql: await readFile(path.join(migrationsDir, name), 'utf8')
  })))
}

export async function runMigrations({ pool, migrationsDir = defaultMigrationsDir }) {
  const client = await pool.connect()
  const applied = []

  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('touji_schema_migrations'))")
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const result = await client.query('SELECT version FROM schema_migrations')
    const existing = new Set(result.rows.map(row => row.version))

    for (const migration of await loadMigrations(migrationsDir)) {
      if (existing.has(migration.version)) continue
      await client.query(migration.sql)
      await client.query(
        'INSERT INTO schema_migrations(version) VALUES ($1)',
        [migration.version]
      )
      applied.push(migration.version)
    }

    await client.query('COMMIT')
    return applied
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  const config = loadConfig()
  const pool = createPool(config)
  try {
    const applied = await runMigrations({ pool })
    console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date')
  } finally {
    await pool.end()
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch(error => {
    console.error('Database migration failed', error)
    process.exitCode = 1
  })
}
