# Mirrorless

**Server data as component input, not client-owned application state.**

Your server already has state. Your frontend does not need an incomplete, independently maintained model of it.

Mirrorless delivers server data to components and keeps that data moving as things change. Application code keeps genuinely local state—drafts, selection, navigation, pending interactions—without also maintaining server-derived entity collections, patching them after commands, and coordinating those patches across views.

```jsx
<MirrorlessQuery id="/api/tasks" loading={LoadingTasks}>
  {(tasks) => <TaskList tasks={tasks} />}
</MirrorlessQuery>
```

`TaskList` receives data. It does not own fetching, loading, subscriptions, or a second task database.

## The idea

```text
server data ───────────────────────────► component input
local interaction ────────────────────► local state

successful command / timer / event
  └─► refresh affected, interested reads
      └─► deliver new component input
```

Views declare the reads they need. Applications declare which commands can affect those reads. Mirrorless handles delivery, shared requests, refresh, and subscription lifetime.

A timer can keep selected reads live. A WebSocket event can trigger a virtual command. Ordinary successful writes use the same refresh rules. **A bespoke backend is not required:** reads and commands can use an existing REST, GraphQL, RPC, or other asynchronous API.

The runtime retains responses internally so it can deliver and reuse them. That is not a server-state model your application must own. The distinction is architectural responsibility, not a claim that browser memory contains no server data.

## Installation

```sh
npm install mirrorless
```

Import the core from `mirrorless` and your framework adapter from a subpath such as `mirrorless/react`. Install your chosen framework separately; adapters use optional peer dependencies.

The standalone library declares Node.js 20.19 or later. Mirrorless is native ESM and includes TypeScript declarations.

## Local development

This repository is the initial extraction from `up-web`. Use **Node 24.15 or later in the Node 24 line** for repository development: the installed framework and browser-test toolchains have newer requirements than the standalone runtime.

From this repository:

```sh
npm install
npm run demo:server
```

In another terminal, choose a browser demo:

```sh
npm run demo:http
# Minimal raw-URL GET/POST example, without operation-name routing.
# Or demo:react, demo:preact, demo:vue, demo:svelte, demo:solid,
# demo:angular, demo:lit, demo:vanilla
```

From a neighbouring application, use the local package:

```sh
npm install ../mirrorless
```

The repository's development-toolchain requirement is separate from the standalone library's Node.js minimum. Importing `mirrorless` does not import every adapter.

## Quick start

### Connect an existing API

This example uses the same task endpoints as the [demo servers](docs/examples.md). Writes deliberately return acknowledgements rather than complete read representations.

```js
import { createMirrorless } from 'mirrorless'

async function request(url, options = {}) {
  const response = await fetch(url, options)
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
  return body
}

export const runtime = createMirrorless({
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

A read's `id` is its actual GET URL. `runtime.command('/api/tasks', body)` sends a POST to that same URL. There is no `GetTasks`/`CreateTask` routing table or per-endpoint wrapper. The update rule says that a successful POST affects the task list and summary; it does not copy the command receipt into either read.

Try the runnable [raw-URL example](examples/http/README.md). Named operations are still useful for RPC, GraphQL, or an existing domain client; they are optional, not a prerequisite for using REST. See [transports](docs/transports.md) for both styles.

### Render plain data

```jsx
import { useState } from 'react'
import {
  MirrorlessProvider,
  MirrorlessQuery,
  useMirrorlessRuntime,
} from 'mirrorless/react'
import { runtime } from './runtime.js'

function LoadingTasks() {
  return <p>Loading tasks…</p>
}

function TaskList({ tasks }) {
  return <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
}

function CreateTask() {
  const runtime = useMirrorlessRuntime()
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    if (pending || !title.trim()) return
    setPending(true)
    setError(null)
    try {
      await runtime.command('/api/tasks', { title: title.trim() })
      setTitle('')
    } catch (cause) {
      setError(cause)
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <button disabled={pending}>{pending ? 'Adding…' : 'Add task'}</button>
      {error && <p role="alert">Could not add the task.</p>}
    </form>
  )
}

