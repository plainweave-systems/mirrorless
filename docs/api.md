# Core API

Import the dependency-free runtime from `mirrorless`. Import framework integration from its [adapter subpath](frameworks.md).

This reference describes the public delivery interfaces. The package also exports compatibility and inspection helpers for the extracted application; they are not prerequisites for a mirrorless frontend.

## Create a runtime

```ts
import { createMirrorless, MirrorlessRuntime } from 'mirrorless'

const runtime = createMirrorless(options)
// Equivalent construction:
const another = new MirrorlessRuntime(options)
```

A runtime belongs to one application data-access scope. For authenticated applications, normally create one per user/session and replace it when that scope changes. Do not share one authenticated runtime across server requests.

### Configuration

| Option | Meaning |
| --- | --- |
| `query(name, params, context)` | Execute a named read. Return a value or promise; reject failures. |
| `command(name, params, context)` | Execute a named command. Resolve only when the API has confirmed success. |
| `updates` | Forward command-to-read patterns used to choose refreshes. |
| `updatedBy` | Optional reverse terms for operation-edge auditing. It does not drive execution. |
| `virtualCommands` | Array or set of command names that skip the command dispatcher and apply update rules directly. |
| `unsubscribeDelayMs` | Interest lease after cleanup. Default `120_000`. |
| `equal(a, b)` | Value equality used for core run identity and pattern comparison. Defaults to the supplied equality helper. |
| `selectData(response, { operationName })` | Select the component input from a response. Defaults to identity. |
| `ingestOperationResult(context)` | Optional downstream integration hook. No normalized projection is required. |
| `ingestContext` | Application fields supplied to ingestion hooks. |
| `operations` | Optional per-operation settings for selection, ingestion, and virtual commands. |
| `onListenerError(error)` | Report subscriber programming errors separately from request errors. |

The library does not require individually registering every operation. Two dispatchers can route the entire API.

### Dispatcher context

```ts
interface OperationContext {
  id: string
  operationName: string
  params: Readonly<Record<string, unknown>>
  kind: 'query' | 'mutation'
  runtime: MirrorlessRuntime
  signal: AbortSignal
  generation: number
}
```

The legacy `mutation` spelling is retained for execution compatibility. New application-facing calls use `runtime.command(...)`.

Pass `signal` to a cooperative transport such as `fetch`. `generation` identifies the current runtime lifetime generation. A signal or ignored response is not proof that a server command did not execute.

## Names, parameters, and values

Operation names must be non-empty strings. Parameters must be JSON-compatible objects; omitted or `null` parameters normalize to `{}`. The runtime copies and freezes them rather than freezing a caller-owned props object in place.

Use JSON values deliberately. Functions and `undefined` properties do not survive JSON serialization; symbols belong in update configuration, not transport parameters. Cyclic structures and values such as `BigInt` are not JSON-compatible.

Results are treated as immutable delivery values. Prefer plain JSON-compatible data. Freezing an object is not a general protocol for making every possible class, collection, or external resource immutable.

`undefined` is reserved for the absence of a renderable value. Return `null` when "no result" is an actual answer. A dispatcher that resolves to `undefined` can finish a request without providing a first value to the data boundary.

TypeScript generics describe your API's values; they do not validate network data at runtime. Validate untrusted responses at the transport boundary when necessary.

## Query snapshots

`QuerySnapshot<T>` contains:

| Field | Meaning |
| --- | --- |
| `runKey` | Internal run identity when one exists. Not an application entity ID. |
| `id`, `operationName` | The read name. |
| `params` | The copied parameter object for this term. |
| `status` | `idle`, `loading`, `success`, or `error`. |
| `loading` | Whether this run is currently loading. |
| `ready` | Whether `data !== undefined`, including retained data during refresh/errors. |
| `data` | Selected component input, or `undefined` before a value exists. |
| `response` | The retained raw dispatcher response. |
| `error` | The latest read error, if present. |
| `lastFetchedAt` | ISO timestamp of the latest accepted successful answer. |
| `fetchStartedAt` | ISO timestamp of the current request's start, if loading. |

Snapshots are immutable and stable by reference until observable data or metadata changes. They contain delivery metadata, not a separate mutable model of server entities.

