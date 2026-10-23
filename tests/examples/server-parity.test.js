// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createTaskServer, INITIAL_TASKS, MAX_BODY_BYTES } from '../../examples/servers/node/server.js'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixtures = INITIAL_TASKS.map((task) => ({ ...task }))
const tools = {
  python: spawnSync('python3', ['--version'], { stdio: 'ignore' }).status === 0,
  go: spawnSync('go', ['version'], { stdio: 'ignore' }).status === 0,
}

async function request(base, route, { method = 'GET', value, body, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: value !== undefined ? JSON.stringify(value) : body,
    signal: AbortSignal.timeout(10_000),
  })
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return { status: response.status, value: await response.json(), headers: response.headers }
}

function chunkedRequest(base, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      timeout: 10_000,
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('error', reject)
      response.on('end', () => {
        try { resolve({ status: response.statusCode, value: JSON.parse(text) }) }
        catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.on('timeout', () => request.destroy(new Error('Chunked request timed out')))
    const middle = Math.floor(Buffer.byteLength(body) / 2)
    const bytes = Buffer.from(body)
    request.write(bytes.subarray(0, middle))
    request.end(bytes.subarray(middle))
  })
}

async function startProcess(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, PORT: '0', PYTHONDONTWRITEBYTECODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let errors = ''
  child.stderr.on('data', (chunk) => { errors += chunk })
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Server did not start: ${command}\n${output}\n${errors}`))
    }, 15_000)
    child.stdout.on('data', (chunk) => {
      output += chunk
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(output)
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      reject(new Error(`Server exited before startup (${code ?? signal}): ${errors}`))
    })
  })
  return {
    base,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = once(child, 'exit')
      const timer = setTimeout(() => child.kill('SIGKILL'), 4000)
      child.kill('SIGTERM')
      const [code, signal] = await exited
      clearTimeout(timer)
      assert.equal(signal, null, `Server needed forced termination: ${errors}`)
      assert.equal(code, 0, `Server failed during shutdown: ${errors}`)
    },
  }
}

async function contract(t, base) {
  await t.test('reads return deterministic server-owned representations', async () => {
    assert.deepEqual((await request(base, '/api/tasks')).value, fixtures)
    assert.deepEqual((await request(base, '/api/tasks/2')).value, fixtures[1])
    assert.deepEqual((await request(base, '/api/summary')).value, { total: 2, done: 1 })
    assert.deepEqual((await request(base, '/api/tasks?ignored=1')).value, fixtures)
  })

  await t.test('commands return receipts, then reads expose changed data', async () => {
    const created = await request(base, '/api/tasks', { method: 'POST', value: { title: '  Read after a command  ' } })
    assert.equal(created.status, 201)
    assert.deepEqual(created.value, { id: '3' })
    assert.deepEqual((await request(base, '/api/tasks/3')).value, { id: '3', title: 'Read after a command', done: false })
    const updated = await request(base, '/api/tasks/3', { method: 'PATCH', value: { done: true, title: 'Changed on the server' } })
    assert.equal(updated.status, 200)
    assert.deepEqual(updated.value, { ok: true })
    assert.deepEqual((await request(base, '/api/tasks/3')).value, { id: '3', title: 'Changed on the server', done: true })
    assert.deepEqual((await request(base, '/api/summary')).value, { total: 3, done: 2 })
    assert.deepEqual((await request(base, '/api/tasks/3', { method: 'PATCH', value: { done: false } })).value, { ok: true })
    assert.equal((await request(base, '/api/tasks/3')).value.done, false)
    assert.deepEqual((await request(base, '/api/tasks/3', { method: 'DELETE' })).value, { ok: true })
    const missing = await request(base, '/api/tasks/3')
    assert.equal(missing.status, 404)
    assert.equal(typeof missing.value.error, 'string')
    assert.equal((await request(base, '/api/tasks/3', { method: 'DELETE' })).status, 404)
    assert.deepEqual((await request(base, '/api/summary')).value, { total: 2, done: 1 })
  })

  await t.test('invalid task fields cannot mutate server data', async () => {
    for (const value of [{}, { title: '' }, { title: '   ' }, { title: 1 }, { title: null }, { title: 'a'.repeat(201) }, { title: 'no', done: true }, { title: 'no', unknown: true }]) {
      const result = await request(base, '/api/tasks', { method: 'POST', value })
      assert.equal(result.status, 400, JSON.stringify(value))
      assert.equal(typeof result.value.error, 'string')
    }
    for (const value of [{}, { done: 1 }, { done: 'true' }, { done: null }, { title: [] }, { title: '' }, { id: 'different' }, { done: true, unknown: 1 }]) {
      const result = await request(base, '/api/tasks/1', { method: 'PATCH', value })
      assert.equal(result.status, 400, JSON.stringify(value))
    }
    assert.deepEqual((await request(base, '/api/tasks')).value, fixtures)
  })

  await t.test('JSON objects and JSON media type are required', async () => {
    for (const body of ['{', 'null', '[]', '"text"', '', '{} {}']) {
      const result = await request(base, '/api/tasks', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
      assert.equal(result.status, 400, body)
    }
    assert.equal((await request(base, '/api/tasks', { method: 'POST', body: '{"title":"wrong type"}' })).status, 415)
    assert.equal((await request(base, '/api/tasks', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415)
    assert.deepEqual((await request(base, '/api/tasks')).value, fixtures)
  })

  await t.test('body limits apply to fixed-length and chunked HTTP requests', async () => {
    const body = JSON.stringify({ title: 'a'.repeat(MAX_BODY_BYTES) })
    assert.equal((await request(base, '/api/tasks', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })).status, 413)
    assert.equal((await chunkedRequest(base, body)).status, 413)
    const created = await chunkedRequest(base, JSON.stringify({ title: 'Chunked JSON works' }))
    assert.equal(created.status, 201)
    assert.equal(typeof created.value.id, 'string')
    await request(base, `/api/tasks/${created.value.id}`, { method: 'DELETE' })
    assert.deepEqual((await request(base, '/api/tasks')).value, fixtures)
  })

  await t.test('concurrent writes receive unique IDs and preserve all tasks', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => request(base, '/api/tasks', { method: 'POST', value: { title: `Concurrent ${index}` } })))
    assert.ok(results.every((result) => result.status === 201))
    assert.equal(new Set(results.map((result) => result.value.id)).size, 5)
    assert.deepEqual((await request(base, '/api/summary')).value, { total: 7, done: 1 })
    await Promise.all(results.map((result) => request(base, `/api/tasks/${result.value.id}`, { method: 'DELETE' })))
    assert.deepEqual((await request(base, '/api/tasks')).value, fixtures)
  })

  await t.test('unknown routes and unsupported methods return JSON errors', async () => {
    for (const route of ['/', '/server.js', '/api/tasks/0', '/api/tasks/nope', '/api/tasks/999']) {
      const result = await request(base, route)
      assert.equal(result.status, 404, route)
      assert.equal(typeof result.value.error, 'string')
    }
    assert.equal((await request(base, '/api/tasks/999', { method: 'PATCH', value: { done: true } })).status, 404)
    const rejected = await request(base, '/api/tasks', { method: 'PUT', value: { title: 'no' } })
    assert.equal(rejected.status, 405)
    assert.equal(rejected.headers.get('allow'), 'GET, POST')
    assert.equal((await request(base, '/api/summary', { method: 'OPTIONS' })).status, 405)
  })
}

test('Node factory has no startup side effect and isolates stores', async () => {
  const first = createTaskServer()
  const second = createTaskServer()
  assert.equal(first.listening, false)
  assert.equal(second.listening, false)
  await Promise.all([first, second].map((server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))))
  try {
    const firstUrl = `http://127.0.0.1:${first.address().port}`
    const secondUrl = `http://127.0.0.1:${second.address().port}`
    await request(firstUrl, '/api/tasks/1', { method: 'PATCH', value: { done: true } })
    assert.equal((await request(firstUrl, '/api/tasks/1')).value.done, true)
    assert.equal((await request(secondUrl, '/api/tasks/1')).value.done, false)
  } finally {
    await Promise.all([first, second].map((server) => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeIdleConnections()
    })))
  }
})

test('Node CLI HTTP contract', { timeout: 60_000 }, async (t) => {
  const server = await startProcess(process.execPath, ['examples/servers/node/server.js'])
  try { await contract(t, server.base) }
  finally { await server.stop() }
})

test('Python HTTP contract', { skip: !tools.python && 'python3 is not installed', timeout: 60_000 }, async (t) => {
  const server = await startProcess('python3', ['-u', 'examples/servers/python/server.py'])
  try { await contract(t, server.base) }
  finally { await server.stop() }
})

test('Go HTTP contract', { skip: !tools.go && 'go is not installed', timeout: 180_000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'mirrorless-go-api-'))
  try {
    const executable = path.join(directory, 'task-api')
    const build = spawn('go', ['build', '-o', executable, 'examples/servers/go/main.go'], {
      cwd: root,
      env: { ...process.env, GOTOOLCHAIN: 'local', GO111MODULE: 'off', GOWORK: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let errors = ''
    build.stderr.on('data', (chunk) => { errors += chunk })
    const [code] = await once(build, 'exit')
    assert.equal(code, 0, `Go demo failed to build: ${errors}`)
    const server = await startProcess(executable, [])
    try { await contract(t, server.base) }
    finally { await server.stop() }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
