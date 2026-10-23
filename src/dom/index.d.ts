// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import type { MirrorlessRuntime, OperationParams, QuerySnapshot, SubscriptionOptions } from '../core/index.js'

export interface QueryBindingOptions<T = unknown> {
  runtime: MirrorlessRuntime
  id: string
  params?: OperationParams
  /** Receives plain available data, including null, false, 0, and empty arrays. */
  render(data: T): void
  loading?(snapshot: QuerySnapshot<T>): void
  /** Handles first-read errors; background errors retain and render prior data. */
  error?(snapshot: QuerySnapshot<T>): void
  options?: SubscriptionOptions
}

export interface QueryBinding<T = unknown> {
  /** Last snapshot delivered to this binding; reading it creates no interest. */
  readonly snapshot: QuerySnapshot<T>
  readonly data: T | undefined
  setQuery(id: string, params?: OperationParams): void
  refetch(): Promise<unknown>
  /** Stop notifications immediately; core may retain interest under its lease. */
  dispose(): void
}

/**
 * Bind immediately to a read. Without an error renderer, synchronous initial
 * errors are thrown; asynchronous initial errors use global reportError or an
 * uncaught microtask. Renderer exceptions follow the same asynchronous policy.
 */
export function bindQuery<T = unknown>(options: QueryBindingOptions<T>): QueryBinding<T>
