<!-- Copyright 2026 Plainweave Systems; SPDX-License-Identifier: Apache-2.0 -->
# TypeScript using the JavaScript library

This headless CLI uses Mirrorless's native ESM JavaScript runtime and handwritten
TypeScript declarations, not a separate TypeScript implementation. No browser,
bundler, emitted JavaScript, credentials, or external service is needed.

## Prerequisites and run

Run these commands from the repository root. Use Node **24** (native TypeScript
stripping), the root-installed TypeScript **6.0.3**, and `@types/node`. Node strips
types but does **not** typecheck; run both commands below. All type-only imports
are explicitly marked, and query/command results use explicit generics. These
annotations describe the demo HTTP contract; they do not validate arbitrary JSON.

Terminal 1 — real, in-memory, loopback HTTP API:

```sh
node examples/servers/node/server.js
```

Terminal 2 — strict check, then **read-only** demo:

```sh
./node_modules/.bin/tsc -p examples/typescript/tsconfig.json
node examples/typescript/main.ts
# Equivalent explicit stripping command:
node --experimental-strip-types examples/typescript/main.ts
# Optional read-only detail:
node examples/typescript/main.ts --select 1
```

To explicitly mutate this disposable local demo:

```sh
node examples/typescript/main.ts --add 'Created from TypeScript'
# Also complete the newly created task; keep unrelated task 1 subscribed:
node examples/typescript/main.ts --select 1 --add 'Bound detail demo' --complete-created
```

`--complete-created` requires `--add`. It only updates the task just created; it
never silently modifies a seeded task. The server returns `{id}` for CreateTask
and `{ok:true}` for UpdateTask, not task arrays or summary counts.

## What it demonstrates

- GetTasks and GetSummary have independent subscriptions. Plain-data consumer
  functions receive only data, not delivery metadata or runtime handles.
- Draft title, selection, pending flag, and command error are local CLI state.
  No client-owned task collection, optimistic patches, or derived summary store.
- Shared `task-api.js` runs real HTTP commands and updates reads after success.
  CreateTask refreshes both subscriptions even though its response is only a receipt.
- The optional completion demo subscribes to GetTask with `{id}`. The shared rule
  `UpdateTask: ['GetTasks', ['GetTask', {id: Symbol.for('id')}], 'GetSummary']`
  binds the command's id by value. A separately selected task with another id
  does not refresh. New params objects do not change this relationship.
- Loading and errors are reported at the delivery boundary; only `undefined`
  means absent data. Empty arrays are valid successful results. Refresh can
  retain old data; read/command failures are reported with a nonzero exit code.

## Optional live reads and cleanup

```sh
node examples/typescript/main.ts --live
# In another terminal, explicitly create a task:
node examples/typescript/main.ts --add 'Written by another client'
```

`--live` emits the virtual command RefreshTasks every two seconds via the shared
helper, without a command HTTP request. It can discover another client's writes;
it is polling, not an atomic snapshot or a backend-freshness guarantee. There are
no automatic retries of failed reads or commands.

Without `--live`, the CLI unsubscribes and disposes its runtime before exiting.
With `--live`, Ctrl-C/SIGTERM stops timers, releases subscriptions, and disposes
in-flight work. Ctrl-C the server separately; restarting it resets demo tasks.
For a different **local** port, start the server with `PORT=4100` and prefix CLI
commands with `TASK_API_URL=http://127.0.0.1:4100/api`. Only credential-free
loopback HTTP URLs are accepted.

## Verification

```sh
node --test tests/examples/language-usage.test.js
```

The focused suite runs strict typechecking and both language CLIs against isolated
real HTTP servers, including receipt-driven refresh, parameter-bound detail
updates, failed commands/reads, live external writes, and signal cleanup. This is
a headless example, not a rendered UI or a browser accessibility demonstration.
