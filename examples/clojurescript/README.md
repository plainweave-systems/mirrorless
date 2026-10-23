<!-- Copyright 2026 Plainweave Systems; SPDX-License-Identifier: Apache-2.0 -->
# ClojureScript interop with the JavaScript library

This is an ordinary headless ClojureScript caller of a **JavaScript/TypeScript
library**, not a new ClojureScript renderer or state framework. `nbb` loads the
native ESM `../shared/task-api.js` helper and the `mirrorless` root export.
Subscriptions, commands, snapshots, and promises remain JS objects. Plain-data
consumers receive frozen JS arrays/objects and use normal CLJS interop; no task
collection is copied into an atom or converted into a second entity model.

## Prerequisites and run

Run from the repository root with Node **24** and the root-installed **nbb
1.6.214**. nbb executes ClojureScript without a JVM build: no Java, Clojure CLI,
Leiningen, shadow-cljs, new build toolchain, browser, or credentials are needed.

Terminal 1 — real, disposable, loopback HTTP API:

```sh
node examples/servers/node/server.js
```

Terminal 2 — default **read-only** example:

```sh
./node_modules/.bin/nbb examples/clojurescript/main.cljs
# Optional read-only detail:
./node_modules/.bin/nbb examples/clojurescript/main.cljs --select 1
```

Explicit opt-in mutations of this local demo only:

```sh
./node_modules/.bin/nbb examples/clojurescript/main.cljs --add 'Created from ClojureScript'
# Also complete only the new task, leaving unrelated selected detail alone:
./node_modules/.bin/nbb examples/clojurescript/main.cljs --select 1 --add 'Bound detail demo' --complete-created
```

`--complete-created` requires `--add`. CreateTask returns only `{id}`. Mirrorless
refreshes separately subscribed GetTasks and GetSummary through shared update
rules; the example never `conj`s a receipt into tasks or increments a local count.
The optional completion demo reads GetTask, then sends UpdateTask with a fresh
`#js {:id id :done true}` object. The helper's `Symbol.for('id')` binding refreshes
only the matching detail by **value**, plus list and summary. The example also
calls the native ESM root `sameParams` export to show value-equal JS params.

The title, selection, live option, pending flag, and command error are local CLI
interaction state. Only that interaction state and cleanup callbacks use atoms.
Loading/error metadata stays at the subscription boundary. Consumers receive
only plain data; `undefined`, not CLJS `nil?`, marks an absent successful result
(`null`, `false`, `0`, and `[]` are valid library data). Read and command failures
are reported with nonzero exit status; commands/reads are not retried.

## Optional liveness and cleanup

```sh
./node_modules/.bin/nbb examples/clojurescript/main.cljs --live
# In a second terminal:
./node_modules/.bin/nbb examples/clojurescript/main.cljs --add 'Written by another client'
```

The shared timer emits virtual RefreshTasks every two seconds without sending a
command HTTP request. Subscribed reads see external writes on a later poll, not
an atomic snapshot or guaranteed knowledge of every external change.

Normally the example unsubscribes and disposes its runtime before exiting.
Ctrl-C/SIGTERM ends `--live`, clears both timers, removes signal handlers,
unsubscribes, and disposes the runtime/in-flight work. Stop the server separately
with Ctrl-C; restart it to restore initial demo data. Alternate local port:
start with `PORT=4100`, then prefix CLI commands with
`TASK_API_URL=http://127.0.0.1:4100/api`. Only credential-free loopback HTTP URLs
are accepted. Nothing here uses external APIs, accounts, or bank operations.

## Verification

```sh
node --test tests/examples/language-usage.test.js
```

Tests run nbb against real isolated HTTP servers and check read-only defaults,
receipt-driven list/summary refresh, bound detail updates, failures, live external
writes, and clean signal shutdown. No rendered UI or browser accessibility check
is implied. There is no compiled ClojureScript/browser bundle in this example.
