# Framework adapters

All adapters deliver the same thing: the server's read value as component input. They differ in how their framework expresses scope, lifecycle, and rendering.

A query snapshot is delivery metadata, not an invitation to copy its `data` into another mutable entity collection. Use the data boundary for ordinary rendering and the lower-level interface when the interaction actually needs request metadata or explicit control.

## Shared behavior

A read is identified by its name and value-equal parameters. Before its first value, a boundary can render loading or handle an initial error. After a value exists, it remains available during a refresh or refresh failure. `null`, `false`, `0`, and empty values are valid data; only `undefined` means no renderable value exists.

Cleanup stops notifications immediately. The core's interest lease can retain the underlying run afterward. Replacing a query term must not display the previous term's data while the new request is being established.

Frameworks are optional peers. Import only the adapter you use. A runtime is explicitly supplied or injected; adapters do not require a global singleton.

## React

```jsx
import {
  MirrorlessProvider,
  MirrorlessQuery,
} from 'mirrorless/react'

function Tasks({ runtime }) {
  return (
    <MirrorlessProvider runtime={runtime}>
      <MirrorlessQuery
        id="GetTasks"
        loading={() => <p>Loading…</p>}
        error={() => <p role="alert">Tasks are unavailable.</p>}
      >
        {(tasks) => <TaskList tasks={tasks} />}
      </MirrorlessQuery>
    </MirrorlessProvider>
  )
}
```

`TaskList` is your ordinary data-rendering component. The success child receives data only. `render={data => ...}` is an alternative to the child function. Loading and error components receive the query snapshot. Without an error component, an initial read error is thrown to the surrounding React error boundary.

For metadata, use the hook:

```tsx
import { useMirrorlessQuery } from 'mirrorless/react'

type Task = { id: string; title: string; done: boolean }

function Detail({ id }: { id: string }) {
  const query = useMirrorlessQuery<Task>('GetTask', { id })
  if (query.data === undefined) {
    if (query.status === 'error') throw query.error
    return <p>Loading…</p>
  }
  async function refresh() {
    try {
      await query.refetch()
    } catch {
      // The snapshot renders the read failure below.
    }
  }
  return (
    <section>
      <h2>{query.data.title}</h2>
      {query.loading && <small>Refreshing…</small>}
      {query.status === 'error' && <small>Could not refresh.</small>}
      <button onClick={refresh}>Refresh</button>
    </section>
  )
}
```

Handle the explicit refetch promise as well as choosing how to display its read-error snapshot.

`useMirrorlessRuntime()` obtains the enclosing runtime for commands. The hook also accepts an explicit `{ runtime }` option. React uses the external-store lifecycle rather than starting a request while rendering. StrictMode can connect and disconnect subscriptions without requiring a special application workaround.

### React Native

The same adapter supports React Native because the provider, hook, and query boundary do not depend on ReactDOM. Supply native loading/error components and native success content:

```jsx
import { ActivityIndicator, Text } from 'react-native'
import { MirrorlessQuery } from 'mirrorless/react'

function TaskTitle({ id }) {
  return (
    <MirrorlessQuery id="GetTask" params={{ id }} loading={ActivityIndicator}>
      {(task) => <Text>{task.title}</Text>}
    </MirrorlessQuery>
  )
}
```

`MirrorlessLoadingSpinner` is a web-only convenience renderer; do not use it as a native view. A mobile application's foreground/reconnect policy should emit its chosen virtual commands using that platform's lifecycle events.

## Preact

Import the same interface names from the Preact subpath:

```jsx
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/preact'
```

Use Preact components and hooks throughout the tree. The separate adapter owns a Preact context; it is not a request to alias React globally or mix renderer contexts. The boundary, hook, error, and parameter semantics follow the React interface.

## Vue

Provide the runtime through an app plugin:

```js
import { createApp } from 'vue'
import { createMirrorlessPlugin } from 'mirrorless/vue'
import App from './App.vue'
import { runtime } from './runtime.js'

createApp(App).use(createMirrorlessPlugin(runtime)).mount('#app')
```

A Vue boundary uses scoped slots:

```vue
<script setup>
import { MirrorlessQuery } from 'mirrorless/vue'
import TaskList from './TaskList.vue'
</script>

<template>
  <MirrorlessQuery id="GetTasks">
    <template #loading><p>Loading…</p></template>
    <template #error><p role="alert">Tasks are unavailable.</p></template>
    <template #default="{ data }">
      <TaskList :tasks="data" />
    </template>
  </MirrorlessQuery>
</template>
```

