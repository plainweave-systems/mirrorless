# Go task API

An interchangeable task API built with `net/http`, `encoding/json`, and other standard-library packages. No Go module dependencies or third-party router are needed. Use Go 1.22 or newer.

From the repository root:

```sh
go run examples/servers/go/main.go
```

The process binds to `127.0.0.1:4000`. `PORT=4100 go run examples/servers/go/main.go` overrides the port; `PORT=0` prints a selected ephemeral loopback port.

For predictable signal handling when launching from another program, compile and execute the binary directly rather than signalling the `go run` wrapper:

```sh
go build -o /tmp/mirrorless-task-api examples/servers/go/main.go
/tmp/mirrorless-task-api
```

The binary handles Ctrl+C/SIGTERM with a bounded graceful HTTP shutdown. A mutex protects concurrent access to server-owned tasks; command responses remain small receipts, and reads obtain the task/list/summary representations. Data is only in memory and resets on restart. This is not a production service: do not expose it publicly.

See [the shared API, fixtures, and limitations](../README.md). No browser adapter or update rule changes are needed when switching server languages.

The parity suite compiles the binary into an automatically removed temporary directory and runs actual HTTP requests against it:

```sh
node --test tests/examples/server-parity.test.js
```
