# Examples and language choices

The examples use one small task API so the architecture remains visible: **the server owns tasks; clients receive task-shaped input and own only their interactions.**

There is no browser-owned task collection pretending to be a server in the browser demos. The API processes are real local HTTP servers. They do not know which components are mounted and do not implement a Mirrorless-specific protocol.

## Start one API server

Choose one command from the repository root:

```sh
node examples/servers/node/server.js
# or:
python3 examples/servers/python/server.py
# or:
go run examples/servers/go/main.go
```

Run only one on the default port at a time. Each binds to `127.0.0.1:4000`; `PORT` can override the port. Browser development servers proxy `/api` to that loopback address. If you change the API port, update the relevant demo proxy target.

The implementations use their language's standard HTTP facilities. The Python and Go variants demonstrate backend independence, not a requirement to add Python or Go to a Mirrorless application.

See [the server guide](../examples/servers/README.md) for the shared contract, validation, test commands, and deliberate limitations. These are ephemeral development servers without production authentication or persistence; do not expose them publicly.

## Start with raw GET/POST URLs

The [minimal HTTP example](../examples/http/README.md) is the shortest path from an existing REST API to a renderer:

```sh
npm run demo:http
```

Its [runtime](../examples/http/runtime.js) passes URLs directly to `fetch`: reads use GET, and commands use POST with a JSON body. Its [view](../examples/http/main.js) declares `/api/tasks` and `/api/summary` interests, then submits `runtime.command('/api/tasks', { title })`.

```text
GET  /api/tasks       -> Task[]
GET  /api/summary     -> { total, done }
POST /api/tasks       -> { id }
                         └─► refresh interested GETs for both URLs
```

