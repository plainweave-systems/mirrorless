# Initial extraction verification

This records checks performed locally for the initial Mirrorless extraction. It
is evidence for this checkout, not a promise that every version in a peer range,
every browser, or every deployment mode has been exercised.

## Reproducible automated checks

From the repository root:

```sh
npm ci --ignore-scripts
npm run check
npm audit --audit-level=high
```

The clean-install check passed with:

- **82 core tests:** operation matching, immutable values, shared interests,
  leases, stable observers, command failure, bounded in-flight invalidation
  rounds under sustained signals, cancellation, reset/disposal generations,
  reentrant cleanup, and compatibility seams.
- **39 DOM/controller tests:** delivery, switching, cleanup, falsy errors/data,
  JSON-normalized optional parameters, and configured equality.
- **44 example/server tests:** TypeScript and ClojureScript clients, Node/Python/Go
  HTTP parity, command receipts, invalid input, bounded bodies, concurrent IDs,
  external writes, timers, and process cleanup.
- **164 framework tests:** React, Preact, Vue, Svelte, Solid, Angular, and Lit.
- Strict public-subpath TypeScript contracts, including negative type tests.
- Vue SFC, Svelte source/template, and Angular example type checks.
- Production builds for all eight browser examples.
- Local Markdown-link checks (not external URLs or heading-anchor validation).
- Packed-file inspection and installation of the actual tarball into an isolated
  consumer. The consumer installed only Mirrorless: no framework or runtime
  dependency was pulled in. Core, DOM, and Lit-controller imports executed.
  With its optional Svelte peer explicitly supplied, the packed Svelte adapter
  compiled as a client dependency and SSR-loaded without initiating reads.

That is **329 automated tests**, in addition to type/build/package/link checks.
The library repository's dependency audit reported zero known vulnerabilities
at the time of verification. This is not a general security certification.

The local toolchain included Node 24.21.0, TypeScript 6.0.3, Python 3.14.7, Go
1.26.8, and Vite 8.3.5. Framework tests used React 19.3.1, Preact 10.29.8, Vue
3.5.44, Svelte 5.57.2, Solid 1.9.17, Angular 22.2.3, and Lit 3.3.3. Older peer
versions were not separately tested.

The checked-in CI workflow is configured to run the same checks; no remote CI
execution or publication was performed as part of extraction.

## Real-browser smoke checks

An isolated temporary Chromium 154.0.8037.97 profile loaded the production builds
of React, Preact, Vue, Svelte, Solid, Angular, Lit, and vanilla JavaScript against
one temporary loopback HTTP API.

For every example:

1. The initial server-owned task list and independent summary rendered.
2. A task was created through the actual form controls and appeared after the
   command completed.
3. Timer-driven liveness was enabled through the example's checkbox.
4. A separate HTTP write, outside Mirrorless's command API, created another task.
5. All eight clients received that external task through virtual-command refresh,
   and their separately subscribed summaries reflected the new total.

These are interaction/data-delivery smoke checks, not a complete visual,
accessibility, performance, browser-matrix, or end-to-end test suite. The only
console errors observed were missing default `/favicon.ico` requests on the
static demo previews. Temporary browser and preview processes were cleaned up.

## Source-application integration

In the neighbouring `up-web` checkout:

```sh
npm run test:mirrorless
npm run build
```

Both integration tests and the production build passed. Tests use injected fake
executors and in-memory banking facts; no Up credentials or banking API calls
were used. They verify that the application extends the extracted runtime,
ingests reads into its own optional projection, and ignores old-session results
after reset.

The app's pre-existing large-bundle warning remains. Its existing toolchain audit
currently reports four high-severity entries (`nanoid`, `postcss`,
`source-map-js`, and `vite`); those unrelated application dependency versions were
not upgraded during extraction.

## Explicit limits

- React Native uses the React adapter and native rendering recipes; Metro and
  physical-device execution were not tested.
- Framework SSR tests establish the documented no-unintended-fetch behavior.
  Automatic prefetch, dehydration, PendingTasks integration, and hydration are
  not implemented or claimed by those tests.
- Next.js, Nuxt, SvelteKit, Astro, and React Router guidance consists of integration
  recipes, not independently built meta-framework example projects.
- WebSocket notification handling is documented as an application integration;
  the browser smoke test exercised timer-based liveness, not a socket backend.
- Demo servers are ephemeral, loopback-only, unauthenticated examples, not
  production infrastructure.
- Package publishing, registry-name reservation, and remote repository setup
  remain separate decisions. The package is intentionally private in this
  checkout to prevent accidental publication.