A refresh retains previous `data` and `response`. A later error can coexist with `ready: true`. Use `data !== undefined` rather than status or truthiness to decide whether a successful renderer has input.

## Observers

```ts
const observer = runtime.observe<Task>('GetTask', { id: '1' })
```

Construction and `getSnapshot()` are side-effect-free. They do not start a request or create interest. Existing data for that exact term may already be visible from another interested consumer.

```js
const observer = runtime.observe('GetTask', { id: '1' })

function read() {
  const snapshot = observer.getSnapshot()
  if (snapshot.data !== undefined) renderTask(snapshot.data)
}

const stop = observer.subscribe(read)
read()

// Later:
stop()
```

`renderTask` is an application consumer. Reading after subscription observes any synchronous transition to loading or a reused value.

| Method | Behavior |
| --- | --- |
| `getSnapshot()` | Read the current stable snapshot without activating interest. |
| `subscribe(listener)` | Activate interest and notify on changes; return an idempotent cleanup function. |
| `refetch()` | Request another answer for an already-interested run; do not create permanent interest. |

Cleanup stops notifications immediately, then releases interest after the configured lease. The observer can be subscribed again. An observer for one term never changes into another term: construct a new observer when the name or parameter values change.

This interface is suitable for framework lifecycle integration. Prefer the existing adapters when available.

## Explicit subscriptions

```js
const subscription = runtime.subscribe('GetTasks', {}, { fetch: false })
const stopListening = subscription.onChange(() => {
  const snapshot = subscription.getSnapshot()
  // Consume data or metadata.
})

await subscription.refetch()
stopListening()
subscription.unsubscribe()
```

Unlike an observer's construction, `subscribe` declares interest immediately. Unless fetching is disabled, it obtains the first answer when needed. Multiple interests in value-equal terms share a run.

The returned `MirrorlessSubscription<T>` provides `getSnapshot`, `onChange`, `refetch`, `unsubscribe`, and identifying fields `subscriberId`, `runKey`, `operationName`, and `params`.

`onChange` attaches notifications; it is not an initial-value callback. Read the current snapshot explicitly after attaching. Calling `unsubscribe()` also removes that subscription's listeners immediately.

### Subscription options

- `fetch: false` declares interest without automatically initiating its first request. Explicit refetch or invalidation can still fetch it.
- `unsubscribeDelayMs` overrides the runtime's lease for this interest. `0` releases immediately. `Infinity`, or a negative value, retains the interest until an explicit runtime reset/disposal ends it.
- `kind` labels the interest for runtime inspection; it is not a different transport or consistency policy.

Do not use an infinite lease casually. It deliberately keeps interest—and possibly its retained server data—alive beyond component cleanup.

## Commands

```ts
const receipt = await runtime.command<{ id: string }>('CreateTask', {
  title: 'Review proposal',
})
```

The runtime copies parameters and calls the command dispatcher unless the command is virtual. For a normal successful command it selects/ingests the result, then selects interested reads through `updates` and waits for the resulting refresh work.

A command waits for the relevant selected read round, not an endless stream of future invalidations. If a selected read is already running, the command waits for its coalesced follow-up round. Signals arriving after that follow-up starts may request another round, but do not keep earlier command promises pending forever.

Read refreshes settle independently. A successful command response does not prove that every subsequent read succeeded; inspect read snapshots for those failures. A command dispatcher rejection skips its update rules. An ingestion-hook failure can also reject the command path, even if the server has already committed, so downstream hooks require an intentional error policy.

The command response is not required to contain a replacement read representation. It can be an acknowledgement such as `{ ok: true }` or `{ id: '3' }`.

```js
await runtime.command('RefreshTasks') // when declared in virtualCommands
```

A virtual command skips network command execution and command-result ingestion, then applies the same update rules. Its internal receipt is not a server response or domain representation; applications generally need only its completion.

`command(name, params, { invalidate: false })` explicitly skips update rules. Use this advanced escape hatch only when the application owns the omitted notification path. It should not become per-button refetch bookkeeping again.

There are no automatic retries or optimistic patches of delivered data. Concurrent commands are not a transaction and are not deduplicated into exactly-once execution.

## Refresh explicitly