The default slot receives `{ data }`; loading and error slots receive the snapshot. With no local error slot, an initial error propagates through Vue's error handling.

The composable returns an object containing a read-only shallow snapshot ref and `refetch`:

```js
import { useMirrorlessQuery } from 'mirrorless/vue'

const query = useMirrorlessQuery(
  'GetTask',
  () => ({ id: props.id }),
)

// In setup code:
const snapshot = query.snapshot.value
```

Names, parameters, and options can be values, refs, or getters. The shallow boundary does not convert frozen responses into a mutable Vue domain model. The composable must run during component setup; interest activates on mount and stops with the component's scope.

For a subtree provider, call `provideMirrorless(runtime)` during an ancestor's setup. `useMirrorlessRuntime()` obtains the injected runtime for commands. You can also pass a runtime explicitly through the composable options or query component's `runtime` prop.

## Svelte 5

Set context in a parent component:

```svelte
<script>
  import { provideMirrorless } from 'mirrorless/svelte'
  let { runtime, children } = $props()
  provideMirrorless(runtime)
</script>

{@render children?.()}
```

The query boundary accepts Svelte snippets:

```svelte
<script>
  import { MirrorlessQuery } from 'mirrorless/svelte'
</script>

<MirrorlessQuery id="GetTasks">
  {#snippet loading()}
    <p>Loading…</p>
  {/snippet}
  {#snippet error(snapshot)}
    <p role="alert">Tasks are unavailable.</p>
  {/snippet}
  {#snippet children(tasks)}
    <ul>
      {#each tasks as task (task.id)}
        <li>{task.title}</li>
      {/each}
    </ul>
  {/snippet}
</MirrorlessQuery>
```

The boundary activates in `onMount`, so its server render does not start reads. It accepts an explicit `runtime` prop as an alternative to context. Initial errors without an error snippet can propagate to a Svelte boundary.

For explicit resource control:

```js
import { createMirrorlessQuery } from 'mirrorless/svelte'

const query = createMirrorlessQuery(runtime, 'GetTask', { id: '1' })
const stop = query.subscribe((snapshot) => {
  // Consume metadata or data without making a mutable copy.
})
query.setQuery('GetTask', { id: '2' })
stop()
query.dispose()
```

The resource follows the readable-store contract: its first consumer activates interest; its last consumer releases it. `setQuery` changes the term, `getSnapshot` inspects it without activating it, and `refetch` targets current interest.

**SSR distinction:** Svelte's automatic `$store` subscription can run during server rendering. The plain resource's explicit subscription is a real subscription, regardless of environment. Use the component boundary for client-first rendering, or deliberately scope and manage a server subscription per request. Do not assume that every use of a readable store is client-only.

## Solid

```tsx
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/solid'

function Tasks(props) {
  return (
    <MirrorlessProvider runtime={props.runtime}>
      <MirrorlessQuery id="GetTasks" loading={() => <p>Loading…</p>}>
        {(tasks) => <TaskList tasks={tasks} />}
      </MirrorlessQuery>
    </MirrorlessProvider>
  )
}
```

For reactive parameters, pass accessors to the query hook:

```tsx
const query = useMirrorlessQuery<Task>(
  'GetTask',
  () => ({ id: props.id }),
)

// Read the current snapshot with query(); request another answer with:
await query.refetch()
```

The hook must run within a Solid owner, such as a component or `createRoot`. Interest activates through its effect and is released by owner cleanup. Construction and server rendering do not themselves start requests.

Solid render callbacks and persistent components have different lifetimes. `children(data)` can recreate its subtree when a new result arrives. If that subtree owns interaction state that must survive incoming values, use the boundary's `component` form:

```tsx
<MirrorlessQuery id="GetTask" params={{ id: props.id }} component={TaskEditorView} />
```

`TaskEditorView` receives reactive `props.data`; keep drafts local with a deliberate policy for incoming server changes. This avoids resetting an editor merely because the read refreshed.

Changing a Solid provider's `runtime` prop switches descendant queries reactively and hides the old runtime's data immediately. `useMirrorlessRuntime()` resolves the current context at invocation time; when commands must follow provider changes, retain a reactive accessor rather than capturing one runtime during setup:

```tsx
import { createMemo } from 'solid-js'
import { useMirrorlessRuntime } from 'mirrorless/solid'

const runtime = createMemo(useMirrorlessRuntime)
// Inside a command handler:
await runtime().command('UpdateTask', { id: '1', done: true })
```

Create that memo inside a Solid owner. Snapshot-level access exposes background loading/errors; the normal boundary keeps prior data available and throws an unhandled initial error to Solid's `ErrorBoundary`.

