// Copyright 2026 Plainweave Systems. SPDX-License-Identifier: Apache-2.0
import type { ReactiveController, ReactiveControllerHost } from 'lit'
import type { MirrorlessRuntime, OperationParams, QuerySnapshot, SubscriptionOptions } from '../core/index.js'

export interface MirrorlessControllerOptions {
  runtime: MirrorlessRuntime
  id: string
  params?: OperationParams
  options?: SubscriptionOptions
}

/**
 * Read interest follows the host's connection. Construction/disconnection does
 * not fetch, notifications stop immediately at disconnect, and reconnection
 * reuses a retained core run when its interest lease has not expired.
 *
 * data is undefined until available. Check snapshot.status === 'error' to
 * render local first-read failures; snapshot.error may itself be undefined or
 * another falsy rejection reason. The data getter does not throw.
 */
export class MirrorlessController<T = unknown> implements ReactiveController {
  constructor(host: ReactiveControllerHost, options: MirrorlessControllerOptions)
  readonly snapshot: QuerySnapshot<T>
  readonly data: T | undefined
  readonly error: unknown
  setQuery(id: string, params?: OperationParams): void
  /** Does not start work while disconnected. */
  refetch(): Promise<unknown>
  hostConnected(): void
  hostDisconnected(): void
  /** Permanently detach and remove the controller from its host. */
  dispose(): void
}
