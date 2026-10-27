# Changelog

## 0.1.1 — 2026-10-27

### Added

- Minimal raw-URL HTTP example using GET reads and POST commands without an operation-name routing table.
- URL-first React and core quick starts, with explicit URL-to-URL update rules and exact-match semantics.

## 0.1.0 — 2026-10-27

Initial public release of **Mirrorless**, extracted from `up-web`.

### Added

- Framework-independent native-ESM runtime with TypeScript declarations.
- Plain-data delivery boundaries so application code can receive server data without maintaining a client-owned entity model.
- Named reads with value-equal parameters, shared runs, immutable snapshots, and configurable interest leases.
- Successful-command update rules with literals, parameter bindings, and virtual commands for timers or external change signals.
- Side-effect-free observers, explicit subscriptions, cells, and optional downstream ingestion hooks.
- Runtime reset/disposal and generation-aware handling of old asynchronous work.
- React/React Native, Preact, Vue, Svelte, Solid, Angular, Lit, and vanilla DOM integration interfaces.
- Browser renderer examples, headless TypeScript and ClojureScript clients, and interchangeable local Node, Python, and Go HTTP servers.
- Architectural writeups, transport and liveness guides, framework and SSR recipes, security guidance, testing notes, and incremental migration guidance.
- Apache-2.0 licensing, copyright Plainweave Systems.

### Extraction behavior

- A command affecting a read already in flight queues/coalesces follow-up read work rather than losing the invalidation.
- Listener cleanup is immediate and separate from delayed interest release.
- Existing delivered data remains available during later refreshes and refresh failures.
- The original banking integration remains application-specific rather than becoming a core dependency.

Compatibility aliases for the source application's server-state vocabulary remain available. New code should use the Mirrorless names documented in the API reference.
