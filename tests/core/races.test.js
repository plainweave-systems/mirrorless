import test from 'node:test'
import assert from 'node:assert/strict'
import { createMirrorless } from '../../src/core/index.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
function runtimeFor(t, options = {}) {
  const runtime = createMirrorless({ unsubscribeDelayMs: 0, ...options })
  t.after(() => runtime.dispose())
  return runtime
}

test('in-flight identity is installed before loading listeners can reenter refetch', async (t) => {
  let calls = 0, reentrant
  const runtime = runtimeFor(t, { query: () => ++calls })
  const observer = runtime.observe('Read')
  const stop = observer.subscribe(() => {
    if (observer.getSnapshot().loading) reentrant = observer.refetch()
  })
  await reentrant
  assert.equal(calls, 1)
  assert.equal(observer.getSnapshot().data, 1)
  stop()
})

test('a synchronous dispatcher can subscribe to its own term without duplicating requests', async (t) => {
  let calls = 0, other
  const runtime = runtimeFor(t, { query: () => {
    calls++
    other ??= runtime.subscribe('Read')
    return calls
  } })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  assert.equal(calls, 1)
  assert.equal(subscription.runKey, other.runKey)
})

test('ordinary concurrent refetches dedupe without scheduling an unnecessary second read', async (t) => {
  const pending = deferred()
  let calls = 0
  const runtime = runtimeFor(t, { query: () => { calls++; return pending.promise } })
  const subscription = runtime.subscribe('Read')
  const a = subscription.refetch()
  const b = subscription.refetch()
  assert.equal(a, b)
  pending.resolve(1)
  await Promise.all([a, b])
  assert.equal(calls, 1)
})

