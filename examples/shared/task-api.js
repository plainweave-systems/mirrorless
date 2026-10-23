// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { createMirrorless } from 'mirrorless'

/** The demo talks to a real HTTP server; it never owns a browser-side task collection. */
export function createTaskRuntime({ baseUrl = '/api', fetch: fetchOperation = globalThis.fetch, unsubscribeDelayMs = 120_000 } = {}) {
  if (typeof fetchOperation !== 'function') throw new TypeError('A fetch implementation is required')
  const base = baseUrl.replace(/\/$/, '')

  async function request(path, { method = 'GET', body, signal } = {}) {
    const response = await fetchOperation(`${base}${path}`, {
      method,
      signal,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
    const data = await response.json()
    if (!response.ok) {
      const error = new Error(typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`)
      error.status = response.status
      throw error
    }
    return data
  }

  function taskPath(params) {
    if (typeof params.id !== 'string' || !params.id) throw new TypeError('A task id is required')
    return `/tasks/${encodeURIComponent(params.id)}`
  }

  return createMirrorless({
    unsubscribeDelayMs,
    query(name, params, context) {
      const options = { signal: context.signal }
      switch (name) {
        case 'GetTasks': return request('/tasks', options)
        case 'GetTask': return request(taskPath(params), options)
        case 'GetSummary': return request('/summary', options)
        default: throw new Error(`Unknown demo read: ${name}`)
      }
    },
    command(name, params, context) {
      const signal = context.signal
      switch (name) {
        case 'CreateTask': return request('/tasks', { method: 'POST', body: { title: params.title }, signal })
        case 'UpdateTask': {
          const body = {}
          if (Object.hasOwn(params, 'title')) body.title = params.title
          if (Object.hasOwn(params, 'done')) body.done = params.done
          return request(taskPath(params), { method: 'PATCH', body, signal })
        }
        case 'DeleteTask': return request(taskPath(params), { method: 'DELETE', signal })
        default: throw new Error(`Unknown demo command: ${name}`)
      }
    },
    virtualCommands: ['RefreshTasks'],
    updates: {
      CreateTask: ['GetTasks', 'GetSummary'],
      UpdateTask: ['GetTasks', ['GetTask', { id: Symbol.for('id') }], 'GetSummary'],
      DeleteTask: ['GetTasks', ['GetTask', { id: Symbol.for('id') }], 'GetSummary'],
      RefreshTasks: ['GetTasks', 'GetTask', 'GetSummary'],
    },
  })
}

/** Optional liveness: all current read interests are refreshed by one virtual command. */
export function startLiveRefresh(runtime, intervalMs = 2000, { onError = () => {} } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('intervalMs must be a positive finite number')
  const timer = globalThis.setInterval(() => {
    Promise.resolve().then(() => runtime.command('RefreshTasks')).catch(onError)
  }, intervalMs)
  timer.unref?.()
  return () => globalThis.clearInterval(timer)
}
