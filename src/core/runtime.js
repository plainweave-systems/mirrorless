import { MirrorlessCell } from './cell.js'
import { cloneFrozenJson, deepFreeze } from './frozenJson.js'
import { sameValue } from './equality.js'
import {
  normalizeUpdateMaps,
  updateTargetsForCommand,
  updateTargetMatchesRun,
  validateUpdateMaps,
} from './invalidation.js'
import {
  createSubscriptionRegistry,
  findRunKey,
  runRecord,
  subscriberIdsForRun,
} from './subscriptionRegistry.js'

export function defaultQueryOperation({ id }) {
  throw new Error(`Mirrorless has no query dispatcher for ${id}`)
}

export function defaultCommandOperation({ id }) {
  throw new Error(`Mirrorless has no command dispatcher for ${id}`)
}

export function defaultSelectData(response) { return response }
export function defaultIngestOperationResult() { return undefined }

function queryDispatcher(options) {
  return options.query
    ? (context) => options.query(context.operationName, context.params, context)
    : options.executeOperation ?? defaultQueryOperation
}

function commandDispatcher(options) {
  return options.command
    ? (context) => options.command(context.operationName, context.params, context)
    : options.executeOperation ?? defaultCommandOperation
}

function operationName(name) {
  if (typeof name !== 'string' || !name) throw new TypeError('An operation name must be a non-empty string')
  return name
}

function operationParams(params) {
  if (params !== undefined && params !== null && (typeof params !== 'object' || Array.isArray(params))) {
    throw new TypeError('Operation params must be a JSON-compatible object')
  }
  return cloneFrozenJson(params ?? {})
}

function idleSnapshot(name, params, runKey) {
  return Object.freeze({
    runKey, id: name, operationName: name, params,
    status: 'idle', loading: false, ready: false,
    data: undefined, response: undefined, error: undefined,
    lastFetchedAt: undefined, fetchStartedAt: undefined,
  })
}

function ignore(promise) { promise.catch(() => undefined) }
function nowIso() { return new Date().toISOString() }

function readRound() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject, settled: false }
}

function settleRound(round, response, error, failed = false) {
  if (!round || round.settled) return
  round.settled = true
  if (failed) round.reject(error)
  else round.resolve(response)
}

function interestDelay(value) {
  if (typeof value !== 'number' || (value !== Infinity && (!Number.isFinite(value) || value > 2_147_483_647))) {
    throw new TypeError('unsubscribeDelayMs must be a finite timer duration, a negative number, or Infinity')
  }
  return value
}

/** Framework-independent delivery of server reads to active interests. */
export class MirrorlessRuntime {
  constructor(options = {}) {
    this.subscriptionRegistry = createSubscriptionRegistry()
    this.queryOperation = queryDispatcher(options)
    this.commandOperation = commandDispatcher(options)
    this.executeOperation = options.executeOperation
    this.selectData = options.selectData ?? defaultSelectData
    this.ingestOperationResult = options.ingestOperationResult ?? defaultIngestOperationResult
    this.ingestContext = options.ingestContext ?? {}
    this.equal = options.equal ?? sameValue
    this.unsubscribeDelayMs = interestDelay(options.unsubscribeDelayMs ?? options.unsubscribeGraceMs ?? 120_000)
    this.virtualCommands = new Set(options.virtualCommands ?? options.fakeCommandOperations ?? options.fakeMutationOperations ?? [])
    this.fakeCommandOperations = this.virtualCommands
    this.invalidationMaps = normalizeUpdateMaps(options)
    this._explicitReverse = (options.updatedBy ?? options.queryInvalidatedByMutations) !== undefined
    this.operationOptions = new Map()
    this.listenersByRunKey = new Map()
    this.unsubscribeTimers = new Map()
    this.inFlight = new Map()
    this.nextRunId = 1
    this.nextSubscriberId = 1
    this.disposed = false
    this._epoch = 0
    this._commandControllers = new Set()
    this.onListenerError = options.onListenerError
    for (const operation of options.operations ?? []) this.registerOperation(operation.id ?? operation.name, operation)
  }

  _assertActive() {
    if (this.disposed) throw new Error('This Mirrorless runtime has been disposed')
  }

  _findRun(name, params) {
    const key = findRunKey(this.subscriptionRegistry, name, params, this.equal)
    return key === undefined ? undefined : this.subscriptionRegistry.runs.get(key)
  }

