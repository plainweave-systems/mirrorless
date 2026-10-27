# Architecture and inheritance

Mirrorless separates application-owned interaction state from delivered server data. Its runtime machinery exists to make that boundary practical across component lifecycles and refresh triggers; it is not a requirement to adopt a new domain store.

For the motivation, start with [Why Mirrorless?](why-mirrorless.md). This page explains what happens behind the boundary.

## From `live-components` to Mirrorless

The predecessor, [`live-components`](https://github.com/alesya-h/live-components), made ordinary REST reads subscribable. A client component declared URL interests. The server reran existing GET handlers when application code marked a resource updated, then pushed responses over a WebSocket. The normal renderer received response bodies after its reads had arrived.

It did not push rendered components, HTML, or DOM changes. Its important idea was that a component could consume server data without maintaining and patching a local copy of the server's collections. Its TodoMVC view subscribed directly to `/todos`; actions used ordinary HTTP calls such as `POST /todos/new`, and server-side update markers caused the displayed collection to arrive again. Named routing was optional application convenience, not a prerequisite for receiving data.

The implementation used Clojure/ClojureScript, Reagent, DataScript for subscription topology, and Immutant's WebSocket APIs. A full URL identified a read, while a query-string-stripped token grouped updates. Several local subscribers could share one URL subscription. A short delayed unsubscribe allowed views to return without immediately discarding interest.

`serverState` carried the same rendering idea into `up-web`, where the upstream API did not provide change notifications. It used client-side dispatchers and explicit command-to-read rules rather than requiring server-side subscription middleware. Mirrorless extracts that reusable boundary and gives it a name that emphasizes the application model it removes.

| Concern | `live-components` | Mirrorless |
| --- | --- | --- |
| What a consumer declares | Subscription URLs | Read URLs or names, with optional parameter values |
| What successful rendering receives | Response bodies | Selected read data |
| Where known write effects are expressed | Server-side update markers | Declared command-to-read rules |
| How new values arrive | Server reruns GET and pushes its response | Runtime dispatches a read after a trigger |
| External change triggers | Backend update markers | Timers, events, socket notifications, or application policy |
| Required backend addition | WebSocket middleware | None; use the API you have |
| Application entity store | Not required | Not required |

The point is not that pulling is better than pushing. Mirrorless can be kept live by either timer-driven reads or push-triggered invalidation. Moving the coordination boundary allows it to work with APIs that the frontend does not control.

The [raw-URL example](../examples/http/README.md) keeps the predecessor's direct style: views request `/api/tasks`, and writes POST to `/api/tasks`, without mapping either to an invented operation name. The difference is the update mechanism: Mirrorless declares the affected GET URLs on the client and refetches them. Its URL names match exactly; unlike the predecessor's update tokens, they do not automatically group query-string variants.

## Reads are questions, not entities

A read is identified by a name and JSON-compatible parameters. The name can already be its URL, such as `/api/tasks/1`; it need not be an alias. An API with named operations can instead use:

```js
['GetTask', { id: '1' }]
```

`GetTask({ id: '1' })` and `GetTasks({ status: 'active' })` may contain some of the same underlying entities. They are still different questions. Mirrorless does not merge their answers into a mandatory normalized task model.

The application can give each answer directly to the renderer that requested it. After a command affects either representation, the relevant question is asked again.

This allows read shapes to be designed for their consumers. An operation can call one endpoint, aggregate several endpoints, or use a domain client. A command response need not have a shape suitable for any of those reads.

## Active runs and shared delivery

When interest is declared, the runtime finds an existing run with the same read name and value-equal parameters, or creates one. Equal inline parameter objects do not represent different requests simply because JavaScript allocated new objects.

A run carries delivery state: the read term, subscribers, current request status, latest response, error, and timestamps. It is a small piece of runtime topology, not an application entity table.

Several consumers can share a run. The runtime avoids starting concurrent requests for that same run. If a successful command affects a read already in flight, a follow-up read is queued/coalesced rather than losing that invalidation. This orders the refresh work; it does not establish which backend replica or transaction produced the answer.

## Observers and subscriptions

The distinction matters to renderers:

- `runtime.observe(...)` constructs a view of a particular read without starting a request or declaring permanent interest. Reading its snapshot is side-effect-free.
- `observer.subscribe(listener)` activates interest and connects change notifications.
- `runtime.subscribe(...)` declares interest immediately and is useful for explicit non-rendering consumers.

Adapters map their framework's lifecycle onto this boundary. They should not fetch during render, turn responses into mutable entity stores, or briefly show data from a previous parameter set.

Snapshots are immutable and stable by reference until their observable contents change. That lets an adapter use its normal external-store, ref, signal, accessor, or controller mechanism without inventing another request state machine.

## A successful value changes the rendering contract

Before any data exists, a read boundary renders loading content or handles an error. After a value exists, it can invoke the normal renderer with plain data.

`undefined` is the absence of a renderable value. `null`, `false`, `0`, empty strings, and empty arrays can all be real answers. Do not use truthiness to decide whether data exists.

During refresh, the previous value remains available. If the refresh fails, that previous value can remain visible while the snapshot exposes the error. Applications that need background error indicators should use the adapter's snapshot-level interface rather than expecting every refresh failure to replace the successful renderer.

## Commands and virtual commands

An ordinary command executes through the application's dispatcher. Once it succeeds, the runtime applies its declared update rules to interested reads.

A virtual command skips the network execution step and applies the same rules. It represents a local or external reason to ask again:

```text
user clicks refresh
window regains focus
periodic timer fires
socket reports a relevant change
```

Those signals do not need separate entity synchronization systems. They enter one refresh mechanism.

The application owns the dependency knowledge. The runtime does not infer which database rows changed, inspect a mutation's implementation, or discover all views containing an entity. See [update rules](update-rules.md), particularly collection-membership changes.

## Interest leases

Removing a listener and releasing interest are different actions. A removed component must stop receiving notifications immediately. Its interest can remain for the configured lease, which defaults to two minutes.

A view returning during that lease can reuse the run and its delivered value. A command or timer can also refresh that retained interest, even when no component is currently visible. Set a shorter lease when that cost or retained lifetime is inappropriate.

After the last interest is actually released, the run can be removed. A late request must not resurrect it. Runtime disposal is a stronger lifetime boundary for logout, identity changes, and application teardown.

## Optional projections stay optional

Some applications genuinely need a secondary projection for cross-read analysis, local querying, or a specialized workflow. Mirrorless exposes ingestion seams for that purpose. The original application used a separate DataScript banking projection.

Such a projection is not the prerequisite for ordinary rendering, and it should not quietly become the architectural center of the extracted library. If you choose one, its completeness, merge policy, persistence, and security are separate responsibilities. A table containing some fetched facts is not automatically a complete view of the server.

## Consistency boundary

The server remains authoritative. Mirrorless requests new answers after known changes; it does not prove that independently fetched answers belong to one atomic snapshot.

A successful command means the command dispatcher accepted it as successful. A backend can still serve an older replica view, an external writer can change data after a read, or two reads can observe different moments. If a workflow requires a transactional read model, version checks, or stronger write acknowledgements, express that contract in the API.

The practical gain is not perfect knowledge of the server. It is that the frontend does not need to maintain its own incomplete approximation of the server's state transitions to display the server's answers.
