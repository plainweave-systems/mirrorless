# Mirrorless + Lit (TypeScript)

This example keeps server data out of application-owned state. Three independent read interests feed the task list, server summary, and optional selected-task details. The only mutable application fields are the input draft, selection, pending/error presentation, and a live-refresh toggle.

## Run

From the repository root, after installing development dependencies:

```sh
# Terminal 1: any one of the interchangeable example HTTP servers
npm run demo:server

# Terminal 2
npm run demo:lit
```

Open the Vite address printed in terminal 2. Its `/api` proxy points to `http://127.0.0.1:4000`. The Python and Go servers implement the same API and may replace the Node server without changing this frontend.

```sh
npm run build --workspace examples/lit
```

The build first type-checks this example and the imported adapter declarations, then produces a Vite browser bundle.

## What to try

1. Add a task. The write returns only its new ID. The list and summary arrive through their own server reads; the command handler does not append to a client-side array or increment a client-side count.
2. Open task details and toggle the task. The list, selected task, and summary refresh through the declared command rules.
3. Notice that the checkbox keeps its confirmed value while the server command is pending. The example does not patch read data optimistically.
4. Enable **Live refresh every 2 seconds**, open another tab, and change a task there. The timer emits the virtual `RefreshTasks` command; the same update rules refresh interested reads. There is no separate live-state store.
5. Stop the API server and refresh. Initial failures have an explicit retry UI; a later refresh failure keeps previously confirmed data available. A rejected write preserves the local input draft.

## Lit integration

Create controllers in the host constructor or field initializers—not during `render()`:

```ts
import { LitElement, html } from 'lit'
import { MirrorlessController } from 'mirrorless/lit'
import { createTaskRuntime, type Task } from '../../shared/task-api.js'

const runtime = createTaskRuntime()

class TaskList extends LitElement {
  private tasks = new MirrorlessController<Task[]>(this, {
    runtime,
    id: 'GetTasks',
  })

  render() {
    const query = this.tasks.snapshot
    if (query.data === undefined) {
      if (query.status === 'error') return html`<p role="alert">Unable to load tasks.</p>`
      return html`<p role="status">Loading…</p>`
    }
    return html`<ul>${query.data.map(task => html`<li>${task.title}</li>`)}</ul>`
  }
}
```

`MirrorlessController` is a normal Lit `ReactiveController`. Construction is inert. `hostConnected` establishes read interest, notifications request a host update, and `hostDisconnected` immediately stops host notifications while releasing interest under the core's configurable lease. Reconnecting can reuse a retained result. `setQuery(name, params)` changes the read without exposing another term's data. `refetch()` does not start work while disconnected. `dispose()` permanently removes the controller from the host.

The controller exposes the core's immutable snapshot and plain data directly. It does not make a deeply reactive or separately writable copy of server entities. Check `snapshot.status === 'error'` for local first-read error presentation and inspect `snapshot.error` for the rejection reason; that reason may itself be `undefined`, `null`, or another falsy value. Reading `controller.data` does not throw. `null`, `false`, `0`, and empty arrays are valid data, so test for `undefined` rather than truthiness.

The example uses Lit's escaped template interpolation and the shared example stylesheet. It opts into light DOM only so all example styles can be shared; applications may use the default shadow DOM normally.

## Verification

The `lit` Vitest project renders real Lit elements in jsdom and exercises the example's create/update/delete interactions, independent read refreshes, pending behavior, local draft preservation, and server-error presentation:

```sh
npm exec -- vitest run --project lit
```

The dependency-free Node adapter tests also cover controller connection, reconnection, term changes, and disposal:

```sh
npm run test:dom
```

These are automated DOM checks, not a screenshot or browser visual review.
