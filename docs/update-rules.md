# Update rules

An update rule says which server questions deserve another answer after a command succeeds. It does **not** say how to patch their answers.

```js
const updates = {
  UpdateTask: [
    'GetTasks',
    ['GetTask', { id: Symbol.for('id') }],
    'GetSummary',
  ],
}
```

A successful `UpdateTask({ id: '1', done: true })` refreshes interested task lists, summaries, and the detail read whose `id` equals `'1'`. The application does not append, remove, or mutate a task in any of those returned values.

The rules are application knowledge. Mirrorless executes them; it does not discover them from endpoint names, schemas, returned IDs, or database changes.

## Names and terms

An operation term has one of these forms:

```js
'GetTask'
['GetTask']
['GetTask', {}]
['GetTask', { id: '1' }]
```

The first three are broad patterns: match the named operation regardless of its parameters. The fourth narrows the match.

The left side of an `updates` entry is one command name. The right side contains its affected read patterns:

```js
const updates = {
  RefreshTasks: ['GetTasks', 'GetTask', 'GetSummary'],
}
```

Broad does not mean "fetch every possible parameter combination." It means "refresh every currently interested run with this name." A run retained by an interest lease still counts as interested.

## Literal values

A literal requires the target read parameter to have that value:

```js
const updates = {
  CompleteTask: [
    ['GetTasks', { status: 'done' }],
  ],
}
```

This matches `GetTasks({ status: 'done' })`, but not `GetTasks({ status: 'active' })`.

The parameter pattern is a partial match. A read with additional parameters can match:

```js
['GetTasks', { status: 'done', page: 2 }]
```

Literal values use the configured value equality. They are not stringified identity keys. An explicitly required target key must exist; omitting a key from a pattern is how you leave it unconstrained.

The `CompleteTask` example illustrates literal matching only. On its own, it is usually **not a complete dependency declaration** for a filtered list: completing an item can also remove it from the active list. See membership changes below.

## Symbols bind command parameters

A symbol in a target pattern refers to a parameter of the successful command:

```js
const Id = Symbol.for('id')

const updates = {
  UpdateTask: [
    ['GetTask', { id: Id }],
  ],
}
```

For `UpdateTask({ id: '1', title: 'Review proposal' })`, the runtime compares:

```text
read.params.id equals command.params.id
```

It does not compare the read's ID to the symbol itself, and it does not read an ID from the command response.

The parameter names need not be the same:

```js
const updates = {
  RenameTask: [
    ['GetTask', { id: Symbol.for('taskId') }],
  ],
}
```

Here the detail read's `id` is compared with `RenameTask`'s `taskId`.

### Missing source parameters

If a binding refers to a missing command parameter, that pattern does not match.

```js
// Rule requires command.params.id.
await runtime.command('UpdateTask', { title: 'No ID supplied' })
```

The update language does not turn a missing binding into a wildcard. Your dispatcher should normally reject a malformed command before it can succeed. Validate operation inputs at the transport/application boundary rather than relying on an update rule to validate a write.

## AND within a pattern

Every specified key must match:

```js
const updates = {
  UpdateTaskInProject: [
    ['GetTaskInProject', {
      id: Symbol.for('id'),
      projectId: Symbol.for('projectId'),
    }],
  ],
}
```

A read for the right task but the wrong project does not match.

## OR across patterns

Use more than one target for alternative affected scopes:

```js
const updates = {
  MoveTask: [
    ['GetProjectTasks', { projectId: Symbol.for('fromProjectId') }],
    ['GetProjectTasks', { projectId: Symbol.for('toProjectId') }],
    ['GetTask', { id: Symbol.for('id') }],
  ],
}
```

A move can affect both the old project's list and the new project's list. Writing both targets makes that consequence visible without reproducing the server's list-editing logic.

## Collection membership is the common trap

A command can affect a read even when the changed entity is absent from that read's previous response.

Examples:

- A newly created task belongs in a list that did not contain it.
- Completing a task removes it from an active list and adds it to a completed list.
- Changing a sort key can move an item between pages.
- Moving an item affects both its old group and its new group.
- A permission change can alter whether an item is visible at all.
- One write can affect an aggregate even if the aggregate exposes no entity IDs.

Do not infer dependencies by searching only the currently returned data. Do not narrow to the new membership while forgetting the old membership.

Start broadly:

```js
const updates = {
  CreateTask: ['GetTasks', 'GetSummary'],
  UpdateTask: ['GetTasks', 'GetTask', 'GetSummary'],
  DeleteTask: ['GetTasks', 'GetTask', 'GetSummary'],
}
```

Then narrow where you have enough information and tests:

```js
const updates = {
  UpdateTask: [
    'GetTasks',
    ['GetTask', { id: Symbol.for('id') }],
    'GetSummary',
  ],
}
```

It is often inexpensive to narrow a detail read by ID and much harder to narrow every list that could gain or lose that item. Those optimizations do not have to happen together.

## API translation stays at the edge

The pattern language compares values; it is not a transformation language.

Suppose the API writes `{ completed: true }`, while a read is parameterized by `{ view: 'done' }`. A symbol does not translate the boolean into the string.

Options include keeping the read update broad or emitting a virtual application event with normalized parameters after the real write succeeds:

```js
const runtime = createMirrorless({
  query: readFromApi,
  command: writeToApi,
  virtualCommands: ['TaskMovedBetweenViews'],
  updates: {
    TaskMovedBetweenViews: [
      ['GetTasks', { view: Symbol.for('fromView') }],
      ['GetTasks', { view: Symbol.for('toView') }],
      ['GetTask', { id: Symbol.for('id') }],
    ],
  },
})
```

`readFromApi` and `writeToApi` are application dispatchers. The code that knows the operation's old and new views can emit the virtual command after confirmation. If it does not know both, broad invalidation is safer than guessing.

Avoid running an ordinary command recursively through its own dispatcher merely to express an event. Keep execution and notification responsibilities explicit.

## Virtual commands are ordinary rule sources

```js
const runtime = createMirrorless({
  query: readFromApi,
  command: writeToApi,
  virtualCommands: ['RefreshTasks'],
  updates: {
    RefreshTasks: ['GetTasks', 'GetTask', 'GetSummary'],
  },
})

await runtime.command('RefreshTasks')
```

The command dispatcher is skipped for `RefreshTasks`; matching interested reads still refresh. This is the bridge for manual refresh, timers, focus, and external notifications. See [liveness](liveness.md).

## Reverse maps are an audit view

You can normally provide `updates` alone. Mirrorless derives a name-level reverse view for inspection. An explicit `updatedBy` map can document dependencies from the read side and help audit forward/reverse edge presence.

The forward `updates` map drives execution. The reverse map does not add another source of runtime matching, and the validator does not prove that two narrowed parameter patterns are logically equivalent. `reverseUpdateMap` produces operation names, not a logical inversion of arbitrary predicates or parameter bindings.

Keep the executable dependency knowledge in the forward rules, and use tests to establish the intended parameter behavior.

## Review rules like application behavior

For each command, ask:

1. Which detail representations can change?
2. Which lists can gain, lose, reorder, or move that entity between pages?
3. Which summaries, permissions, or composite reads can change?
4. Which parameter values are actually available after success?
5. Which external writers can perform the same change, and what signal reaches this client?

Test broad and narrowed rules separately from the transport. Then test a complete flow with several interested views. A configuration that looks concise is not useful if a relevant view is missing from it.
