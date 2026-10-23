// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import {
  DestroyRef,
  InjectionToken,
  PLATFORM_ID,
  assertInInjectionContext,
  computed,
  effect,
  inject,
  makeEnvironmentProviders,
  signal,
  untracked,
} from '@angular/core'
import { isPlatformBrowser } from '@angular/common'
import { cloneFrozenJson, sameParams } from '../core/index.js'

/** Provide one runtime for an application/session, never across authenticated SSR requests. */
export const MIRRORLESS_RUNTIME = new InjectionToken('Mirrorless runtime')

export function provideMirrorless(runtime) {
  if (!runtime || typeof runtime.observe !== 'function') {
    throw new TypeError('provideMirrorless requires a Mirrorless runtime')
  }
  return makeEnvironmentProviders([{ provide: MIRRORLESS_RUNTIME, useValue: runtime }])
}

export function injectMirrorlessRuntime() {
  assertInInjectionContext(injectMirrorlessRuntime)
  const runtime = inject(MIRRORLESS_RUNTIME, { optional: true })
  if (!runtime) {
    throw new Error('No Mirrorless runtime provided. Add provideMirrorless(runtime) to your application providers.')
  }
  return runtime
}

function resolve(source) {
  return typeof source === 'function' ? source() : source
}

function resolveTerm(name, params) {
  const operationName = resolve(name)
  if (typeof operationName !== 'string' || operationName.length === 0) {
    throw new TypeError('A Mirrorless query name must be a non-empty string')
  }
  const value = resolve(params) ?? {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Mirrorless query params must be a JSON-compatible object')
  }
  return { operationName, params: cloneFrozenJson(value) }
}

/**
 * Declare read interest from an Angular injection context.
 *
 * The returned read-only signal contains the delivery snapshot. Its `data`,
 * `loading`, `ready`, and `error` properties are convenient read-only signals;
 * none is an application-owned mutable copy of the returned server entities.
 * Initial errors are exposed, not thrown: templates explicitly choose the
 * loading/error/data branch. Existing data remains available during refresh.
 *
 * `name` and `params` may be ordinary values, signals, or getter functions.
 * Options are fixed for this resource's lifetime. Creating a resource starts
 * interest when Angular executes its effect, not during this function call.
 * Server-side subscription is opt-in and does not register PendingTasks or
 * automatically make Angular SSR await/serialize the result.
 */
export function injectMirrorlessQuery(name, params = {}, options = {}) {
  assertInInjectionContext(injectMirrorlessQuery)
  const runtime = options.runtime ?? injectMirrorlessRuntime()
  const destroyRef = inject(DestroyRef)
  const canSubscribe = options.ssr === true || isPlatformBrowser(inject(PLATFORM_ID))
  const { runtime: _runtime, ssr: _ssr, ...subscriptionOptions } = options
  let disposed = false

  // Comparing copied values avoids subscription churn when a getter produces
  // a fresh object containing the same params.
  const term = computed(() => resolveTerm(name, params), {
    equal: (previous, next) => (
      previous.operationName === next.operationName && sameParams(previous.params, next.params)
    ),
  })
  const observer = computed(() => {
    const current = term()
    return runtime.observe(current.operationName, current.params, subscriptionOptions)
  })
  const published = signal(undefined)

  // A new reactive term is visible synchronously, before Angular schedules
  // effect cleanup. An old observer can never supply data for the new term.
  const snapshot = computed(() => {
    const currentObserver = observer()
    const current = published()
    return current?.observer === currentObserver
      ? current.snapshot
      : currentObserver.getSnapshot()
  })

  const effectRef = effect((onCleanup) => {
    const currentObserver = observer()
    untracked(() => {
      if (disposed || !canSubscribe) return
      let listening = true
      const readSnapshot = () => {
        if (!disposed && listening) {
          published.set({ observer: currentObserver, snapshot: currentObserver.getSnapshot() })
        }
      }
      const stop = currentObserver.subscribe(readSnapshot)
      onCleanup(() => {
        listening = false
        stop()
      })
      readSnapshot()
    })
  }, { manualCleanup: true })

  const stopResource = () => {
    if (disposed) return
    disposed = true
    effectRef.destroy()
  }
  const unregisterDestroy = destroyRef.onDestroy(stopResource)

  return Object.assign(snapshot, {
    data: computed(() => snapshot().data),
    loading: computed(() => snapshot().loading),
    ready: computed(() => snapshot().data !== undefined),
    error: computed(() => snapshot().error),
    refetch: () => disposed
      ? Promise.resolve(undefined)
      : untracked(() => observer().refetch()),
    dispose: () => {
      unregisterDestroy()
      stopResource()
    },
  })
}