```js
await runtime.refresh('GetTasks')
await runtime.refresh('GetTask', { id: '1' })
```

Without parameters, `refresh` targets all interested runs of that read name and returns their settled results. With parameters, it targets the matching existing run. It does not enumerate possible parameter combinations or create an application-wide cache of inactive reads.

Use a virtual command when the intended meaning is a related group of reads rather than one named read.

## Cells

An explicit consumer can receive snapshots in a small subscription cell:

```ts
import type { QuerySnapshot } from 'mirrorless'

const cell = runtime.createCell<QuerySnapshot<Task>>()
const stopCell = cell.subscribe((snapshot) => {
  if (snapshot.data !== undefined) consumeTask(snapshot.data)
})
const interest = runtime.subscribeCell(cell, 'GetTask', { id: '1' })

// Later:
stopCell()
interest.unsubscribe()
```

`consumeTask` is application code. `MirrorlessCell<T>` provides `get()`, `set(value)`, and `subscribe(listener)`. `subscribeCell` writes delivery snapshots into the supplied cell and returns the underlying subscription.

Cells are useful for explicit non-rendering consumers. They are not a mandatory entity store, a persistence layer, or a reason to turn every read into global application state.

## Configuration and per-operation settings

`runtime.configure(options)` updates execution/configuration for subsequent work and returns the runtime. `registerOperation(id, options)` supplies operation-specific selection, ingestion, or virtual-command behavior:

```js
runtime.registerOperation('GetTask', {
  selectData: (response) => response.task,
})

runtime.registerOperation('RefreshTasks', { virtual: true })
```

Per-operation `selectData` and `ingest` override the corresponding global hook. Reconfiguration is not a user-isolation mechanism and does not retroactively transform every retained snapshot. Refetch or reset when changing data-selection policy, and replace the runtime for a new identity.

## Optional ingestion

An ingestion hook receives the operation name, params, response, selected data, fetch timestamp, kind, abort signal, generation, runtime, subscription registry, and application ingestion context.

It runs before the accepted result is published. A hook rejection is therefore observable as operation failure. Keep hooks small, scope their external side effects to the same identity, and respect cancellation/generation when they perform asynchronous work.

`getIngestContext()` is an inheritance seam for integrations. The extracted banking application uses that seam for its separate projection; no banking database is included in the core package.

## Reset and disposal

```js
runtime.reset()                         // clear data, keep interests, refetch
runtime.reset({ refetch: false })       // clear data, keep interests, do not refetch yet
runtime.reset({ subscriptions: true })  // end interests; consumers must subscribe again
runtime.dispose()                      // permanent, idempotent teardown
```

Reset advances the generation so old asynchronous completions are ignored. Disposal also ends the runtime's usable lifetime. Replacing a runtime on logout or identity change is the recommended scope boundary.

Neither operation cancels arbitrary application event listeners or reverses already-committed server commands. See [security](security.md).

## Update helpers and auditing

`validateUpdateMaps({ updates, updatedBy?, knownQueries?, knownCommands? })` returns error strings. `runtime.validateUpdates(...)` audits the runtime's maps. With `updates` alone, a name-level reverse map can be derived for inspection.

Validation checks malformed terms, known operation names, and forward/reverse edge presence. It does not prove the logical equivalence of parameter predicates, infer missing business dependencies, or establish that every server change path has been covered.

`reverseUpdateMap(updates)` produces a name-only inverse for inspection; it does not logically invert arbitrary parameter bindings or predicates. The forward `updates` map alone drives runtime selection.

The root exports operation-term matching helpers and normalized-map helpers for tooling and tests. See [update rules](update-rules.md) before building configuration tooling around them.

## Compatibility and integration helpers

The extraction retains aliases including `ServerStateRuntime`, `createServerState`, `ServerStateCell`, `mutate`, the older invalidation option/helper names, `fakeCommandOperations`, `fakeMutationOperations`, and `unsubscribeGraceMs`. Prefer the Mirrorless names in new code.

The root also exports equality, JSON freezing/cloning, `ValueRef` helpers, and subscription-registry inspection functions. They support adapters and existing integrations. Registry records and raw run keys are not an application entity-store API; do not mutate them to patch server data.
