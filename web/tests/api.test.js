import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { getToken, request, setToken } from '../src/api.js'

const values = new Map()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key)
} })
globalThis.window = { location: { hash: '#/nodes' } }
let base, releaseUnauthorized, unauthorizedStarted
const server = createServer(async (req, res) => {
  if (req.url === '/stall') return
  if (req.url === '/stall-body') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.flushHeaders()
    return
  }
  if (req.url === '/unauthorized-delayed') {
    unauthorizedStarted()
    await new Promise(resolve => { releaseUnauthorized = resolve })
  }
  if (req.url.startsWith('/unauthorized')) res.statusCode = 401
  if (req.url === '/unavailable') res.statusCode = 503
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(req.url === '/unavailable' ? { error: '暂时不可用' } : { authorization: req.headers.authorization, method: req.method }))
})

before(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  base = `http://127.0.0.1:${server.address().port}`
})
beforeEach(() => {
  values.clear()
  setToken('test-session')
  window.location.hash = '#/nodes'
})
after(async () => {
  releaseUnauthorized?.()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
})

test('preserves authentication, method and successful JSON responses', async () => {
  assert.deepEqual(await request(base + '/ok', { method: 'POST', body: '{}' }), { authorization: 'Bearer test-session', method: 'POST' })
})

for (const path of ['/stall', '/stall-body']) {
  test(`bounds the wait when ${path} never completes`, async () => {
    await assert.rejects(request(base + path, { timeoutMs: 80 }), { name: 'TimeoutError', message: '请求超时，请重试' })
    assert.ok(await request(base + '/ok'), 'a timeout must not abort a retry')
    assert.equal(getToken(), 'test-session')
  })
}

test('a write timeout explains that the operation may already have been submitted', async () => {
  await assert.rejects(request(base + '/stall', { method: 'POST', timeoutMs: 80 }), /操作可能已提交/)
})

test('page cancellation aborts a pending read without becoming a timeout', async () => {
  const controller = new AbortController()
  const pending = request(base + '/stall', { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(getToken(), 'test-session')
})

test('already cancelled pages do not start new reads', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(request(base + '/ok', { signal: controller.signal }), { name: 'AbortError' })
})

test('server errors remain actionable and do not clear the session', async () => {
  await assert.rejects(request(base + '/unavailable'), /暂时不可用/)
  assert.equal(getToken(), 'test-session')
})

test('an expired session returns to login', async () => {
  await assert.rejects(request(base + '/unauthorized'), /登录已失效/)
  assert.equal(getToken(), null)
  assert.equal(window.location.hash, '#/login')
})

test('a late 401 from an old session cannot log out a newer session', async () => {
  const started = new Promise(resolve => { unauthorizedStarted = resolve })
  const pending = request(base + '/unauthorized-delayed')
  await started
  setToken('new-session')
  releaseUnauthorized()
  await assert.rejects(pending, /登录已失效/)
  assert.equal(getToken(), 'new-session')
  assert.equal(window.location.hash, '#/nodes')
})
