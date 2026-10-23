# Contributing to Mirrorless

Mirrorless's purpose is to remove the application-owned client model of server entities. A contribution should make it easier to receive server data as component input while keeping genuine local interaction state local.

Do not turn the project into an entity store merely because a new feature needs somewhere to put data. First ask whether the responsibility belongs in delivery machinery, a renderer adapter, an application dispatcher, or an explicitly optional projection.

## Work locally

The package is currently private while the extraction is checked. Publishing is a separate decision; do not remove that protection as part of an unrelated change.

```sh
npm install
npm run check
```

Useful focused scripts are:

```sh
npm run test:core
npm run test:dom
npm run test:examples
npm run test:frameworks
npm run typecheck
npm run typecheck:examples
npm run build:examples
npm run check:docs
npm run check:package
```

`npm run check` includes these layers: Node and framework tests, public TypeScript contracts, framework example checks/builds, local Markdown links, and package-artifact/isolated-consumer checks. Local results do not establish that CI has run remotely or that every version permitted by a peer range was tested.

Start the API and a renderer demo in separate terminals:

```sh
npm run demo:server
npm run demo:vanilla
```

Choose a different `demo:*` script for the adapter being changed. Each example workspace has its own build script; verify compiler-facing changes with the relevant example build in addition to unit tests.

Use Node 24.15+ within the Node 24 line for repository development. The installed Angular and browser-test toolchains require a newer environment than the standalone runtime, whose package declaration remains Node.js 20.19 or later. The direct TypeScript example also relies on Node's type-stripping support. Python and Go are optional tools for their server examples and parity tests. Report skipped tool-dependent checks honestly.

## Repository boundaries

- `src/core/` contains native-ESM JavaScript, public declarations, and framework-independent delivery machinery. It has no required framework or banking dependency.
- `src/<framework>/` contains that renderer's lifecycle integration. Optional peers must not become unconditional root imports.
- `src/dom/` supplies imperative delivery callbacks without owning a DOM template system.
- `tests/core/`, `tests/dom/`, `tests/frameworks/`, and `tests/types/` exercise their corresponding contracts.
- `examples/shared/` is demo application integration with a real HTTP API, not part of the runtime API.
- `examples/servers/` demonstrates backend independence through Node, Python, and Go implementations of one contract.
- `docs/` explains the programming model, API, integration policy, and limits.

JavaScript package sources should not require a JSX transform. Svelte ships its component source for the consumer's normal compiler. Examples use their framework's ordinary source formats.

Keep TypeScript declarations aligned with runtime behavior. Adding a generic return type is not a substitute for implementing or validating that behavior.

## Preserve the delivery boundary

A normal successful renderer receives plain available data. It should not need a runtime, mutable store, or request-state union merely to display a value.

Adapters may expose snapshots when an interaction needs metadata. They must not deep-convert server responses into writable entity models or briefly display one term's data under another term's parameters.

Observer construction and snapshot reads are inert. Framework lifecycle activates interest. Listener cleanup is immediate even when the underlying interest lease remains alive.

Treat `undefined` as absent data. Test `null`, `false`, `0`, empty strings, and empty arrays as real values. Initial error handling and background error handling are different contracts.

## Test changes where they fail

A runtime change needs core tests for the observable behavior, including races when relevant. Use controlled promises rather than timing guesses. A framework change needs real framework lifecycle tests, not only a fake object with similarly named methods.

For a new adapter, cover:

- Provider/injection scope and a useful missing-runtime error.
- No request merely from constructing/rendering an inert observer.
- Correct first loading and initial error presentation.
- Plain success data, including valid falsy values.
- Retained data during refresh and refresh failure.
- Reactive name/parameter changes without old-term leakage.
- Value-equal parameters without needless subscription churn.
- Shared interest, immediate listener cleanup, and reconnect/remount behavior.
- The renderer's SSR activation policy.
- Public TypeScript contracts and a compiled/runnable example.

A new liveness helper must have an owner and cleanup path. A timer or socket listener is not finished merely because its happy path refreshes data.

## Keep success semantics honest

The dispatcher decides whether an operation succeeded. Do not add code that silently treats protocol or application failures as confirmed commands. Do not add automatic retries to consequential commands as an incidental convenience.

The runtime can order refetch work after a command, but it cannot prove that an API replica returned the freshest possible answer or that several reads form a transaction. Document stronger guarantees only when an implementation and API contract actually provide them.

Ingestion hooks and other extension points may start work outside core. Their cancellation, identity scope, and failure policy must be explicit; generation checks cannot undo arbitrary external side effects.

## Documentation is part of the contract

Update examples and declarations with the API, not afterward. Check code snippets against actual names and signatures. Clearly separate executable examples from integration recipes. Do not claim that a platform or language passed tests when its checks were skipped or not run.

Prefer the product language:

> Server data is component input, not client-owned application state.

Use active interests, update rules, and response retention to explain the implementation when useful. Do not make those mechanisms replace the architectural reason for the library.

Liveness can be implemented through timers or push-triggered invalidation. Do not describe an integration as inherently non-live simply because its read transport is HTTP.

Avoid unsupported benchmarks, ecosystem comparisons, adoption claims, or feature-parity claims. A precise description of the behavior is more useful.

## Licensing and provenance

Mirrorless is Apache-2.0, copyright 2026 Plainweave Systems. Preserve the repository's LICENSE and NOTICE and keep contributed code compatible with that license. Do not copy third-party code without checking its license and attribution requirements.

A concise source header used in this repository is:

```text
Copyright 2026 Plainweave Systems
SPDX-License-Identifier: Apache-2.0
```

The design inherits from `live-components` and the `up-web` server-state implementation. Preserve that history fairly without inventing an origin date, exclusive novelty claim, or broader guarantee than the implementation provides.
