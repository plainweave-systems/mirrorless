export type OperationParams = Record<string, unknown>
export type Equality = (a: unknown, b: unknown) => boolean
export type Unsubscribe = () => void
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error'

/** Immutable delivery metadata; data remains available during refresh and later errors. */
export interface QuerySnapshot<T = unknown> {
  readonly runKey: string | undefined
  readonly id: string
  readonly operationName: string
  readonly params: Readonly<OperationParams>
  readonly status: QueryStatus
  readonly loading: boolean
  /** True when data !== undefined, including null/false/0 and retained previous values. */
  readonly ready: boolean
  readonly data: T | undefined
  readonly response: unknown
  readonly error: unknown
  readonly lastFetchedAt: string | undefined
  readonly fetchStartedAt: string | undefined
}

export interface SubscriptionOptions {
  fetch?: boolean
  kind?: string
  /** Interest lease after listener cleanup. Default 120000ms; Infinity retains until reset/dispose. */
  unsubscribeDelayMs?: number
}

export interface MirrorlessObserver<T = unknown> {
  /** Inert and referentially stable until observable data/metadata changes. */
  getSnapshot(): QuerySnapshot<T>
  /** Establish interest; cleanup stops notifications immediately, then releases the interest lease. */
  subscribe(listener: () => void): Unsubscribe
  /** Refetch an interested run, joining its current read round without waiting for later invalidations. */
  refetch(): Promise<unknown>
}

export interface MirrorlessSubscription<T = unknown> {
  readonly subscriberId: string
  readonly runKey: string
  readonly operationName: string
  readonly params: Readonly<OperationParams>
  getSnapshot(): QuerySnapshot<T>
  onChange(listener: () => void): Unsubscribe
  /** Join the current read round, or start one; subsequent signals do not extend this promise. */
  refetch(): Promise<unknown>
  unsubscribe(): void
}

export interface OperationContext {
  readonly id: string
  readonly operationName: string
  readonly params: Readonly<OperationParams>
  /** The legacy mutation spelling is retained for executeOperation compatibility. */
  readonly kind: 'query' | 'mutation'
  readonly runtime: MirrorlessRuntime
  readonly signal: AbortSignal
  readonly generation: number
}

export type OperationDispatcher = (name: string, params: Readonly<OperationParams>, context: OperationContext) => unknown | PromiseLike<unknown>
export type LegacyOperationDispatcher = (context: OperationContext) => unknown | PromiseLike<unknown>
export type DataSelector = (response: unknown, context: { operationName: string }) => unknown

export interface IngestionContext {
  operationName: string
  params: Readonly<OperationParams>
  response: unknown
  data: unknown
  fetchedAt: string
  kind: 'query' | 'mutation'
  signal: AbortSignal
  generation: number
  runtime: MirrorlessRuntime
  subscriptionRegistry: SubscriptionRegistry
  [key: string]: unknown
}

export type IngestOperationResult = (context: IngestionContext) => unknown | PromiseLike<unknown>
export type ParamsPattern = Readonly<Record<string, unknown>>
export type OperationTerm = string | readonly [string] | readonly [string, ParamsPattern]

export interface UpdatePredicateContext {
  queryParams: Readonly<OperationParams>
  commandParams: Readonly<OperationParams>
  commandResult: unknown
  /** @deprecated Use commandParams. */
  mutationParams: Readonly<OperationParams>
  /** @deprecated Use commandResult. */
  mutationResult: unknown
  run: Record<string, unknown>
}

export type UpdatePredicate = (context: UpdatePredicateContext) => boolean
export type UpdateEntries = OperationTerm | readonly OperationTerm[] | Readonly<Record<string, ParamsPattern | UpdatePredicate | true | null | undefined>>
export type UpdateMap = Readonly<Record<string, UpdateEntries>>

export interface OperationOptions {
  id?: string
  name?: string
  selectData?: DataSelector
  ingest?: IngestOperationResult | null
  virtual?: boolean
  /** @deprecated Use virtual. */
  fake?: boolean
}

export interface MirrorlessOptions {
  query?: OperationDispatcher
  command?: OperationDispatcher
  updates?: UpdateMap
  /** Optional reverse terms for operation-edge auditing; updates alone drives execution. */
  updatedBy?: UpdateMap
  virtualCommands?: readonly string[] | ReadonlySet<string>
  unsubscribeDelayMs?: number
  equal?: Equality
  selectData?: DataSelector
  ingestOperationResult?: IngestOperationResult | null
  ingestContext?: Record<string, unknown>
  operations?: readonly OperationOptions[]
  /** Listener programming errors are reported separately, never treated as request errors. */
  onListenerError?: (error: unknown) => void
  /** @deprecated Prefer separate query and command dispatchers. */
  executeOperation?: LegacyOperationDispatcher
  /** @deprecated Use updates. */
  mutationInvalidatesQueries?: UpdateMap
  /** @deprecated Use updatedBy. */
  queryInvalidatedByMutations?: UpdateMap
  /** @deprecated Use virtualCommands. */
  fakeCommandOperations?: readonly string[] | ReadonlySet<string>
  /** @deprecated Use virtualCommands. */
  fakeMutationOperations?: readonly string[] | ReadonlySet<string>
  /** @deprecated Use unsubscribeDelayMs. */
  unsubscribeGraceMs?: number
}

