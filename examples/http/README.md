# Direct HTTP URLs

From the repository root, run in separate terminals:

```sh
npm run demo:server
npm run demo:http
```

Open the URL printed by Vite. Its `/api` proxy targets `127.0.0.1:4000`.

`runtime.observe('/api/tasks')` declares a GET read; subscribing starts it.
The full raw URL is the read ID: put query strings in that ID, not in params.
`runtime.command('/api/tasks', { title })` POSTs JSON to that same raw URL.
There are no operation names translated into routes.

The server returns a write receipt (`{ id }`), not a replacement list. Explicit
update rules refetch the two interested URLs, `/api/tasks` and `/api/summary`.
Matching is exact: there is no automatic prefix matching or query stripping.
For example, `/api/tasks?view=all` is a separate read and needs its own update
rule if writes should refresh it. Refresh emits the virtual command `refresh`,
which runs those GETs without a POST.

`bindQuery` renders server data with safe DOM text APIs. Draft, pending, and
command error are local state; the UI never patches a task array or computes a
summary. Bindings, runtime, and handlers are cleaned up on HMR or final page exit.

Unlike the live-components example, this needs no WebSocket server: it uses
ordinary HTTP and explicit command-triggered refetches, not push updates.

```sh
npm run build --workspace examples/http
```
