// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { createTaskServer } from '../../examples/servers/node/server.js'
import { createHttpRuntime } from '../../examples/http/runtime.js'

async function fixture(t, server = createTaskServer()) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const calls = []
  const requests = []
  server.on('request', request => { requests.push([request.method, request.url]) })
  const realFetch = globalThis.fetch
  const fetchOperation = (url, options) => {
    calls.push({ url, ...options })
    // Only the Node tests resolve relative URLs; the runtime forwards them as-is.
    return realFetch(new URL(url, origin), options)
  }
  const runtime = createHttpRuntime({ fetch: fetchOperation, unsubscribeDelayMs: 0 })
  t.after(async () => {
    runtime.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return { runtime, calls, requests, fetchOperation }
}

async function settle(subscription) {
  await subscription.refetch()
  return subscription.getSnapshot().data
}

function methodsAndUrls(calls) {
  return calls.map(({ method, url }) => [method, url])
}

test('raw URL observers are inert; subscriptions share a read while summary stays independent', async t => {
  const { runtime, calls } = await fixture(t)
  const observer = runtime.observe('/api/tasks')
  assert.equal(observer.getSnapshot().status, 'idle')
  assert.deepEqual(calls, [])
  const tasks = runtime.subscribe('/api/tasks')
  const sameTasks = runtime.subscribe('/api/tasks')
  const summary = runtime.subscribe('/api/summary')
  const [rows, sameRows, totals] = await Promise.all([settle(tasks), settle(sameTasks), settle(summary)])
  assert.equal(rows, sameRows)
  assert.equal(rows.length, 2)
  assert.ok(Object.isFrozen(rows))
  assert.deepEqual(totals, { total: 2, done: 1 })
  assert.deepEqual(methodsAndUrls(calls), [['GET', '/api/tasks'], ['GET', '/api/summary']])
})

test('a POST receipt refetches exactly the interested raw URLs, not query variants or detail', async t => {
  const { runtime, calls, requests } = await fixture(t)
  const tasks = runtime.subscribe('/api/tasks')
  const sameTasks = runtime.subscribe('/api/tasks')
  const summary = runtime.subscribe('/api/summary')
  const variant = runtime.subscribe('/api/tasks?view=all')
  const detail = runtime.subscribe('/api/tasks/1')
  await Promise.all([tasks, sameTasks, summary, variant, detail].map(settle))
  const oldVariant = variant.getSnapshot().data
  calls.length = 0
  requests.length = 0
  const receipt = await runtime.command('/api/tasks', { title: 'Read the URL directly' })
  assert.deepEqual(receipt, { id: '3' })
  assert.deepEqual(tasks.getSnapshot().data.at(-1), { id: '3', title: 'Read the URL directly', done: false })
  assert.equal(tasks.getSnapshot().data, sameTasks.getSnapshot().data)
  assert.deepEqual(summary.getSnapshot().data, { total: 3, done: 1 })
  assert.equal(variant.getSnapshot().data, oldVariant)
  assert.equal(oldVariant.length, 2)
  assert.deepEqual(methodsAndUrls(calls), [
    ['POST', '/api/tasks'], ['GET', '/api/tasks'], ['GET', '/api/summary'],
  ])
  assert.deepEqual(requests, methodsAndUrls(calls))
  assert.equal(calls[0].headers['Content-Type'], 'application/json')
  assert.equal(calls[0].body, JSON.stringify({ title: 'Read the URL directly' }))
})

test('failed POST does not refresh; virtual refresh only GETs currently interested URLs', async t => {
  const { runtime, calls } = await fixture(t)
  const tasks = runtime.subscribe('/api/tasks')
  const summary = runtime.subscribe('/api/summary')
  await Promise.all([settle(tasks), settle(summary)])
  const previous = tasks.getSnapshot().data
  calls.length = 0
  await assert.rejects(runtime.command('/api/tasks', { title: '' }), error => error.status === 400)
  assert.deepEqual(methodsAndUrls(calls), [['POST', '/api/tasks']])
  assert.equal(tasks.getSnapshot().data, previous)
  calls.length = 0
  await runtime.command('refresh')
  assert.deepEqual(methodsAndUrls(calls), [['GET', '/api/tasks'], ['GET', '/api/summary']])
  summary.unsubscribe()
  calls.length = 0
  await runtime.command('refresh')
  assert.deepEqual(methodsAndUrls(calls), [['GET', '/api/tasks']])
})

test('GET ignores params and both methods preserve raw paths and query strings; unknown URLs reach HTTP 404', async t => {
  const { runtime, calls, requests } = await fixture(t)
  const rawUrl = '/api/tasks?label=a%2Fb&label=two+words&order=desc'
  const tasks = runtime.subscribe(rawUrl, { ignored: 'not a query string' })
  assert.equal((await settle(tasks)).length, 2)
  const postUrl = '/api/tasks?source=direct%2Furl'
  assert.deepEqual(await runtime.command(postUrl, { title: 'Raw POST URL' }), { id: '3' })
  // This POST URL has no update rule: no automatic query stripping occurs.
  assert.deepEqual(methodsAndUrls(calls), [['GET', rawUrl], ['POST', postUrl]])
  const missing = runtime.subscribe('/api/no-such-resource?x=1')
  await assert.rejects(missing.refetch(), { status: 404, message: 'Not found' })
  assert.equal(missing.getSnapshot().error.status, 404)
  assert.equal(missing.getSnapshot().error.message, 'Not found')
  await assert.rejects(runtime.command('/api/no-such-resource?x=2', { title: 'Missing' }), {
    status: 404, message: 'Not found',
  })
  assert.deepEqual(requests, methodsAndUrls(calls))
})

test('reset forwards cancellation to GET and POST fetch signals without subsequent refreshes', async t => {
  const { runtime, calls } = await fixture(t)
  const tasks = runtime.subscribe('/api/tasks')
  const read = tasks.refetch()
  const write = runtime.command('/api/tasks', { title: 'Cancelled' })
  const rejected = assert.rejects(write, error => error.name === 'AbortError')
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.ok(call.signal instanceof AbortSignal)
    assert.equal(call.signal.aborted, false)
  }
  runtime.reset({ refetch: false })
  for (const call of calls) assert.equal(call.signal.aborted, true)
  await Promise.all([read, rejected])
  assert.equal(tasks.getSnapshot().status, 'idle')
  assert.equal(calls.length, 2)
  assert.equal((await settle(tasks)).length, 2)
})