test('a command during an in-flight read waits for a post-command follow-up read', async (t) => {
  const first = deferred(), second = deferred()
  let calls = 0
  const runtime = runtimeFor(t, {
    query: () => ++calls === 1 ? first.promise : second.promise,
    command: () => ({ ok: true }), updates: { Save: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  let commandFinished = false
  const command = runtime.command('Save').then(() => { commandFinished = true })
  await flush()
  assert.equal(calls, 1)
  first.resolve('before command')
  await flush()
  assert.equal(calls, 2)
  assert.equal(commandFinished, false)
  assert.equal(subscription.getSnapshot().data, 'before command')
  assert.equal(subscription.getSnapshot().loading, true)
  second.resolve('after command')
  await command
  assert.equal(subscription.getSnapshot().data, 'after command')
  assert.equal(commandFinished, true)
})

test('several invalidations during one read coalesce and a later invalidation is not lost', async (t) => {
  const pending = [deferred(), deferred(), deferred()]
  let calls = 0
  const runtime = runtimeFor(t, {
    query: () => pending[calls++].promise,
    virtualCommands: ['Tick'], updates: { Tick: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  const firstCommands = [runtime.command('Tick'), runtime.command('Tick'), runtime.command('Tick')]
  await flush()
  pending[0].resolve(1)
  await flush()
  assert.equal(calls, 2)
  const duringSecondRead = runtime.command('Tick')
  pending[1].resolve(2)
  await flush()
  assert.equal(calls, 3)
  pending[2].resolve(3)
  await Promise.all([...firstCommands, duringSecondRead])
  assert.equal(calls, 3)
  assert.equal(subscription.getSnapshot().data, 3)
})

test('queued explicit invalidation still executes after the earlier read failed', async (t) => {
  const first = deferred()
  let calls = 0
  const runtime = runtimeFor(t, {
    query: () => ++calls === 1 ? first.promise : 'recovered',
    virtualCommands: ['Tick'], updates: { Tick: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  const command = runtime.command('Tick')
  first.reject(new Error('old read failed'))
  await command
  assert.equal(calls, 2)
  assert.equal(subscription.getSnapshot().data, 'recovered')
  assert.equal(subscription.getSnapshot().error, undefined)
})

test('queued work is abandoned if the last interest disappears before the first result', async (t) => {
  const first = deferred()
  let calls = 0, ingests = 0
  const runtime = runtimeFor(t, {
    query: () => { calls++; return first.promise },
    ingestOperationResult: () => ingests++,
    virtualCommands: ['Tick'], updates: { Tick: ['Read'] },
  })
  const subscription = runtime.subscribe('Read')
  const command = runtime.command('Tick')
  subscription.unsubscribe()
  first.resolve('late')
  await command
  assert.equal(calls, 1)
  assert.equal(ingests, 0)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
})

test('late results after final release cannot populate a new same-term run', async (t) => {
  const oldRead = deferred()
  let calls = 0, oldSignal
  const ingests = []
  const runtime = runtimeFor(t, {
    query: (_name, _params, context) => {
      if (++calls === 1) { oldSignal = context.signal; return oldRead.promise }
      return 'new'
    },
    ingestOperationResult: ({ data }) => ingests.push(data),
  })
  const old = runtime.subscribe('Read')
  const oldRequest = old.refetch()
  old.unsubscribe()
  assert.equal(oldSignal.aborted, true)
  const current = runtime.subscribe('Read')
  await current.refetch()
  assert.notEqual(old.runKey, current.runKey)
  oldRead.resolve('old')
  assert.equal(await oldRequest, undefined)
  assert.equal(current.getSnapshot().data, 'new')
  assert.deepEqual(ingests, ['new'])
})

test('reset preserves active interests, clears data, and starts fresh reads by default', async (t) => {
  const next = deferred()
  let calls = 0
  const runtime = runtimeFor(t, { query: () => ++calls === 1 ? 'old' : next.promise })
  const observer = runtime.observe('Read')
  const stop = observer.subscribe(() => {})
  await observer.refetch()
  runtime.reset()
  assert.equal(observer.getSnapshot().data, undefined)
  assert.equal(observer.getSnapshot().loading, true)
  next.resolve('new')
  await observer.refetch()
  assert.equal(observer.getSnapshot().data, 'new')
  assert.equal(calls, 2)
  stop()
})

test('an old read cannot clear or overwrite a newer in-flight read after reset', async (t) => {
  const oldRead = deferred(), newRead = deferred()
  let calls = 0
  const ingests = []
  const runtime = runtimeFor(t, {
    query: () => ++calls === 1 ? oldRead.promise : newRead.promise,
    ingestOperationResult: ({ data }) => ingests.push(data),
  })
  const subscription = runtime.subscribe('Read')
  const oldPromise = subscription.refetch()
  runtime.reset()
  oldRead.resolve('old session')
  assert.equal(await oldPromise, undefined)
  assert.equal(runtime.inFlight.size, 1)
  assert.equal(subscription.getSnapshot().loading, true)
  newRead.resolve('new session')
  await subscription.refetch()
  assert.equal(subscription.getSnapshot().data, 'new session')
  assert.deepEqual(ingests, ['new session'])
})

test('old command completion after reset does not ingest or invalidate the new session', async (t) => {
  const commandResult = deferred()
  let reads = 0, commandSignal
  const ingests = []
  const runtime = runtimeFor(t, {
    query: () => ++reads,
    command: (_name, _params, context) => { commandSignal = context.signal; return commandResult.promise },
    updates: { Save: ['Read'] },
    ingestOperationResult: (context) => ingests.push(context.kind),
  })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch()
  const command = runtime.command('Save')
  runtime.reset()
  await subscription.refetch()
  assert.equal(commandSignal.aborted, true)
  assert.equal(reads, 2)
  commandResult.resolve({ ok: true })
  await command
  assert.equal(reads, 2)
  assert.deepEqual(ingests, ['query', 'query'])
})

test('reset can clear responses without refetching and explicitly terminate subscriptions', async (t) => {
  let calls = 0, notifications = 0
  const runtime = runtimeFor(t, { query: () => ++calls })
  const observer = runtime.observe('Read', { id: 1 })
  const oldStop = observer.subscribe(() => notifications++)
  await observer.refetch()
  runtime.reset({ refetch: false })
  assert.equal(observer.getSnapshot().status, 'idle')
  assert.equal(calls, 1)
  await observer.refetch()
  assert.equal(calls, 2)
  runtime.reset({ subscriptions: true })
  assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 0)
  assert.equal(observer.getSnapshot().status, 'idle')
  assert.equal(observer.getSnapshot().params.id, 1)
  const before = notifications
  const newStop = observer.subscribe(() => {})
  await observer.refetch()
  oldStop()
  assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 1)
  assert.equal(notifications, before)
  newStop()
})

test('fresh subscriptions created by reset notifications keep their new listeners', async (t) => {
  let calls = 0, replacement, replacementNotifications = 0
  const runtime = runtimeFor(t, { query: () => ++calls })
  const observer = runtime.observe('Read')
  observer.subscribe(() => {
    if (observer.getSnapshot().status === 'idle' && !replacement) {
      replacement = runtime.subscribe('Read', {}, { fetch: false })
      replacement.onChange(() => replacementNotifications++)
    }
  })
  await observer.refetch()
  runtime.reset({ subscriptions: true })
  assert.ok(replacement)
  await replacement.refetch()
  assert.equal(replacementNotifications, 2)
})

test('dispose is terminal before listeners run and ignores old reads/commands', async (t) => {
  const read = deferred(), commandResult = deferred()
  let readSignal, commandSignal, ingests = 0
  const listenerErrors = []
  const runtime = runtimeFor(t, {
    query: (_name, _params, context) => { readSignal = context.signal; return read.promise },
    command: (_name, _params, context) => { commandSignal = context.signal; return commandResult.promise },
    updates: { Save: ['Read'] },
    ingestOperationResult: () => ingests++,
    onListenerError: (error) => listenerErrors.push(error),
  })
  const observer = runtime.observe('Read')
  observer.subscribe(() => {
    if (observer.getSnapshot().status === 'idle') runtime.subscribe('MustNotStart')
  })
  const pendingRead = observer.refetch()
  const pendingCommand = runtime.command('Save')
  runtime.dispose()
  runtime.dispose()
  assert.equal(readSignal.aborted, true)
  assert.equal(commandSignal.aborted, true)
  assert.equal(runtime.disposed, true)
  assert.equal(runtime.getSubscriptionRegistry().runs.size, 0)
  assert.equal(listenerErrors.length, 1)
  assert.throws(() => runtime.subscribe('Read'), /disposed/)
  assert.throws(() => runtime.configure({}), /disposed/)
  await assert.rejects(runtime.command('Save'), /disposed/)
  assert.equal(observer.getSnapshot().status, 'idle')
  read.resolve('old read')
  commandResult.resolve('old command')
  assert.equal(await pendingRead, undefined)
  assert.equal(await pendingCommand, 'old command')
  assert.equal(ingests, 0)
})

for (const shutdown of ['reset', 'dispose']) {
  for (const sameTerm of [false, true]) {
    test(`${shutdown} final notifications respect reentrant cleanup of a ${sameTerm ? 'same-term' : 'different-term'} observer`, (t) => {
      const runtime = runtimeFor(t)
      let stopB, calls = 0
      const stopA = runtime.observe('A', {}, { fetch: false }).subscribe(() => stopB())
      stopB = runtime.observe(sameTerm ? 'A' : 'B', {}, { fetch: false }).subscribe(() => calls++)
      if (shutdown === 'reset') runtime.reset({ subscriptions: true })
      else runtime.dispose()
      assert.equal(calls, 0)
      assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 0)
      stopA()
      stopB()
      assert.equal(runtime.listenersByRunKey.size, 0)
    })
  }
}

test('reset during asynchronous ingestion prevents committing its old selected value', async (t) => {
  const ingestion = deferred()
  let calls = 0
  const runtime = runtimeFor(t, {
    query: () => ++calls,
    ingestOperationResult: ({ data }) => data === 1 ? ingestion.promise : undefined,
  })
  const subscription = runtime.subscribe('Read')
  const oldRead = subscription.refetch()
  await flush()
  runtime.reset()
  await subscription.refetch()
  ingestion.resolve()
  await oldRead
  assert.equal(subscription.getSnapshot().data, 2)
})

test('falsy thrown request values reject the explicit request rather than silently succeeding', async (t) => {
  const runtime = runtimeFor(t, { query: () => { throw 0 } })
  const subscription = runtime.subscribe('Read')
  await subscription.refetch().then(
    () => assert.fail('should reject'),
    (error) => assert.equal(error, 0),
  )
  assert.equal(subscription.getSnapshot().status, 'error')
})
