// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMirrorless } from '../../src/core/index.js'
import { bindQuery } from '../../src/dom/index.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function createManualRuntime({ data, error, status = 'idle' } = {}) {
  const reads = new Map()
  let interests = 0
  let observers = 0
  function observe(id, params = {}) {
    observers += 1
    const copy = Object.freeze(structuredClone(params))
    const key = JSON.stringify([id, copy])
    if (!reads.has(key)) {
      reads.set(key, {
        listeners: new Set(),
        snapshot: Object.freeze({
          id, operationName: id, params: copy, status,
          loading: status === 'loading', ready: data !== undefined,
          data, response: data, error,
        }),
      })
    }
    const read = reads.get(key)
    return {
      getSnapshot: () => read.snapshot,
      subscribe(listener) {
        interests += 1
        read.listeners.add(listener)
        let active = true
        return () => {
          if (!active) return
          active = false
          interests -= 1
          read.listeners.delete(listener)
        }
      },
      refetch: async () => read.snapshot.response,
    }
  }
  return {
    observe,
    get interests() { return interests },
    get observers() { return observers },
    publish(id, params, patch) {
      const read = reads.get(JSON.stringify([id, params]))
      read.snapshot = Object.freeze({ ...read.snapshot, ...patch })
      for (const listener of [...read.listeners]) listener()
    },
  }
}

test('initial loading is separate and successful renderer receives the plain frozen value', async () => {
  const pending = deferred()
  const runtime = createMirrorless({ query: () => pending.promise, unsubscribeDelayMs: 0 })
  const loading = [], received = []
  const binding = bindQuery({ runtime, id: 'Read', render: (data) => received.push(data), loading: (query) => loading.push(query) })
  try {
    assert.equal(received.length, 0)
    assert.ok(loading.length > 0)
    assert.equal(loading.at(-1).data, undefined)
    const response = { title: 'From the server', nested: { count: 1 } }
    pending.resolve(response)
    await settle()
    assert.equal(received.at(-1), response)
    assert.ok(Object.isFrozen(response))
    assert.ok(Object.isFrozen(response.nested))
    assert.equal(binding.data, response)
    assert.equal(binding.snapshot.data, response)
  } finally {
    binding.dispose()
    runtime.dispose()
  }
})

test('null, false, zero, empty text, and empty lists are successful data', async (t) => {
  for (const value of [null, false, 0, '', []]) {
    await t.test(JSON.stringify(value), async () => {
      const runtime = createMirrorless({ query: async () => value, unsubscribeDelayMs: 0 })
      const received = []
      const binding = bindQuery({ runtime, id: 'Read', render: (data) => received.push(data) })
      try {
        await settle()
        assert.equal(received.at(-1), value)
      } finally {
        binding.dispose()
        runtime.dispose()
      }
    })
  }
})

test('value-equal params do not recreate observers or redeliver unchanged data', () => {
  const runtime = createManualRuntime({ data: 'value', status: 'success' })
  const received = []
  const params = { nested: { a: 1, b: 2 } }
  const binding = bindQuery({ runtime, id: 'Read', params, render: (data) => received.push(data) })
  binding.setQuery('Read', { nested: { b: 2, a: 1 } })
  assert.equal(runtime.observers, 1)
  assert.equal(runtime.interests, 1)
  assert.deepEqual(received, ['value'])
  binding.dispose()
  assert.equal(runtime.interests, 0)
})

test('JSON-normalized optional undefined params reuse the DOM run with an immediate lease', async () => {
  let reads = 0
  const runtime = createMirrorless({ query: async () => ++reads, unsubscribeDelayMs: 0 })
  const binding = bindQuery({ runtime, id: 'Read', params: { filter: undefined }, render() {} })
  try {
    await settle()
    const runKey = binding.snapshot.runKey
    binding.setQuery('Read', { filter: undefined })
    binding.setQuery('Read', {})
    await settle()
    assert.equal(binding.snapshot.runKey, runKey)
    assert.equal(reads, 1)
    assert.deepEqual(binding.snapshot.params, {})
  } finally {
    binding.dispose()
    runtime.dispose()
  }
})

