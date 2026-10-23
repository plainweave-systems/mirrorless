import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMirrorless, MirrorlessRuntime, MirrorlessCell, ServerStateRuntime, createServerState,
} from '../../src/core/index.js'

const pause = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
function runtimeFor(t, options = {}) {
  const runtime = createMirrorless({ unsubscribeDelayMs: 0, ...options })
  t.after(() => runtime.dispose())
  return runtime
}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('Mirrorless exports the branded runtime and compatibility constructors without a singleton', async () => {
  assert.equal(MirrorlessRuntime, ServerStateRuntime)
  assert.equal(createMirrorless, createServerState)
  const exports = await import('../../src/core/index.js')
  assert.equal('serverState' in exports, false)
  assert.equal('mirrorless' in exports, false)
})

test('observer construction, reading, and inactive refetch are side-effect free', async (t) => {
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ++calls })
  const observer = runtime.observe('Read', { id: 1 })
  const idle = observer.getSnapshot()
  assert.equal(observer.getSnapshot(), idle)
  assert.ok(Object.isFrozen(idle))
  assert.equal(idle.status, 'idle')
  assert.equal(idle.operationName, 'Read')
  assert.equal(idle.params.id, 1)
  assert.equal(await observer.refetch(), undefined)
  assert.equal(calls, 0)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
  assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 0)
  assert.throws(() => observer.subscribe(null), TypeError)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
})

test('value-equal interests share one request and stable snapshot even with inline params', async (t) => {
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ({ calls: ++calls }) })
  const a = runtime.subscribe('Read', { id: 1, scope: { active: true } })
  const b = runtime.subscribe('Read', { scope: { active: true }, id: 1 })
  assert.equal(a.runKey, b.runKey)
  await a.refetch()
  assert.equal(calls, 1)
  const snapshot = a.getSnapshot()
  assert.equal(snapshot, a.getSnapshot())
  assert.equal(snapshot, b.getSnapshot())
  const c = runtime.subscribe('Read', { id: 1, scope: { active: true } })
  assert.equal(c.getSnapshot(), snapshot)
  assert.equal(calls, 1)
})

test('configured equality is used for run identity and symbol-bound update matching', async (t) => {
  const calls = []
  const equal = (a, b) => {
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase()
    return JSON.stringify(a).toLowerCase() === JSON.stringify(b).toLowerCase()
  }
  const runtime = runtimeFor(t, {
    equal,
    query: (_name, params) => { calls.push(params.id); return params.id },
    command: () => true,
    updates: { Save: [['Read', { id: Symbol.for('id') }]] },
  })
  const a = runtime.subscribe('Read', { id: 'ABC' })
  const b = runtime.subscribe('Read', { id: 'abc' })
  await a.refetch()
  assert.equal(a.runKey, b.runKey)
  await runtime.command('Save', { id: 'aBc' })
  assert.deepEqual(calls, ['ABC', 'ABC'])
})

test('params are copied/frozen and caller mutations do not retarget an interest', async (t) => {
  let received
  const runtime = runtimeFor(t, { query: (_name, params) => { received = params; return params } })
  const params = { id: 1, nested: { a: 1 } }
  const subscription = runtime.subscribe('Read', params)
  params.id = 2
  params.nested.a = 2
  await subscription.refetch()
  assert.deepEqual(received, { id: 1, nested: { a: 1 } })
  assert.ok(Object.isFrozen(received.nested))
  assert.equal(Object.isFrozen(params), false)
  assert.throws(() => runtime.subscribe('Read', []), TypeError)
})

test('observer snapshots never expose another operation or parameter term', async (t) => {
  const runtime = runtimeFor(t, { query: (_name, params) => ({ id: params.id }) })
  const a = runtime.subscribe('Read', { id: 'a' })
  await a.refetch()
  const b = runtime.observe('Read', { id: 'b' })
  const other = runtime.observe('Other', { id: 'a' })
  assert.equal(b.getSnapshot().data, undefined)
  assert.equal(b.getSnapshot().params.id, 'b')
  assert.equal(other.getSnapshot().data, undefined)
  const existing = runtime.observe('Read', { id: 'a' })
  assert.equal(existing.getSnapshot(), a.getSnapshot())
  assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 1)
})

