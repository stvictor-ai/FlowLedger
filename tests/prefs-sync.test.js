const assert = require('node:assert/strict')
const test = require('node:test')
const Prefs = require('../js/prefs-sync.js')

const local = () => ({
  rules: { monthlyCap: 5000, largeTx: 5000 },
  features: { loans: true },
  theme: 'neon',
  plColors: undefined,
  dayNotes: { '2026-11-20': { note: '追高了', savedAt: '2026/11/20 21:00' } },
  periodNotes: { '30:2026-11': { note: '这个月投多了', savedAt: '2026/11/21 09:00' } },
  checklists: { '30:2026-11': [{ text: '有没有计划外操作', checked: true }] }
})

test('what the browser holds turns into documents and back without loss', () => {
  const docs = Prefs.toDocs(local())
  assert.deepEqual(docs.map(doc => doc.id).sort(), [
    'note:checklist:30:2026-11', 'note:day:2026-11-20', 'note:period:30:2026-11',
    'prefs:features', 'prefs:rules', 'prefs:theme'
  ])
  const back = Prefs.fromDocs(docs)
  assert.deepEqual(back.rules, { monthlyCap: 5000, largeTx: 5000 })
  assert.equal(back.theme, 'neon')
  assert.equal(back.plColors, undefined)
  assert.equal(back.dayNotes['2026-11-20'].note, '追高了')
  assert.deepEqual(back.checklists['30:2026-11'], [{ text: '有没有计划外操作', checked: true }])
})

test('a device nobody has touched produces no documents', () => {
  assert.deepEqual(Prefs.toDocs({ features: {}, dayNotes: {}, periodNotes: {}, checklists: {} }), [])
})

test('saving writes only what changed and removes a cleared note', () => {
  const docs = Prefs.toDocs(local()).map(doc => ({ ...doc, updatedAt: 100 }))
  const next = local()
  next.rules = { monthlyCap: 8000, largeTx: 5000 }
  delete next.dayNotes['2026-11-20']
  const result = Prefs.push(docs, next, 200)
  assert.deepEqual(result.upserts.map(doc => [doc.id, doc.updatedAt]), [['prefs:rules', 200]])
  assert.deepEqual(result.removeIds, ['note:day:2026-11-20'])
})

test('saving leaves loans and account values alone', () => {
  const docs = [{ id: 'loan-1', kind: 'loan', updatedAt: 5 }, { id: 'balance:甲', kind: 'balance', updatedAt: 5 }]
  const result = Prefs.push(docs, { dayNotes: {}, periodNotes: {}, checklists: {} }, 200)
  assert.deepEqual(result, { upserts: [], removeIds: [] })
})

test('what arrives from another device replaces what this one had', () => {
  const remote = [{ id: 'prefs:rules', kind: 'prefs', name: 'rules', value: { monthlyCap: 3000 }, updatedAt: 500 }]
  const result = Prefs.pull(remote, { rules: { monthlyCap: 0 }, dayNotes: {}, periodNotes: {}, checklists: {} }, {})
  assert.equal(result.changed, true)
  assert.equal(result.local.rules.monthlyCap, 3000)
  assert.deepEqual(result.seeds, [])
})

test('notes written before the upgrade are kept and become documents with the oldest stamp', () => {
  const result = Prefs.pull([{ id: 'loan-1', kind: 'loan', updatedAt: 5 }], local(), {})
  assert.equal(result.changed, false)
  assert.equal(result.seeds.length, 6)
  assert.ok(result.seeds.every(doc => doc.updatedAt === Prefs.SEED_STAMP))
  assert.equal(result.local.dayNotes['2026-11-20'].note, '追高了')
})

test('a note deleted on another device is deleted here too', () => {
  const result = Prefs.pull([], local(), { 'note:day:2026-11-20': 900 })
  assert.equal(result.changed, true)
  assert.equal(result.local.dayNotes['2026-11-20'], undefined)
  assert.ok(!result.seeds.some(doc => doc.id === 'note:day:2026-11-20'))
})

test('once aligned, pulling again changes nothing', () => {
  const first = Prefs.pull([], local(), {})
  const second = Prefs.pull(first.seeds, first.local, {})
  assert.equal(second.changed, false)
  assert.deepEqual(second.seeds, [])
})
