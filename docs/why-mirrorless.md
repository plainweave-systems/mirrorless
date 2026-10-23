# Why Mirrorless?

## The second world in your frontend

A server has customers, tasks, balances, permissions, order totals, and rules for changing them. A frontend needs to display some of those things.

It is easy for that requirement to grow into a second model of the server inside the client: collections keyed by ID, selected records, derived counts, flags for loaded ranges, reducers that approximate server transitions, and rules for keeping all those pieces in agreement. The model is incomplete because the client has fetched only some of the server. It is outdated because time has passed and other things may have changed. Yet application code is responsible for maintaining it as though it were a coherent local world.

Then a command arrives: complete a task, move a record, transfer a balance, change a permission. A button handler updates one collection. A detail pane has another copy. A summary is now wrong. A filter may need to lose an item as well as another filter gaining it. Fixes accumulate around the places where the inconsistency becomes visible.

Mirrorless starts by questioning the extra model, not by proposing another way to organize it.

> Server data is input to components. It does not need to become application-owned client state first.

## Keep the state that is actually yours

A frontend still has state. A partially written title is not a server task. An open menu is not a server entity. The selected tab, the currently expanded detail, the user's unsaved edits, and whether a command is pending are all meaningful client-local state.

Mirrorless does not try to remove these things. It separates them from the values obtained by asking the server a question.

```text
server-owned facts       delivered read values
                         └─► render

client-owned interaction drafts, selection, navigation,
                         pending operations
                         └─► ordinary local state
```

That separation makes a useful demand of a component: when given tasks, render tasks. It need not also determine whether the tasks have been fetched, decide where to store them, patch them after every command, or coordinate another component's summary.

At a data boundary, the application declares a read. The successful renderer receives a value only after one exists. Initial loading and initial failure are handled at that boundary. Afterward, an existing value can remain on screen while the next value is being obtained.

## A write does not have to return the next world

Suppose completing a task returns `{ ok: true }`. That can be an entirely adequate command response. The command endpoint need not also return the exact representation required by a list, a detail pane, a summary, and a report.

The server already knows how to answer those reads. After the command succeeds, Mirrorless obtains the relevant answers again and delivers them to the interested consumers.

The application supplies the knowledge that a command can affect a read. It does not supply a client-side implementation of how the read's result must change.

That is the important exchange:

```text
Do not reproduce the state transition in every client representation.
Declare which representations need another answer.
```

This can mean additional requests. It also means server business rules remain server business rules. The trade-off is deliberate, not a claim that refetching is free or always preferable to every other architecture.

## Interest follows composition

A list declares that it needs a list. Opening a detail declares that it needs that detail. Two components asking the same named read with equal parameter values share the same active run.

The component tree is therefore an expression of demand. The parent does not have to enumerate every possible request in the application and distribute their status by hand.

Interest can outlive an unmount for a configurable lease. Returning to a view shortly afterward can reuse its delivered value. During that lease the read is still considered interesting and can be refreshed. Once the final interest expires, the runtime can remove the run and its retained response.

The application is not maintaining an entity store with its own session-long lifetime. It is expressing what needs delivery now, or may need delivery again soon.

## Live does not require one transport

A server can push changes. A client can periodically ask for them. A WebSocket can announce that some reads deserve another look without delivering their data. A command performed in this client can provide the trigger directly.

All of those can make a UI live. They differ in latency, cost, and what changes they can observe; none requires the application to reconstruct server entities in a client-side store.

Mirrorless uses virtual commands for local or external refresh signals. A virtual command makes no network write, but enters the same declared update rules as an ordinary command. A timer, focus handler, or validated socket notification can therefore refresh interested reads without becoming a separate state synchronization architecture.

There is no claim that the runtime knows about an external change before a signal or subsequent read reveals it. Liveness comes from the triggers you connect.

## Not literally zero copies

A response must exist in browser memory to be rendered. Mirrorless retains responses to share them, deliver them, and avoid needless work. Calling this architecture mirrorless is not a claim that no byte from the server is ever copied.

The removed mirror is the **application-owned representation that developers are expected to maintain**: the entity model, its collection patches, and the client-side approximation of server transitions.

This is a distinction about responsibility. Internal response retention is delivery machinery. Your application consumes the resulting values rather than owning a second server model.

## A smaller contract, not universal magic

Mirrorless still needs information from the application:

- How to execute reads and commands against its API.
- Which reads a successful command can affect.
- Which external signals should cause reads to refresh.
- How to handle initial failure, background failure, and pending interaction.
- How long a runtime belongs to a particular user, tenant, or session.

It does not infer SQL effects, discover all dependencies from response shapes, make independent reads atomic, resolve offline conflicts, or prove that a backend replica returned the freshest possible answer. Those are separate problems.

This model is useful when the server is authoritative and the frontend's job is to interact with and display its answers. An application whose central requirement is an independently editable offline world has a different problem. A genuinely local editor or simulation can still use its own state model; there is no benefit in pretending that all client state is remote data.

## What becomes easier to reason about

With the boundary in place, questions become more local:

- What data does this renderer require?
- What is the local interaction being represented?
- Which reads can this command affect?
- What signal tells this client about external changes?

You no longer need every feature to answer, "How do I update every incomplete copy of this server entity?"

That is Mirrorless's purpose: **keep local state local, and let server data arrive as input.**
