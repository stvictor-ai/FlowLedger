(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.ToujiPrefs = factory()
})(typeof self !== 'undefined' ? self : this, function () {
  // 复盘笔记、复盘清单、给自己定的规矩、功能开关和外观原来只存在当前浏览器里，换设备就没了。
  // 这里把它们表示成账本里的文档（和贷款、账户现值放在同一个集合里），于是它们跟着账号同步，
  // 也进 JSON 备份和快照。浏览器里原来的那几份仍是页面读写的地方，这里只负责两边对齐。
  //
  //   {id:'prefs:rules',    kind:'prefs', name:'rules',    value:{monthlyCap,…}}
  //   {id:'prefs:features', kind:'prefs', name:'features', value:{positions,loans}}
  //   {id:'prefs:theme',    kind:'prefs', name:'theme',    value:'mist'}
  //   {id:'prefs:plColors', kind:'prefs', name:'plColors', value:'cn'}
  //   {id:'note:day:2026-11-21',      kind:'note', scope:'day',       key, note, savedAt}
  //   {id:'note:period:<周期>',        kind:'note', scope:'period',    key, note, savedAt}
  //   {id:'note:checklist:<周期>',     kind:'note', scope:'checklist', key, items:[{text,checked}]}

  const PREFS = 'prefs'
  const NOTE = 'note'
  const PREF_NAMES = ['rules', 'features', 'theme', 'plColors']
  // 迁移时补建的文档用这个时间戳：比任何真实修改都早，别的设备上真正改过的那份一定赢。
  const SEED_STAMP = 1

  function isSynced(doc) {
    return !!doc && (doc.kind === PREFS || doc.kind === NOTE)
  }

  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
    }
    return JSON.stringify(value === undefined ? null : value)
  }

  function sameContent(a, b) {
    const strip = doc => { const { updatedAt, ...rest } = doc || {}; return rest }
    return stable(strip(a)) === stable(strip(b))
  }

  function text(value) {
    return typeof value === 'string' ? value : ''
  }

  /**
   * 浏览器里存的那几份 → 文档。没设置过的项（undefined）不产生文档，
   * 所以一台什么都没动过的新设备不会凭空多出「数据」。
   */
  function toDocs(local) {
    const docs = []
    const source = local || {}
    for (const name of PREF_NAMES) {
      const value = source[name]
      if (value === undefined || value === null) continue
      if (typeof value === 'object' && !Object.keys(value).length) continue
      docs.push({ id: `${PREFS}:${name}`, kind: PREFS, name, value })
    }
    for (const [key, item] of Object.entries(source.dayNotes || {})) {
      const note = text(item && item.note).trim()
      if (note) docs.push({ id: `${NOTE}:day:${key}`, kind: NOTE, scope: 'day', key, note, savedAt: text(item.savedAt) })
    }
    for (const [key, item] of Object.entries(source.periodNotes || {})) {
      const note = text(item && item.note)
      if (note.trim()) docs.push({ id: `${NOTE}:period:${key}`, kind: NOTE, scope: 'period', key, note, savedAt: text(item.savedAt) })
    }
    for (const [key, items] of Object.entries(source.checklists || {})) {
      if (!Array.isArray(items) || !items.length) continue
      docs.push({
        id: `${NOTE}:checklist:${key}`, kind: NOTE, scope: 'checklist', key,
        items: items.map(item => ({ text: text(item && item.text), checked: !!(item && item.checked) }))
      })
    }
    return docs
  }

  /** 文档 → 浏览器里存的那几份。认不出的文档跳过。 */
  function fromDocs(docs) {
    const local = { dayNotes: {}, periodNotes: {}, checklists: {} }
    for (const doc of docs || []) {
      if (!isSynced(doc)) continue
      if (doc.kind === PREFS) {
        if (PREF_NAMES.includes(doc.name) && doc.value !== undefined && doc.value !== null) local[doc.name] = doc.value
        continue
      }
      const key = text(doc.key)
      if (!key) continue
      if (doc.scope === 'day' && text(doc.note).trim()) local.dayNotes[key] = { note: doc.note, savedAt: text(doc.savedAt) }
      else if (doc.scope === 'period' && text(doc.note).trim()) local.periodNotes[key] = { note: doc.note, savedAt: text(doc.savedAt) }
      else if (doc.scope === 'checklist' && Array.isArray(doc.items)) {
        local.checklists[key] = doc.items.map(item => ({ text: text(item && item.text), checked: !!(item && item.checked) }))
      }
    }
    return local
  }

  /**
   * 用户刚在这台设备上改了东西：让文档跟上浏览器里的内容。
   * 返回要写入的文档（带新时间戳）和要删除的文档 id（由调用方记删除墓碑）。
   */
  function push(docs, local, now) {
    const existing = new Map((docs || []).filter(isSynced).map(doc => [doc.id, doc]))
    const upserts = []
    for (const want of toDocs(local)) {
      const have = existing.get(want.id)
      existing.delete(want.id)
      if (!have || !sameContent(have, want)) upserts.push({ ...want, updatedAt: now })
    }
    return { upserts, removeIds: [...existing.keys()] }
  }

  /**
   * 文档变了（刚打开页面、同步回来、导入了备份）：文档说了算。
   *  - 文档里有的，照文档来；
   *  - 浏览器里有、文档里没有的：别的设备删掉了它（有删除墓碑）就跟着删；
   *    否则是升级前留下的内容，补建成文档（时间戳取最早，不会压过别处真正改过的）。
   * 返回对齐后的浏览器内容、要补建的文档，以及浏览器内容有没有变。
   */
  function pull(docs, local, tombstones) {
    const dead = tombstones || {}
    const existing = new Set((docs || []).filter(isSynced).map(doc => doc.id))
    const seeds = toDocs(local).filter(doc => !existing.has(doc.id) && !(doc.id in dead))
    const merged = fromDocs([...(docs || []), ...seeds])
    const before = fromDocs(toDocs(local))
    return {
      local: merged,
      seeds: seeds.map(doc => ({ ...doc, updatedAt: SEED_STAMP })),
      changed: stable(merged) !== stable(before)
    }
  }

  return { PREFS, NOTE, SEED_STAMP, isSynced, toDocs, fromDocs, push, pull, sameContent }
})