There is no `GetTasks`/`CreateTask` routing switch or wrapper per endpoint. The only relationship to declare is which GET URLs a successful POST can affect. The same idea appears in the [README's React quick start](../README.md#quick-start).

URLs match exactly, including query strings; this example does not add path-prefix matching or infer resource dependencies. Its Refresh button triggers the virtual `refresh` event, which reruns the interested GETs without a POST. The fuller examples below add selection, other HTTP methods, and optional timer-driven refresh using named operations.

## Choose a browser renderer

After installing repository dependencies, start any demo in a second terminal:

| Example | Command | Entry point |
| --- | --- | --- |
| Minimal raw-URL JavaScript | `npm run demo:http` | [main.js](../examples/http/main.js) |
| Vanilla JavaScript, full task demo | `npm run demo:vanilla` | [main.js](../examples/vanilla/main.js) |
| React / JSX | `npm run demo:react` | [main.jsx](../examples/react/main.jsx) |
| Preact / TSX | `npm run demo:preact` | [main.tsx](../examples/preact/main.tsx) |
| Vue / TypeScript | `npm run demo:vue` | [App.vue](../examples/vue/App.vue) |
| Svelte / TypeScript | `npm run demo:svelte` | [App.svelte](../examples/svelte/src/App.svelte) |
| Solid / TSX | `npm run demo:solid` | [main.tsx](../examples/solid/src/main.tsx) |
| Angular / TypeScript | `npm run demo:angular` | [app.component.ts](../examples/angular/src/app.component.ts) |
| Lit / TypeScript | `npm run demo:lit` | [main.ts](../examples/lit/src/main.ts) |

The development server prints its browser URL. Use Node 24.15+ within the Node 24 line for the repository's installed framework/build tools. The examples are separate workspaces so you can inspect each framework's normal source format and build arrangement.

Look for the separation between:

- A task list read.
- A separately subscribed summary read.
- A selected detail read where provided.
- Local title input, selection, pending flags, and command errors.
- Commands that await confirmation rather than editing fetched arrays.
- Optional timer-driven live refresh or explicit refresh controls.

The fuller framework demos use the [shared named-operation task integration](../examples/shared/task-api.js) for transport dispatch and update rules. It returns `createMirrorless(...)`; it is example application code, not a second library or mandatory backend client. The raw-URL example deliberately bypasses that routing layer.

## Why command receipts have a different shape

The server deliberately returns receipts rather than replacement read values:

```text
CreateTask             -> { id }
UpdateTask / DeleteTask -> { ok: true }
GetTasks               -> Task[]
GetTask                -> Task
GetSummary             -> { total, done }
```

After success, the runtime asks the affected interested questions again. That demonstrates the architectural boundary more clearly than a demo whose mutation response just happens to be the exact next list value.

The summary is an independent read. It is not maintained by incrementing a browser-side counter after each command.

## Headless TypeScript

The [TypeScript client](../examples/typescript/main.ts) uses core subscriptions and ordinary plain-data consumers. It is useful for understanding delivery without JSX or a browser.

With a server running, use Node with type-stripping support; the repository's development environment is Node 24.15+: 

```sh
node examples/typescript/main.ts
node examples/typescript/main.ts --select 1
node examples/typescript/main.ts --add 'Review proposal' --complete-created
node examples/typescript/main.ts --live
```

The default invocation is read-only. `--add` opts into a server write; `--complete-created` also updates the newly created task and requires `--add`. `--live` keeps running until a termination signal and emits the virtual refresh command periodically.

The client separately subscribes to the list and summary. It prints command pending state, receives receipts, and lets update rules obtain new read values. It does not append to the list or adjust the summary locally.

`TASK_API_URL` can point it at another credential-free loopback HTTP address. The demo deliberately rejects remote or credential-bearing URLs so a copy-pasted example does not accidentally write to an external service.

## ClojureScript interop

The [ClojureScript client](../examples/clojurescript/main.cljs) uses the same native-ESM package and shared API integration through ordinary JavaScript interop. Run the locally installed `nbb` entry point:

```sh
node node_modules/nbb/cli.js examples/clojurescript/main.cljs
node node_modules/nbb/cli.js examples/clojurescript/main.cljs --select 1
node node_modules/nbb/cli.js examples/clojurescript/main.cljs --add 'Review proposal' --complete-created
node node_modules/nbb/cli.js examples/clojurescript/main.cljs --live
```

Its flags and loopback restriction match the TypeScript example. Atoms hold only CLI interaction state and lifecycle callbacks, not a task entity database. The delivered values remain frozen JavaScript arrays and objects; the example consumes them with JS interop.

A ClojureScript renderer can use an appropriate adapter or bridge the core observer lifecycle. This example does not claim to ship a Reagent renderer or a Clojure server library.

One interop detail matters: test specifically for JavaScript `undefined` when deciding whether a first value exists. ClojureScript's `nil?` also treats `null` as nil, but `null` can be a legitimate delivered value.

## Demonstrate an external writer

Open a browser demo, enable its live refresh when available, and change the server outside that client:

```sh
curl -i -X PATCH http://127.0.0.1:4000/api/tasks/1 \
  -H 'Content-Type: application/json' \
  -d '{"done":true}'
```

The fuller demos' timers emit `RefreshTasks`, and interested reads obtain new answers. The minimal raw-URL example has no timer; use its Refresh button to trigger `refresh`. Without a timer or other invalidation signal, a write in another client is not automatically announced. You can also open two demos against the same API process: server changes are shared, while drafts and selection remain local to each client.

The sample servers intentionally do not expose WebSocket endpoints. The [socket recipe](liveness.md#websocket-triggered-refresh) shows how a real application's notifications can enter the same virtual-command path without changing these read/command HTTP contracts.

## What an example does not prove

A running demo is not a benchmark, a distributed consistency guarantee, or evidence of mature feature parity with another toolkit. It also does not make its development server production-ready.

Use [the test suites](testing.md) to check specific delivery and lifecycle properties. Meta-framework recipes are documented separately from these runnable renderer examples; do not assume that a recipe has a bundled end-to-end project merely because its renderer has an adapter.
