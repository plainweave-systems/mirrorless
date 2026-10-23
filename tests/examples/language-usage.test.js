// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createTaskServer, INITIAL_TASKS } from '../../examples/servers/node/server.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const languages = {
  TypeScript: ['examples/typescript/main.ts'],
  ClojureScript: ['node_modules/nbb/cli.js', 'examples/clojurescript/main.cljs'],
}

function launch(args, baseUrl) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, TASK_API_URL: baseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = { stdout: '', stderr: '' }
  child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.on('data', (chunk) => { output.stderr += chunk })
  const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
  const finished = once(child, 'close').then(([code, signal]) => {
    clearTimeout(timer)
    return { ...output, code, signal }
  })
  return { child, output, finished }
}

async function fixture(t) {
  const server = createTaskServer()
  const requests = []
  server.prependListener('request', (req) => requests.push(`${req.method} ${req.url}`))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`
  return { requests, baseUrl }
}

function records(output, label) {
  return output.split('\n').filter((line) => line.startsWith(`${label}: `))
    .map((line) => JSON.parse(line.slice(label.length + 2)))
}

async function until(predicate, description) {
  const deadline = Date.now() + 10_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${description}`)
    await delay(25)
  }
}

test('TypeScript example passes strict no-emit typechecking', async () => {
  const result = await launch(['node_modules/typescript/bin/tsc', '-p', 'examples/typescript/tsconfig.json'], '').finished
  assert.equal(result.code, 0, result.stdout + result.stderr)
  assert.equal(result.signal, null)
})

for (const [language, executable] of Object.entries(languages)) {
  test(`${language}: default is read-only, independently subscribed tasks and summary`, async (t) => {
    const { requests, baseUrl } = await fixture(t)
    const result = await launch(executable, baseUrl).finished
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    assert.deepEqual(records(result.stdout, 'Tasks').at(-1), INITIAL_TASKS)
    assert.deepEqual(records(result.stdout, 'Summary').at(-1), { total: 2, done: 1 })
    assert.deepEqual(requests.sort(), ['GET /api/summary', 'GET /api/tasks'])
    assert.match(result.stdout, /GetTasks: loading/)
    assert.match(result.stdout, /GetSummary: loading/)
  })

  test(`${language}: empty lists are successful plain data`, async (t) => {
    const { baseUrl } = await fixture(t)
    for (const task of INITIAL_TASKS) {
      const response = await fetch(`${baseUrl}/tasks/${task.id}`, { method: 'DELETE' })
      assert.equal(response.status, 200)
    }
    const result = await launch(executable, baseUrl).finished
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(records(result.stdout, 'Tasks').at(-1), [])
    assert.deepEqual(records(result.stdout, 'Summary').at(-1), { total: 0, done: 0 })
  })

  test(`${language}: receipts refresh subscribed reads; detail updates bind id by value`, async (t) => {
    const { requests, baseUrl } = await fixture(t)
    const result = await launch([...executable, '--select', '1', '--add', 'Language demo', '--complete-created'], baseUrl).finished
    assert.equal(result.code, 0, result.stderr)
    assert.deepEqual(records(result.stdout, 'CreateTask receipt'), [{ id: '3' }])
    assert.deepEqual(records(result.stdout, 'UpdateTask receipt'), [{ ok: true }])
    assert.ok(records(result.stdout, 'Tasks').some((tasks) => tasks.some((task) => task.id === '3' && task.done === false)), 'CreateTask alone refreshed the list')
    assert.ok(records(result.stdout, 'Summary').some((summary) => summary.total === 3 && summary.done === 1), 'CreateTask alone refreshed the independent summary')
    assert.deepEqual(records(result.stdout, 'Tasks').at(-1), [...INITIAL_TASKS, { id: '3', title: 'Language demo', done: true }])
    assert.deepEqual(records(result.stdout, 'Summary').at(-1), { total: 3, done: 2 })
    assert.deepEqual(records(result.stdout, 'Selected task').at(-1), { id: '3', title: 'Language demo', done: true })
    const count = (request) => requests.filter((entry) => entry === request).length
    assert.equal(count('POST /api/tasks'), 1)
    assert.equal(count('PATCH /api/tasks/3'), 1)
    assert.equal(count('GET /api/tasks'), 3)
    assert.equal(count('GET /api/summary'), 3)
    assert.equal(count('GET /api/tasks/3'), 2)
    assert.equal(count('GET /api/tasks/1'), 1, 'unrelated subscribed detail must not refresh')
    assert.match(result.stdout, /Command pending: true/)
    assert.match(result.stdout, /Command pending: false/)
  })

  test(`${language}: rejected command reports failure without refreshing reads`, async (t) => {
    const { requests, baseUrl } = await fixture(t)
    const result = await launch([...executable, '--add', '   '], baseUrl).finished
    assert.equal(result.code, 1)
    assert.match(result.stderr, /title must be a string/)
    assert.match(result.stdout, /Command pending: false/)
    assert.deepEqual(requests.filter((entry) => entry.startsWith('GET ')).sort(), ['GET /api/summary', 'GET /api/tasks'])
    assert.equal(requests.filter((entry) => entry.startsWith('POST ')).length, 1)
    assert.deepEqual(records(result.stdout, 'CreateTask receipt'), [])
  })

  test(`${language}: read failure exits nonzero and cleans up`, async (t) => {
    const { baseUrl } = await fixture(t)
    const result = await launch([...executable, '--select', '999'], baseUrl).finished
    assert.equal(result.code, 1)
    assert.equal(result.signal, null)
    assert.match(result.stderr, /Task not found/)
  })

  test(`${language}: mutation opt-in validation runs before HTTP`, async (t) => {
    const { requests, baseUrl } = await fixture(t)
    const result = await launch([...executable, '--complete-created'], baseUrl).finished
    assert.equal(result.code, 1)
    assert.match(result.stderr, /--complete-created requires --add/)
    assert.deepEqual(requests, [])
  })

  test(`${language}: live virtual refresh sees external HTTP writes and stops on SIGINT`, async (t) => {
    const { requests, baseUrl } = await fixture(t)
    const run = launch([...executable, '--live'], baseUrl)
    t.after(() => {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL')
    })
    await until(() => run.output.stdout.includes('Live: RefreshTasks'), run.output.stderr || 'live startup')
    const response = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'External client write' }),
    })
    assert.equal(response.status, 201)
    await until(() => run.output.stdout.includes('External client write') && run.output.stdout.includes('"total":3'), 'live read refresh')
    run.child.kill('SIGINT')
    const result = await run.finished
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    assert.deepEqual(records(result.stdout, 'Summary').at(-1), { total: 3, done: 1 })
    assert.equal(requests.filter((entry) => entry.startsWith('POST ')).length, 1, 'only the external write uses POST')
    assert.ok(requests.filter((entry) => entry === 'GET /api/tasks').length >= 2)
    assert.ok(requests.filter((entry) => entry === 'GET /api/summary').length >= 2)
  })
}
