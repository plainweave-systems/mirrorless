# Getting started

Start with a real server read and one ordinary renderer. Do not introduce a client entity store as an intermediate step.

## Run the examples locally

The repository is not presented as an already-published npm release. Use Node 24.15+ within the Node 24 line for its framework/build/browser-test toolchain. Install its development dependencies and start the local API from the repository root:

```sh
npm install
npm run demo:server
```

In a second terminal:

```sh
npm run demo:vanilla
```

The vanilla example shows the architecture without a framework-specific state API. The React, Preact, Vue, Svelte, Solid, Angular, and Lit examples use the same server and shared task runtime; choose the corresponding `demo:*` script from `package.json`.

The API process owns its task collection. Browser demos own draft inputs, selection, and pending interactions. A successful command causes new list/detail/summary inputs to arrive; it does not make the demo patch a local task collection.

The [examples guide](examples.md) explains the interchangeable Python and Go servers, headless TypeScript and ClojureScript clients, and how to demonstrate external changes.

## Use the local package in an application

From a neighbouring application:

```sh
npm install ../mirrorless
```

The package is native ESM and includes TypeScript declarations. Import the core from `mirrorless` and your integration from a subpath such as `mirrorless/react`. Your framework remains an optional peer dependency rather than a core dependency.

The standalone package declares Node.js 20.19 or later. This does not mean its complete repository toolchain runs on that minimum: the installed Angular and browser-test tools require a newer environment, for which this repository uses Node 24.15+. The direct TypeScript example also uses Node's type-stripping support rather than a transpilation step.

## Define two dispatchers

`query(name, params, context)` obtains a read answer. `command(name, params, context)` executes a write and rejects if it is not confirmed.

Keep your existing API client, credentials, serialization, and protocol policy at this boundary. Mirrorless does not require a special endpoint or a new backend protocol.

A minimal REST read can look like this:

```js
import { createMirrorless } from 'mirrorless'

const runtime = createMirrorless({
  async query(name, params, context) {
    if (name !== 'GetTasks') throw new Error(`Unknown read: ${name}`)
    const response = await fetch('/api/tasks', { signal: context.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  },
})
```

This runtime supports one read. It does not yet define any server commands. An unknown command must not be silently treated as successful.

For a complete read/write dispatcher, use the [README quick start](../README.md#quick-start) or the actual [shared demo integration](../examples/shared/task-api.js).

## Put a data boundary at the point of use

In React:

```jsx
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/react'

function TaskList({ tasks }) {
  return <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
}

export function TasksPage({ runtime }) {
  return (
    <MirrorlessProvider runtime={runtime}>
      <MirrorlessQuery id="GetTasks" loading={() => <p>Loading…</p>}>
        {(tasks) => <TaskList tasks={tasks} />}
      </MirrorlessQuery>
    </MirrorlessProvider>
  )
}
```

The successful child is called after a value exists. It receives plain data, not a loading union that every display component must unpack. `null`, `false`, `0`, and empty arrays remain valid values.

Other adapters express the same boundary using slots, snippets, accessors, signals, controllers, or imperative render callbacks. See [frameworks](frameworks.md) for their actual interfaces.

## Add a command without adding a second collection

Suppose `CreateTask({ title })` returns only `{ id }`. Declare that it can affect `GetTasks` and `GetSummary`:

```js
const updates = {
  CreateTask: ['GetTasks', 'GetSummary'],
}
```

The form awaits `runtime.command('CreateTask', { title })`, then clears its local draft if appropriate. It does not append an invented task to the returned list or increment a client-maintained summary.

For detail reads, a parameter binding can narrow the affected term:

```js
const updates = {
  UpdateTask: [
    'GetTasks',
    ['GetTask', { id: Symbol.for('id') }],
    'GetSummary',
  ],
}
```

The symbol means the detail read's `id` must equal the successful command's `id`. It is dependency selection, not a transformation of read data. Start broad for filtered lists and narrow only with enough information; [membership changes](update-rules.md#collection-membership-is-the-common-trap) deserve particular care.

## Add TypeScript where it helps

The data boundary is the same in JavaScript and TypeScript. Describe the API's values without introducing writable server-state types for a store:

```ts
import type { QuerySnapshot } from 'mirrorless'

type Task = Readonly<{ id: string; title: string; done: boolean }>
type TaskSummary = Readonly<{ total: number; done: number }>

const tasks = runtime.subscribe<readonly Task[]>('GetTasks', {}, { fetch: false })
const summary = runtime.subscribe<TaskSummary>('GetSummary', {}, { fetch: false })

function consume(snapshot: QuerySnapshot<readonly Task[]>) {
  if (snapshot.data !== undefined) {
    for (const task of snapshot.data) console.log(task.title)
  }
}

const stop = tasks.onChange(() => consume(tasks.getSnapshot()))
await Promise.all([tasks.refetch(), summary.refetch()])

const receipt = await runtime.command<{ id: string }>('CreateTask', {
  title: 'Review proposal',
})
console.log(receipt.id)

stop()
tasks.unsubscribe()
summary.unsubscribe()
```

This snippet assumes the complete task runtime from the shared demo integration, not the read-only minimal runtime earlier on this page. The generic arguments describe expected values; they do not perform network schema validation. Validate responses at the dispatcher if your trust boundary requires it.

In normal component code, prefer the framework adapter to manual subscription management. The explicit API is useful for non-rendering consumers, tests, and integration work.

## Connect external change signals

Configure a virtual command:

```js
const runtime = createMirrorless({
  query: readFromApi,
  command: writeToApi,
  virtualCommands: ['RefreshTasks'],
  updates: { RefreshTasks: ['GetTasks', 'GetTask', 'GetSummary'] },
})
```

`readFromApi` and `writeToApi` are application dispatchers. A timer or event handler can call `runtime.command('RefreshTasks')` without making a network write. The [liveness guide](liveness.md) includes cleanup and validated WebSocket recipes.

## Choose the runtime's lifetime deliberately

The runtime is not a process-wide store for every identity. Create it for the current application/session, stop its external triggers on teardown, and call `dispose()` when that scope ends.

For server rendering, use a client-first boundary or an explicitly request-scoped runtime. Do not put authenticated runtimes at module scope in a shared server process. See [security](security.md) and [SSR recipes](server-rendering.md).

## A useful first complete flow

Before migrating a whole application, make one command affect two independent consumers—for example a task list and a separately requested summary. Add a detail read next. Then make the same change outside that client and connect the desired liveness signal.

If those flows contain no fetched-entity patches and no parent coordinating every mounted request, you have established the boundary Mirrorless is intended to provide.
