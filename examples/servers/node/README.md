# Node.js task API

A native-ESM HTTP server using only `node:http`. The browser's fetched data has a real server-side source of truth; this is not a browser mock.

From the repository root:

```sh
node examples/servers/node/server.js
# Or the root convenience script:
npm run demo:server
```

The CLI binds to `127.0.0.1:4000`. `PORT=4100 node examples/servers/node/server.js` overrides the port; `PORT=0` prints a selected ephemeral port. Ctrl+C/SIGTERM closes the listener and idle connections, with a bounded fallback for active connections.

## Embedding in a local test

Importing the module does **not** open a port:

```js
import { createTaskServer } from './examples/servers/node/server.js'

const server = createTaskServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`

try {
  const tasks = await fetch(`${baseUrl}/api/tasks`).then(response => response.json())
  console.log(tasks)
} finally {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeIdleConnections()
  })
}
```

`createTaskServer()` returns an unbound native `http.Server`, with an isolated copy of the deterministic fixtures. Callers embedding it are responsible for binding only to loopback and closing it. The module also exports frozen `INITIAL_TASKS` and `MAX_BODY_BYTES` for contract tests.

See [the shared API and limitations](../README.md). State is in memory, resets when the process restarts, and is not suitable for production deployment.

```sh
node --test tests/examples/server-parity.test.js
```
