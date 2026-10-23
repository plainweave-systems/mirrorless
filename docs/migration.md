# Incremental migration

A migration should remove an application's server-state model, not rename its existing store to Mirrorless.

Start with a narrow vertical slice: one read, one renderer, one command, and one other read affected by that command. Keep unrelated features working while you establish the boundary.

## 1. Identify what is actually local

Separate the feature's current state into:

- Server-derived values: fetched entities, list results, server totals, server permissions.
- Local interaction: drafts, selection, open panels, navigation, pending commands, local messages.
- Delivery metadata: whether a read has a first answer, whether it is refreshing, and its errors.

Keep local interaction in the framework's normal state mechanism. Move delivery metadata to the query boundary. Stop treating server-derived values as a mutable application-owned model.

This is not a requirement to remove an entire state library from a large application. It can remain appropriate for genuine local state or for untouched features during migration.

## 2. Keep the API client

Wrap the existing API boundary with `query(name, params, context)` and `command(name, params, context)`. Preserve its authentication, signing, serialization, validation, and error handling.

Do not rewrite a working backend merely to adopt Mirrorless. REST, GraphQL, RPC, and composite reads can all provide component input.

Check success semantics before migrating writes. A GraphQL or application error envelope must not resolve as a successful command merely because HTTP returned `200`.

## 3. Turn a display component into a data consumer

Extract the success renderer from its fetching and store wiring:

```jsx
function TaskList({ tasks }) {
  return <ul>{tasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul>
}
```

Then put the delivery boundary at the point of use:

```jsx
<MirrorlessQuery id="GetTasks" loading={LoadingTasks}>
  {(tasks) => <TaskList tasks={tasks} />}
</MirrorlessQuery>
```

`MirrorlessQuery` is imported from your renderer's adapter, and `LoadingTasks` is your loading component. Initially, this read may coexist with a legacy store elsewhere. Make that temporary duplication visible; do not start synchronizing both directions.

## 4. Declare a command's known effects

Move update knowledge out of individual click handlers:

```js
updates: {
  UpdateTask: ['GetTasks', ['GetTask', { id: Symbol.for('id') }], 'GetSummary'],
}
```

The handler awaits the command and updates only its local interaction state. Remove its task-array patch and summary-count patch for the migrated consumers.

Start broad for list membership. A command can remove an item from one filtered result and add it to another. Keeping an old selective invalidation rule without reexamining it can preserve the original bug under a new API.

## 5. Retire the migrated server-state slice

Once every consumer of that slice receives delivered reads, remove the old fetched-entity state, its reducers/actions, and its synchronization code. Keep local draft and selection state.

Avoid an adapter that copies every incoming response back into the old store. That retains the architecture Mirrorless was meant to remove and creates two owners of the same representation.

If some legacy feature still needs the old store, isolate the compatibility boundary and migrate it deliberately. A one-way temporary projection is easier to reason about than bidirectional synchronization, but it remains extra machinery to retire or justify.

## Migrating from a query-cache toolkit

Mirrorless is not an assertion that existing query libraries cannot refresh data after mutations. The migration is a choice about the application programming model and responsibility boundary.

Keep useful transport code and tests. Replace per-feature ownership of fetched values with data boundaries. Translate known write effects into central rules. Revisit implicit retry, focus, reconnect, stale-window, persistence, cancellation, and error policies rather than assuming defaults match.

Do not claim feature parity merely because the first read works. Pagination helpers, devtools, offline behavior, hydration, background policies, and mature ecosystem integrations are separate capabilities. If a current feature depends on one, keep it, implement an intentional integration, or postpone that portion of the migration.

## Pagination remains a read-composition problem

Mirrorless can deliver separate page reads. It does not automatically choose cursor lifetime, merge pages, deduplicate rows across pages, or preserve scroll interaction.

Keep those policies explicit. An application-specific page-composition resource may be appropriate; do not present it as a reason that every server entity needs to enter a global normalized store.

When a command can change page membership or ordering, refresh the relevant page interests conservatively. A changed item can enter a page that did not previously contain it.

## Existing route loaders and server rendering

Route-provided data can remain ordinary route input. Decide where Mirrorless takes responsibility for continued client delivery. Do not silently copy loader values into another store and then ask Mirrorless to keep that store current.

The extraction does not provide automatic hydration from arbitrary loader data. Use a client-first boundary or an explicit request-scoped server-read design. See [SSR recipes](server-rendering.md).

## External writers need a signal

A local command only describes changes that pass through that runtime. If another client or service can write the data, connect a timer, focus/reconnect refresh, or server notification as appropriate.

Use a virtual command to connect those signals to the same rules. Do not introduce a second system that applies socket patches to an application entity model unless that is a deliberate separate requirement.

## Optional projections are a separate decision

If a feature needs a local analytical database or specialized projection, document its completeness and lifetime. It may be useful, but it is not mandatory for a list or detail renderer to receive data.

Do not carry an old normalization layer into the new architecture merely because it already exists. Ask which consumers genuinely require it after ordinary rendering has become direct data delivery.

## A useful migration acceptance check

For the migrated slice:

- The success renderer accepts ordinary data and can be tested independently.
- Commands do not manually patch its fetched entity representation.
- Independent affected views receive new server answers after success.
- Local drafts and selections remain local and do not reset accidentally on refresh.
- External changes become visible through the intended liveness policy.
- Teardown releases listeners and ends the runtime's identity scope correctly.
- No legacy server-state slice remains solely as a second owner of the migrated data.
