# Preact · TypeScript / TSX

An independent Preact adapter and a real HTTP-backed task demo. The package imports `preact`, `preact/hooks`, and `preact/compat`—not React or ReactDOM. The compatibility module supplies Preact's `useSyncExternalStore` implementation.

## Run

From the Mirrorless repository root, after installing development dependencies:

```sh
# Terminal 1
npm run demo:server

# Terminal 2
npm run demo:preact
```

Open Vite's printed local URL. The dev server proxies `/api` to `http://127.0.0.1:4000`. Python and Go implementations can replace the Node demo server without changing this interface.

```sh
# Strict TypeScript check followed by a production Vite build
npm run build --workspace examples/preact
```

See [`main.tsx`](main.tsx) and the shared [`task-api.js`](../shared/task-api.js)/[`task-api.d.ts`](../shared/task-api.d.ts).

## Typed server inputs, not a client task store

```tsx
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/preact'
import type { Task } from '../shared/task-api.js'

<MirrorlessProvider runtime={runtime}>
  <MirrorlessQuery<Task[]> id="GetTasks" loading={Loading} error={QueryFailure}>
    {(tasks) => <TaskList tasks={tasks} />}
  </MirrorlessQuery>
</MirrorlessProvider>
```

The type argument describes the selected response. It does not generate runtime validation; the transport remains responsible for validating the API and rejecting protocol/application errors.

The list, detail, and summary have separate read interests. Command handlers call `runtime.command(...)` and update only local draft/selection/pending UI. The update rules refresh server inputs without manually patching a task array or summary count.

Enable timer-driven live refresh and open two tabs to see external changes flow through the same virtual command rules. Timer refresh is opt-in; a WebSocket notification can emit the same command instead.

## Lifecycle and errors

- Value-equal inline parameters reuse an observer instead of resubscribing on each render.
- Changing the operation, parameters, or runtime immediately selects the correct new observer; old-term data is never briefly shown as the new term.
- Loading/error props are real Preact components and may use hooks.
- Initial errors reach the nearest Preact error boundary unless a local error component is supplied.
- Last-received data stays visible during refresh and later errors; the hook also exposes delivery metadata when needed.
- Listener cleanup is immediate. Core interest retention is a separate configurable lease.
- Server rendering does not establish subscriptions or start network requests. Use per-request/session runtimes; this adapter does not promise automatic SSR hydration.
- The provider does not dispose an externally owned runtime. Dispose it when its owner/session ends.