export interface CommandOptions { invalidate?: boolean }
export interface ResetOptions {
  /** Default false: preserve interests. True permanently ends existing subscriptions. */
  subscriptions?: boolean
  /** Default true: preserved interests refetch after their retained data is cleared. */
  refetch?: boolean
}

export interface SubscriptionRegistry {
  runs: Map<string, Record<string, unknown>>
  subscribers: Map<string, Record<string, unknown>>
  runSubscribers: Map<string, Set<string>>
}

export class MirrorlessRuntime {
  constructor(options?: MirrorlessOptions)
  readonly disposed: boolean
  readonly subscriptionRegistry: SubscriptionRegistry
  readonly virtualCommands: Set<string>
  /** @deprecated Use virtualCommands. */
  readonly fakeCommandOperations: Set<string>
  readonly inFlight: Map<string, Promise<unknown>>
  equal: Equality
  unsubscribeDelayMs: number
  observe<T = unknown>(name: string, params?: OperationParams | null, options?: SubscriptionOptions): MirrorlessObserver<T>
  subscribe<T = unknown>(name: string, params?: OperationParams | null, options?: SubscriptionOptions): MirrorlessSubscription<T>
  createCell<T = unknown>(initialValue?: T): MirrorlessCell<T>
  subscribeCell<T = unknown>(cell: { set(value: QuerySnapshot<T>): void }, name: string, params?: OperationParams | null, options?: SubscriptionOptions): MirrorlessSubscription<T>
  /** Await execution and each affected read round selected by this command, not future unrelated signals. */
  command<T = unknown>(name: string, params?: OperationParams | null, options?: CommandOptions): Promise<T>
  /** @deprecated Alias of command. */
  mutate<T = unknown>(name: string, params?: OperationParams | null, options?: CommandOptions): Promise<T>
  refresh(name: string): Promise<PromiseSettledResult<unknown>[]>
  refresh(name: string, params: OperationParams): Promise<unknown>
  configure(options: MirrorlessOptions): this
  registerOperation(id: string, options?: OperationOptions): this
  selectDataForOperation(name: string, response: unknown): unknown
  getIngestContext(): Record<string, unknown>
  getSubscriptionRegistry(): SubscriptionRegistry
  ingestResult(context: Omit<IngestionContext, 'runtime' | 'subscriptionRegistry'>): Promise<unknown>
  /** Coalesce into the next round behind an active read; each caller waits only for that bounded round. */
  invalidateCommand(name: string, context?: { commandParams?: OperationParams; commandResult?: unknown; generation?: number }): Promise<PromiseSettledResult<unknown>[]>
  /** @deprecated Prefer command or invalidateCommand. */
  invalidateMutation(name: string, context?: { mutationParams?: OperationParams; mutationResult?: unknown }): Promise<PromiseSettledResult<unknown>[]>
  rawMutationInvalidatesQueries(): UpdateMap
  rawQueryInvalidatedByMutations(): UpdateMap
  validateUpdates(options?: UpdateValidationNames): string[]
  /** @deprecated Alias of validateUpdates. */
  validateInvalidationMaps(options?: UpdateValidationNames): string[]
  /** Clear data and invalidate old async work; interests survive/refetch unless subscriptions is true. */
  reset(options?: ResetOptions): this
  /** Terminal and idempotent; prefer a fresh runtime when identity changes. */
  dispose(): void
}

export function createMirrorless(options?: MirrorlessOptions): MirrorlessRuntime
/** @deprecated Use MirrorlessRuntime. */
export { MirrorlessRuntime as ServerStateRuntime }
/** @deprecated Use createMirrorless. */
export { createMirrorless as createServerState }

export class MirrorlessCell<T = unknown> {
  constructor(initialValue?: T)
  value: T | undefined
  get(): T | undefined
  set(value: T): void
  subscribe(listener: (value: T) => void): Unsubscribe
}
/** @deprecated Use MirrorlessCell. */
export { MirrorlessCell as ServerStateCell }

