import { describe, expect, it, vi } from 'vitest'
import { createMirrorlessQuery } from '../../src/svelte/resource.js'

function fakeRuntime() {
  const records = []
  const runtime = {
    observe: vi.fn((id, params, options) => {
      let snapshot = Object.freeze({
        id, operationName: id, params, status: 'idle', loading: false,
        ready: false, data: undefined, response: undefined, error: undefined,
      })
      const listeners = new Set()
      const callbacks = []
      const stop = vi.fn(() => {})
      const observer = {
        getSnapshot: () => snapshot,
        subscribe: vi.fn((listener) => {
          listeners.add(listener)
          callbacks.push(listener)
          return () => { listeners.delete(listener); stop() }
        }),
        refetch: vi.fn(async () => undefined),
      }
      const record = {
        id, params, options, observer, stop, listeners, callbacks,
        emit(data, attrs = {}) {
          snapshot = Object.freeze({ ...snapshot, status: 'success', ready: true, data, ...attrs })
          for (const listener of [...listeners]) listener()
        },
      }
      records.push(record)
      return observer
    }),
  }
  return { runtime, records }
}

describe('Svelte lazy query resource', () => {
  it('does not declare interest while constructed, inspected, or switched without consumers', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read', { id: 1 })
    expect(query.getSnapshot().status).toBe('idle')
    query.setQuery('Read', { id: 2 })
    expect(records).toHaveLength(2)
    for (const record of records) expect(record.observer.subscribe).not.toHaveBeenCalled()
    query.dispose()
  })

  it('shares one observer subscription among store consumers and detaches on the last cleanup', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read')
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = query.subscribe(first)
    const stopSecond = query.subscribe(second)
    expect(records[0].observer.subscribe).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    const data = Object.freeze({ title: 'From the server' })
    records[0].emit(data)
    expect(first.mock.lastCall[0]).toBe(query.getSnapshot())
    expect(first.mock.lastCall[0].data).toBe(data)
    expect(second.mock.lastCall[0].data).toBe(data)
    stopFirst()
    expect(records[0].stop).not.toHaveBeenCalled()
    stopSecond()
    stopSecond()
    expect(records[0].stop).toHaveBeenCalledTimes(1)
    records[0].emit({ title: 'No listener remains' })
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(2)
    query.dispose()
  })

  it('reconnects the same resource after the last consumer leaves', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read')
    const stop = query.subscribe(() => {})
    stop()
    records[0].emit('retained result')
    const consumer = vi.fn()
    const stopAgain = query.subscribe(consumer)
    expect(records[0].observer.subscribe).toHaveBeenCalledTimes(2)
    expect(consumer.mock.lastCall[0].data).toBe('retained result')
    stopAgain()
    query.dispose()
  })

  it('copies params and does not churn on new value-equal params or options objects', () => {
    const { runtime, records } = fakeRuntime()
    const params = { id: 1, filter: { done: false } }
    const query = createMirrorlessQuery(runtime, 'Read', params, { unsubscribeDelayMs: 0 })
    const stop = query.subscribe(() => {})
    params.filter.done = true
    expect(records[0].params.filter.done).toBe(false)
    expect(Object.isFrozen(records[0].params.filter)).toBe(true)
    query.setQuery('Read', { filter: { done: false }, id: 1 }, { unsubscribeDelayMs: 0 })
    expect(runtime.observe).toHaveBeenCalledTimes(1)
    expect(records[0].stop).not.toHaveBeenCalled()
    stop()
    query.dispose()
  })

  it('clears another term’s data synchronously and ignores late old-observer callbacks', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read', { id: 1 })
    const consumer = vi.fn()
    const stop = query.subscribe(consumer)
    records[0].emit({ id: 1 })
    query.setQuery('Read', { id: 2 })
    expect(query.getSnapshot().params).toEqual({ id: 2 })
    expect(query.getSnapshot().data).toBeUndefined()
    expect(consumer.mock.lastCall[0].params).toEqual({ id: 2 })
    expect(consumer.mock.lastCall[0].data).toBeUndefined()
    expect(records[0].stop).toHaveBeenCalledTimes(1)
    const notifications = consumer.mock.calls.length
    records[0].emit({ id: 1, late: true })
    records[0].callbacks[0]()
    expect(consumer).toHaveBeenCalledTimes(notifications)
    records[1].emit({ id: 2 })
    expect(consumer.mock.lastCall[0].data).toEqual({ id: 2 })
    stop()
    query.dispose()
  })

  it('forwards snapshots unchanged, including refresh/error snapshots with prior data', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read')
    const consumer = vi.fn()
    const stop = query.subscribe(consumer)
    const data = Object.freeze([Object.freeze({ id: 1 })])
    records[0].emit(data)
    records[0].emit(data, { status: 'loading', loading: true })
    expect(consumer.mock.lastCall[0].data).toBe(data)
    const failure = new Error('Offline')
    records[0].emit(data, { status: 'error', loading: false, error: failure })
    expect(consumer.mock.lastCall[0]).toBe(records[0].observer.getSnapshot())
    expect(consumer.mock.lastCall[0].data).toBe(data)
    stop()
    query.dispose()
  })

  it('honors the readable-store invalidator ordering', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read')
    const events = []
    const stop = query.subscribe(() => events.push('value'), () => events.push('invalidate'))
    expect(events).toEqual(['value'])
    records[0].emit(false)
    expect(events).toEqual(['value', 'invalidate', 'value'])
    stop()
    query.dispose()
  })

  it('does not publish a previous term after a subscriber switches terms reentrantly', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read', { id: 1 })
    let switchOnNext = false
    const stopFirst = query.subscribe(() => {
      if (switchOnNext) {
        switchOnNext = false
        query.setQuery('Read', { id: 2 })
      }
    })
    const second = vi.fn()
    const stopSecond = query.subscribe(second)
    switchOnNext = true
    records[0].emit({ id: 1 })
    expect(second.mock.lastCall[0].params).toEqual({ id: 2 })
    expect(second.mock.lastCall[0].data).toBeUndefined()
    stopFirst()
    stopSecond()
    query.dispose()
  })

  it('detaches if an initial subscriber throws instead of leaking its interest', () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read')
    expect(() => query.subscribe(() => { throw new Error('render failed') })).toThrow('render failed')
    expect(records[0].stop).toHaveBeenCalledTimes(1)
    query.dispose()
  })

  it('forwards refetch and makes disposal final and idempotent', async () => {
    const { runtime, records } = fakeRuntime()
    const query = createMirrorlessQuery(runtime, 'Read')
    const stop = query.subscribe(() => {})
    await query.refetch()
    expect(records[0].observer.refetch).toHaveBeenCalledTimes(1)
    query.dispose()
    query.dispose()
    stop()
    expect(records[0].stop).toHaveBeenCalledTimes(1)
    expect(() => query.subscribe(() => {})).toThrow('disposed')
    expect(() => query.setQuery('Other')).toThrow('disposed')
    await expect(query.refetch()).rejects.toThrow('disposed')
  })
})
