const DEFAULT_PORT = 8787
const DEFAULT_DEV_DATABASE_URL = 'postgres://touji:touji_dev@db:5432/touji'
const DEFAULT_DEV_SESSION_SECRET = 'development-only-session-secret-change-me'

function requiredInProduction(env, key, fallback) {
  const value = String(env[key] || '').trim()
  if (value) return value
  if (env.NODE_ENV === 'production') {
    throw new Error(`${key} is required in production`)
  }
  return fallback
}

export function loadConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || 'development').trim()
  const port = Number(env.PORT || DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }

  const databaseUrl = requiredInProduction(env, 'DATABASE_URL', DEFAULT_DEV_DATABASE_URL)
  const sessionSecret = requiredInProduction(env, 'SESSION_SECRET', DEFAULT_DEV_SESSION_SECRET)
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters')
  }
  const identityProvider = String(env.IDENTITY_PROVIDER || 'session').trim().toLowerCase()
  if (!['session', 'orbit'].includes(identityProvider)) {
    throw new Error('IDENTITY_PROVIDER must be session or orbit')
  }

  return Object.freeze({
    nodeEnv,
    port,
    databaseUrl,
    sessionSecret,
    appOrigin: String(env.APP_ORIGIN || `http://127.0.0.1:${port}`).trim(),
    accountOrigin: String(env.ACCOUNT_ORIGIN || 'https://orbitshz.com').trim(),
    identityProvider,
    isProduction: nodeEnv === 'production'
  })
}
