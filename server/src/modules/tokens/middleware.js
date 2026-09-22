/**
 * Bearer auth for machine callers. Deliberately separate from the browser
 * session: a trading desk or an agent has no cookie jar and no Origin, and it
 * must never be able to reach anything but the read-only feed.
 */
export function createRequireApiToken(tokenService) {
  return async function requireApiToken(request, response, next) {
    const header = String(request.get('authorization') || '')
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    if (!match) {
      response.set('WWW-Authenticate', 'Bearer realm="touji"')
      return response.status(401).json({ error: 'UNAUTHENTICATED' })
    }

    const grant = await tokenService.authenticate(match[1])
    if (!grant) {
      response.set('WWW-Authenticate', 'Bearer realm="touji", error="invalid_token"')
      return response.status(401).json({ error: 'INVALID_TOKEN' })
    }

    request.apiToken = grant
    return next()
  }
}
