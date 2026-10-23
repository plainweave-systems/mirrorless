# Python task API

A standard-library implementation using `ThreadingHTTPServer`, JSON, and a lock around server-owned task mutations. There are no pip dependencies.

From the repository root:

```sh
python3 examples/servers/python/server.py
```

The CLI binds to `127.0.0.1:4000`. Override the port if needed:

```sh
PORT=4100 python3 examples/servers/python/server.py
# Print an unused port for a test:
PORT=0 python3 examples/servers/python/server.py
```

Ctrl+C/SIGTERM shuts down the listener. Importing the file does not start a server. `TaskServer(port=0)` creates an isolated server with an ephemeral loopback port if a Python test needs to embed it; the test must run `serve_forever()` and subsequently call `shutdown()` from another thread and `server_close()`.

The body reader bounds both ordinary and chunked request bodies. This is still an intentionally small, ephemeral demonstration, not an application backend framework. Its two initial tasks return on restart; no data is stored on disk. Do not expose Python's demo HTTP server publicly.

See [the shared API, fixtures, curl example, and limitations](../README.md). Any browser example can use this server instead of Node or Go without changing its Mirrorless rules.

Parity tests use the installed `python3` executable:

```sh
node --test tests/examples/server-parity.test.js
```
