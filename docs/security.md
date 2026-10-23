# Runtime lifetime and security

A Mirrorless runtime belongs to a particular data-access scope. In an authenticated application, that usually means one user/session and tenant context—not every browser tab, server request, or user of a long-running process.

The runtime can retain read responses while interest exists. Treat that retained data with the same care as the API response itself.

## Replace runtimes when identity changes

Create the runtime and its transport dispatchers for the current identity. On logout or a change of user, tenant, or materially different authorization scope:

1. Stop timers, focus handlers, and socket listeners owned by the old session.
2. Dispose the old runtime.
3. Remove the old application's rendered data and any application-owned projections.
4. Create a new runtime and connect a new provider/controller scope.

Match the framework scope to that lifetime. React, Preact, and Solid provider runtime changes retarget descendant queries; dispose the old runtime separately. Vue and Svelte setup-time context values belong to their provider subtree's lifetime: recreate that subtree on identity changes, or explicitly supply the new runtime through a reactive query input. Angular DI scopes and existing query resources likewise need deliberate destruction/recreation when identity changes. Reassigning a JavaScript variable does not retarget an existing observer or provider value automatically.

Do not merely replace a credential inside a long-lived shared dispatcher and hope that all old operations have finished. A previous request can still complete later.

`dispose()` is a permanent lifetime boundary. It releases subscriptions, clears retained runs, aborts cooperative in-flight work, and prevents old completions from being applied through that runtime. A disposed runtime is not intended to be configured and reused.

Disposal does not remove listeners that your own code attached to `window` or a shared socket. It does not erase values already copied to application code, logs, DOM nodes, browser history, or developer tools. Remove those through their own owners.

## Cancellation is cooperative

Dispatchers receive `context.signal`. Pass it to APIs that support cancellation:

```js
const runtime = createMirrorless({
  query(name, params, context) {
    return fetch(urlForRead(name, params), { signal: context.signal })
      .then(readSuccessfulJson)
  },
})
```

`urlForRead` and `readSuccessfulJson` are application functions. The important part is passing the runtime's signal into the transport.

The runtime also uses generation/lifetime checks so an ignored or non-cooperating request cannot repopulate a retired run. That does not make arbitrary external side effects reversible.

Aborting a command request is not proof that the server did not execute it. The server may have committed before the client disconnected. Design idempotency, status checks, and user-facing recovery around the API's actual contract.

## Reset is not a new identity

`runtime.reset()` clears delivered results and starts another generation. By default, interests survive and refetch. `reset({ refetch: false })` clears results without immediately fetching them again. `reset({ subscriptions: true })` explicitly ends current subscriptions; consumers must establish new interests afterward.

Use reset deliberately within one data-access scope. For identity replacement, a fresh runtime is easier to reason about and avoids retaining configuration or application-owned integration state unintentionally.

The optional ingestion hook can start work outside the runtime. If an ingestion implementation awaits before mutating an external projection, it must respect its signal/generation and that projection's own lifetime. Clearing core runs cannot undo arbitrary work an application callback already performed elsewhere.

## Never share authenticated runtimes across SSR requests

A module-level runtime in a server process can outlive one request and be reached by another user's rendering tree. Equal read names and parameters can then share retained data even though their identities differ.

Create a separate runtime per request when explicitly reading on the server. Dispose it after the request's work ends. Do not rely on a framework adapter's context alone to isolate a runtime object you already shared globally.

For client-first rendering, construct the browser runtime in the client application/session boundary. See [server-rendering recipes](server-rendering.md).

## Failure semantics are part of the trust boundary

Mirrorless knows a command succeeded when its dispatcher resolves. Reject on failed HTTP status, GraphQL errors, application error envelopes, and any other condition that means the operation was not confirmed.

This is especially important when a protocol returns `200` for an application failure. Do not let that response enter normal command-success rules by accident.

Do not expose raw exception messages, response bodies, or stack traces to every renderer. They can contain credentials, query text, internal IDs, or implementation details. Use user-safe local messages and a deliberate reporting policy.

## Existing data after authorization failure

A successful value remains available during a later refresh failure. That is useful for transient connectivity problems, but it may not be the right policy after a permission or identity change.

If a transport classifies an error as an access failure, a snapshot-level renderer can hide the previously delivered value and show an appropriate message. A broader scope change should replace the runtime and remove the old rendered tree.

The default data boundary is not an authorization enforcement mechanism. A previously received permission or data value does not authorize a future command. The server must enforce every protected operation.

The same issue applies to deletion: if a detail read starts returning `404`, the default "keep prior data" behavior does not itself choose a deleted-record UI. Return an explicit nullable representation where that is the API contract, or use the read's error metadata to render the desired not-found state.

## Keep secrets out of terms and diagnostics

Read parameters appear in snapshots and can be inspected or logged by application tooling. Do not put passwords, tokens, signing keys, or private credentials into operation names or read parameters just to make them available to a dispatcher. Close over a properly scoped client or use your normal credential mechanism.

Do not add every credential value to a read key as a substitute for correct runtime isolation. User and tenant scope should be expressed by lifetime and authorization, not by making secrets into diagnostic identifiers.

## Validate external notifications

Map socket or event messages through an allowlist of virtual commands. Validate the payload and its scope. Never interpret an arbitrary received command name as permission to execute it.

A notification can tell the runtime to ask the API again. It should not silently become an authoritative patch to the delivered data or a way to invoke arbitrary writes. See the [socket recipe](liveness.md#websocket-triggered-refresh).

## Persistence is an explicit application choice

Mirrorless does not require persistent response storage or a normalized database. If an integration persists a downstream projection, decide its retention, logout behavior, encryption, and completeness separately.

An interest lease is not a security erasure guarantee. A short lease can reduce retained runtime lifetime; it does not remove information from other owners that have already received it.

## Demo servers are not production backends

The Node, Python, and Go examples bind to loopback and implement a small in-memory API. They do not provide authentication, authorization, TLS, persistence, or production hardening. Do not expose them publicly or deploy them as-is. Their purpose is to show that the server can remain an ordinary HTTP API.