test('DOM setQuery honors the runtime configured parameter equality', async () => {
  let reads = 0
  const runtime = createMirrorless({
    query: async () => ++reads,
    equal: (left, right) => left?.filter?.toLowerCase() === right?.filter?.toLowerCase(),
    unsubscribeDelayMs: 0,
  })
  const binding = bindQuery({ runtime, id: 'Read', params: { filter: 'ALL' }, render() {} })
  try {
    await settle()
    const runKey = binding.snapshot.runKey
    binding.setQuery('Read', { filter: 'all', omitted: undefined })
    await settle()
    assert.equal(binding.snapshot.runKey, runKey)
    assert.equal(reads, 1)
  } finally {
    binding.dispose()
    runtime.dispose()
  }
})

test('switching to another term exposes its loading state immediately, never the old data', async () => {
  const first = deferred(), second = deferred()
  const runtime = createMirrorless({
    query: (_name, params) => params.id === 1 ? first.promise : second.promise,
    unsubscribeDelayMs: 0,
  })
  const received = []
  const binding = bindQuery({ runtime, id: 'Read', params: { id: 1 }, render: (data) => received.push(data) })
  try {
    first.resolve({ id: 1 })
    await settle()
    assert.equal(binding.data.id, 1)
    binding.setQuery('Read', { id: 2 })
    assert.equal(binding.data, undefined)
    assert.equal(binding.snapshot.params.id, 2)
    second.resolve({ id: 2 })
    await settle()
    assert.deepEqual(received.map((value) => value.id), [1, 2])
  } finally {
    binding.dispose()
    runtime.dispose()
  }
})

test('late old-term responses and disposed bindings do not render', async () => {
  const first = deferred(), second = deferred()
  const runtime = createMirrorless({
    query: (_name, params) => params.id === 1 ? first.promise : second.promise,
    unsubscribeDelayMs: 0,
  })
  const received = []
  const binding = bindQuery({ runtime, id: 'Read', params: { id: 1 }, render: (data) => received.push(data) })
  binding.setQuery('Read', { id: 2 })
  first.resolve({ id: 1 })
  await settle()
  assert.deepEqual(received, [])
  binding.dispose()
  binding.dispose()
  second.resolve({ id: 2 })
  await settle()
  assert.deepEqual(received, [])
  assert.throws(() => binding.setQuery('Read'), /disposed/)
  await assert.rejects(binding.refetch(), /disposed/)
  runtime.dispose()
})

test('background refresh failures retain data instead of invoking the initial-error renderer', async () => {
  const failure = new Error('Temporarily unavailable')
  let attempts = 0
  const runtime = createMirrorless({
    query: async () => { if (attempts++ === 0) return { value: 1 }; throw failure },
    unsubscribeDelayMs: 0,
  })
  const received = [], errors = []
  const binding = bindQuery({ runtime, id: 'Read', render: (data) => received.push(data), error: (query) => errors.push(query.error) })
  try {
    await settle()
    await assert.rejects(binding.refetch(), /Temporarily unavailable/)
    assert.equal(binding.data.value, 1)
    assert.equal(received.at(-1).value, 1)
    assert.deepEqual(errors, [])
    assert.equal(binding.snapshot.error, failure)
  } finally {
    binding.dispose()
    runtime.dispose()
  }
})

test('first-read error renderer receives a snapshot and explicit retry can recover', async () => {
  const failure = new Error('No connection')
  let attempts = 0
  const runtime = createMirrorless({
    query: async () => { if (attempts++ === 0) throw failure; return 'recovered' },
    unsubscribeDelayMs: 0,
  })
  const errors = [], received = []
  const binding = bindQuery({ runtime, id: 'Read', render: (data) => received.push(data), error: (query) => errors.push(query.error) })
  try {
    await settle()
    assert.deepEqual(errors, [failure])
    assert.deepEqual(received, [])
    await binding.refetch()
    assert.equal(received.at(-1), 'recovered')
  } finally {
    binding.dispose()
    runtime.dispose()
  }
})

