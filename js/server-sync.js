(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ToujiServerSync = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // 账本格式的版本号。写服务器时放在 X-Touji-Schema 里：流水每加一个字段就加一，
  // 并在 server/src/modules/sync/service.js 的 ENTRY_FIELDS_SINCE 里登记。
  // 服务器靠它认出还在跑旧代码的页面，不让它把自己不认识的字段抹掉。
  const SCHEMA_VERSION = 4

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
        // 没登录时，前面的代理会把请求 302 到登录页。跟着跳过去只会得到一个跨域错误，
        // 和断网分不清 —— 所以不跟，直接把「被要求去登录」认作未登录。
        redirect: 'manual',
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init && init.headers) }
      })
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new ServerSyncError('UNAUTHENTICATED', 401)
      }
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
      listApiTokens() {
        return request('/api/v1/tokens', { method: 'GET' })
      },
      createApiToken(payload) {
        return request('/api/v1/tokens', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      },
      revokeApiToken(id) {
        return request(`/api/v1/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
      },
      readSnapshot(ledgerId) {
        return request(`/api/v1/ledgers/${encodeURIComponent(ledgerId)}/sync`, { method: 'GET' })
      },
      writeSnapshot(ledgerId, payload) {
        return request(`/api/v1/ledgers/${encodeURIComponent(ledgerId)}/sync`, {
          method: 'PUT',
          headers: { 'X-Touji-Schema': String(SCHEMA_VERSION) },
          body: JSON.stringify(payload)
        })
      },
      adminSummary() {
        return request('/api/v1/admin/summary', { method: 'GET' })
      },
      adminUsers() {
        return request('/api/v1/admin/users', { method: 'GET' })
      },
      adminInvitations() {
        return request('/api/v1/admin/invitations', { method: 'GET' })
      },
      createInvitation(payload) {
        return request('/api/v1/admin/invitations', {
          method: 'POST',
          body: JSON.stringify(payload)
        })
      },
      updateUserStatus(userId, status) {
        return request(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status })
        })
      },
      revokeInvitation(inviteId) {
        return request(`/api/v1/admin/invitations/${encodeURIComponent(inviteId)}`, {
          method: 'DELETE'
        })
      }
    }
  }

  // 同一条记录的本机副本和远端副本取哪个：updatedAt 新的那个。
  // 时间相同说明两边出自同一次保存，内容却不一样，只可能是其中一边被不认识新字段的
  // 旧页面读过又存回 —— 这时以本机为准，本机没有的字段从远端补回来，而不是整条丢掉。
  function mergeRecord(local, remote) {
    if (!local) return remote
    if (!remote) return local
    const localAt = Number(local.updatedAt) || 0
    const remoteAt = Number(remote.updatedAt) || 0
    if (remoteAt > localAt) return remote
    if (remoteAt < localAt) return local
    return { ...remote, ...local }
  }

  function amountCNY(entry) {
    if (entry && entry.type === '入金' && String(entry.sourceCurrency || '').toUpperCase() === 'CNY' && Number(entry.sourceAmount) > 0) {
      return Number(entry.sourceAmount)
    }
    if (entry && entry.type === '出金' && String(entry.targetCurrency || '').toUpperCase() === 'CNY' && Number(entry.targetAmount) > 0) {
      return Number(entry.targetAmount)
    }
    const amount = Number(entry && entry.amount) || 0
    const currency = (entry && entry.currency) || 'CNY'
    const rate = Number(entry && entry.rate) || 1
    return currency === 'CNY' ? amount : amount * rate
  }

  function summarizeSnapshot(snapshot) {
    const data = snapshot || {}
    const entries = Array.isArray(data.entries) ? data.entries : []
    const positions = Array.isArray(data.positions) ? data.positions : []
    const debts = Array.isArray(data.debts) ? data.debts : []
    let totalIn = 0
    let totalOut = 0
    entries.forEach(entry => {
      if (entry.type === '入金') totalIn += amountCNY(entry)
      if (entry.type === '出金') totalOut += amountCNY(entry)
    })
    return {
      entries: entries.length,
      positions: positions.length,
      debts: debts.length,
      totalIn,
      totalOut,
      deleted: Object.keys(data.deletedIds || {}).length +
        Object.keys(data.deletedPositionIds || {}).length +
        Object.keys(data.deletedDebtIds || {}).length
    }
  }

  function hasSnapshotData(snapshot) {
    const summary = summarizeSnapshot(snapshot)
    return summary.entries + summary.positions + summary.debts + summary.deleted > 0
  }

  function createAutoSyncCoordinator(options) {
    const settings = options || {}
    const delay = Number(settings.delay) >= 0 ? Number(settings.delay) : 1200
    const retryDelay = Number(settings.retryDelay) >= 0 ? Number(settings.retryDelay) : 30000
    const setTimer = settings.setTimer || setTimeout
    const clearTimer = settings.clearTimer || clearTimeout
    let timer = null
    let retryTimer = null
    let running = false
    let queued = false
    let disposed = false

    function clearScheduled() {
      if (timer !== null) clearTimer(timer)
      timer = null
    }

    function clearRetry() {
      if (retryTimer !== null) clearTimer(retryTimer)
      retryTimer = null
    }

    function scheduleRetry() {
      clearRetry()
      if (disposed) return
      retryTimer = setTimer(() => {
        retryTimer = null
        flush()
      }, retryDelay)
    }

    async function flush() {
      clearScheduled()
      if (disposed || (settings.canRun && !settings.canRun())) return false
      if (running) {
        queued = true
        return false
      }
      running = true
      queued = false
      try {
        await settings.run()
        clearRetry()
        return true
      } catch (error) {
        if (settings.onError) settings.onError(error)
        scheduleRetry()
        return false
      } finally {
        running = false
        if (queued && !disposed) schedule(0)
      }
    }

    function schedule(wait) {
      if (disposed || (settings.canRun && !settings.canRun())) return false
      queued = true
      clearScheduled()
      timer = setTimer(() => {
        timer = null
        flush()
      }, wait === undefined ? delay : Math.max(0, Number(wait) || 0))
      return true
    }

    function dispose() {
      disposed = true
      queued = false
      clearScheduled()
      clearRetry()
    }

    return { schedule, flush, dispose, isRunning: () => running, isQueued: () => queued }
  }

  return { SCHEMA_VERSION, ServerSyncError, createClient, mergeRecord, summarizeSnapshot, hasSnapshotData, createAutoSyncCoordinator }
})
