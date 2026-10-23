// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import { cloneFrozenJson, sameParams } from 'mirrorless'

function assertRuntime(runtime) {
  if (!runtime || typeof runtime.observe !== 'function') {
    throw new TypeError('createMirrorlessQuery requires a Mirrorless runtime')
  }
}

function assertName(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('A Mirrorless query requires a non-empty operation name')
  }
}

/**
 * A Svelte readable store whose first consumer declares interest and whose last
 * consumer releases it. Constructing, inspecting, or changing an unconsumed
 * resource does not start a request. The runtime owns results and interest leases.
 */
export function createMirrorlessQuery(runtime, id, params = {}, options = {}) {
  assertRuntime(runtime)
  assertName(id)

  let operationName = id
  let operationParams = cloneFrozenJson(params ?? {})
  let subscriptionOptions = Object.freeze({ ...options })
  let observer = runtime.observe(operationName, operationParams, subscriptionOptions)
  let snapshot = observer.getSnapshot()
  let stopObserver
  let generation = 0
  let disposed = false
  const subscribers = new Set()

  function assertOpen() {
    if (disposed) throw new Error('This Mirrorless query resource has been disposed')
  }

  function publish(nextSnapshot) {
    if (Object.is(snapshot, nextSnapshot)) return
    snapshot = nextSnapshot
    const currentGeneration = generation

    for (const entry of [...subscribers]) {
      if (currentGeneration !== generation) break
      if (!entry.started || !subscribers.has(entry)) continue
      entry.invalidate()
      if (currentGeneration !== generation) break
      if (subscribers.has(entry)) entry.run(nextSnapshot)
    }
  }

  function detach() {
    generation += 1
    const stop = stopObserver
    stopObserver = undefined
    stop?.()
  }

  function attach() {
    if (disposed || subscribers.size === 0 || stopObserver) return
    const selectedObserver = observer
    const currentGeneration = generation
    const sync = () => {
      if (
        disposed || subscribers.size === 0 || currentGeneration !== generation ||
        selectedObserver !== observer
      ) return
      publish(selectedObserver.getSnapshot())
    }

    const stop = selectedObserver.subscribe(sync)
    // A synchronous callback is permitted to change the resource or remove its
    // last consumer before subscribe() returns its cleanup function.
    if (
      disposed || subscribers.size === 0 || currentGeneration !== generation ||
      selectedObserver !== observer
    ) {
      stop()
      return
    }
    stopObserver = stop
    sync()
  }

  function getSnapshot() {
    if (!disposed && subscribers.size === 0) snapshot = observer.getSnapshot()
    return snapshot
  }

  function subscribe(run, invalidate = () => {}) {
    assertOpen()
    if (typeof run !== 'function' || typeof invalidate !== 'function') {
      throw new TypeError('A Mirrorless store subscriber must be a function')
    }
    const entry = { run, invalidate, started: false }
    subscribers.add(entry)

    try {
      if (subscribers.size === 1) attach()
      entry.started = true
      run(snapshot)
    } catch (error) {
      subscribers.delete(entry)
      if (subscribers.size === 0) detach()
      throw error
    }

    let listening = true
    return () => {
      if (!listening) return
      listening = false
      subscribers.delete(entry)
      if (subscribers.size === 0) detach()
    }
  }

  function setQuery(nextId, nextParams = {}, nextOptions = subscriptionOptions) {
    assertOpen()
    assertName(nextId)
    const frozenParams = cloneFrozenJson(nextParams ?? {})
    const frozenOptions = Object.freeze({ ...nextOptions })
    const equal = runtime.equal ?? sameParams
    if (
      operationName === nextId && equal(operationParams, frozenParams) &&
      sameParams(subscriptionOptions, frozenOptions)
    ) return

    // Build/validate the new observer before releasing a valid old query. This
    // construction is side-effect-free under the core observer contract.
    const nextObserver = runtime.observe(nextId, frozenParams, frozenOptions)
    detach()
    operationName = nextId
    operationParams = frozenParams
    subscriptionOptions = frozenOptions
    observer = nextObserver
    publish(observer.getSnapshot())
    attach()
  }

  function refetch() {
    if (disposed) return Promise.reject(new Error('This Mirrorless query resource has been disposed'))
    return observer.refetch()
  }

  function dispose() {
    if (disposed) return
    disposed = true
    detach()
    subscribers.clear()
  }

  return Object.freeze({ subscribe, getSnapshot, setQuery, refetch, dispose })
}
