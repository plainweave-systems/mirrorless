# Solid + TypeScript

A real-HTTP example of Mirrorless's separation: server data arrives at rendering boundaries; only drafts, selection, pending interactions, errors, and the live-refresh switch are local state.

## Run

From the repository root, after the root development dependencies are installed:

```sh
# Terminal 1: interchangeable Node, Python, or Go task API
npm run demo:server

# Terminal 2: Solid development server
npm run demo:solid
```

Open the local Vite URL printed in terminal 2. The development server proxies `/api` to `http://127.0.0.1:4000`.

Enable **Live refresh every 2 seconds** in two browser tabs. A change made in one tab becomes visible in the other through timer-emitted virtual `RefreshTasks` commands. Refresh now uses the same update rules. This is polling-based liveness, not a requirement for server-specific subscriptions.

```sh
npm run build --workspace mirrorless-example-solid
npm exec -- vitest run --project solid
```

The browser example uses the shared task transport in `../shared/task-api.js`. Task mutations intentionally do not return the same shapes as the reads. There is no local task collection to patch and no local copy of summary counts.

## Solid adapter

The native ESM adapter needs no JSX compiler of its own:

```tsx
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/solid'

<MirrorlessProvider runtime={runtime}>
  <MirrorlessQuery<Task[]> id="GetTasks" loading={<p>Loading…</p>}>
    {(tasks) => <ul>{tasks.map(task => <li>{task.title}</li>)}</ul>}
  </MirrorlessQuery>
</MirrorlessProvider>
```

Initial errors propagate to Solid's `ErrorBoundary` unless an `error` component/element is supplied. Loading/error components receive the query snapshot. The successful callback receives only data. `null`, `0`, `false`, empty strings, and empty arrays are values—not loading states. Confirmed content remains visible during refresh and background read errors.

### Preserve an interactive component instance

Solid does not reconcile component instances like React. A `children(data)` callback gets a new plain immutable value for each result and its subtree is recreated for that result. Background status changes alone do not recreate it.

For a result-rendering component that also owns interactive local state, use the `component` form. It receives reactive `props.data` while retaining its instance as subsequent successful results arrive:

```tsx
const Tasks: Component<{ data: Task[] }> = (props) => {
  // Other local signals can live here; don't copy props.data into one.
  return <For each={props.data}>{task => <p>{task.title}</p>}</For>
}

<MirrorlessQuery<Task[]> id="GetTasks" component={Tasks} />
```

As with normal Solid props, do not destructure `props.data` outside a reactive expression. This demo uses this form for all three independent read views.

### Reactive terms and lifecycle

The lower-level hook returns a snapshot accessor with a stable `refetch()` function:

```tsx
const [selectedId, setSelectedId] = createSignal('1')
const query = useMirrorlessQuery<Task>(
  'GetTask',
  () => ({ id: selectedId() }),
)

// query().data is always for the CURRENT id, never the previous id.
// query.refetch() explicitly refreshes the current interested term.
```

Call hooks inside a Solid component or `createRoot`. Pass accessors for reactive names, parameters, or explicit runtime overrides. Value-equal parameters reuse their observer. Subscriptions start in a Solid effect, not during construction/render, and stop with the owner; core interest retention follows the configured lease.

The provider creates no global runtime. Changing its `runtime` prop reactively switches descendant queries: previous-session data is hidden immediately, old notifications detach, and the new runtime supplies the next value. Nested providers remain separately scoped.

`useMirrorlessRuntime()` resolves the current provider at invocation time. When commands or effects must follow a changing provider, retain a reactive accessor rather than capturing one runtime during component setup:

```tsx
const runtime = createMemo(useMirrorlessRuntime)
// In a handler: await runtime().command('UpdateTask', params)
```

Use one runtime per authenticated browser session or deliberate server request, and dispose replaced runtimes when no other owners still use them. Server rendering returns initial fallbacks without executing reads; this adapter does not implement automatic SSR prefetch/hydration.

## Test environment

Solid's Node/server export is intentionally non-reactive. Browser tests require Solid's `browser` condition and a DOM environment; running browser reactivity tests against the default Node export is not valid. The separate `solid-ssr.test.js` file deliberately loads the server implementation to check request-free SSR.

Browser appearance and keyboard interaction need a rendered browser check in addition to the build and test commands. Do not infer visual verification from a passing compile.
