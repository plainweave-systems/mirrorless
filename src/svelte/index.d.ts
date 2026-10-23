// Copyright 2026 Plainweave Systems
// SPDX-License-Identifier: Apache-2.0
import type { Component, Snippet } from 'svelte'
import type { Readable } from 'svelte/store'
import type { MirrorlessRuntime, OperationParams, QuerySnapshot, SubscriptionOptions } from 'mirrorless'

/** Context key only; no global runtime or authenticated state is stored here. */
export declare const MIRRORLESS_CONTEXT: unique symbol

/** Call during Svelte component initialization. The app owns runtime disposal. */
export declare function provideMirrorless(runtime: MirrorlessRuntime): MirrorlessRuntime

/** Call during initialization beneath provideMirrorless; throws if absent. */
export declare function useMirrorlessRuntime(): MirrorlessRuntime

export interface MirrorlessQueryResource<T = unknown> extends Readable<QuerySnapshot<T>> {
  /** Inspect the current term without declaring interest or starting a fetch. */
  getSnapshot(): QuerySnapshot<T>
  /** Switch synchronously; value-equal terms/options preserve the subscription. */
  setQuery(id: string, params?: OperationParams, options?: SubscriptionOptions): void
  /** Refetch an already-interested run; does not create permanent interest. */
  refetch(): Promise<unknown>
  /** Stop listeners immediately and release interest under the runtime's lease. */
  dispose(): void
}

/**
 * Lazy readable-store resource. A manual subscribe() is an explicit declaration
 * of interest, including on the server. For fetch-free SSR use MirrorlessQuery,
 * or activate manual subscriptions inside onMount and use a per-request runtime.
 */
export declare function createMirrorlessQuery<T = unknown>(
  runtime: MirrorlessRuntime,
  id: string,
  params?: OperationParams,
  options?: SubscriptionOptions,
): MirrorlessQueryResource<T>

export interface MirrorlessQueryProps<T = unknown> {
  id: string
  params?: OperationParams
  options?: SubscriptionOptions
  /** Override a runtime provided by an ancestor. Never shared globally. */
  runtime?: MirrorlessRuntime
  /** Called only once a value exists; null, false, and 0 are successful values. */
  children?: Snippet<[data: T]>
  /** First-value loading only; old data remains visible during refresh. */
  loading?: Snippet<[snapshot: QuerySnapshot<T>]>
  /** First-value failure only; omitted errors propagate to a Svelte boundary. */
  error?: Snippet<[snapshot: QuerySnapshot<T>]>
}

/**
 * Svelte 5 data boundary. Subscribes on client mount, never during SSR render.
 * Source is compiled by your Svelte tooling. Use <svelte:boundary> on Svelte 5.3+
 * to catch initial errors, or pass the local error snippet.
 */
export declare function MirrorlessQuery<T = unknown>(
  internals: Parameters<Component<MirrorlessQueryProps<T>>>[0],
  props: MirrorlessQueryProps<T>,
): ReturnType<Component<MirrorlessQueryProps<T>>>