test('JSON response handling accepts 204 and preserves HTTP status for non-JSON errors', async t => {
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/empty' ? 204 : 503)
    response.end(request.url === '/empty' ? undefined : 'Temporarily unavailable')
  })
  const { runtime } = await fixture(t, server)
  const empty = runtime.subscribe('/empty')
  assert.equal(await settle(empty), null)
  assert.equal(await runtime.command('/empty', {}), null)
  await assert.rejects(runtime.command('/unavailable', {}), { status: 503, message: 'HTTP 503' })
})

async function waitFor(check) {
  const deadline = Date.now() + 3000
  while (!check()) {
    if (Date.now() >= deadline) assert.fail('Timed out waiting for DOM update')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('DOM example renders real reads safely, posts drafts, and cleans up on final pagehide', async t => {
  const { calls, fetchOperation } = await fixture(t)
  const html = await readFile(new URL('../../examples/http/index.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { url: 'http://localhost/' })
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, fetch: fetchOperation })
  t.after(() => {
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide'))
    Object.assign(globalThis, previous)
    dom.window.close()
  })
  await import('../../examples/http/main.js')
  const document = dom.window.document
  const tasks = document.querySelector('#tasks')
  const summary = document.querySelector('#summary')
  const pending = document.querySelector('#pending')
  const error = document.querySelector('#error')
  const input = document.querySelector('#title')
  const form = document.querySelector('#create-task')
  const refresh = document.querySelector('#refresh')
  await waitFor(() => tasks.querySelectorAll('li').length === 2 && summary.textContent === '1 of 2 complete')
  calls.length = 0
  const title = '<img src=x onerror=alert(1)>'
  input.value = title
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  assert.equal(refresh.disabled, true)
  assert.ok(pending.textContent)
  await waitFor(() => tasks.querySelectorAll('li').length === 3 && !pending.textContent)
  assert.equal(input.value, '')
  assert.equal(tasks.querySelector('img'), null)
  assert.ok(tasks.textContent.includes(title))
  assert.equal(summary.textContent, '1 of 3 complete')
  assert.deepEqual(methodsAndUrls(calls), [['POST', '/api/tasks'], ['GET', '/api/tasks'], ['GET', '/api/summary']])

  calls.length = 0
  input.value = 'x'.repeat(201)
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await waitFor(() => error.textContent && !pending.textContent)
  assert.equal(input.value.length, 201)
  assert.deepEqual(methodsAndUrls(calls), [['POST', '/api/tasks']])

  dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }))
  calls.length = 0
  refresh.click()
  await waitFor(() => !pending.textContent)
  assert.deepEqual(methodsAndUrls(calls), [['GET', '/api/tasks'], ['GET', '/api/summary']])
  assert.equal(error.textContent, '')
  dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide'))
  calls.length = 0
  refresh.click()
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [])
})
