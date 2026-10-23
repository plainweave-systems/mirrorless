# Server rendering and meta-frameworks

Mirrorless's core can run in JavaScript environments beyond the browser. That does not mean every framework integration automatically has prefetch, dehydration, hydration, streaming, or cross-request isolation built in.

The supplied meta-framework guidance is a set of integration recipes, not a claim that complete Next.js, Nuxt, SvelteKit, Astro, or React Router demo projects are bundled and verified.

## Choose one of two boundaries

### Client-first delivery

Render a stable shell or loading boundary on the server. Create the runtime for the browser application/session. The client adapter declares interest when its client lifecycle activates, then delivers the server data.

This is the simplest integration. It does not require transferring runtime internals between server and browser, and it preserves the mirrorless programming model in the interactive component tree.

It also means that data behind this boundary is not automatically present in the initial server HTML. If server-rendered content is a requirement, design that explicitly rather than assuming a client adapter provides it.

### Explicit server reads

If a route must read through Mirrorless on the server, create a runtime **for that request**, establish explicit interest, await the required read, and dispose the runtime after the request's work is finished.

```js
async function obtainTasksForRequest(createRuntime) {
  const runtime = createRuntime()
  const tasks = runtime.subscribe('GetTasks', {}, { fetch: false })
  try {
    await tasks.refetch()
    return tasks.getSnapshot().data
  } finally {
    tasks.unsubscribe()
    runtime.dispose()
  }
}
```

`createRuntime` is an application factory scoped to that request's identity and transport. This function returns data; it does not transfer an active runtime or establish a browser hydration protocol.

If the browser must continue from a server-rendered value, the application needs an explicit, safe handoff design. Mirrorless does not expose a documented automatic dehydration/hydration API. Do not serialize internal maps or raw run records and treat them as a stable protocol.

## Runtime objects are not serializable application props

A runtime contains dispatchers, subscriptions, listeners, and in-flight work. It is not a value to pass through a meta-framework's server-to-client serialization boundary.

Transfer only appropriate plain data through that framework's supported mechanism. Create the browser runtime on the browser side of the boundary. Scope credentials separately for server and browser execution.

A server module singleton is especially dangerous for authenticated data: equal read terms can reuse results across requests even when the users differ. Context does not fix a runtime object that was already shared across those users.

## Next.js and React server/client boundaries

Place the Mirrorless provider and interactive query boundaries in the client component tree. A render callback such as `tasks => <TaskList tasks={tasks} />` belongs on that side too; it is not a serializable function prop for an arbitrary server-to-client boundary.

Create the browser runtime in a client-owned application/session scope. If component effects own its terminal disposal, account for React's development effect setup/cleanup cycle: disposing a single state-held runtime in the first cleanup and then reusing it will not work.

One client-first pattern creates a new runtime for each effect setup:

```tsx
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { MirrorlessRuntime } from 'mirrorless'
import { MirrorlessProvider } from 'mirrorless/react'

export function BrowserMirrorlessRoot({
  createRuntime,
  children,
}: {
  createRuntime: () => MirrorlessRuntime
  children: ReactNode
}) {
  const [runtime, setRuntime] = useState<MirrorlessRuntime | null>(null)

  useEffect(() => {
    const current = createRuntime()
    setRuntime(current)
    return () => current.dispose()
  }, [createRuntime])

  if (!runtime) return <p>Preparing data…</p>
  return <MirrorlessProvider runtime={runtime}>{children}</MirrorlessProvider>
}
```

This is application-level React code, not an additional Mirrorless export. Keep `createRuntime` stable, and define it in the client scope rather than passing it from a server component. The first server and browser render share the same placeholder; client setup creates the delivery runtime. A session owner outside the component tree can also own creation and final disposal.

If a write happens through a server-side action or another server-owned path, it does not notify an unrelated browser runtime by itself. After confirmation, emit the appropriate client virtual command or provide another liveness signal.

## Nuxt

For client-first use, install the Vue plugin in Nuxt's client-only application setup and wrap data-dependent content in the framework's client rendering boundary as appropriate. Use `createMirrorlessPlugin(runtime)` from `mirrorless/vue` with a runtime created for that browser session.

The Vue composable activates interest on mount rather than during setup/server rendering. That avoids accidental requests, but it is not a substitute for deciding what HTML the server should produce when data has not yet arrived.

For deliberate server reads, make the runtime request-scoped. Do not put it in a shared module and rely on a Vue provider to separate users. Nuxt-provided route data and Mirrorless-delivered client data are separate ownership paths; choose the boundary deliberately instead of copying one into a new maintained store.

## SvelteKit

Use a provider in the intended layout/application subtree and create the runtime with the correct browser or request lifetime. The supplied Svelte query component activates on client mount, so it can participate in a client-first boundary.

A lower-level readable query resource is different: Svelte's automatic store subscription can happen during SSR. If a server-rendered component uses that resource directly, subscription is actual interest and can start work. Do not assume that a store is browser-only because its consumer eventually hydrates.

SvelteKit route-loaded values can remain ordinary route input. If you want Mirrorless to own continued delivery for an interactive subtree, define that transition explicitly; there is no automatic route-data-to-runtime hydration feature.

## Astro

Use the adapter belonging to the renderer inside an interactive island. Decide whether the island receives client-first data or a deliberately server-rendered representation.

Separate islands do not automatically share a provider context merely because they appear on one page. An explicitly shared browser runtime can share read work, but that object still needs one clear session owner and teardown policy. Never use a shared server-process runtime to simulate browser sharing.

Static HTML or server-rendered content outside an activated island does not acquire live updates merely because another island uses Mirrorless.

## React Router

Mount the React provider at a stable application or route scope, depending on whether interest should survive navigation. The normal lease can reuse reads when a route returns shortly afterward.

A route loader and a Mirrorless read are different delivery mechanisms. Do not copy loader data into a mutable entity store merely to use Mirrorless. Either keep it as route input or make the relevant client subtree use Mirrorless delivery, with an intentional handoff if both are needed.

Likewise, an action performed outside the runtime needs a notification path after success. A client virtual command can connect that confirmed action to the relevant interested reads.

## Angular server rendering

The Angular adapter's default signal query activates only in the browser. `{ ssr: true }` explicitly permits server activation. Use that option only with a request-scoped runtime and an intentional server completion/rendering policy.

The adapter does not itself serialize a signal resource into a browser runtime or make several reads an atomic server snapshot.

## Solid and other server-rendered owners

The Solid adapter uses its owner/effect lifecycle; server rendering does not automatically activate client effects. Keep a request-scoped runtime for deliberate server work and a browser/session runtime for continuing delivery.

For any renderer, distinguish these questions:

1. Who obtains data for the initial server HTML?
2. Who owns the browser runtime?
3. How does the first browser render match the server output?
4. Which successful writes and external signals refresh browser interest?
5. Who disposes each runtime and its event/timer owners?

A clear answer to those questions is more valuable than calling an integration "SSR-compatible" without specifying the behavior.