  _wanted(run, epoch = this._epoch) {
    return !this.disposed && epoch === this._epoch &&
      this.subscriptionRegistry.runs.get(run.runKey) === run &&
      subscriberIdsForRun(this.subscriptionRegistry, run.runKey).length > 0
  }

  _snapshot(run) {
    run.snapshot = Object.freeze({
      runKey: run.runKey,
      id: run.operationName,
      operationName: run.operationName,
      params: run.params,
      status: run.status,
      loading: run.status === 'loading',
      ready: run.data !== undefined,
      data: run.data,
      response: run.latestResponse,
      error: run.error,
      lastFetchedAt: run.lastFetchedAt,
      fetchStartedAt: run.fetchStartedAt,
    })
    return run.snapshot
  }

  _reportListenerError(error) {
    if (this.onListenerError) this.onListenerError(error)
    else if (typeof globalThis.reportError === 'function') globalThis.reportError(error)
    else globalThis.queueMicrotask(() => { throw error })
  }

  notifyRun(runKey) {
    const listeners = this.listenersByRunKey.get(runKey)
    for (const record of [...(listeners ?? [])]) {
      if (!record.active) continue
      try { record.listener() } catch (error) { this._reportListenerError(error) }
    }
  }

  _listen(runKey, listener, subscriber) {
    if (typeof listener !== 'function') throw new TypeError('A query listener must be a function')
    const record = { listener, active: true }
    const listeners = this.listenersByRunKey.get(runKey) ?? new Set()
    listeners.add(record)
    this.listenersByRunKey.set(runKey, listeners)
    subscriber?.listeners.add(record)
    return () => {
      record.active = false
      listeners.delete(record)
      subscriber?.listeners.delete(record)
      if (listeners.size === 0 && this.listenersByRunKey.get(runKey) === listeners) this.listenersByRunKey.delete(runKey)
    }
  }

  addRunListener(runKey, listener) {
    return this._listen(runKey, listener)
  }

  _dropSubscriberListeners(subscriber) {
    const listeners = this.listenersByRunKey.get(subscriber.runKey)
    for (const record of subscriber.listeners) {
      record.active = false
      listeners?.delete(record)
    }
    subscriber.listeners.clear()
    if (listeners?.size === 0) this.listenersByRunKey.delete(subscriber.runKey)
  }

  /** Constructing an observer, including reading its snapshot, performs no work. */
  observe(name, params = {}, options = {}) {
    operationName(name)
    const frozenParams = operationParams(params)
    const idle = idleSnapshot(name, frozenParams)
    return Object.freeze({
      getSnapshot: () => this._findRun(name, frozenParams)?.snapshot ?? idle,
      subscribe: (listener) => {
        this._assertActive()
        if (typeof listener !== 'function') throw new TypeError('A query listener must be a function')
        const subscription = this._subscribe(name, frozenParams, options, listener)
        return subscription.unsubscribe
      },
      refetch: () => {
        const run = this._findRun(name, frozenParams)
        return run && this._wanted(run) ? this.refetchRun(run.runKey) : Promise.resolve(undefined)
      },
    })
  }

  subscribe(name, params = {}, options = {}) {
    return this._subscribe(operationName(name), operationParams(params), options)
  }

  _subscribe(name, frozenParams, options, initialListener) {
    this._assertActive()
    interestDelay(options.unsubscribeDelayMs ?? this.unsubscribeDelayMs)
    let run = this._findRun(name, frozenParams)
    if (!run) {
      run = {
        runKey: `${name}:${this.nextRunId++}`,
        operationName: name,
        params: frozenParams,
        status: 'idle',
        data: undefined,
        latestResponse: undefined,
        error: undefined,
        lastFetchedAt: undefined,
        fetchStartedAt: undefined,
        hasResponse: false,
        flight: undefined,
      }
      this._snapshot(run)
      this.subscriptionRegistry.runs.set(run.runKey, run)
    }
    const runKey = run.runKey
    const idle = idleSnapshot(name, frozenParams, runKey)
    const subscriberId = `sub:${this.nextSubscriberId++}`
    const subscriber = { subscriberId, runKey, kind: options.kind ?? 'component', active: true, released: false, listeners: new Set() }
    this.subscriptionRegistry.subscribers.set(subscriberId, subscriber)
    const subscribers = this.subscriptionRegistry.runSubscribers.get(runKey) ?? new Set()
    subscribers.add(subscriberId)
    this.subscriptionRegistry.runSubscribers.set(runKey, subscribers)
    if (initialListener) this._listen(runKey, initialListener, subscriber)

    const subscription = {
      subscriberId, runKey, operationName: name, params: frozenParams,
      getSnapshot: () => this.subscriptionRegistry.runs.get(runKey)?.snapshot ?? idle,
      onChange: (listener) => subscriber.active ? this._listen(runKey, listener, subscriber) : () => {},
      refetch: () => this.refetchRun(runKey),
      unsubscribe: () => {
        // Destructive reset releases interest before final notifications. Cleanup
        // must still deactivate its queued records when another listener unmounts it.
        this._dropSubscriberListeners(subscriber)
        if (!subscriber.active) return
        subscriber.active = false
        this.scheduleUnsubscribe(subscriberId, runKey, options.unsubscribeDelayMs)
      },
    }
    if (options.fetch !== false && this.shouldFetchOnSubscribe(runKey)) ignore(this.ensureRunFetched(runKey))
    return Object.freeze(subscription)
  }

