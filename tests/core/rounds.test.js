import test from 'node:test'
import assert from 'node:assert/strict'
import { createMirrorless } from '../../src/core/index.js'

const flush = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(t) {
  const reads = []
  let active = 0, maximumActive = 0
  const runtime = createMirrorless({
    unsubscribeDelayMs: 0,
    query: (_name, _params, { signal }) => {
      const read = { ...deferred(), signal }
      reads.push(read)
      active++
      maximumActive = Math.max(maximumActive, active)
      return read.promise.finally(() => active--)
    },
    command: () => ({ ok: true }),
    virtualCommands: ['Pulse'],
    updates: { Pulse: ['Read'], Save: ['Read'] },
  })
  t.after(() => {
    runtime.dispose()
    for (const read of reads) read.resolve(undefined)
  })
  return { runtime, reads, maximumActive: () => maximumActive, active: () => active }
}

test('an earlier pulse completes after its required round despite a later queued round', async (t) => {
  const { runtime, reads, maximumActive } = setup(t)
  runtime.subscribe('Read')
  let completed = 0
  const first = runtime.command('Pulse').then(() => completed++)
  reads[0].resolve(1)
  await flush()
  assert.equal(reads.length, 2)
  const second = runtime.command('Pulse').then(() => completed++)
  reads[1].resolve(2)
  await flush()
  assert.equal(reads.length, 3)
  assert.equal(completed, 1)
  assert.equal(runtime._commandControllers.size, 1)
  assert.equal(maximumActive(), 1)
  reads[2].resolve(3)
  await Promise.all([first, second])
  assert.equal(completed, 2)
  assert.equal(runtime._commandControllers.size, 0)
})

test('sustained pulses coalesce per round and do not retain completed command controllers', async (t) => {
  const { runtime, reads, maximumActive } = setup(t)
  runtime.subscribe('Read')
  let completed = 0
  const commands = []
  const pulsePair = () => {
    commands.push(runtime.command('Pulse').then(() => completed++))
    commands.push(runtime.command('Pulse').then(() => completed++))
  }
  pulsePair()
  reads[0].resolve(1)
  await flush()
  for (let round = 1; round <= 8; round++) {
    pulsePair()
    assert.equal(runtime._commandControllers.size, 4)
    reads[round].resolve(round + 1)
    await flush()
    assert.equal(reads.length, round + 2)
    assert.equal(completed, round * 2)
    assert.equal(runtime._commandControllers.size, 2)
    assert.equal(maximumActive(), 1)
  }
  reads[9].resolve(10)
  await Promise.all(commands)
  assert.equal(completed, 18)
  assert.equal(runtime._commandControllers.size, 0)
  assert.equal(runtime.inFlight.size, 0)
})

test('a successful real write is not kept pending by later virtual pulses', async (t) => {
  const { runtime, reads } = setup(t)
  runtime.subscribe('Read')
  let writeFinished = false
  const write = runtime.command('Save').then(() => { writeFinished = true })
  await flush()
  reads[0].resolve(1)
  await flush()
  const pulse = runtime.command('Pulse')
  reads[1].resolve(2)
  await flush()
  assert.equal(writeFinished, true)
  assert.equal(reads.length, 3)
  assert.equal(runtime._commandControllers.size, 1)
  reads[2].resolve(3)
  await Promise.all([write, pulse])
})

test('ordinary refetch joins its current round rather than unrelated future invalidations', async (t) => {
  const { runtime, reads } = setup(t)
  const subscription = runtime.subscribe('Read')
  let received
  const current = subscription.refetch().then((value) => { received = value })
  const pulse = runtime.command('Pulse')
  reads[0].resolve('current')
  await flush()
  assert.equal(received, 'current')
  assert.equal(reads.length, 2)
  reads[1].resolve('next')
  await Promise.all([current, pulse])
})

test('a failed required round releases its commands even when a newer round continues', async (t) => {
  const { runtime, reads } = setup(t)
  const subscription = runtime.subscribe('Read')
  let firstFinished = false
  const first = runtime.command('Pulse').then(() => { firstFinished = true })
  reads[0].resolve(1)
  await flush()
  const failure = new Error('second round unavailable')
  const readFailure = assert.rejects(subscription.refetch(), failure)
  const second = runtime.command('Pulse')
  reads[1].reject(failure)
  await flush()
  assert.equal(firstFinished, true)
  assert.equal(runtime._commandControllers.size, 1)
  assert.equal(reads.length, 3)
  assert.equal(subscription.getSnapshot().loading, true)
  assert.equal(subscription.getSnapshot().data, 1)
  reads[2].resolve(3)
  await Promise.all([first, second, readFailure])
  assert.equal(subscription.getSnapshot().data, 3)
})

test('a failed final queued round settles without an automatic retry or retained commands', async (t) => {
  const { runtime, reads } = setup(t)
  const subscription = runtime.subscribe('Read')
  const command = runtime.command('Pulse')
  reads[0].resolve(1)
  await flush()
  const failure = new Error('refresh unavailable')
  reads[1].reject(failure)
  await command
  assert.equal(subscription.getSnapshot().error, failure)
  assert.equal(subscription.getSnapshot().data, 1)
  assert.equal(reads.length, 2)
  assert.equal(runtime.inFlight.size, 0)
  assert.equal(runtime._commandControllers.size, 0)
})

