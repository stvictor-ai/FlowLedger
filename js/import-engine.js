(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  if (root) root.ToujiImport = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function countByKey(items, keyOf) {
    const counts = new Map()
    ;(Array.isArray(items) ? items : []).forEach(item => {
      const key = keyOf(item)
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return counts
  }

  function consume(counts, key) {
    const count = counts.get(key) || 0
    if (!count) return false
    if (count === 1) counts.delete(key)
    else counts.set(key, count - 1)
    return true
  }

  function classifyOccurrences(existingEntries, incomingEntries, options) {
    const source = options && options.source
    const keyOf = options && options.keyOf
    if (typeof keyOf !== 'function') throw new TypeError('keyOf must be a function')

    const existing = Array.isArray(existingEntries) ? existingEntries : []
    const incoming = Array.isArray(incomingEntries) ? incomingEntries : []
    const remainingByKey = countByKey(existing, keyOf)
    const existingById = new Map(existing.filter(entry => entry && entry.id).map(entry => [entry.id, entry]))

    return incoming.map(entry => {
      const key = keyOf(entry)
      const sameId = source === 'JSON' && entry && entry.id ? existingById.get(entry.id) : null

      if (sameId) {
        consume(remainingByKey, keyOf(sameId))
        if (keyOf(sameId) === key) return { entry, kind: 'duplicate' }
        return { entry, kind: 'update', isUpdate: true }
      }

      if (consume(remainingByKey, key)) return { entry, kind: 'duplicate' }
      return { entry, kind: 'new' }
    })
  }

  return { classifyOccurrences }
})