## Angular

Provide a runtime in the application's dependency-injection scope:

```ts
import { bootstrapApplication } from '@angular/platform-browser'
import { provideMirrorless } from 'mirrorless/angular'

bootstrapApplication(App, {
  providers: [provideMirrorless(runtime)],
})
```

`App` and `runtime` are application values. The adapter itself ships functions and signals, not an uncompiled template component.

Inside an injection context, request a typed query:

```ts
import { injectMirrorlessQuery } from 'mirrorless/angular'

type Task = { id: string; title: string; done: boolean }

export class TaskPanel {
  readonly tasks = injectMirrorlessQuery<Task[]>('GetTasks')
}
```

The result is a read-only snapshot signal with convenience signals:

```html
@if (tasks.ready()) {
  <ul>
    @for (task of tasks.data() ?? []; track task.id) {
      <li>{{ task.title }}</li>
    }
  </ul>
} @else if (tasks().status === 'error') {
  <p role="alert">Tasks are unavailable.</p>
} @else {
  <p>Loading…</p>
}
```

The template above belongs in an ordinary Angular component. The adapter does not turn the returned task array into writable Angular state.

Names and parameters may be values, signals, or getter functions. The resource exposes `data`, `loading`, `ready`, `error`, `refetch()`, and `dispose()` in addition to the snapshot signal. `injectMirrorlessRuntime()` obtains the injected runtime for commands.

Interest starts when Angular runs the effect and stops through `DestroyRef`. By default it activates only in the browser; `{ ssr: true }` explicitly permits server activation and requires a request-scoped runtime. Unlike the render-prop boundaries, the signal interface exposes errors rather than automatically throwing them: templates decide how to present initial and background failure.

## Lit

Use a controller whose interest follows the host's connection:

```ts
import { LitElement, html } from 'lit'
import { MirrorlessController } from 'mirrorless/lit'
import { runtime } from './runtime.js'

type Task = { id: string; title: string; done: boolean }

class TaskList extends LitElement {
  private readonly tasks = new MirrorlessController<Task[]>(this, {
    runtime,
    id: 'GetTasks',
  })

  render() {
    const query = this.tasks.snapshot
    if (query.data === undefined) {
      return query.status === 'error'
        ? html`<p role="alert">Tasks are unavailable.</p>`
        : html`<p>Loading…</p>`
    }
    return html`<ul>${query.data.map((task) => html`<li>${task.title}</li>`)}</ul>`
  }
}

customElements.define('task-list', TaskList)
```

Here `runtime.js` is your browser application's session-scoped runtime module, as in the README example. An element/context arrangement can supply the runtime instead. Do not use this module-level pattern for an authenticated runtime in a shared server process.

The controller exposes `snapshot`, `data`, `error`, `setQuery(id, params)`, `refetch()`, and `dispose()`. Construction starts no request. Connection activates interest, disconnection releases it, and reconnection can reuse a leased run. Ordinary disconnection is not permanent disposal.

The controller exposes initial errors in its snapshot rather than throwing from a data getter. Your render method chooses the presentation.

## Vanilla JavaScript and TypeScript

```js
import { bindQuery } from 'mirrorless/dom'

const target = document.querySelector('#task-title')
const binding = bindQuery({
  runtime,
  id: 'GetTask',
  params: { id: '1' },
  loading: () => { target.textContent = 'Loading…' },
  error: () => { target.textContent = 'Task unavailable' },
  render: (task) => { target.textContent = task.title },
})

binding.setQuery('GetTask', { id: '2' })
await binding.refetch()
binding.dispose()
```

`runtime` is the application runtime. `bindQuery` activates interest immediately. It does not create or interpolate DOM nodes; your renderer controls safe DOM APIs. Use `textContent` or your template system's escaping for server values rather than constructing untrusted HTML strings.

Without an error callback, a synchronous initial failure can throw to the caller. An asynchronous failure is reported through the host's error-reporting mechanism; ordinary DOM callbacks do not have a framework error boundary around them. Supply an error renderer when local failure handling is intended.

## Other renderers and explicit consumers

Use the [core observer API](api.md#observers) to connect lifecycle and notifications to another renderer. Use explicit subscriptions or cells for non-rendering consumers. Those interfaces are delivery primitives, not a requirement to make your framework's state mechanism the owner of server entities.

Every adapter must release its listener and interest, keep new query terms isolated from old data, and avoid accidental cross-user sharing. Those requirements do not change with the syntax used to render a component.