test('an observer supports independent listeners, immediate cleanup, and reconnection', async (t) => {
  let calls = 0, first = 0, second = 0
  const runtime = runtimeFor(t, { query: () => ++calls })
  const observer = runtime.observe('Read')
  const stopFirst = observer.subscribe(() => first++)
  const stopSecond = observer.subscribe(() => second++)
  await observer.refetch()
  assert.equal(calls, 1)
  stopFirst()
  const previousFirst = first
  await observer.refetch()
  assert.equal(first, previousFirst)
  assert.ok(second > 0)
  stopSecond()
  stopSecond()
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
  assert.equal(observer.getSnapshot().status, 'idle')
  const stopAgain = observer.subscribe(() => {})
  await observer.refetch()
  assert.equal(calls, 3)
  stopAgain()
})

test('unsubscribe stops owned onChange listeners immediately even while its lease stays active', async (t) => {
  let calls = 0, notifications = 0
  const runtime = runtimeFor(t, {
    query: () => ++calls, virtualCommands: ['Tick'], updates: { Tick: ['Read'] }, unsubscribeDelayMs: 35,
  })
  const subscription = runtime.subscribe('Read')
  subscription.onChange(() => notifications++)
  await subscription.refetch()
  subscription.unsubscribe()
  const before = notifications
  await runtime.command('Tick')
  assert.equal(calls, 2)
  assert.equal(notifications, before)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 1)
  await pause(60)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
  await runtime.command('Tick')
  assert.equal(calls, 2)
})

test('remount before lease expiry reuses an existing response without a fetch', async (t) => {
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ++calls, unsubscribeDelayMs: 30 })
  const first = runtime.subscribe('Read')
  await first.refetch()
  first.unsubscribe()
  const second = runtime.subscribe('Read')
  assert.equal(second.runKey, first.runKey)
  assert.equal(second.getSnapshot().data, 1)
  assert.equal(calls, 1)
  await pause(45)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 1)
  second.unsubscribe()
  await pause(45)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
})

test('fetch:false registers interest without fetching and explicit refetch works', async (t) => {
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ++calls })
  const subscription = runtime.subscribe('Read', {}, { fetch: false })
  assert.equal(subscription.getSnapshot().status, 'idle')
  assert.equal(calls, 0)
  await subscription.refetch()
  assert.equal(subscription.getSnapshot().data, 1)
})

test('undefined is not ready, but null, false, zero, empty string and empty arrays are values', async (t) => {
  for (const value of [undefined, null, false, 0, '', []]) {
    const runtime = runtimeFor(t, { query: () => value })
    const subscription = runtime.subscribe('Read')
    await subscription.refetch()
    assert.equal(subscription.getSnapshot().status, 'success')
    assert.equal(subscription.getSnapshot().ready, value !== undefined)
    assert.equal(subscription.getSnapshot().data, value)
  }
})

test('retained data remains ready during refresh and errors, without automatic retries', async (t) => {
  const pending = deferred()
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ++calls === 1 ? { id: 1 } : pending.promise })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  const data = subscription.getSnapshot().data
  const refresh = subscription.refetch()
  assert.equal(subscription.getSnapshot().status, 'loading')
  assert.equal(subscription.getSnapshot().data, data)
  assert.equal(subscription.getSnapshot().ready, true)
  const error = new Error('unavailable')
  pending.reject(error)
  await assert.rejects(refresh, error)
  assert.equal(subscription.getSnapshot().status, 'error')
  assert.equal(subscription.getSnapshot().data, data)
  assert.equal(subscription.getSnapshot().ready, true)
  assert.equal(subscription.getSnapshot().error, error)
  await pause()
  assert.equal(calls, 2)
})

test('first-read errors are observable and do not automatically retry', async (t) => {
  const error = new Error('failed')
  let calls = 0
  const runtime = runtimeFor(t, { query: () => { calls++; throw error } })
  const subscription = runtime.subscribe('Read')
  await assert.rejects(subscription.refetch(), error)
  assert.equal(subscription.getSnapshot().error, error)
  assert.equal(subscription.getSnapshot().ready, false)
  await pause()
  assert.equal(calls, 1)
})