  shouldFetchOnSubscribe(runKey) {
    const run = this.subscriptionRegistry.runs.get(runKey)
    return Boolean(run && !run.flight && (!run.hasResponse || run.status === 'error'))
  }

  scheduleUnsubscribe(subscriberId, runKey, delayMs = this.unsubscribeDelayMs) {
    if (this.unsubscribeTimers.has(subscriberId)) return
    interestDelay(delayMs)
    if (delayMs < 0 || delayMs === Infinity) return
    if (delayMs <= 0) return this.finalizeUnsubscribe(subscriberId, runKey)
    const timer = globalThis.setTimeout(() => {
      this.unsubscribeTimers.delete(subscriberId)
      this.finalizeUnsubscribe(subscriberId, runKey)
    }, delayMs)
    timer?.unref?.()
    this.unsubscribeTimers.set(subscriberId, timer)
  }

  finalizeUnsubscribe(subscriberId, runKey) {
    const subscriber = this.subscriptionRegistry.subscribers.get(subscriberId)
    if (!subscriber || subscriber.released) return
    subscriber.active = false
    subscriber.released = true
    this._dropSubscriberListeners(subscriber)
    const timer = this.unsubscribeTimers.get(subscriberId)
    if (timer !== undefined) globalThis.clearTimeout(timer)
    this.unsubscribeTimers.delete(subscriberId)
    this.subscriptionRegistry.subscribers.delete(subscriberId)
    const subscribers = this.subscriptionRegistry.runSubscribers.get(runKey)
    subscribers?.delete(subscriberId)
    if (subscribers?.size > 0) return
    this.subscriptionRegistry.runSubscribers.delete(runKey)
    const run = this.subscriptionRegistry.runs.get(runKey)
    this.subscriptionRegistry.runs.delete(runKey)
    this.listenersByRunKey.delete(runKey)
    this._cancelFlight(run)
  }

  createCell(initialValue) { return new MirrorlessCell(initialValue) }

  subscribeCell(cell, name, params = {}, options = {}) {
    const subscription = this.subscribe(name, params, { ...options, kind: options.kind ?? 'cell' })
    const sync = () => cell.set(subscription.getSnapshot())
    try { sync() } catch (error) { subscription.unsubscribe(); throw error }
    const stop = subscription.onChange(sync)
    return Object.freeze({ ...subscription, unsubscribe: () => { stop(); subscription.unsubscribe() } })
  }

  snapshotForRun(runKey) {
    return this.subscriptionRegistry.runs.get(runKey)?.snapshot
  }

  selectDataForOperation(name, response) {
    return deepFreeze((this.operationOptions.get(name)?.selectData ?? this.selectData)(response, { operationName: name }))
  }

  ensureRunFetched(runKey, { force = false, invalidated = false } = {}) {
    const run = this.subscriptionRegistry.runs.get(runKey)
    if (!run || !this._wanted(run)) return Promise.resolve(undefined)
    if (run.flight) {
      if (invalidated) {
        run.flight.queued ??= readRound()
        return run.flight.queued.promise
      }
      return run.flight.current.promise
    }
    if (!force && run.hasResponse && run.status === 'success') return Promise.resolve(run.latestResponse)
    const current = readRound()
    const flight = { current, promise: current.promise, epoch: this._epoch, queued: undefined, controller: undefined }
    // Install the in-flight identity before notifying listeners or calling user code.
    run.flight = flight
    this.inFlight.set(runKey, current.promise)
    ignore(this._drainRun(run, flight))
    return current.promise
  }

