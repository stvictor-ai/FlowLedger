const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')

// An object literal may repeat a key, and the last one silently wins. That is
// how an English block pasted into the zh dictionary once turned
// "当前周期净盈亏" into "Current Period Net" with nothing reporting it. The
// runtime object has already lost the evidence, so this reads the source.

/** The source text of `const I18N={...}`, braces included. */
function dictionarySource(html) {
  const start = html.indexOf('const I18N={')
  assert.ok(start > -1, 'const I18N={ not found in index.html')
  let depth = 0
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    const ch = html[i]
    if (ch === '\'' || ch === '"' || ch === '`') { i = skipString(html, i); continue }
    if (ch === '{') depth++
    if (ch === '}' && --depth === 0) return html.slice(html.indexOf('{', start), i + 1)
  }
  throw new Error('I18N object is not closed')
}

/** Index of the closing quote of the string that opens at `i`. */
function skipString(src, i) {
  const quote = src[i]
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue }
    if (src[j] === quote) return j
  }
  throw new Error(`unterminated string at ${i}`)
}

/** Every key repeated within the same object, as dotted paths. */
function duplicateKeys(src) {
  const duplicates = []
  const stack = [] // one { path, keys } per open object
  let expectKey = false
  let pendingKey = null

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (/\s/.test(ch)) continue
    if (src.startsWith('//', i)) { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (src.startsWith('/*', i)) { i = src.indexOf('*/', i) + 1; continue }

    if (ch === '{') {
      const parent = stack[stack.length - 1]
      stack.push({ path: parent && pendingKey ? `${parent.path}.${pendingKey}` : (pendingKey || 'I18N'), keys: new Set() })
      expectKey = true
      pendingKey = null
      continue
    }
    if (ch === '}') { stack.pop(); expectKey = false; continue }
    if (ch === ',') { expectKey = true; continue }

    let token = null
    let end = i
    if (ch === '\'' || ch === '"') {
      end = skipString(src, i)
      token = src.slice(i + 1, end)
    } else if (ch === '`') {
      end = skipString(src, i)
    } else {
      const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))
      if (word) { token = word[0]; end = i + token.length - 1 }
    }

    // A key is a name or string right after `{` or `,`, followed by `:`.
    const after = src.slice(end + 1).match(/^\s*:/)
    const top = stack[stack.length - 1]
    if (expectKey && token !== null && after && top) {
      if (top.keys.has(token)) duplicates.push(`${top.path}.${token}`)
      top.keys.add(token)
      pendingKey = token
    }
    expectKey = false
    i = end
  }
  return duplicates
}

test('the duplicate-key reader catches what it is meant to catch', () => {
  // Proof the check itself works, so a clean run below means something.
  assert.deepEqual(
    duplicateKeys(`{zh:{a:'1',b:'x, y: z',a:'2',nested:{c:1,c:2}},en:{a:'1'}}`),
    ['I18N.zh.a', 'I18N.zh.nested.c']
  )
  assert.deepEqual(duplicateKeys(`{zh:{'quoted':1,quoted:2,t:\`{a:1,a:2}\`}}`), ['I18N.zh.quoted'])
})

test('no locale in the I18N dictionary repeats a key', () => {
  const html = fs.readFileSync('index.html', 'utf8')
  const source = dictionarySource(html)

  assert.match(source, /zh:\{/)
  assert.deepEqual(duplicateKeys(source), [], 'a repeated key silently overrides the earlier value')
})
