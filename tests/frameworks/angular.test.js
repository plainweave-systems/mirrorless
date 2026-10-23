// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import '@angular/compiler'
import {
  PLATFORM_ID,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMirrorless } from '../../src/core/index.js'
import { createTaskRuntime } from '../../examples/shared/task-api.js'
import { createTaskServer } from '../../examples/servers/node/server.js'
import {
  injectMirrorlessQuery,
  injectMirrorlessRuntime,
  provideMirrorless,
} from '../../src/angular/index.js'

const cleanups = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// Use Angular's real application/environment injectors and effect scheduler.
// No fake signal implementation, decorator transform, Zone, or template compiler
// is needed by the published adapter.
async function harness(options = {}, providers = [], providedRuntime) {
  const runtime = providedRuntime ?? createMirrorless({ unsubscribeDelayMs: 0, ...options })
  const app = await createApplication({ providers: [provideMirrorless(runtime)] })
  const scope = createEnvironmentInjector(providers, app.injector)
  cleanups.push(() => {
    if (!scope.destroyed) scope.destroy()
    app.destroy()
    runtime.dispose()
  })
  return {
    runtime,
    scope,
    create: (factory) => runInInjectionContext(scope, factory),
    async flush() {
      // Flush root effects plus resolved query promises and their notifications.
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve()
        app.tick()
      }
    },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('Angular adapter', () => {
  it('injects the provided runtime and starts delivery in an Angular effect', async () => {
    const read = vi.fn(async () => ({ title: 'From the server' }))
    const h = await harness({ query: read })
    expect(h.create(injectMirrorlessRuntime)).toBe(h.runtime)
    const query = h.create(() => injectMirrorlessQuery('GetTask', { id: '1' }))
    expect(read).not.toHaveBeenCalled()
    expect(query().data).toBeUndefined()
    await h.flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(query.data()).toEqual({ title: 'From the server' })
    expect(query.ready()).toBe(true)
    expect(Object.isFrozen(query.data())).toBe(true)
  })

  it('requires an injection context and never falls back to a global runtime', async () => {
    expect(() => injectMirrorlessQuery('GetTask')).toThrow()
    const app = await createApplication()
    cleanups.push(() => app.destroy())
    expect(() => runInInjectionContext(app.injector, injectMirrorlessRuntime))
      .toThrow('No Mirrorless runtime provided')
  })

  it('never exposes the old term while waiting for a parameter-change effect', async () => {
    const second = deferred()
    const read = vi.fn(async (_name, params) => params.id === '2' ? second.promise : { id: params.id })
    const h = await harness({ query: read })
    const id = signal('1')
    const query = h.create(() => injectMirrorlessQuery('GetTask', () => ({ id: id() })))
    await h.flush()
    expect(query.data()).toEqual({ id: '1' })

    id.set('2')
    // Deliberately do not flush effects: synchronously reading a new term
    // must not show the previous task even for one Angular render.
    expect(query().params.id).toBe('2')
    expect(query.data()).toBeUndefined()
    await h.flush()
    expect(query.loading()).toBe(true)
    second.resolve({ id: '2' })
    await h.flush()
    expect(query.data()).toEqual({ id: '2' })
  })

  it('supports reactive operation names and skips equal-value re-subscription', async () => {
    const read = vi.fn(async (name) => ({ name }))
    const h = await harness({ query: read })
    const observe = vi.spyOn(h.runtime, 'observe')
    const name = signal('GetTasks')
    const params = signal({ page: 1 })
    const query = h.create(() => injectMirrorlessQuery(name, params))
    await h.flush()
    expect(query.data()).toEqual({ name: 'GetTasks' })
    expect(observe).toHaveBeenCalledTimes(1)

    params.set({ page: 1 })
    await h.flush()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(1)

    name.set('GetSummary')
    expect(query().operationName).toBe('GetSummary')
    expect(query.data()).toBeUndefined()
    await h.flush()
    expect(observe).toHaveBeenCalledTimes(2)
    expect(query.data()).toEqual({ name: 'GetSummary' })
  })

  it.each([null, false, 0, []])('treats %j as available data rather than loading', async (value) => {
    const h = await harness({ query: async () => value })
    const query = h.create(() => injectMirrorlessQuery('GetValue'))
    await h.flush()
    expect(query.data()).toEqual(value)
    expect(query.ready()).toBe(true)
    expect(query.loading()).toBe(false)
  })

  it('keeps the original data reference while a background read is pending', async () => {
    const next = deferred()
    const read = vi.fn().mockResolvedValueOnce({ version: 1 }).mockImplementationOnce(() => next.promise)
    const h = await harness({ query: read })
    const query = h.create(() => injectMirrorlessQuery('GetTask'))
    await h.flush()
    const first = query.data()
    const refreshing = query.refetch()
    await h.flush()
    expect(query.loading()).toBe(true)
    expect(query.ready()).toBe(true)
    expect(query.data()).toBe(first)
    next.resolve({ version: 2 })
    await refreshing
    expect(query.data()).toEqual({ version: 2 })
    expect(query.loading()).toBe(false)
  })

  it('exposes initial failures and keeps confirmed data on a later failure', async () => {
    const failure = new Error('Read failed')
    const read = vi.fn()
      .mockResolvedValueOnce({ title: 'Confirmed' })
      .mockRejectedValueOnce(failure)
    const h = await harness({ query: read })
    const query = h.create(() => injectMirrorlessQuery('GetTask'))
    await h.flush()
    const first = query.data()
    await expect(query.refetch()).rejects.toThrow('Read failed')
    await h.flush()
    expect(query.data()).toBe(first)
    expect(query.error()).toBe(failure)
    expect(query.ready()).toBe(true)

    const failed = h.create(() => injectMirrorlessQuery('GetMissing', {}, {
      runtime: createMirrorless({ query: async () => { throw failure }, unsubscribeDelayMs: 0 }),
    }))
    await h.flush()
    expect(failed.data()).toBeUndefined()
    expect(failed.error()).toBe(failure)
    expect(failed.ready()).toBe(false)
    failed.dispose()
  })

  it('refreshes interested signals through a virtual command without executing a write', async () => {
    let count = 0
    const command = vi.fn()
    const h = await harness({
      query: async () => ({ count: ++count }),
      command,
      virtualCommands: ['Refresh'],
      updates: { Refresh: ['GetSummary'] },
    })
    const query = h.create(() => injectMirrorlessQuery('GetSummary'))
    await h.flush()
    expect(query.data()).toEqual({ count: 1 })
    await h.runtime.command('Refresh')
    await h.flush()
    expect(query.data()).toEqual({ count: 2 })
    expect(command).not.toHaveBeenCalled()
  })

  it('shares a read and releases only the destroyed resource interest', async () => {
    const read = vi.fn(async () => ({ version: read.mock.calls.length }))
    const h = await harness({ query: read })
    const one = h.create(() => injectMirrorlessQuery('GetTask', { id: '1' }))
    const two = h.create(() => injectMirrorlessQuery('GetTask', { id: '1' }))
    await h.flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(one.data()).toBe(two.data())
    const first = one.data()
    one.dispose()
    await two.refetch()
    await h.flush()
    expect(read).toHaveBeenCalledTimes(2)
    expect(one.data()).toBe(first)
    expect(two.data()).not.toBe(first)
  })

  it('DestroyRef cleanup prevents further notifications and refreshes', async () => {
    const read = vi.fn(async () => ({ count: read.mock.calls.length }))
    const h = await harness({
      query: read,
      virtualCommands: ['Refresh'],
      updates: { Refresh: ['GetTask'] },
    })
    const query = h.create(() => injectMirrorlessQuery('GetTask'))
    await h.flush()
    const first = query.data()
    h.scope.destroy()
    await h.runtime.command('Refresh')
    await h.flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(query.data()).toBe(first)
    expect(() => query.dispose()).not.toThrow()
    await query.refetch()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('coordinates independent Angular reads against the real local HTTP API', async () => {
    const server = createTaskServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise((resolve) => {
      server.closeAllConnections()
      server.close(resolve)
    }))
    const runtime = createTaskRuntime({
      baseUrl: `http://127.0.0.1:${server.address().port}/api`,
      unsubscribeDelayMs: 0,
    })
    const h = await harness({}, [], runtime)
    const tasks = h.create(() => injectMirrorlessQuery('GetTasks'))
    const summary = h.create(() => injectMirrorlessQuery('GetSummary'))
    const detail = h.create(() => injectMirrorlessQuery('GetTask', { id: '1' }))
    await h.flush()
    await vi.waitFor(() => {
      expect(tasks.data()).toHaveLength(2)
      expect(summary.data()).toEqual({ total: 2, done: 1 })
      expect(detail.data()?.done).toBe(false)
    })

    await runtime.command('CreateTask', { title: 'No client-side entity patch' })
    expect(tasks.data()).toHaveLength(3)
    expect(summary.data()).toEqual({ total: 3, done: 1 })

    await runtime.command('UpdateTask', { id: '1', done: true })
    expect(tasks.data().find((task) => task.id === '1').done).toBe(true)
    expect(detail.data()?.done).toBe(true)
    expect(summary.data()).toEqual({ total: 3, done: 2 })
  })

  it('does not subscribe while server rendering unless explicitly opted in', async () => {
    const read = vi.fn(async () => 'server result')
    const h = await harness({ query: read }, [{ provide: PLATFORM_ID, useValue: 'server' }])
    const query = h.create(() => injectMirrorlessQuery('GetTask'))
    await h.flush()
    expect(read).not.toHaveBeenCalled()
    expect(query().status).toBe('idle')

    const deliberate = h.create(() => injectMirrorlessQuery('GetTask', {}, { ssr: true }))
    await h.flush()
    expect(read).toHaveBeenCalledTimes(1)
    expect(deliberate.data()).toBe('server result')
  })
})
