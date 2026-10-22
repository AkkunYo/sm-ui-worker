import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'

// Every <label> must be programmatically tied to its control (wrapping it, or
// for="" pointing at an id in the same view) so screen readers and getByLabel
// can find the field. Labels of custom widgets belong on a <span> + aria-labelledby.
const viewsDir = new URL('../src/views/', import.meta.url)
const views = readdirSync(viewsDir).filter(name => name.endsWith('.vue'))

test('the views directory contains the expected pages', () => {
  assert.ok(views.length >= 8, `expected the page views, found ${views.length}`)
})

for (const name of views) {
  const source = readFileSync(new URL(name, viewsDir), 'utf8')
  const template = source.slice(0, source.indexOf('<script'))
  const ids = [...template.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])

  test(`${name}: every label is associated with a form control`, () => {
    const problems = []
    for (const m of template.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
      const [, attrs, inner] = m
      const line = template.slice(0, m.index).split('\n').length
      const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30)
      if (/<(input|select|textarea)\b/.test(inner)) continue
      const target = /\sfor="([^"]+)"/.exec(attrs)?.[1]
      if (!target) problems.push(`line ${line} "${text}": no for="" and no wrapped control`)
      else if (!ids.includes(target)) problems.push(`line ${line} "${text}": for="${target}" has no matching id`)
    }
    assert.deepEqual(problems, [])
  })

  test(`${name}: element ids are unique`, () => {
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i)
    assert.deepEqual(duplicates, [])
  })
}