test('selectors execute once per response, yield frozen values, and do not destabilize snapshots', async (t) => {
  let selections = 0
  const runtime = runtimeFor(t, {
    query: () => ({ payload: { data: [1, 2] } }),
    selectData: (response) => { selections++; return { items: response.payload.data } },
  })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  const before = subscription.getSnapshot()
  assert.equal(subscription.getSnapshot(), before)
  assert.equal(selections, 1)
  assert.ok(Object.isFrozen(before.response.payload))
  assert.ok(Object.isFrozen(before.data))
  assert.ok(Object.isFrozen(before.data.items))
})

test('successful commands refetch only matching active runs, once per run across OR targets', async (t) => {
  const calls = []
  const runtime = runtimeFor(t, {
    query: (name, params) => { calls.push([name, params.id]); return params.id ?? [] },
    command: () => ({ ok: true }),
    updates: { Move: [['Read', { id: Symbol.for('from') }], ['Read', { id: Symbol.for('to') }], 'List'] },
  })
  const a = runtime.subscribe('Read', { id: 1 })
  const b = runtime.subscribe('Read', { id: 2 })
  const c = runtime.subscribe('Read', { id: 3 })
  const list = runtime.subscribe('List')
  await Promise.all([a.refetch(), b.refetch(), c.refetch(), list.refetch()])
  calls.length = 0
  await runtime.command('Move', { from: 1, to: 1 })
  assert.deepEqual(calls, [['Read', 1], ['List', undefined]])
})

