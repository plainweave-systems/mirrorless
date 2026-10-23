# Angular task example

A standalone Angular application using ordinary signals for **client-local** draft,
selection, and pending/error feedback. Mirrorless's query signals deliver immutable
server responses to the task list, summary, and selected detail. Commands do not
patch those responses; the shared runtime's declared update rules refresh the
interested reads.

## Run

Install the repository's approved development dependencies from the Mirrorless
root, then use two terminals:

```sh
# From the Mirrorless repository root:
npm run demo:server
```

```sh
# In another terminal, from the same root:
npm run demo:angular
```

Open <http://127.0.0.1:4200>. Angular's development server proxies `/api/**` to the
real local HTTP API at `127.0.0.1:4000`. The Node, Python, and Go demo servers are
interchangeable; start only one on that port.

Enable **Live refresh every two seconds** in two browser tabs. Changes made in
one tab arrive in the other through the virtual `RefreshTasks` command. Turning
the switch off or destroying the component removes its timer.

```sh
npm run build --workspace examples/angular
npm run typecheck --workspace examples/angular
```

The demo uses the official Angular CLI `@angular/build:application` builder, so
its TypeScript decorators, templates, and required signal inputs are actually
compiled by Angular—not assumed to work through a generic Vite TypeScript pass.
Its dependency versions target Angular 22 / TypeScript 6. The published adapter
uses only ordinary ESM JavaScript and Angular 19+ signals/DI APIs; it does not ship
Angular decorators, templates, or a compiler dependency.

## How data reaches the template

```ts
readonly tasks = injectMirrorlessQuery<Task[]>('GetTasks')
```

```html
@let result = tasks();
@if (result.data !== undefined) {
  @for (task of result.data; track task.id) {
    <p>{{ task.title }}</p>
  }
} @else if (result.error) {
  <p role="alert">The initial read failed.</p>
} @else {
  <p role="status">Loading…</p>
}
```

The signal is read-only delivery metadata, not an application-owned mutable task
store. Do not use truthiness as readiness: `null`, `false`, and `0` are valid query
data. A subsequent refresh keeps prior data available and exposes `loading` or
`error` alongside it. Unlike render-boundary adapters, the Angular helper does not
automatically throw initial read errors; the template explicitly handles them.

A changing input is a getter or signal:

```ts
readonly task = injectMirrorlessQuery<Task>('GetTask', () => ({ id: this.taskId() }))
```

Equal-value params do not re-subscribe. When the ID changes, reading the resource
immediately refers to the new term—even before the next Angular effect flush—so
the old task cannot be rendered under the new ID.

The component's `DestroyRef` stops notifications and releases read interest. The
runtime may retain that interest under its configured lease (two minutes by
default), which is separate from active component listeners. `query.dispose()`
is available for early cleanup; it does not dispose the shared runtime.

## Server rendering

The default adapter does not subscribe on an Angular server platform. Explicit
server delivery can use `{ ssr: true }` with a separate runtime per request; no
automatic hydration or server-prefetch serialization is provided. The opt-in does
not register Angular `PendingTasks` or guarantee that SSR waits for the response;
applications must coordinate deliberate server loading themselves. Never reuse an
authenticated runtime across requests. The demo itself is a client application.

## Local state and command feedback

The app keeps only draft input, selected ID, the live switch, and feedback locally.
An update checkbox restores the last confirmed native value while the command is
pending; only the refetched server result changes the displayed task. Command
failures are caught and displayed; there are no automatic retries or optimistic
entity patches.
