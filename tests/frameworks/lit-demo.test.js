// @vitest-environment jsdom
// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../examples/lit/src/main.ts'

function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

async function settle(element) {
  for (let index = 0; index < 24; index += 1) await Promise.resolve()
  await element.updateComplete
}

function makeServer() {
  // This is a test HTTP service, not application state in the browser example.
  let tasks = [{ id: '1', title: 'Server-owned task', done: false }]
  let nextId = 2
  const calls = []
  let patchGate
  let failCreate = false
  const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
  const fetch = vi.fn(async (url, options = {}) => {
    const path = String(url)
    const method = options.method ?? 'GET'
    calls.push([method, path])
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (path === '/api/tasks' && method === 'GET') return json(tasks.map((task) => ({ ...task })))
    if (path === '/api/summary') return json({ total: tasks.length, done: tasks.filter((task) => task.done).length })
    if (path === '/api/tasks' && method === 'POST') {
      if (failCreate) return json({ error: 'Creation rejected by server' }, 400)
      const id = String(nextId++)
      tasks.push({ id, title: JSON.parse(options.body).title, done: false })
      return json({ id }, 201)
    }
    const id = decodeURIComponent(path.split('/').at(-1))
    const task = tasks.find((item) => item.id === id)
    if (!task) return json({ error: 'Task not found' }, 404)
    if (method === 'GET') return json({ ...task })
    if (method === 'PATCH') {
      if (patchGate) await patchGate.promise
      Object.assign(task, JSON.parse(options.body))
      return json({ ok: true })
    }
    if (method === 'DELETE') {
      tasks = tasks.filter((item) => item.id !== id)
      return json({ ok: true })
    }
    return json({ error: 'Unsupported test operation' }, 405)
  })
  return {
    fetch, calls,
    delayPatch() { patchGate = deferred(); return () => patchGate.resolve() },
    rejectCreates() { failCreate = true },
  }
}

let server
let element
beforeEach(() => {
  server = makeServer()
  vi.stubGlobal('fetch', server.fetch)
  element = document.createElement('mirrorless-lit-demo')
  document.body.append(element)
})

afterEach(() => {
  element.dispose()
  element.remove()
  vi.unstubAllGlobals()
})

describe('Lit task example', () => {
  it('renders separately fetched list and summary, then creates through a server command', async () => {
    await settle(element)
    expect(element.querySelector('[aria-label="Tasks"]')?.textContent).toContain('Server-owned task')
    expect(element.querySelector('[aria-label="Server summary"]')?.textContent).toContain('0 of 1 tasks complete')
    expect(server.calls).toContainEqual(['GET', '/api/tasks'])
    expect(server.calls).toContainEqual(['GET', '/api/summary'])

    const input = element.querySelector('[aria-label="Task title"]')
    input.value = 'Another server task'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await element.updateComplete
    element.querySelector('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await settle(element)
    expect(element.querySelector('[aria-label="Tasks"]')?.textContent).toContain('Another server task')
    expect(element.querySelector('[aria-label="Server summary"]')?.textContent).toContain('0 of 2 tasks complete')
    expect(element.querySelector('[aria-label="Task title"]').value).toBe('')
    expect(server.calls).toContainEqual(['POST', '/api/tasks'])
    expect(server.calls.filter(([method, path]) => method === 'GET' && path === '/api/tasks')).toHaveLength(2)
    expect(server.calls.filter(([method, path]) => method === 'GET' && path === '/api/summary')).toHaveLength(2)
  })

  it('does not optimistically toggle a task, then refreshes list, detail, and summary', async () => {
    await settle(element)
    element.querySelector('.task-row button').click()
    await settle(element)
    expect(element.querySelector('[aria-label="Selected task"]')?.textContent).toContain('Not complete')
    const finishPatch = server.delayPatch()
    const checkbox = element.querySelector('.task-row input[type="checkbox"]')
    checkbox.click()
    expect(checkbox.checked).toBe(false)
    await settle(element)
    expect(element.querySelector('[aria-label="Server summary"]')?.textContent).toContain('0 of 1 tasks complete')
    expect(element.querySelector('[aria-label="Selected task"]')?.textContent).toContain('Not complete')
    expect(element.querySelector('.task-row input[type="checkbox"]').disabled).toBe(true)

    finishPatch()
    await settle(element)
    expect(element.querySelector('.task-row input[type="checkbox"]').checked).toBe(true)
    expect(element.querySelector('[aria-label="Server summary"]')?.textContent).toContain('1 of 1 tasks complete')
    expect(element.querySelector('[aria-label="Selected task"]')?.textContent).toContain('Complete')
    expect(server.calls).toContainEqual(['PATCH', '/api/tasks/1'])
    expect(server.calls.filter(([method, path]) => method === 'GET' && path === '/api/tasks/1')).toHaveLength(2)
  })

  it('preserves local draft and confirmed reads when a command fails', async () => {
    await settle(element)
    server.rejectCreates()
    const input = element.querySelector('[aria-label="Task title"]')
    input.value = 'Keep this draft'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await element.updateComplete
    element.querySelector('form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
    await settle(element)
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Creation rejected by server')
    expect(element.querySelector('[aria-label="Task title"]').value).toBe('Keep this draft')
    expect(element.querySelector('[aria-label="Server summary"]')?.textContent).toContain('0 of 1 tasks complete')
    expect(server.calls.filter(([method, path]) => method === 'GET' && path === '/api/tasks')).toHaveLength(1)
    expect(element.querySelector('button[type="submit"]').disabled).toBe(false)
  })

  it.each([undefined, null, false, 0, ''])('shows initial HTTP failures with falsy rejection reason %j', async (reason) => {
    element.dispose()
    element.remove()
    vi.stubGlobal('fetch', vi.fn(async () => { throw reason }))
    element = document.createElement('mirrorless-lit-demo')
    document.body.append(element)
    await settle(element)
    const tasks = element.querySelector('[aria-label="Tasks"]')
    const summary = element.querySelector('[aria-label="Server summary"]')
    expect(tasks.querySelector('[role="alert"]')?.textContent).toBe(String(reason))
    expect(summary.querySelector('[role="alert"]')?.textContent).toBe(String(reason))
    expect(tasks.querySelector('[role="status"]')).toBeNull()
    expect(summary.querySelector('[role="status"]')).toBeNull()
  })

  it('deletes through the server and clears only local selection after confirmation', async () => {
    await settle(element)
    element.querySelector('.task-row button').click()
    await settle(element)
    element.querySelector('[aria-label="Delete Server-owned task"]').click()
    await settle(element)
    expect(element.querySelector('[aria-label="Selected task"]')).toBeNull()
    expect(element.querySelector('[aria-label="Tasks"]')?.textContent).toContain('No tasks yet')
    expect(element.querySelector('[aria-label="Server summary"]')?.textContent).toContain('0 of 0 tasks complete')
    expect(server.calls).toContainEqual(['DELETE', '/api/tasks/1'])
  })
})