  _detachFlight(run, flight) {
    if (run.flight === flight) run.flight = undefined
    if (this.inFlight.get(run.runKey) === flight.promise) this.inFlight.delete(run.runKey)
  }

  _cancelFlight(run, flight = run?.flight) {
    if (!flight) return
    this._detachFlight(run, flight)
    const queued = flight.queued
    flight.queued = undefined
    // A dispatcher may ignore AbortSignal indefinitely. Cancel delivery tickets
    // now so callers and completed commands do not depend on transport cooperation.
    settleRound(flight.current)
    settleRound(queued)
    flight.controller?.abort()
  }

  async _drainRun(run, flight) {
    try {
      while (run.flight === flight && this._wanted(run, flight.epoch)) {
        const round = flight.current
        let response, failure, failed = false
        try {
          response = await this._fetchOnce(run, flight)
        } catch (error) {
          failure = error
          failed = true
        }
        if (run.flight !== flight || !this._wanted(run, flight.epoch)) {
          settleRound(round)
          break
        }
        const next = flight.queued
        flight.queued = undefined
        if (next) {
          flight.current = next
          flight.promise = next.promise
          this.inFlight.set(run.runKey, next.promise)
        } else {
          // Remove the flight before settling its last round: a later signal
          // either queues behind an active read or starts a new read, never a gap.
          this._detachFlight(run, flight)
        }
        // A command waits only for its selected round. Later timer/socket pulses
        // may keep this drain active, but cannot extend already-satisfied callers.
        settleRound(round, response, failure, failed)
        if (!next) break
      }
    } finally {
      this._detachFlight(run, flight)
      settleRound(flight.current)
      settleRound(flight.queued)
      flight.queued = undefined
    }
  }

  async _fetchOnce(run, flight) {
    if (!this._wanted(run, flight.epoch)) return undefined
    const controller = new AbortController()
    flight.controller = controller
    run.status = 'loading'
    run.error = undefined
    run.fetchStartedAt = nowIso()
    this._snapshot(run)
    this.notifyRun(run.runKey)
    if (!this._wanted(run, flight.epoch)) return undefined
    try {
      const response = deepFreeze(await this.queryOperation({
        id: run.operationName, operationName: run.operationName, params: run.params,
        kind: 'query', runtime: this, signal: controller.signal, generation: flight.epoch,
      }))
      if (!this._wanted(run, flight.epoch)) return undefined
      const fetchedAt = nowIso()
      const data = this.selectDataForOperation(run.operationName, response)
      if (!this._wanted(run, flight.epoch)) return undefined
      await this.ingestResult({
        operationName: run.operationName, params: run.params, response, data,
        fetchedAt, kind: 'query', signal: controller.signal, generation: flight.epoch,
      })
      if (!this._wanted(run, flight.epoch)) return undefined
      run.status = 'success'
      run.latestResponse = response
      run.data = data
      run.error = undefined
      run.lastFetchedAt = fetchedAt
      run.fetchStartedAt = undefined
      run.hasResponse = true
      this._snapshot(run)
      this.notifyRun(run.runKey)
      return response
    } catch (error) {
      if (!this._wanted(run, flight.epoch)) return undefined
      run.status = 'error'
      run.error = error instanceof Error ? error : deepFreeze(error)
      run.fetchStartedAt = undefined
      this._snapshot(run)
      this.notifyRun(run.runKey)
      throw error
    }
  }

  refetchRun(runKey) { return this.ensureRunFetched(runKey, { force: true }) }

  refresh(name, params) {
    operationName(name)
    if (params !== undefined) {
      const run = this._findRun(name, operationParams(params))
      return run ? this.refetchRun(run.runKey) : Promise.resolve(undefined)
    }
    const runs = [...this.subscriptionRegistry.runs.values()].filter((run) => run.operationName === name && this._wanted(run))
    return Promise.allSettled(runs.map((run) => this.refetchRun(run.runKey)))
  }

  runStillWanted(runKey) {
    const run = this.subscriptionRegistry.runs.get(runKey)
    return Boolean(run && this._wanted(run))
  }

