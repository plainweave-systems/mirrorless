// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import { cloneFrozenJson, sameParams } from '../core/index.js'

function reportUnhandled(error) {
  // Keep renderer exceptions out of the read dispatcher's promise chain.
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error)
  } else {
    globalThis.queueMicrotask(() => { throw error })
  }
}

/**
 * Deliver a query's plain data to an imperative renderer. This helper does not
 * create, inspect, or interpolate DOM nodes. Renderers retain control of safe
 * DOM APIs, local interaction state, and their own presentation.
 *
 * An error callback handles a first-read failure. Without one, a failure found
 * synchronously by bindQuery/setQuery is thrown to the caller; later failures
 * are reported with reportError (or an uncaught microtask). Existing data keeps
 * rendering during a background refresh or its failure.
 */
export function bindQuery({ runtime, id, params = {}, render, loading, error, options = {} }) {
  if (!runtime || typeof runtime.observe !== 'function') {
    throw new TypeError('bindQuery requires a Mirrorless runtime')
  }
  if (typeof render !== 'function') {
    throw new TypeError('bindQuery requires a render(data) function')
  }
  if (loading !== undefined && typeof loading !== 'function') {
    throw new TypeError('bindQuery loading must be a function')
  }
  if (error !== undefined && typeof error !== 'function') {
    throw new TypeError('bindQuery error must be a function')
  }

  let observer
  let stop
  let snapshot
  let termName
  let termParams
  let epoch = 0
  let disposed = false
  let hasDelivered = false

  function release() {
    epoch += 1
    const previousStop = stop
    stop = undefined
    previousStop?.()
  }

  function deliver(next) {
    if (hasDelivered && next === snapshot) return
    snapshot = next
    hasDelivered = true
    if (next.data !== undefined) {
      render(next.data)
    } else if (next.status === 'error') {
      if (error) error(next)
      else throw next.error
    } else {
      loading?.(next)
    }
  }

  function setQuery(name, nextParams = {}) {
    if (disposed) throw new Error('Cannot setQuery on a disposed Mirrorless binding')
    const normalizedParams = cloneFrozenJson(nextParams ?? {})
    const equal = runtime.equal ?? sameParams
    if (stop && termName === name && equal(termParams, normalizedParams)) return

    // Construct before releasing the old term: invalid terms must not silently
    // destroy a working binding. observe/getSnapshot themselves start no work.
    const nextObserver = runtime.observe(name, normalizedParams, options)
    const initial = nextObserver.getSnapshot()
    release()
    observer = nextObserver
    termName = name
    termParams = initial.params
    hasDelivered = false
    snapshot = initial
    const currentEpoch = epoch
    let attaching = true
    const listener = () => {
      if (attaching || disposed || epoch !== currentEpoch) return
      try {
        deliver(nextObserver.getSnapshot())
      } catch (failure) {
        reportUnhandled(failure)
      }
    }

    try {
      const cleanup = nextObserver.subscribe(listener)
      attaching = false
      if (disposed || epoch !== currentEpoch) {
        cleanup()
        return
      }
      stop = cleanup
      deliver(nextObserver.getSnapshot())
    } catch (failure) {
      attaching = false
      // A renderer may synchronously switch/dispose the binding. Never tear
      // down that newer term when unwinding the old renderer's exception.
      if (epoch === currentEpoch) {
        release()
        observer = undefined
      }
      throw failure
    }
  }

  const binding = {
    get snapshot() { return snapshot },
    get data() { return snapshot?.data },
    setQuery,
    refetch() {
      if (disposed) return Promise.reject(new Error('Cannot refetch a disposed Mirrorless binding'))
      if (!observer || !stop) return Promise.resolve(undefined)
      return observer.refetch()
    },
    dispose() {
      if (disposed) return
      disposed = true
      release()
      observer = undefined
    },
  }

  setQuery(id, params)
  return binding
}
