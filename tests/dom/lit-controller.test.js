// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMirrorless } from '../../src/core/index.js'
import { MirrorlessController } from '../../src/lit/index.js'

function createHost() {
  const controllers = new Set()
  return {
    controllers,
    updates: 0,
    addController(controller) { controllers.add(controller) },
    removeController(controller) { controllers.delete(controller) },
    requestUpdate() { this.updates += 1 },
    connect() { for (const controller of controllers) controller.hostConnected() },
    disconnect() { for (const controller of controllers) controller.hostDisconnected() },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

test('Lit controller construction and detached refetch create no read interest', async () => {
  let reads = 0
  const runtime = createMirrorless({ query: async () => { reads += 1; return 42 }, unsubscribeDelayMs: 0 })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read' })
  assert.equal(reads, 0)
  assert.equal(query.data, undefined)
  assert.equal(query.snapshot.status, 'idle')
  await query.refetch()
  assert.equal(reads, 0)
  host.connect()
  await settle()
  assert.equal(reads, 1)
  assert.equal(query.data, 42)
  assert.ok(host.updates > 0)
  query.dispose()
  runtime.dispose()
})

test('value-equal params do not replace a Lit observer', async () => {
  let observed = 0
  const runtime = createMirrorless({ query: async () => 'value', unsubscribeDelayMs: 0 })
  const originalObserve = runtime.observe.bind(runtime)
  runtime.observe = (...args) => { observed += 1; return originalObserve(...args) }
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read', params: { nested: { a: 1, b: 2 } } })
  host.connect()
  await settle()
  query.setQuery('Read', { nested: { b: 2, a: 1 } })
  assert.equal(observed, 1)
  query.dispose()
  runtime.dispose()
})

test('JSON-normalized optional undefined params reuse the Lit run with an immediate lease', async () => {
  let reads = 0
  const runtime = createMirrorless({ query: async () => ++reads, unsubscribeDelayMs: 0 })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read', params: { filter: undefined } })
  try {
    host.connect()
    await settle()
    const runKey = query.snapshot.runKey
    query.setQuery('Read', { filter: undefined })
    query.setQuery('Read', {})
    await settle()
    assert.equal(query.snapshot.runKey, runKey)
    assert.equal(reads, 1)
    assert.deepEqual(query.snapshot.params, {})
  } finally {
    query.dispose()
    runtime.dispose()
  }
})

test('Lit setQuery honors the runtime configured parameter equality', async () => {
  let reads = 0
  const runtime = createMirrorless({
    query: async () => ++reads,
    equal: (left, right) => left?.filter?.toLowerCase() === right?.filter?.toLowerCase(),
    unsubscribeDelayMs: 0,
  })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read', params: { filter: 'ALL' } })
  try {
    host.connect()
    await settle()
    const runKey = query.snapshot.runKey
    query.setQuery('Read', { filter: 'all', omitted: undefined })
    await settle()
    assert.equal(query.snapshot.runKey, runKey)
    assert.equal(reads, 1)
  } finally {
    query.dispose()
    runtime.dispose()
  }
})

test('term changes immediately replace data and late old reads do not update the host', async () => {
  const one = deferred(), two = deferred()
  const runtime = createMirrorless({
    query: (_name, params) => params.id === 1 ? one.promise : two.promise,
    unsubscribeDelayMs: 0,
  })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read', params: { id: 1 } })
  host.connect()
  query.setQuery('Read', { id: 2 })
  assert.equal(query.snapshot.params.id, 2)
  assert.equal(query.data, undefined)
  const updates = host.updates
  one.resolve({ id: 1 })
  await settle()
  assert.equal(host.updates, updates)
  two.resolve({ id: 2 })
  await settle()
  assert.equal(query.data.id, 2)
  assert.ok(host.updates > updates)
  query.dispose()
  runtime.dispose()
})

test('disconnect immediately stops updates and reconnect reuses a retained result', async () => {
  let current = 'first', reads = 0
  const runtime = createMirrorless({
    query: async () => { reads += 1; return current },
    virtualCommands: ['Refresh'], updates: { Refresh: ['Read'] },
    unsubscribeDelayMs: 1000,
  })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read' })
  try {
    host.connect()
    await settle()
    assert.equal(query.data, 'first')
    host.disconnect()
    const updates = host.updates
    current = 'second'
    await runtime.command('Refresh')
    assert.equal(reads, 2)
    assert.equal(host.updates, updates)
    assert.equal(query.data, 'first')
    host.connect()
    await settle()
    assert.equal(query.data, 'second')
    assert.equal(reads, 2)
  } finally {
    query.dispose()
    runtime.dispose()
  }
})

test('setQuery while disconnected starts no read and new term activates on reconnect', async () => {
  const requested = []
  const runtime = createMirrorless({
    query: async (_name, params) => { requested.push(params.id); return { id: params.id } },
    unsubscribeDelayMs: 0,
  })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read', params: { id: 1 } })
  host.connect()
  await settle()
  host.disconnect()
  const updates = host.updates
  query.setQuery('Read', { id: 2 })
  assert.equal(query.data, undefined)
  assert.equal(host.updates, updates)
  assert.deepEqual(requested, [1])
  host.connect()
  await settle()
  assert.deepEqual(requested, [1, 2])
  assert.equal(query.data.id, 2)
  query.dispose()
  runtime.dispose()
})

test('background errors remain inspectable without discarding confirmed data', async () => {
  let attempts = 0
  const failure = new Error('Read failed')
  const runtime = createMirrorless({
    query: async () => { if (attempts++ === 0) return false; throw failure },
    unsubscribeDelayMs: 0,
  })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read' })
  host.connect()
  await settle()
  assert.equal(query.data, false)
  await assert.rejects(query.refetch(), failure)
  assert.equal(query.data, false)
  assert.equal(query.error, failure)
  assert.equal(query.snapshot.error, failure)
  query.dispose()
  runtime.dispose()
})

test('dispose is terminal, removes the controller, and is idempotent', async () => {
  const pending = deferred()
  const runtime = createMirrorless({ query: () => pending.promise, unsubscribeDelayMs: 0 })
  const host = createHost()
  const query = new MirrorlessController(host, { runtime, id: 'Read' })
  host.connect()
  query.dispose()
  query.dispose()
  assert.equal(host.controllers.size, 0)
  const updates = host.updates
  pending.resolve('too late')
  await settle()
  assert.equal(host.updates, updates)
  query.hostConnected()
  assert.equal(host.updates, updates)
  assert.throws(() => query.setQuery('Other'), /disposed/)
  await assert.rejects(query.refetch(), /disposed/)
  runtime.dispose()
})
