# Keeping server data live

Live data does not require one particular transport. It requires a reason to obtain another answer when the current answer may have changed.

Mirrorless accepts that reason through the same update rules whether it comes from a successful command, a timer, a focus/reconnect event, or a WebSocket notification. The component keeps receiving server data as input; it does not acquire a second entity model to synchronize.

## Virtual commands

A virtual command applies update rules without executing a network command:

```js
import { createMirrorless } from 'mirrorless'

const runtime = createMirrorless({
  query: readFromApi,
  command: writeToApi,
  virtualCommands: ['RefreshTasks', 'TaskChanged'],
  updates: {
    RefreshTasks: ['GetTasks', 'GetTask', 'GetSummary'],
    TaskChanged: [
      'GetTasks',
      ['GetTask', { id: Symbol.for('id') }],
      'GetSummary',
    ],
  },
})
```

`readFromApi` and `writeToApi` are your dispatchers. `runtime.command('RefreshTasks')` does not call `writeToApi`. It refreshes interested reads matched by `RefreshTasks`.

The source application's names `fakeCommandOperations` and `fakeMutationOperations` describe this same idea. New integrations should prefer `virtualCommands`: the command is a real refresh signal, just not a server write.

## Manual refresh

```js
async function refresh() {
  await runtime.command('RefreshTasks')
}
```

There is no need for a button to know which list, detail, and summary components are mounted. The command expresses its scope; the runtime finds matching interest.

An individual subscription or observer can also call `refetch()` when the intended scope is exactly that read. Use a virtual command when the interaction means "these related server questions may have changed."

## Periodic refresh

This application helper sets up a timer and returns its cleanup:

```js
function keepTasksLive(runtime, intervalMs = 2000, onError = console.error) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('intervalMs must be positive')
  }

  const timer = setInterval(() => {
    runtime.command('RefreshTasks').catch(onError)
  }, intervalMs)

  return () => clearInterval(timer)
}

const stop = keepTasksLive(runtime)
// On application/session teardown:
stop()
```

This is application code, not an additional Mirrorless scheduler API. It is often enough.

Only one request runs at a time for a read term. When signals arrive faster than that request completes, their invalidations coalesce into a follow-up round rather than starting parallel requests. An earlier command settles after its own relevant round; later timer or socket signals do not indefinitely extend that promise. This is still not free work: a busy signal source can keep reads continuously active.

Choose the interval from the interaction's needs and API cost. A dashboard may need different liveness from a rarely opened detail. Separate virtual commands can target different read groups; an individual active observer's `refetch()` can target one read.

A run retained by an unsubscribe lease remains interested, so it can still be refreshed by the timer. "No component is visible" is not identical to "no interest exists." Shorten `unsubscribeDelayMs` or stop an application-level timer when that policy is inappropriate.

The interval is not an exact freshness guarantee. Browser scheduling, network latency, failed requests, server replication, and background-tab throttling all affect what arrives.

## Focus and network return

Attach browser listeners after the client application mounts:

```js
function refreshOnReturn(runtime, onError = console.error) {
  const refresh = () => {
    runtime.command('RefreshTasks').catch(onError)
  }

  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)

  return () => {
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', refresh)
  }
}
```

The browser's `online` event is a hint, not proof that your API is reachable. An application that needs a stronger reconnect policy can probe its own service before refreshing.

Do not register these listeners at module scope in a server-rendered application. Create them in the framework's client lifecycle and run their cleanup when the session or owning application stops.

## WebSocket-triggered refresh

A socket can announce change without transporting the new read data. The API still supplies the authoritative answer.

```js
function refreshFromSocket(runtime, socket, onError = console.error) {
  function receive(event) {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }

    // An application allowlist, not arbitrary command execution.
    if (message?.type !== 'task-changed') return

    if (typeof message.id === 'string' && message.id.length > 0) {
      runtime.command('TaskChanged', { id: message.id }).catch(onError)
    } else {
      // The notification is broad; do not invent a missing binding.
      runtime.command('RefreshTasks').catch(onError)
    }
  }

  socket.addEventListener('message', receive)
  return () => socket.removeEventListener('message', receive)
}
```

The caller owns the socket and decides when to open, reconnect, and close it. The cleanup above removes this subscription; it does not close a socket that other application features may share.

Do not pass a received operation name straight into `runtime.command`. A notification channel should not become an unrestricted command execution channel. Validate message types and scope, and map them to known virtual commands.

The socket's payload is a reason to read, not a patch to the application's server entity model. A notification may be delayed, duplicated, or incomplete. Broad refresh can be the right response when it lacks enough information for safe parameter narrowing.

## Reconnection and missed events

If a socket disconnects, events may be missed. Unless the server offers a replay protocol, refresh the relevant reads when the connection is restored. A periodic fallback can also be useful.

A reconnect notification does not require rebuilding a client-owned entity database. It can emit a broad virtual command that asks the server the interested questions again.

## Failures and existing data

Mirrorless does not automatically retry failed reads or commands. Decide whether the next timer tick, a reconnect signal, a user action, or a dedicated policy should ask again.

A trigger's rejected promise and a read's refresh error are not interchangeable. Read snapshots expose read failures. A screen with existing data can keep rendering that data and show a separate background-warning or reconnect indicator. If retaining old data is inappropriate—for example after a permission change—use a deliberate application policy or replace the runtime.

## Teardown belongs to the owner

Keep the cleanup functions for timers and event listeners alongside the runtime they use:

```js
const stopTimer = keepTasksLive(runtime)
const stopReturnListeners = refreshOnReturn(runtime)

function stopSession() {
  stopTimer()
  stopReturnListeners()
  runtime.dispose()
}
```

Disposing a runtime does not remove arbitrary listeners your application installed on `window` or a shared socket. Preventing those callbacks from continuing to fire is the application owner's responsibility.