  async command(name, params = {}, options = {}) {
    this._assertActive()
    operationName(name)
    const frozenParams = operationParams(params)
    const epoch = this._epoch
    const controller = new AbortController()
    this._commandControllers.add(controller)
    const operation = this.operationOptions.get(name)
    const virtual = operation?.virtual === true || operation?.fake === true || this.virtualCommands.has(name)
    try {
      const response = virtual
        ? deepFreeze({ mirrorless: { virtualCommand: name }, payload: { data: null } })
        : deepFreeze(await this.commandOperation({
          id: name, operationName: name, params: frozenParams, kind: 'mutation',
          runtime: this, signal: controller.signal, generation: epoch,
        }))
      if (this.disposed || epoch !== this._epoch) return response
      if (!virtual) {
        const data = this.selectDataForOperation(name, response)
        if (this.disposed || epoch !== this._epoch) return response
        await this.ingestResult({
          operationName: name, params: frozenParams, response, data, fetchedAt: nowIso(),
          kind: 'mutation', signal: controller.signal, generation: epoch,
        })
      }
      if (!this.disposed && epoch === this._epoch && options.invalidate !== false) {
        await this.invalidateCommand(name, { commandParams: frozenParams, commandResult: response, generation: epoch })
      }
      return response
    } finally {
      this._commandControllers.delete(controller)
    }
  }

  mutate(name, params = {}, options = {}) { return this.command(name, params, options) }

  async ingestResult(context) {
    const ingest = this.operationOptions.get(context.operationName)?.ingest ?? this.ingestOperationResult
    if (!ingest) return undefined
    return ingest({
      ...context, subscriptionRegistry: this.subscriptionRegistry, runtime: this,
      ...this.getIngestContext(),
    })
  }

  invalidateCommand(name, { commandParams = {}, commandResult, generation = this._epoch } = {}) {
    if (this.disposed || generation !== this._epoch) return Promise.resolve([])
    const selected = new Set()
    for (const target of updateTargetsForCommand(this.invalidationMaps, name)) {
      for (const run of this.subscriptionRegistry.runs.values()) {
        if (run.operationName !== target.queryName || !this._wanted(run, generation)) continue
        if (!updateTargetMatchesRun(target, run, { sourceParams: commandParams, equal: this.equal })) continue
        const matches = !target.predicate || target.predicate({
          queryParams: run.params, commandParams, commandResult,
          mutationParams: commandParams, mutationResult: commandResult,
          run: runRecord(this.subscriptionRegistry, run.runKey),
        })
        if (matches) selected.add(run.runKey)
      }
    }
    if (this.disposed || generation !== this._epoch) return Promise.resolve([])
    return Promise.allSettled([...selected].map((runKey) => this.ensureRunFetched(runKey, { force: true, invalidated: true })))
  }

  invalidateMutation(name, { mutationParams = {}, mutationResult } = {}) {
    return this.invalidateCommand(name, { commandParams: mutationParams, commandResult: mutationResult })
  }

  getSubscriptionRegistry() { return this.subscriptionRegistry }
  getIngestContext() { return this.ingestContext ?? {} }

  configure(options = {}) {
    this._assertActive()
    const nextDelay = options.unsubscribeDelayMs ?? options.unsubscribeGraceMs
    if (nextDelay !== undefined) interestDelay(nextDelay)
    if (options.query || options.executeOperation) this.queryOperation = queryDispatcher(options)
    if (options.command || options.executeOperation) this.commandOperation = commandDispatcher(options)
    if (options.executeOperation) this.executeOperation = options.executeOperation
    if (options.selectData) this.selectData = options.selectData
    if ('ingestOperationResult' in options) this.ingestOperationResult = options.ingestOperationResult
    if (options.ingestContext) this.ingestContext = options.ingestContext
    if (options.equal) this.equal = options.equal
    if ('onListenerError' in options) this.onListenerError = options.onListenerError
    if (options.unsubscribeDelayMs !== undefined || options.unsubscribeGraceMs !== undefined) {
      this.unsubscribeDelayMs = nextDelay
    }
    if (options.virtualCommands || options.fakeCommandOperations || options.fakeMutationOperations) {
      this.virtualCommands = new Set(options.virtualCommands ?? options.fakeCommandOperations ?? options.fakeMutationOperations)
      this.fakeCommandOperations = this.virtualCommands
    }
    if (options.updates || options.updatedBy || options.mutationInvalidatesQueries || options.queryInvalidatedByMutations) {
      const updates = options.updates ?? options.mutationInvalidatesQueries ?? this.rawMutationInvalidatesQueries()
      const suppliedReverse = options.updatedBy ?? options.queryInvalidatedByMutations
      const updatedBy = suppliedReverse ?? (this._explicitReverse ? this.rawQueryInvalidatedByMutations() : undefined)
      this.invalidationMaps = normalizeUpdateMaps({ updates, updatedBy })
      this._explicitReverse ||= suppliedReverse !== undefined
    }
    for (const operation of options.operations ?? []) this.registerOperation(operation.id ?? operation.name, operation)
    return this
  }

