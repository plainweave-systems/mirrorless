# React · JavaScript / JSX

A real HTTP-backed task interface, not a browser-owned collection pretending to be a server. The task list, summary, and selected task are separate reads. Creating, updating, or deleting a task lets the shared update rules select the affected reads; no handler patches an array or adjusts a cached count.

## Run

From the Mirrorless repository root, after installing development dependencies:

```sh
# Terminal 1 — or use the interchangeable Python/Go server documented at the root
npm run demo:server

# Terminal 2
npm run demo:react
```

Open the address Vite prints. `/api` is proxied to `http://127.0.0.1:4000`. The demo server is intentionally local and unauthenticated; it is not production server code.

```sh
npm run build --workspace examples/react
```

The entry point is [`main.jsx`](main.jsx); the read/command transport and update rules are in [`../shared/task-api.js`](../shared/task-api.js).

## What stays local

- The new-task draft.
- The selected task ID.
- Pending/error UI for a command.
- Whether timer-driven liveness is enabled.

Task entities and aggregate counts are inputs from `MirrorlessQuery`, not application-owned React state. The success child runs only once a defined value is available; `null`, `false`, `0`, and empty collections still count as data.

```jsx
<MirrorlessProvider runtime={runtime}>
  <MirrorlessQuery id="GetTasks" loading={Loading} error={QueryFailure}>
    {(tasks) => <TaskList tasks={tasks} />}
  </MirrorlessQuery>
</MirrorlessProvider>
```

Loading and error props are components, not functions called directly by the adapter, so they can use React hooks. Without a local error component, a failed initial read is thrown to your normal React error boundary. A later refresh keeps the last received data visible; use the hook's metadata if the view needs to communicate a background refresh/error.

## Liveness

Enable **Live refresh every 2 seconds**, open a second tab, and change a task there. The first tab's timer emits the virtual `RefreshTasks` command. WebSocket notifications can emit the same command instead; the UI and dependency rules need not change.

Do not automatically retry writes. The demo shows pending UI until the server confirms the command and its triggered read work settles. A failed background read is not a rollback of a successful command.

## React Native

The `mirrorless/react` adapter imports React and the dependency-free core only—never ReactDOM. Use the same provider/query/hooks with native loading, error, and success components:

```jsx
import { ActivityIndicator, FlatList, Text } from 'react-native'
import { MirrorlessProvider, MirrorlessQuery } from 'mirrorless/react'

function Loading() {
  return <ActivityIndicator accessibilityLabel="Reading tasks" />
}

function TaskScreen({ runtime }) {
  return (
    <MirrorlessProvider runtime={runtime}>
      <MirrorlessQuery id="GetTasks" loading={Loading}>
        {(tasks) => (
          <FlatList
            data={tasks}
            keyExtractor={(task) => task.id}
            renderItem={({ item }) => <Text>{item.title}</Text>}
          />
        )}
      </MirrorlessQuery>
    </MirrorlessProvider>
  )
}
```

The optional `MirrorlessLoadingSpinner` helper is for the web; do not render it in a native tree. This repository's automated renderer tests run with ReactDOM/jsdom, not on a native device.

## SSR and lifetime

The observer is constructed during rendering but does not fetch or declare interest until React subscribes after commit. Server rendering therefore emits the loading shell by default. This is not automatic SSR data fetching or hydration support. Create runtimes per authenticated request/session, not as a cross-request server singleton. Replacing a runtime changes the current read immediately; dispose the old runtime when its session ends. The provider does not dispose an externally owned runtime on unmount.
