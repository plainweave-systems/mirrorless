// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import { cloneFrozenJson, sameParams } from '../core/index.js'

/**
 * A Lit-compatible ReactiveController. Construction starts no requests; the
 * host's connection owns read interest. The controller retains only the core
 * snapshot reference, never a separately mutable model of server entities.
 */
export class MirrorlessController {
  constructor(host, { runtime, id, params = {}, options = {} }) {
    if (!host || typeof host.addController !== 'function' || typeof host.requestUpdate !== 'function') {
      throw new TypeError('MirrorlessController requires a ReactiveControllerHost')
    }
    if (!runtime || typeof runtime.observe !== 'function') {
      throw new TypeError('MirrorlessController requires a Mirrorless runtime')
    }

    this._host = host
    this._runtime = runtime
    this._options = options
    this._observer = runtime.observe(id, params ?? {}, options)
    this._snapshot = this._observer.getSnapshot()
    this._id = id
    this._params = this._snapshot.params
    this._connected = false
    this._disposed = false
    this._stop = undefined
    this._epoch = 0
    // Lit may immediately call hostConnected if this controller is added to an
    // already-connected, updated host, so all fields must be initialized first.
    host.addController(this)
  }

  get snapshot() { return this._snapshot }
  get data() { return this._snapshot.data }
  get error() { return this._snapshot.error }

  hostConnected() {
    if (this._disposed || this._connected) return
    this._connected = true
    try {
      this._activate()
    } catch (failure) {
      this._connected = false
      throw failure
    }
  }

  hostDisconnected() {
    if (!this._connected) return
    this._connected = false
    this._release()
  }

  _release() {
    this._epoch += 1
    const stop = this._stop
    this._stop = undefined
    stop?.()
  }

  _activate() {
    const observer = this._observer
    const epoch = ++this._epoch
    const sync = () => {
      if (this._disposed || !this._connected || this._epoch !== epoch) return
      const next = observer.getSnapshot()
      if (next === this._snapshot) return
      this._snapshot = next
      this._host.requestUpdate()
    }
    const stop = observer.subscribe(sync)
    if (this._disposed || !this._connected || this._epoch !== epoch) {
      stop()
      return
    }
    this._stop = stop
    // subscribe may change the snapshot before it attaches a notification
    // listener. Always read after attaching to close that gap.
    sync()
  }

  setQuery(id, params = {}) {
    if (this._disposed) throw new Error('Cannot setQuery on a disposed Mirrorless controller')
    const normalizedParams = cloneFrozenJson(params ?? {})
    const equal = this._runtime.equal ?? sameParams
    if (id === this._id && equal(this._params, normalizedParams)) return

    const observer = this._runtime.observe(id, normalizedParams, this._options)
    const snapshot = observer.getSnapshot()
    this._release()
    this._observer = observer
    this._id = id
    this._params = snapshot.params
    this._snapshot = snapshot
    if (this._connected) {
      this._activate()
      this._host.requestUpdate()
    }
  }

  refetch() {
    if (this._disposed) return Promise.reject(new Error('Cannot refetch a disposed Mirrorless controller'))
    if (!this._connected) return Promise.resolve(undefined)
    return this._observer.refetch()
  }

  /** Permanently detach; ordinary disconnect/reconnect uses the host hooks. */
  dispose() {
    if (this._disposed) return
    this._disposed = true
    this._connected = false
    this._release()
    this._host.removeController?.(this)
  }
}
