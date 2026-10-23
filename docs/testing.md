# Testing a mirrorless frontend

Test delivery and declared consequences, not a client-side reimplementation of the server's entity transitions.

A useful test boundary has three parts:

1. A dispatcher representing the API contract.
2. A declared set of read interests and update rules.
3. Assertions about delivered values, request selection, failure, and cleanup.

## Repository checks

Use Node 24.15+ within the Node 24 line for the installed repository toolchain. The standalone runtime's declared Node minimum is separate from these framework/build/browser-test requirements.

From the repository root:

```sh
npm test
npm run test:frameworks
npm run typecheck
npm run typecheck:examples
npm run build:examples
npm run check:docs
npm run check:package
# Combined:
npm run check
```

These are the scripts in `package.json`; this guide is not a record that a particular checkout passed them. The combined check covers the tests, public-subpath generic type contracts, framework example checks/builds, local Markdown links, and a clean packed artifact with an isolated-consumer smoke check. Documentation-link checking verifies local target paths, not external URLs or heading anchors.

- `tests/core/` uses Node's built-in test runner for runtime, helper, rule, and race behavior.
- `tests/dom/` exercises imperative bindings and controller lifecycle without requiring a browser framework.
- `tests/frameworks/` contains adapter integration and SSR-oriented tests.
- `tests/examples/` exercises the shared HTTP helper, language clients, and interchangeable demo servers.
- `tests/types/` checks the public TypeScript contracts.

The server parity suite makes real loopback HTTP requests. Python and Go portions explicitly skip when their executable is unavailable; a skipped language is not a passing language. The language-client suite uses the installed TypeScript and ClojureScript tooling. See the [example server notes](../examples/servers/README.md) for their scope and limitations.

`npm run build:examples` runs the example workspace builds; a workspace's own `build` script is useful for focused checks. A core test does not prove that a framework compiler accepts an example, and a compiled example does not prove every lifecycle or security property.

The root package has a targeted `@angular/build` override to Vite 8.3.5 or later within that major. The installed Angular builder otherwise pins a Vite patch with known advisories. Keep the override and lockfile together, verify the Angular example build when changing it, and reassess it when updating upstream build tooling rather than applying an unrelated forced framework downgrade.

Tests exercise the installed versions, not every version permitted by peer dependency ranges. React Native's shared React adapter still needs validation in the consuming native application; a web React integration test is not a device test. A checked-in CI configuration does not itself establish a completed remote run.

## Test the absence of optimistic state

A controlled dispatcher makes the distinction clear:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMirrorless } from 'mirrorless'

test('a confirmed command delivers another server answer', async (t) => {
  let serverTitle = 'Before'
  let confirm
  const runtime = createMirrorless({
    unsubscribeDelayMs: 0,
    query: () => ({ id: '1', title: serverTitle }),
    command: (_name, params) => new Promise((resolve) => {
      confirm = () => {
        serverTitle = params.title
        resolve({ ok: true })
      }
    }),
    updates: { RenameTask: [['GetTask', { id: Symbol.for('id') }]] },
  })
  t.after(() => runtime.dispose())

  const task = runtime.subscribe('GetTask', { id: '1' }, { fetch: false })
  await task.refetch()
  const saving = runtime.command('RenameTask', { id: '1', title: 'After' })

  assert.equal(task.getSnapshot().data.title, 'Before')
  confirm()
  await saving
  assert.equal(task.getSnapshot().data.title, 'After')
})
```

`serverTitle` is a controlled **test server fixture**, not the recommended location for application server entities. The test verifies that pending interaction does not replace confirmed input and that command success triggers another read.

## Test update rules as behavior

For each important command, subscribe to several relevant and irrelevant terms. Execute the command and assert which read dispatches occur.

Include:

- A broad list or aggregate affected by the write.
- A matching detail ID.
- A non-matching detail ID.
- More than one consumer of the same term.
- A missing binding source parameter.
- A list that gains an entity and a list that loses it.
- A virtual command that refreshes reads without invoking the write dispatcher.

`validateUpdateMaps` and `runtime.validateUpdates` can catch malformed configuration, unknown names when supplied, and missing forward/reverse edges. They do not prove business dependency completeness or the logical equivalence of narrowed patterns.

## Control promises instead of guessing timings

For race tests, hold the read or command promise explicitly and release it at the point the test needs. This makes it possible to assert:

- Two consumers share one in-flight request.
- A command affecting an in-flight read causes a follow-up read.
- Earlier commands settle after their own relevant read round even when later timer/socket invalidations continue arriving.
- A removed listener receives no more notifications during its interest lease.
- A run removed before completion is not resurrected.
- Reset/disposal ignores completions from an old generation.
- An old command cannot refresh a replacement session's reads.
- A new parameter term never renders the previous term's data.

Use timer control for lease and periodic-liveness tests. Avoid using a large arbitrary sleep as a substitute for waiting for an observable condition.

## Test rendering separately from delivery

A plain success renderer can be tested with ordinary data props. It does not need a mocked store or a fabricated loading state merely to display a task title.

Adapter tests should separately cover initial loading, initial error handling, valid falsy/null data, existing data during refresh, background failure, reactive parameters, lifecycle cleanup, and server rendering without unintended work.

For interaction state, verify that drafts survive unrelated incoming data according to the editor's chosen policy. A correctly refreshed query is not a reason to erase unsaved input.

## Test the real API boundary

At least one integration test should use an actual HTTP server and command receipts with a different shape from the reads. Otherwise a mock can accidentally prove only that a response happened to resemble the desired UI value.

Also test protocol failure: a rejected HTTP status, a GraphQL error envelope, malformed data where validation is required, and an ambiguous command failure. The dispatcher must not resolve an unconfirmed write as success.

For liveness, change the server from outside the client runtime, then trigger its timer or notification path. Verify that the new value arrives without a client entity patch. That tests the promise users actually care about.