export function App() {
  return (
    <MirrorlessProvider runtime={runtime}>
      <CreateTask />
      <MirrorlessQuery id="/api/summary">
        {(summary) => <p>{summary.done} of {summary.total} completed</p>}
      </MirrorlessQuery>
      <MirrorlessQuery id="/api/tasks" loading={LoadingTasks}>
        {(tasks) => <TaskList tasks={tasks} />}
      </MirrorlessQuery>
    </MirrorlessProvider>
  )
}
```

The title, pending flag, and error are local interaction state. There is no `setTasks`, client-side task reducer, or summary-count patch. After the command succeeds, the relevant server reads provide the next inputs.

Create runtimes at the appropriate application/session boundary. The module-level runtime above is suitable for a browser-only example, not an authenticated server-rendering process shared by multiple requests. See [runtime lifetime and security](docs/security.md).

### Make it live

```js
const timer = setInterval(() => {
  runtime.command('refresh').catch((error) => {
    console.error('Refresh trigger failed', error)
  })
}, 2000)

// When this application/session stops:
clearInterval(timer)
```

`refresh` is a virtual event, not a POST URL: it makes no command request, but applies the same update rules. A focus event or validated WebSocket notification can invoke it too. See [liveness](docs/liveness.md) for complete setup and cleanup recipes.

## Framework adapters

| Environment | Import | Interface |
| --- | --- | --- |
| React and React Native | `mirrorless/react` | Provider, data boundary, hooks |
| Preact | `mirrorless/preact` | Provider, data boundary, hooks |
| Vue | `mirrorless/vue` | Injection, composable, scoped-slot boundary |
| Svelte | `mirrorless/svelte` | Context, readable query resource, snippet boundary |
| Solid | `mirrorless/solid` | Context, query accessor, data boundary |
| Angular | `mirrorless/angular` | Dependency injection and signal queries |
| Lit | `mirrorless/lit` | ReactiveController |
| Vanilla JS/TS | `mirrorless/dom` | Data binding with explicit cleanup |
| Other renderers and non-UI consumers | `mirrorless` | Observers, subscriptions, cells |

The [framework guide](docs/frameworks.md) covers the idioms and lifecycle differences. Repository checks exercise the installed versions; peer ranges do not mean every historical framework version has been tested. React Native uses the React adapter rather than a separately device-tested renderer. [Server-rendering recipes](docs/server-rendering.md) discuss Next.js, Nuxt, SvelteKit, Astro, and React Router without assuming automatic hydration support.

## What Mirrorless does—and does not ask you to do

- **Do** declare reads at the point of use and the known effects of commands once.
- **Do** keep drafts, selection, and pending interactions in ordinary local state.
- **Do** reject failed transport or application operations in your dispatchers.
- **Do** connect timers or external signals when external changes should become visible.
- **Do not** patch read responses to pretend that an unconfirmed write has succeeded.
- **Do not** assume the library discovers dependencies or unannounced writes.
- **Do not** infer transactionally consistent snapshots from several independent reads.

There are no automatic query or command retries, optimistic server-data patches, mandatory normalized entity store, or required transport protocol. A failed initial read can reach a local error renderer or framework boundary; previously received data remains available during subsequent refreshes and refresh failures.

## Documentation

Start with [Why Mirrorless?](docs/why-mirrorless.md) and [Getting started](docs/getting-started.md).

- [Architecture and the `live-components` inheritance](docs/architecture.md)
- [Core API](docs/api.md)
- [Update rules and parameter bindings](docs/update-rules.md)
- [Local state, forms, and pending commands](docs/local-state.md)
- [Timers, focus, reconnect, and WebSocket liveness](docs/liveness.md)
- [REST, GraphQL, and RPC transports](docs/transports.md)
- [Framework adapters](docs/frameworks.md)
- [SSR and meta-frameworks](docs/server-rendering.md)
- [Runtime lifetime and security](docs/security.md)
- [Testing](docs/testing.md)
- [Initial extraction verification and limits](docs/verification.md)
- [Incremental migration](docs/migration.md)
- [Examples and language choices](docs/examples.md)
- [Contributing](CONTRIBUTING.md)

## License

Apache-2.0. Copyright Plainweave Systems. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
