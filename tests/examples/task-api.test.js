// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { createTaskServer } from '../../examples/servers/node/server.js'
import { createTaskRuntime, startLiveRefresh } from '../../examples/shared/task-api.js'

async function fixture(t) {
  const server = createTaskServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const calls = []
  const runtime = createTaskRuntime({
    baseUrl: `http://127.0.0.1:${server.address().port}/api`,
    unsubscribeDelayMs: 0,
    fetch: (url, options) => {
      calls.push([options?.method ?? 'GET', new URL(url).pathname])
      return fetch(url, options)
    },
  })
  t.after(async () => {
    runtime.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return { runtime, calls }
}

async function settle(subscription) {
  await subscription.refetch()
  return subscription.getSnapshot().data
}

test('shared HTTP helper keeps reads inert until subscribed and delivers independent server representations', async t => {
  const { runtime, calls } = await fixture(t)
  const observer = runtime.observe('GetTasks')
  assert.equal(observer.getSnapshot().status, 'idle')
  assert.equal(calls.length, 0)
  const tasks = runtime.subscribe('GetTasks')
  const summary = runtime.subscribe('GetSummary')
  const rows = await settle(tasks)
  const totals = await settle(summary)
  assert.equal(rows.length, 2)
  assert.deepEqual(totals, { total: 2, done: 1 })
  assert.ok(Object.isFrozen(rows))
  tasks.unsubscribe()
  summary.unsubscribe()
})

test('a write receipt refreshes list, summary and matching detail without client-side entity patches', async t => {
  const { runtime, calls } = await fixture(t)
  const tasks = runtime.subscribe('GetTasks')
  const summary = runtime.subscribe('GetSummary')
  const first = runtime.subscribe('GetTask', { id: '1' })
  const other = runtime.subscribe('GetTask', { id: '2' })
  await Promise.all([settle(tasks), settle(summary), settle(first), settle(other)])
  calls.length = 0
  const receipt = await runtime.command('UpdateTask', { id: '1', done: true })
  assert.deepEqual(receipt, { ok: true })
  assert.equal(first.getSnapshot().data.done, true)
  assert.equal(tasks.getSnapshot().data.find(task => task.id === '1').done, true)
  assert.deepEqual(summary.getSnapshot().data, { total: 2, done: 2 })
  assert.deepEqual(calls.filter(([method]) => method === 'GET').map(([, path]) => path).sort(), [
    '/api/summary', '/api/tasks', '/api/tasks/1',
  ])
  for (const subscription of [tasks, summary, first, other]) subscription.unsubscribe()
})

test('virtual refresh makes no write request, and failed HTTP commands do not refresh reads', async t => {
  const { runtime, calls } = await fixture(t)
  const tasks = runtime.subscribe('GetTasks')
  await settle(tasks)
  calls.length = 0
  await runtime.command('RefreshTasks')
  assert.deepEqual(calls, [['GET', '/api/tasks']])
  calls.length = 0
  await assert.rejects(runtime.command('CreateTask', { title: '' }), error => error.status === 400)
  assert.deepEqual(calls, [['POST', '/api/tasks']])
  tasks.unsubscribe()
})

test('liveness helper emits a virtual command and cleanup stops its timer', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const commands = []
  const stop = startLiveRefresh({ command: async name => { commands.push(name) } }, 100)
  t.mock.timers.tick(100)
  await Promise.resolve()
  assert.deepEqual(commands, ['RefreshTasks'])
  stop()
  t.mock.timers.tick(200)
  await Promise.resolve()
  assert.equal(commands.length, 1)
  assert.throws(() => startLiveRefresh({ command() {} }, 0), RangeError)
})
