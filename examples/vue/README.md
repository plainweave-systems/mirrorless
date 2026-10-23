# Vue 3 + TypeScript

A real-HTTP example: server reads flow into Vue components without copying tasks into Pinia, Vuex, or another application-owned server-data model.

## Run

From the Mirrorless repository root:

```sh
npm install
npm run demo:server
```

In another terminal:

```sh
npm run demo:vue
```

Open the URL printed by Vite. `/api` is proxied to `http://127.0.0.1:4000`. The Node, Python, and Go example servers use the same API contract, so any one of them can supply this frontend. Do not run multiple servers on the same port.

```sh
npm run build --workspace examples/vue
npm run typecheck --workspace examples/vue
```

The build compiles Vue SFCs; the separate `vue-tsc` command checks their TypeScript and scoped slots. Neither is a visual/accessibility audit.

## What to try

1. Add a task. `CreateTask` returns an ID, not a replacement client-side task collection.
2. Watch the independently subscribed task list and server summary update through the shared `updates` rules.
3. Select a task, then mark it done. Its parameterized detail read updates too.
4. Open another browser window. Enable two-second refresh in the first window, make a change in the second, and observe the first without a special backend subscription protocol.

No component patches a fetched task array, flips a stored server `done` flag, or computes a mirrored summary count. The local state is the draft title, selection, pending interaction, and local error/live-toggle UI.

## The rendering boundary

```vue
<script setup lang="ts">
import { MirrorlessQuery } from 'mirrorless/vue'
import type { Task } from '../shared/task-api.js'

const Tasks = MirrorlessQuery<Task[]>
</script>

<template>
  <Tasks id="GetTasks">
    <template #default="{ data }">
      <TaskList :tasks="data" />
    </template>
    <template #loading><p>Loading tasks…</p></template>
    <template #error="snapshot"><p>{{ snapshot.error }}</p></template>
  </Tasks>
</template>
```

`TaskList` receives plain data. It is never called with `undefined`; `null`, `false`, `0`, and empty arrays are legitimate defined values. The loading slot is optional and defaults to no content. Without an initial-error slot, errors are thrown during render and can be handled with Vue's `onErrorCaptured` boundary.

Existing data stays rendered while refreshing and after background refresh failures. If a screen needs a refresh indicator or background-error banner, the composable exposes that metadata without mixing it into the success component's props.

## Composable and reactive parameters

```ts
import { useMirrorlessQuery } from 'mirrorless/vue'
import type { Task } from '../shared/task-api.js'

const { snapshot, refetch } = useMirrorlessQuery<Task>(
  'GetTask',
  () => ({ id: props.taskId }),
)
// script: snapshot.value.data / snapshot.value.loading / await refetch()
// template: snapshot.data (top-level refs are unwrapped by Vue)
```

The returned snapshot is a shallow readonly ref. Mirrorless does not convert server responses into a deep mutable Vue model. Parameter objects are compared by value; replacing an inline object with an equal object does not reconstruct the observer. In-place changes to reactive nested parameters are tracked. Changing the operation or parameters immediately switches to that term's snapshot, never the previous term's data.

Names and options may also be refs/getters. An explicit runtime overrides the injected one:

```ts
const query = useMirrorlessQuery<Task>(
  () => props.operation,
  () => ({ id: props.taskId }),
  () => ({ runtime: props.runtime, unsubscribeDelayMs: 10_000 }),
)
```

## Runtime lifetime and SSR

`main.ts` creates one runtime for this browser app and installs `createMirrorlessPlugin(runtime)`. Components can alternatively call `provideMirrorless(runtime)` in an ancestor's setup; Vue providers apply to descendants, not the providing component itself.

Constructing the composable or rendering the boundary does not start a request. Interest starts on mount, so server-side rendering produces the initial loading content without an accidental server fetch. This adapter does not implement automatic SSR preloading or hydration-cache transfer. Create a separate runtime per authenticated SSR request/session; never share one globally. A deliberately prepopulated runtime may already expose data, but its lifetime and serialization remain the application's responsibility.

Unmount immediately stops Vue notifications. Core may retain the underlying interest under its configured lease. The owner of the runtime—not the provider plugin—must dispose it when the app/session ends. Vite HMR cleanup in this example unmounts the app and disposes the runtime.