export function sameParams(a?: unknown, b?: unknown): boolean
export function sameValue(a: unknown, b: unknown): boolean
export function freezingReviver(key: string, value: unknown): unknown
export function parseFrozenJson<T = unknown>(text: string): T
export function deepFreeze<T>(value: T): T
export function cloneJson<T>(value: T): T
export function cloneFrozenJson<T>(value: T): T
export class ValueRef<T = unknown> { constructor(value: T); value: T }
export function valueRef<T>(value: T | ValueRef<T>): ValueRef<T>
export function derefValue<T>(value: T | ValueRef<T>): T

export interface NormalizedOperationTerm { readonly operationName: string; readonly paramsPattern: ParamsPattern }
export function normalizeOperationTerm(term: OperationTerm): NormalizedOperationTerm
export function symbolBindingKey(symbol: symbol): string | undefined
export function resolvePatternValue(patternValue: unknown, sourceParams?: OperationParams): { found: boolean; value: unknown }
export function paramsMatchPattern(targetParams?: OperationParams, paramsPattern?: ParamsPattern, sourceParams?: OperationParams, equal?: Equality): boolean
export function operationMatchesTerm(name: string, params: OperationParams, term: OperationTerm, sourceParams?: OperationParams, equal?: Equality): boolean

export interface NormalizedUpdateTarget extends NormalizedOperationTerm {
  readonly queryName?: string
  readonly commandName?: string
  readonly predicate?: UpdatePredicate
  readonly term: OperationTerm
}
export interface NormalizedUpdateMaps {
  readonly updates: Readonly<Record<string, readonly NormalizedUpdateTarget[]>>
  readonly updatedBy: Readonly<Record<string, readonly NormalizedUpdateTarget[]>>
  readonly mutationInvalidatesQueries: Readonly<Record<string, readonly NormalizedUpdateTarget[]>>
  readonly queryInvalidatedByMutations: Readonly<Record<string, readonly NormalizedUpdateTarget[]>>
}
export interface UpdateValidationNames {
  knownQueries?: ReadonlySet<string>
  knownCommands?: ReadonlySet<string>
  /** @deprecated Use knownCommands. */
  knownMutations?: ReadonlySet<string>
}
export interface UpdateMapOptions extends UpdateValidationNames {
  updates?: UpdateMap
  updatedBy?: UpdateMap
  mutationInvalidatesQueries?: UpdateMap
  queryInvalidatedByMutations?: UpdateMap
}
export function normalizeUpdateMaps(options?: UpdateMapOptions): NormalizedUpdateMaps
/** Name-only inverse for inspecting edges; parameter predicates are not logically inverted. */
export function reverseUpdateMap(updates?: UpdateMap): Record<string, string[]>
/** Audits known names and edge presence, not logical equivalence of parameter patterns. */
export function validateUpdateMaps(options?: UpdateMapOptions): string[]
export function updateTargetsForCommand(maps: NormalizedUpdateMaps, name: string): readonly NormalizedUpdateTarget[]
export function updateTargetMatchesRun(target: NormalizedUpdateTarget, run: { params?: OperationParams }, options?: { sourceParams?: OperationParams; equal?: Equality }): boolean
export {
  normalizeUpdateMaps as normalizeInvalidationMaps,
  reverseUpdateMap as reverseInvalidationMap,
  validateUpdateMaps as validateInvalidationMaps,
  updateTargetsForCommand as invalidationTargetsForMutation,
  updateTargetMatchesRun as invalidationTargetMatchesRun,
}

export function defaultQueryOperation(context: Pick<OperationContext, 'id'>): never
export function defaultCommandOperation(context: Pick<OperationContext, 'id'>): never
export function defaultSelectData<T>(response: T): T
export function defaultIngestOperationResult(): undefined
export {
  defaultQueryOperation as coreDefaultQueryOperation,
  defaultCommandOperation as coreDefaultCommandOperation,
  defaultSelectData as coreDefaultSelectData,
  defaultIngestOperationResult as coreDefaultIngestOperationResult,
}

export function createSubscriptionRegistry(): SubscriptionRegistry
export function subscriptionRegistry(registry: SubscriptionRegistry): SubscriptionRegistry
export function allRuns(registry: SubscriptionRegistry): Record<string, unknown>[]
export function runRecord(registry: SubscriptionRegistry, runKey: string): Record<string, unknown> | undefined
export function findRunKey(registry: SubscriptionRegistry, name: string, params?: OperationParams, equal?: Equality): string | undefined
export function runKeysForOperation(registry: SubscriptionRegistry, name: string): string[]
export function activeRunKeysForOperation(registry: SubscriptionRegistry, name: string): string[]
export function subscriberIdsForRun(registry: SubscriptionRegistry, runKey: string): string[]