  registerOperation(id, options = {}) {
    this._assertActive()
    operationName(id)
    this.operationOptions.set(id, { ...options, id })
    return this
  }

  rawMutationInvalidatesQueries() {
    return Object.fromEntries(Object.entries(this.invalidationMaps.updates).map(([name, targets]) => [
      name,
      targets.some((target) => target.predicate)
        ? Object.fromEntries(targets.map((target) => [target.queryName, target.predicate ?? target.paramsPattern]))
        : targets.map((target) => target.term),
    ]))
  }

  rawQueryInvalidatedByMutations() {
    return Object.fromEntries(Object.entries(this.invalidationMaps.updatedBy).map(([name, targets]) => [name, targets.map((target) => target.term)]))
  }

  validateInvalidationMaps(options = {}) {
    return validateUpdateMaps({
      updates: this.rawMutationInvalidatesQueries(),
      updatedBy: this.rawQueryInvalidatedByMutations(),
      ...options,
    })
  }

  validateUpdates(options = {}) { return this.validateInvalidationMaps(options) }

  /**
   * Clear retained responses and ignore all prior asynchronous completions.
   * Interests survive and refetch by default. `subscriptions: true` explicitly
   * ends all subscriptions; callers must establish new interests afterward.
   */
  reset(options = {}) {
    this._assertActive()
    return this._reset(options)
  }

  _reset({ subscriptions = false, refetch = true } = {}) {
    this._epoch += 1
    const runs = [...this.subscriptionRegistry.runs.values()]
    const flights = runs.filter((run) => run.flight).map((run) => [run, run.flight])
    const commandControllers = [...this._commandControllers]
    this._commandControllers.clear()
    // Stage cleared state and detach every old round before abort callbacks can
    // reenter the runtime. New work must not attach to tickets from the old epoch.
    for (const run of runs) {
      if (run.flight) this._detachFlight(run, run.flight)
      run.status = 'idle'
      run.data = undefined
      run.latestResponse = undefined
      run.error = undefined
      run.lastFetchedAt = undefined
      run.fetchStartedAt = undefined
      run.hasResponse = false
      this._snapshot(run)
    }
    const listeners = subscriptions ? [...this.listenersByRunKey.values()].flatMap((records) => [...records]) : []
    const subscribers = subscriptions ? [...this.subscriptionRegistry.subscribers.values()] : []
    if (subscriptions) {
      for (const timer of this.unsubscribeTimers.values()) globalThis.clearTimeout(timer)
      this.unsubscribeTimers.clear()
      this.listenersByRunKey.clear()
      for (const subscriber of subscribers) {
        subscriber.active = false
        subscriber.released = true
      }
      // Abort callbacks are user code too. Give them the fresh registry before
      // cancelling captured work, or their new runs would be silently discarded.
      this.subscriptionRegistry = createSubscriptionRegistry()
    }
    for (const [run, flight] of flights) this._cancelFlight(run, flight)
    for (const controller of commandControllers) controller.abort()
    if (subscriptions) {
      // Abort- and notification-created subscriptions remain tracked. Retain old
      // subscriber records until this loop completes so reentrant unmount can
      // still deactivate a later queued final notification.
      try {
        for (const record of listeners) {
          if (!record.active) continue
          try { record.listener() } catch (error) { this._reportListenerError(error) }
          record.active = false
        }
      } finally {
        for (const record of listeners) record.active = false
        for (const subscriber of subscribers) subscriber.listeners.clear()
      }
    } else {
      for (const run of runs) this.notifyRun(run.runKey)
      if (refetch) for (const run of runs) if (this._wanted(run)) ignore(this.ensureRunFetched(run.runKey))
    }
    return this
  }

  /** Permanently end this identity/runtime lifetime; it cannot be configured or reused. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this._reset({ subscriptions: true, refetch: false })
  }
}

export function createMirrorless(options = {}) { return new MirrorlessRuntime(options) }
export { MirrorlessRuntime as ServerStateRuntime, createMirrorless as createServerState }