test('failed commands do not ingest or refetch and are not retried', async (t) => {
  let reads = 0, commands = 0, ingests = 0
  const runtime = runtimeFor(t, {
    query: () => ++reads,
    command: () => { commands++; throw new Error('denied') },
    ingestOperationResult: () => ingests++, updates: { Save: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  await assert.rejects(runtime.command('Save'), /denied/)
  assert.equal(reads, 1)
  assert.equal(commands, 1)
  assert.equal(ingests, 1)
})

test('commands copy params, pass execution metadata and signals, and can opt out of invalidation', async (t) => {
  let commandContext, commandParams, calls = 0
  const runtime = runtimeFor(t, {
    query: () => ++calls,
    command: (_name, params, context) => { commandContext = context; commandParams = params; return { ok: true } },
    updates: { Save: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  const params = { id: 1 }
  await runtime.command('Save', params, { invalidate: false })
  assert.equal(calls, 1)
  assert.equal(commandContext.kind, 'mutation')
  assert.equal(commandContext.operationName, 'Save')
  assert.equal(commandContext.runtime, runtime)
  assert.ok(commandContext.signal instanceof AbortSignal)
  assert.ok(Object.isFrozen(commandParams))
  assert.equal(Object.isFrozen(params), false)
})

test('virtual commands and per-operation virtual/fake flags bypass network and mutation ingestion', async (t) => {
  let reads = 0, commands = 0, ingests = 0
  const runtime = runtimeFor(t, {
    query: () => ++reads,
    command: () => { commands++; return true },
    ingestOperationResult: () => ingests++,
    virtualCommands: new Set(['Tick']),
    operations: [{ id: 'Focus', virtual: true }, { id: 'OldTick', fake: true }],
    updates: { Tick: ['Read'], Focus: ['Read'], OldTick: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  const response = await runtime.command('Tick')
  await runtime.command('Focus')
  await runtime.mutate('OldTick')
  assert.equal(response.mirrorless.virtualCommand, 'Tick')
  assert.equal(commands, 0)
  assert.equal(reads, 4)
  assert.equal(ingests, 4)
})

test('legacy dispatcher/update/fake options remain compatible', async (t) => {
  const contexts = []
  const runtime = runtimeFor(t, {
    executeOperation: (context) => { contexts.push(context); return context.kind },
    fakeMutationOperations: ['Tick'],
    mutationInvalidatesQueries: { Tick: ['Read'], Save: ['Read'] },
    queryInvalidatedByMutations: { Read: ['Tick', 'Save'] },
  })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  await runtime.mutate('Save')
  await runtime.command('Tick')
  assert.deepEqual(contexts.map((context) => context.kind), ['query', 'mutation', 'query', 'query'])
  assert.deepEqual(runtime.validateInvalidationMaps(), [])
})

test('per-operation selectors and ingestion inherit application-specific context', async (t) => {
  const ingests = []
  class ApplicationRuntime extends MirrorlessRuntime {
    getIngestContext() { return { ...super.getIngestContext(), projection: 'owned by application' } }
  }
  const runtime = new ApplicationRuntime({
    unsubscribeDelayMs: 0,
    query: () => ({ value: 5 }), command: () => ({ value: 9 }),
    ingestContext: { tenant: 'example' },
    operations: [{ id: 'Read', selectData: (response) => response.value, ingest: (context) => ingests.push(context) }],
    ingestOperationResult: (context) => ingests.push(context),
  })
  t.after(() => runtime.dispose())
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  await runtime.command('Save')
  assert.equal(subscription.getSnapshot().data, 5)
  assert.equal(ingests.length, 2)
  assert.equal(ingests[0].data, 5)
  assert.equal(ingests[0].tenant, 'example')
  assert.equal(ingests[0].projection, 'owned by application')
  assert.equal(ingests[1].kind, 'mutation')
})

test('subscription cells track snapshots and stop immediately on unsubscribe', async (t) => {
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ++calls, unsubscribeDelayMs: 30 })
  const cell = runtime.createCell()
  assert.ok(cell instanceof MirrorlessCell)
  const subscription = runtime.subscribeCell(cell, 'Read')
  await subscription.refetch()
  assert.equal(cell.get().data, 1)
  subscription.unsubscribe()
  const last = cell.get()
  await subscription.refetch()
  assert.equal(cell.get(), last)
})

test('listener exceptions are separate from query errors and do not prevent other listeners', async (t) => {
  const errors = []
  const runtime = runtimeFor(t, { query: () => 1, onListenerError: (error) => errors.push(error) })
  const subscription = runtime.subscribe('Read', {}, { fetch: false })
  subscription.onChange(() => { throw new Error('listener bug') })
  let notifications = 0
  subscription.onChange(() => notifications++)
  await subscription.refetch()
  assert.equal(subscription.getSnapshot().status, 'success')
  assert.equal(subscription.getSnapshot().error, undefined)
  assert.equal(notifications, 2)
  assert.equal(errors.length, 2)
})

test('invalid interest delays are rejected before an interest or request is created', (t) => {
  assert.throws(() => createMirrorless({ unsubscribeDelayMs: NaN }), /unsubscribeDelayMs/)
  const runtime = runtimeFor(t)
  assert.throws(() => runtime.subscribe('Read', {}, { unsubscribeDelayMs: NaN }), /unsubscribeDelayMs/)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
})

test('updating forward rules preserves explicitly supplied reverse patterns for auditing', (t) => {
  const runtime = runtimeFor(t, {
    updates: { Save: [['Read', { id: Symbol.for('id') }]] },
    updatedBy: { Read: [['Save', { source: Symbol.for('id') }]] },
  })
  runtime.configure({ updates: { Save: ['Read'] } })
  assert.equal(runtime.rawQueryInvalidatedByMutations().Read[0][1].source, Symbol.for('id'))
})

test('configure preserves predicate rules and reverse term patterns when dispatchers change', async (t) => {
  let reads = 0
  const runtime = runtimeFor(t, {
    query: () => ++reads, command: () => true,
    updates: { Save: { Read: ({ mutationParams }) => mutationParams.refresh } },
    updatedBy: { Read: [['Save', { id: Symbol.for('id') }]] },
  })
  const subscription = runtime.subscribe('Read', { id: 1 })
  await subscription.refetch()
  runtime.configure({ command: () => true })
  await runtime.command('Save', { refresh: false })
  assert.equal(reads, 1)
  runtime.configure({ updatedBy: runtime.rawQueryInvalidatedByMutations() })
  assert.equal(runtime.rawQueryInvalidatedByMutations().Read[0][1].id, Symbol.for('id'))
  await runtime.command('Save', { refresh: true })
  assert.equal(reads, 2)
})