for (const action of ['release', 'reset', 'drop', 'dispose']) {
  test(`${action} settles active and queued round tickets without waiting for an ignored abort signal`, async (t) => {
    const { runtime, reads } = setup(t)
    const subscription = runtime.subscribe('Read')
    let currentFinished = false, commandFinished = false
    const current = subscription.refetch().then(() => { currentFinished = true })
    const command = runtime.command('Pulse').then(() => { commandFinished = true })
    if (action === 'release') subscription.unsubscribe()
    else if (action === 'reset') runtime.reset()
    else if (action === 'drop') runtime.reset({ subscriptions: true })
    else runtime.dispose()
    await flush()
    assert.equal(currentFinished, true)
    assert.equal(commandFinished, true)
    assert.equal(reads[0].signal.aborted, true)
    assert.equal(runtime._commandControllers.size, 0)
    assert.equal(runtime.inFlight.size, action === 'reset' ? 1 : 0)
    if (action === 'reset') {
      assert.equal(reads.length, 2)
      reads[1].resolve('new session')
      await subscription.refetch()
    }
    reads[0].resolve('old session')
    await Promise.all([current, command])
    assert.equal(subscription.getSnapshot().data, action === 'reset' ? 'new session' : undefined)
  })
}

test('reset abort callbacks can start one fresh read without reusing or erasing old round tickets', async (t) => {
  const { runtime, reads } = setup(t)
  const subscription = runtime.subscribe('Read')
  const pulse = runtime.command('Pulse')
  let fresh, dataAtAbort
  reads[0].signal.addEventListener('abort', () => {
    dataAtAbort = subscription.getSnapshot().data
    fresh = subscription.refetch()
  })
  runtime.reset()
  await flush()
  assert.equal(dataAtAbort, undefined)
  assert.equal(reads.length, 2)
  assert.equal(runtime.inFlight.size, 1)
  assert.equal(runtime._commandControllers.size, 0)
  reads[1].resolve('fresh generation')
  assert.equal(await fresh, 'fresh generation')
  reads[0].resolve('ignored old generation')
  await pulse
  assert.equal(subscription.getSnapshot().data, 'fresh generation')
  assert.equal(runtime.inFlight.size, 0)
})

for (const name of ['Read', 'Other']) {
  test(`destructive reset tracks an abort-created ${name} interest and disposal cancels it`, async (t) => {
    const { runtime, reads } = setup(t)
    runtime.subscribe('Read')
    let fresh
    reads[0].signal.addEventListener('abort', () => { fresh = runtime.subscribe(name) })
    runtime.reset({ subscriptions: true, refetch: false })
    assert.equal(reads.length, 2)
    assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 1)
    assert.equal(runtime.getSubscriptionRegistry().runs.size, 1)
    assert.equal(runtime.inFlight.size, 1)
    assert.equal(reads[1].signal.aborted, false)
    let finished = false
    const ticket = fresh.refetch().then(() => { finished = true })
    runtime.dispose()
    await flush()
    assert.equal(reads[1].signal.aborted, true)
    assert.equal(runtime.inFlight.size, 0)
    assert.equal(finished, true)
    await ticket
  })
}

test('destructive reset preserves abort-created current/queued tickets and disposal settles both', async (t) => {
  const { runtime, reads } = setup(t)
  runtime.subscribe('Read')
  const oldPulse = runtime.command('Pulse')
  let freshRead, freshPulse, freshReadFinished = false, freshPulseFinished = false
  reads[0].signal.addEventListener('abort', () => {
    const fresh = runtime.subscribe('Read')
    freshRead = fresh.refetch().then(() => { freshReadFinished = true })
    freshPulse = runtime.command('Pulse').then(() => { freshPulseFinished = true })
  })
  runtime.reset({ subscriptions: true, refetch: false })
  await flush()
  await oldPulse
  assert.equal(runtime.getSubscriptionRegistry().subscribers.size, 1)
  assert.equal(runtime.inFlight.size, 1)
  assert.equal(runtime._commandControllers.size, 1)
  assert.equal(freshReadFinished, false)
  assert.equal(freshPulseFinished, false)
  runtime.dispose()
  await flush()
  assert.equal(reads[1].signal.aborted, true)
  assert.equal(runtime.inFlight.size, 0)
  assert.equal(runtime._commandControllers.size, 0)
  assert.equal(freshReadFinished, true)
  assert.equal(freshPulseFinished, true)
  await Promise.all([freshRead, freshPulse])
})

for (const action of ['reset', 'dispose']) {
  test(`${action} releases callers of a running queued round and its following queued round`, async (t) => {
    const { runtime, reads } = setup(t)
    runtime.subscribe('Read')
    let completed = 0
    const first = runtime.command('Pulse').then(() => completed++)
    reads[0].resolve(1)
    await flush()
    const second = runtime.command('Pulse').then(() => completed++)
    if (action === 'reset') runtime.reset({ refetch: false })
    else runtime.dispose()
    await flush()
    assert.equal(completed, 2)
    assert.equal(runtime._commandControllers.size, 0)
    assert.equal(runtime.inFlight.size, 0)
    assert.equal(reads[1].signal.aborted, true)
    reads[1].resolve('late')
    await Promise.all([first, second])
  })
}

test('reentrant loading invalidations queue bounded rounds without duplicate active reads', async (t) => {
  const { runtime, reads, maximumActive } = setup(t)
  const subscription = runtime.subscribe('Read', {}, { fetch: false })
  const commands = []
  let requested = 0, completed = 0
  subscription.onChange(() => {
    if (subscription.getSnapshot().loading && requested < 3) {
      requested++
      commands.push(runtime.command('Pulse').then(() => completed++))
    }
  })
  const initial = subscription.refetch()
  for (let round = 0; round < 4; round++) {
    assert.equal(reads.length, round + 1)
    reads[round].resolve(round + 1)
    await flush()
    assert.equal(completed, Math.min(round, 3))
    assert.equal(maximumActive(), 1)
  }
  await Promise.all([initial, ...commands])
  assert.equal(completed, 3)
  assert.equal(runtime.inFlight.size, 0)
  assert.equal(runtime._commandControllers.size, 0)
})
