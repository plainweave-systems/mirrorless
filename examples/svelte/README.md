# Svelte 5 + TypeScript

A real-HTTP task demo of **server data as component input, not Svelte-owned server state**.

## Run

From the repository root:

```sh
npm install
npm run demo:server
```

In a second terminal, from the root:

```sh
npm run demo:svelte
```

Open the URL Vite prints. `/api` is proxied to `http://127.0.0.1:4000`. The interchangeable Python or Go example server may replace the Node server; run only one server on that port at a time.

Check the TypeScript/Svelte templates and build the browser app with:

```sh
npm run check --workspace examples/svelte
npm run build --workspace examples/svelte
```

This example targets Svelte 5.57+, Vite 8, and TypeScript 5.9. It imports the workspace's local Mirrorless package; no published Mirrorless version is required.

## What to inspect

- `App.svelte` owns only a draft, selection, pending state, error text, and the live-refresh toggle.
- `TaskList.svelte` renders `GetTasks` and sends commands. It never patches a task array after a command.
- `TaskSummary.svelte` renders a separate `GetSummary` read. The server owns the count.
- `TaskDetail.svelte` declares `GetTask({ id })` when selected. A matching command refreshes it through the parameter-bound update rule.
- `../shared/task-api.js` adapts named reads and commands to ordinary HTTP. Its virtual `RefreshTasks` command drives manual and timer refresh.

The task list deliberately uses action buttons rather than a locally bound `done` checkbox: confirmed status does not change until the server's next read confirms it. A pending interaction is shown separately.

Turn on **Live refresh every two seconds** in two browser windows. Writes in one window then reach the other through timer-driven virtual commands. Turning it off stops that timer; local successful commands still refresh declared dependencies. No special realtime backend is needed.

## The normal component API

Provide one runtime during ancestor initialization:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { provideMirrorless } from 'mirrorless/svelte'
  import { createTaskRuntime } from '../shared/task-api.js'

  const runtime = createTaskRuntime()
  provideMirrorless(runtime)
  onDestroy(() => runtime.dispose())
</script>
```

A child renders plain successful data:

```svelte
<script lang="ts">
  import { MirrorlessQuery } from 'mirrorless/svelte'
  import type { Task } from '../shared/task-api.js'
  const TaskQuery = MirrorlessQuery<Task>
  let { id }: { id: string } = $props()
</script>

<TaskQuery id="GetTask" params={{ id }}>
  {#snippet loading(snapshot)}
    <p role="status">Loading {snapshot.operationName}…</p>
  {/snippet}
  {#snippet children(task: Task)}
    <h2>{task.title}</h2>
  {/snippet}
</TaskQuery>
```

The `MirrorlessQuery<Task>` instantiation supplies the result type explicitly: a runtime operation name alone cannot tell TypeScript the server response shape. In JavaScript, use `MirrorlessQuery` directly without the type instantiation.

`children` receives data, not a request-state wrapper. `null`, `false`, `0`, and empty arrays are successful values. While a later refresh is running or fails, prior confirmed data stays visible. Loading/error snippets describe the **first** value. If no error snippet is supplied, initial errors propagate to a Svelte error boundary (`<svelte:boundary>` requires Svelte 5.3+).

## Lower-level resource

`createMirrorlessQuery<T>(runtime, name, params?, options?)` is a readable-store-compatible resource with `subscribe`, `getSnapshot`, `setQuery`, `refetch`, and `dispose`.

```ts
import { createMirrorlessQuery } from 'mirrorless/svelte'
import type { Task } from '../shared/task-api.js'

const task = createMirrorlessQuery<Task>(runtime, 'GetTask', { id: '1' })
// No interest or request yet.
const stop = task.subscribe(snapshot => console.log(snapshot.data))
task.setQuery('GetTask', { id: '2' }) // clears id=1 data synchronously
await task.refetch()
stop()        // stop notifications immediately; runtime controls interest lease
// Re-subscribing remains valid until disposal.
task.dispose()
```

Value-equal parameter objects do not churn subscriptions. One resource shares an observer subscription across its consumers; different resources also share core read work for equal terms. Data and snapshots remain the runtime's immutable references, not deep Svelte proxies.

## SSR and lifetime

`MirrorlessQuery` constructs a side-effect-free observer during render and subscribes only inside `onMount`. Rendering it on the server does not fetch. Changing its name, params, or runtime cannot briefly show a previous term's data before Svelte's effects run.

A **manual resource subscription is an explicit declaration of interest**, on the server as well as the client. Svelte's `$store` syntax subscribes during SSR, so do not use `$query` in an SSR component if you intend fetch-free server rendering. Prefer the boundary, or subscribe manually inside `onMount` and return the cleanup function.

Create a runtime per authenticated browser session or deliberate server request. Do not share one authenticated global runtime across SSR requests. The provider does not dispose a runtime it does not own; the application decides its lifetime. This adapter does not claim automatic SSR prefetch or hydration of fetched results.
