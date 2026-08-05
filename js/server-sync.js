(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ToujiServerSync = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  class ServerSyncError extends Error {
    constructor(code, status, details) {
      super(code)
      this.name = 'ServerSyncError'
      this.code = code
      this.status = status
      this.details = details || null
    }
  }

  async function responseBody(response) {
    const type = response.headers && response.headers.get
      ? response.headers.get('content-type') || ''
      : ''
    if (!type.includes('application/json')) return null
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  function createClient(options) {
    const settings = options || {}
    const fetchImpl = settings.fetchImpl || globalThis.fetch
    const baseUrl = String(settings.baseUrl || '').replace(/\/$/, '')
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required')

    async function request(path, init) {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(init && init.headers) },
        ...init
      })
      const body = await responseBody(response)
      if (!response.ok) {
        throw new ServerSyncError(
          (body && body.error) || 'SERVER_UNAVAILABLE',
          response.status,
          body && body.details
        )
      }
      return body
    }

    return {
      register(payload) {
        return request('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      },
      login(payload) {
        return request('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      },
      logout() {
        return request('/api/v1/auth/logout', { method: 'POST' })
      },
      me() {
        return request('/api/v1/auth/me', { method: 'GET' })
      },
      readSnapshot(ledgerId) {
        return request(`/api/v1/ledgers/${encodeURIComponent(ledgerId)}/sync`, { method: 'GET' })
      },
      writeSnapshot(ledgerId, payload) {
        return request(`/api/v1/ledgers/${encodeURIComponent(ledgerId)}/sync`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
      }
    }
  }

  function amountCNY(entry) {
    const amount = Number(entry && entry.amount) || 0
    const currency = (entry && entry.currency) || 'CNY'
    const rate = Number(entry && entry.rate) || 1
    return currency === 'CNY' ? amount : amount * rate
  }

  function summarizeSnapshot(snapshot) {
    const data = snapshot || {}
    const entries = Array.isArray(data.entries) ? data.entries : []
    const positions = Array.isArray(data.positions) ? data.positions : []
    let totalIn = 0
    let totalOut = 0
    entries.forEach(entry => {
      if (entry.type === '入金') totalIn += amountCNY(entry)
      if (entry.type === '出金') totalOut += amountCNY(entry)
    })
    return {
      entries: entries.length,
      positions: positions.length,
      totalIn,
      totalOut,
      deleted: Object.keys(data.deletedIds || {}).length + Object.keys(data.deletedPositionIds || {}).length
    }
  }

  function hasSnapshotData(snapshot) {
    const summary = summarizeSnapshot(snapshot)
    return summary.entries + summary.positions + summary.deleted > 0
  }

  return { ServerSyncError, createClient, summarizeSnapshot, hasSnapshotData }
})
