// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import type { EnvironmentProviders, InjectionToken, Signal } from '@angular/core'
import type { MirrorlessRuntime, OperationParams, QuerySnapshot, SubscriptionOptions } from '../core/index.js'

/** A literal value, an Angular signal, or a getter reading Angular signals. */
export type MirrorlessSource<T> = T | (() => T)

export interface AngularQueryOptions extends SubscriptionOptions {
  /** Override the DI-provided runtime. An Angular injection context is still required for cleanup. */
  runtime?: MirrorlessRuntime
  /** Explicitly allow server-side subscription. Use a separate runtime per SSR request. Default: false. */
  ssr?: boolean
}

/**
 * Read-only delivery state. Data values are the core's original immutable
 * server responses, not deep-reactive or mutable copies of server entities.
 */
export type MirrorlessQuerySignal<T = unknown> = Signal<QuerySnapshot<T>> & {
  readonly data: Signal<T | undefined>
  readonly loading: Signal<boolean>
  /** True when data !== undefined, including during background refresh/errors. */
  readonly ready: Signal<boolean>
  readonly error: Signal<unknown>
  /** Refetch the currently interested term; no-op after explicit disposal. */
  readonly refetch: () => Promise<unknown>
  /** Optional early cleanup. Destroying the owning context also cleans up. */
  readonly dispose: () => void
}

export const MIRRORLESS_RUNTIME: InjectionToken<MirrorlessRuntime>

/**
 * Provide a runtime for this application/session. Does not take ownership of
 * disposing the runtime, which may be shared by multiple component resources.
 */
export function provideMirrorless(runtime: MirrorlessRuntime): EnvironmentProviders

/** Read the runtime from an Angular injection context, or throw if absent. */
export function injectMirrorlessRuntime(): MirrorlessRuntime

/**
 * Create a query resource in an Angular injection context (for example a
 * component field initializer). Angular effect execution starts interest;
 * DestroyRef releases it and immediately detaches result notifications.
 *
 * Initial loading and failure are explicit snapshot states. Templates must
 * check data !== undefined, not its truthiness: null, false, and 0 are data.
 * Options are fixed; name and params can be reactive getters/signals.
 * Server rendering does not subscribe unless ssr: true is explicitly passed.
 * That opt-in does not register Angular PendingTasks or provide SSR hydration.
 */
export function injectMirrorlessQuery<T = unknown>(
  name: MirrorlessSource<string>,
  params?: MirrorlessSource<OperationParams>,
  options?: AngularQueryOptions,
): MirrorlessQuerySignal<T>
