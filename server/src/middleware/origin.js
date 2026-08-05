const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createOriginGuard({ appOrigin, requireOrigin }) {
  return function originGuard(request, response, next) {
    if (SAFE_METHODS.has(request.method)) return next()
    const origin = request.get('origin')
    if (!origin && !requireOrigin) return next()
    if (origin !== appOrigin) {
      return response.status(403).json({ error: 'INVALID_ORIGIN' })
    }
    return next()
  }
}
