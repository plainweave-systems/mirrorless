# Getting started

Start with a real server read and one ordinary renderer. Do not introduce a client entity store as an intermediate step.

## Install in an application

```sh
npm install mirrorless
```

Install your chosen framework separately, then import its adapter from a subpath such as `mirrorless/react`.

## Run the examples locally

Use Node 24.15+ within the Node 24 line for the repository's framework/build/browser-test toolchain. Install its development dependencies and start the local API from the repository root:

```sh
npm install
npm run demo:server
```

In a second terminal:

```sh
npm run demo:http
```

The [raw-URL example](../examples/http/README.md) uses ordinary GET and POST URLs directly, without renaming endpoints or introducing a routing table. It shows the architecture without a framework-specific state API. The fuller Vanilla, React, Preact, Vue, Svelte, Solid, Angular, and Lit demos use the same server with a named-operation integration; choose the corresponding `demo:*` script from `package.json`.

The API process owns its task collection. Browser demos own draft inputs, selection, and pending interactions. A successful command causes new list/detail/summary inputs to arrive; it does not make the demo patch a local task collection.

The [examples guide](examples.md) explains the interchangeable Python and Go servers, headless TypeScript and ClojureScript clients, and how to demonstrate external changes.

## Use the local package in an application

From a neighbouring application:

```sh
npm install ../mirrorless
```

The package is native ESM and includes TypeScript declarations. Import the core from `mirrorless` and your integration from a subpath such as `mirrorless/react`. Your framework remains an optional peer dependency rather than a core dependency.

The standalone package declares Node.js 20.19 or later. This does not mean its complete repository toolchain runs on that minimum: the installed Angular and browser-test tools require a newer environment, for which this repository uses Node 24.15+. The direct TypeScript example also uses Node's type-stripping support rather than a transpilation step.

## Use GET and POST URLs directly

For an existing REST API, a read's name can simply be its URL. `query(url, params, context)` performs a GET; `command(url, body, context)` performs a POST. These two generic functions are enough—there is no need to translate `/api/tasks` into `GetTasks` and back again.

```js
import { createMirrorless } from 'mirrorless'

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
  return body
}

const runtime = createMirrorless({
  query: (url, _params, { signal }) => request(url, { signal }),
  command: (url, body, { signal }) => request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }),
  updates: {
    '/api/tasks': ['/api/tasks', '/api/summary'],
    refresh: ['/api/tasks', '/api/summary'],
  },
  virtualCommands: ['refresh'],
})
```

The URLs go straight to `fetch`. This JSON API returns read representations for GET and acknowledgements for POST. HTTP failures must reject rather than trigger successful-command refreshes. Keep your normal credentials, validation, and transport policy at this boundary.

See the runnable [HTTP runtime](../examples/http/runtime.js) or the [README quick start](../README.md#quick-start). Named operations remain an option for RPC, GraphQL, and existing domain clients; see [transports](transports.md).

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
      <MirrorlessQuery id="/api/tasks" loading={() => <p>Loading…</p>}>
        {(tasks) => <TaskList tasks={tasks} />}
      </MirrorlessQuery>
    </MirrorlessProvider>
  )
}
```

The successful child is called after a value exists. It receives plain data, not a loading union that every display component must unpack. `null`, `false`, `0`, and empty arrays remain valid values.

Other adapters express the same boundary using slots, snippets, accessors, signals, controllers, or imperative render callbacks. See [frameworks](frameworks.md) for their actual interfaces.

## Add a command without adding a second collection

Suppose `POST /api/tasks` returns only `{ id }`. The update rule above declares that it can affect `GET /api/tasks` and `GET /api/summary`:

```js
const receipt = await runtime.command('/api/tasks', { title: 'Review proposal' })
// No tasks.push(...), list replacement, or summary-count increment.
```

After the POST succeeds, Mirrorless refreshes those interested reads. The form can clear its local draft; it does not patch the returned list or maintain a summary counter.

The GET and POST can have the same URL because reads and commands use separate dispatchers. The update rules describe consequences, not server routing.

A detail read can use `/api/tasks/1`, and a filtered read can include its query string directly in the URL. Mirrorless matches read names exactly: it does not strip query strings, match path prefixes, or infer which representations a write affects. Declare every affected URL explicitly. If an API needs parameterized operations or method-specific commands, the [transport guide](transports.md) and [update rules](update-rules.md) show those alternatives.

## Add TypeScript where it helps

The data boundary is the same in JavaScript and TypeScript. Describe the API's values without introducing writable server-state types for a store:

```ts
import type { QuerySnapshot } from 'mirrorless'

type Task = Readonly<{ id: string; title: string; done: boolean }>
type TaskSummary = Readonly<{ total: number; done: number }>

const tasks = runtime.subscribe<readonly Task[]>('/api/tasks', {}, { fetch: false })
const summary = runtime.subscribe<TaskSummary>('/api/summary', {}, { fetch: false })

function consume(snapshot: QuerySnapshot<readonly Task[]>) {
  if (snapshot.data !== undefined) {
    for (const task of snapshot.data) console.log(task.title)
  }
}

const stop = tasks.onChange(() => consume(tasks.getSnapshot()))
await Promise.all([tasks.refetch(), summary.refetch()])

const receipt = await runtime.command<{ id: string }>('/api/tasks', {
  title: 'Review proposal',
})
console.log(receipt.id)

stop()
tasks.unsubscribe()
summary.unsubscribe()
```

This snippet uses the GET/POST runtime defined above. The generic arguments describe expected values; they do not perform network schema validation. Validate responses at the dispatcher if your trust boundary requires it.

In normal component code, prefer the framework adapter to manual subscription management. The explicit API is useful for non-rendering consumers, tests, and integration work.

## Connect external change signals

The `refresh` event in the configuration above is a virtual command:

```js
await runtime.command('refresh')
```

It refreshes interested task and summary URLs without making a POST. A timer, focus handler, refresh button, or validated WebSocket notification can trigger it. The [liveness guide](liveness.md) includes cleanup and validated WebSocket recipes.

## Choose the runtime's lifetime deliberately

The runtime is not a process-wide store for every identity. Create it for the current application/session, stop its external triggers on teardown, and call `dispose()` when that scope ends.

For server rendering, use a client-first boundary or an explicitly request-scoped runtime. Do not put authenticated runtimes at module scope in a shared server process. See [security](security.md) and [SSR recipes](server-rendering.md).

## A useful first complete flow

Before migrating a whole application, make one command affect two independent consumers—for example a task list and a separately requested summary. Add a detail read next. Then make the same change outside that client and connect the desired liveness signal.

If those flows contain no fetched-entity patches and no parent coordinating every mounted request, you have established the boundary Mirrorless is intended to provide.