test('first-read failures dispatch to the error callback for every falsy rejection reason', async (t) => {
  for (const reason of [undefined, null, false, 0, '']) {
    await t.test(String(reason), async () => {
      const runtime = createMirrorless({ query: async () => { throw reason }, unsubscribeDelayMs: 0 })
      const errors = [], loading = [], rendered = []
      const binding = bindQuery({
        runtime, id: 'Read',
        render: (data) => rendered.push(data),
        loading: (snapshot) => loading.push(snapshot.status),
        error: (snapshot) => errors.push(snapshot),
      })
      try {
        await settle()
        assert.equal(binding.snapshot.status, 'error')
        assert.equal(errors.length, 1)
        assert.equal(errors[0].status, 'error')
        assert.equal(errors[0].error, reason)
        assert.deepEqual(rendered, [])
        assert.ok(!loading.includes('error'))
      } finally {
        binding.dispose()
        runtime.dispose()
      }
    })
  }
})

test('first-read failures without a callback globally report every falsy rejection reason', async (t) => {
  for (const reason of [undefined, null, false, 0, '']) {
    await t.test(String(reason), async () => {
      const previousReportError = globalThis.reportError
      const reports = [], loading = []
      globalThis.reportError = (failure) => reports.push(failure)
      const runtime = createMirrorless({ query: async () => { throw reason }, unsubscribeDelayMs: 0 })
      const binding = bindQuery({ runtime, id: 'Read', render() {}, loading: (snapshot) => loading.push(snapshot.status) })
      try {
        await settle()
        assert.equal(binding.snapshot.status, 'error')
        assert.deepEqual(reports, [reason])
        assert.ok(!loading.includes('error'))
      } finally {
        binding.dispose()
        runtime.dispose()
        if (previousReportError === undefined) delete globalThis.reportError
        else globalThis.reportError = previousReportError
      }
    })
  }
})

test('an already-failed initial snapshot without a handler throws and releases its interest', () => {
  const failure = new Error('Initial failure')
  const runtime = createManualRuntime({ error: failure, status: 'error' })
  assert.throws(() => bindQuery({ runtime, id: 'Read', render() {} }), failure)
  assert.equal(runtime.interests, 0)
})

test('asynchronous initial errors without a handler are reported outside the dispatcher', () => {
  const previousReportError = globalThis.reportError
  const reports = []
  globalThis.reportError = (failure) => reports.push(failure)
  const runtime = createManualRuntime()
  const binding = bindQuery({ runtime, id: 'Read', render() {} })
  const failure = new Error('Async failure')
  try {
    runtime.publish('Read', {}, { error: failure, status: 'error' })
    assert.deepEqual(reports, [failure])
    assert.equal(runtime.interests, 1)
  } finally {
    binding.dispose()
    if (previousReportError === undefined) delete globalThis.reportError
    else globalThis.reportError = previousReportError
  }
})

test('renderer exceptions do not become query errors or detach a reentrantly changed term', () => {
  const previousReportError = globalThis.reportError
  const reports = []
  globalThis.reportError = (failure) => reports.push(failure)
  const runtime = createManualRuntime()
  const failure = new Error('Renderer failed')
  let binding
  const received = []
  binding = bindQuery({
    runtime, id: 'Read', params: { id: 1 },
    render(data) {
      received.push(data)
      if (data === 'first') {
        binding.setQuery('Read', { id: 2 })
        throw failure
      }
    },
  })
  try {
    runtime.publish('Read', { id: 1 }, { data: 'first', status: 'success' })
    runtime.publish('Read', { id: 2 }, { data: 'second', status: 'success' })
    assert.deepEqual(received, ['first', 'second'])
    assert.deepEqual(reports, [failure])
    assert.equal(runtime.interests, 1)
    assert.equal(binding.snapshot.params.id, 2)
  } finally {
    binding.dispose()
    if (previousReportError === undefined) delete globalThis.reportError
    else globalThis.reportError = previousReportError
  }
})

test('callback validation fails before declaring interest', () => {
  const runtime = createManualRuntime()
  assert.throws(() => bindQuery({ runtime, id: 'Read' }), /render/)
  assert.throws(() => bindQuery({ runtime, id: 'Read', render() {}, loading: true }), /loading/)
  assert.throws(() => bindQuery({ runtime, id: 'Read', render() {}, error: true }), /error/)
  assert.equal(runtime.interests, 0)
})
