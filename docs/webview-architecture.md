# Webview Architecture

How webview apps hold state and talk to the extension host. Every surface runs the **same single
stack**: Supertalk RPC over VS Code's postMessage pipe, with frames traveling as binary payloads
wrapped in a `__supertalk_rpc__` namespace (`rpc/constants.ts`). Around that core, each concern
has one mechanism: readiness rides the RPC session announcement, visibility/focus pushes ride
buffered RPC events re-emitted as window CustomEvents, bootstrap arrives once through a serialized
HTML attribute with tagged-value revival, and persistence uses the VS Code webview state API. For
styling see `docs/webview-styling.md`; for the Commit Graph's rows channel see
`docs/graph-update-pipeline.md`.

## One stack

Every webview gets an `RpcHost` (`src/webviews/webviewController.ts`) exposing typed services
(`rpc/services/`, aggregated by `createSharedServices`) over a single Supertalk connection; the
app side connects through its `RpcController`. There is no second message protocol and no
per-surface transport choice.

| Surface         | App entry                                | Service planes                                          |
| --------------- | ---------------------------------------- | ------------------------------------------------------- |
| Settings        | `apps/settings/settings.ts`              | shared services                                         |
| Commit Details  | `apps/commitDetails/commitDetails.ts`    | shared services                                         |
| Home            | `apps/home/home.ts`                      | shared services + promos                                |
| Timeline        | `apps/plus/timeline/timeline.ts`         | shared services + promos                                |
| Commit Graph    | `apps/plus/graph/graph.ts`               | `plus/graph/graphService.ts` + the `graph:rows` channel |
| Patch Details   | `apps/plus/patchDetails/patchDetails.ts` | `rpc/patchDetailsService.ts` + shared services          |
| Rebase          | `apps/rebase/rebase.ts`                  | `rpc/rebaseService.ts`                                  |
| Welcome         | `apps/welcome/welcome.ts`                | `rpc/welcomeService.ts` + shared services               |
| Allowed Signers | `apps/allowedSigners/allowedSigners.ts`  | `rpc/allowedSignersService.ts`                          |

`src/webviews/protocol.ts` is a pure types module (custom config keys and `WebviewState`) —
it declares no messages at all. Readiness is part of the RPC session itself: each client session
announces itself (see "The RPC handshake" below), and focus/visibility pushes all ride RPC.

### The RPC handshake

There is no separate readiness message. Supertalk's `expose()` sends its ready signal exactly
once and `waitForReady()` sends nothing, so a host that exposed before the webview's scripts were
listening would strand the client forever. Instead the announcing side is the client: each mount's
session runs `reset()` + `expose()` (`apps/shared/rpc/session.ts`), which posts a handshake frame
the moment the client is listening, and the host watches for exactly that frame
(`RpcHost`'s announcement tap in `rpc/rpcHost.ts`).

Serving an announcement is destructive — it swaps to a fresh exposed Connection and resets the
tracked subscriptions — so whether to serve is gated by the controller's session state
(`_sessionState`): serve only when no generation is currently validated (`none`). A second
announcement while one is already served-but-unvalidated (a straggler from a dying iframe) or
while the session is healthy (an element remount joining the live connection) is answered with a
re-announce on the existing connection instead — inert to sessions whose handshake slot is
consumed, and sufficient to unblock any genuine waiter. The latch self-heals after
`sessionLatchTimeout` if the served generation dies before validating, so a crash can't wedge
the gate shut permanently.

After the handshake resolves, the client reports its generation identity over the shared
`webview` group's `connect()` method (`clientId`/`clientLoadedAt` from
`getWebviewClientInfo()`), which is what flips the controller `_ready`, classifies reconnects via
the same-vs-different generation comparison, and drives `provider.onReady`/`onReconnect`. Every RPC
registration is attributed to the caller session dispatching it — `Connection.callerSession`, read
synchronously (before any `await`) via `SubscriptionTracker.callerSession`, which `RpcHost` binds
once in its constructor to a resolver closed over its own (possibly swapped) `Connection`. A
counter-based generation can't express this safely: bumping a counter on every announcement — served
or not — means an ignored announcement's straggler (a duplicate/late handshake that still gets a
resolved `waitForReady()` off the re-posted frame; see the latch above) registers at a NEWER counter
value than the legitimately-served client, so validating-by-counter releases the wrong side. Session
identity doesn't have that ordering problem: each registration simply belongs to the connection that
made it.

`connect()` is itself dispatched over RPC, so its own caller session identifies the validating
client. While `_sessionState` is `none`, EVERY `connect()` is rejected unconditionally — nothing has
been served since the last invalidation (dispose, html reload, non-retain hide; each also clears
`RpcHost.pendingServedSession` via `invalidatePendingSession()`), so no caller has anything
legitimate to validate against, even one whose session happens to still equal a now-stale
`pendingServedSession`. While `served-awaiting-validation`, the caller session is checked against
`RpcHost.pendingServedSession` — the session `RpcHost` captured off the handshake frame's own
`session` field when it decided to SERVE that announcement (as opposed to answering with an inert
re-announce); a mismatch means this `connect()` didn't come from the session actually served, so
it's rejected as a straggler and only ITS OWN registrations are released
(`SubscriptionTracker.releaseSession`). Once healthy, an element remount's `connect()` skips this
gate entirely (its announcement is deliberately left unserved, so its session never becomes the
pending one) and instead passes the existing `clientId`/`clientLoadedAt` comparison. Either way, once
a `connect()` call validates, `SubscriptionTracker.releaseAllExcept(session)` disposes every
registration NOT owned by the validating session, across every event (`rpc/eventVisibilityBuffer.ts`)
— a same-connection remount's predecessor mount, or any straggler's debris. This runs BEFORE
`provider.onReconnect`/`onReady` (`WebviewController.connect()`), so a provider that reseeds
synchronously from one of those callbacks can't push that reseed to a not-yet-released interloper's
still-live registration. A genuinely served reconnect (a swapped Connection, not a remount)
additionally calls the tracker's wholesale `reset()` from `RpcHost`, disposing everything
unconditionally. Because release waits for validation, there's a brief window — between a remount's
replay and its `connect()` — where both the old and new session's registrations are live and a fired
event reaches both; a straggler that never reaches `connect()` at all never triggers a release, so
its debris registrations are only ever disposed by the next legitimate validation or a served
reconnect's `reset()`.

`releaseAllExcept(session)` tombstones (see `SubscriptionTracker.isSessionReleased`) every session
this call ACTUALLY released a registration for, every `SubscriptionTracker.reserveSession`'d session
not superseded, and the previously validated keeper (remembered from the last `releaseAllExcept`, so
a keeper that happens to be idle — nothing tracked, nothing reserved — when it's superseded is still
released) — deliberately NEVER a session merely for not being the new keeper. A session that has
never validated and has neither a tracked registration nor a reservation at release time has had no
chance to be superseded (e.g. a remount's brand-new post-reset session, registering before its own
`connect()` runs) and must stay live, or its retained subscription would be torn down before it ever
gets to validate. This is also what stops a released interloper from immediately re-registering: its
earlier registration was tombstoned right here, so a synchronous re-registration is caught by
`isSessionReleased` in `trackRpcRegistration`.

An async subscription method that awaits resource acquisition before registering (e.g.
`RepositoryService.onRepositoryOrWorktreeChanged`) must capture its caller session before that await
— `Connection.callerSession` is unreliable once the caller resumes from an `await` (see its doc
comment) — call `SubscriptionTracker.reserveSession(session)` synchronously right there (before the
await) so a validation landing while it's mid-acquisition can still tombstone it despite having
nothing tracked yet, and pass the captured session explicitly to `trackRpcRegistration`'s optional
session parameter, which re-checks `SubscriptionTracker.isSessionReleased(session)` immediately
before attaching (running `attach()` regardless, so any resource it wraps still gets a teardown call
instead of leaking, then tearing that down immediately instead of installing it). `reserveSession`
returns a one-shot release handle backed by a refcount — each concurrent acquisition holds its own,
so same-session overlaps don't collapse — and the method must release it on EVERY exit path,
including a rejected acquisition: wrap the whole thing in `try/finally`, releasing in the `finally`
so it runs after `trackRpcRegistration`'s check. The method itself should still check `epoch` after
the await, which `isSessionReleased` doesn't cover — a different failure mode (reset/disposal, not
session invalidation).

Any event implementation that doesn't go through `createRpcEvent`/`createRpcEventSubscription`
must register through the exported `trackRpcRegistration` helper in the same file, never call
`tracker.track()` directly. A bare `track()` skips session attribution and stacks a duplicate
listener on every remount.

### Shared-core pushes ride RPC

Focus reporting, telemetry, and host focus/visibility pushes are wired centrally, not per surface:

- The host exposes a shared `webview` service group (`rpc/webviewViewService.ts`, aggregated by
  `createSharedServices`) with `connect()` (the session handshake), `focusChanged()` and three
  save-last events (`onVisibilityChanged`, `onWebviewFocusChanged`, `onHostWindowFocusChanged`);
  its controller-side emitters are their only source.
- `RpcController` resolves that group after each handshake, subscribes its events once (re-armed
  automatically per handshake), dispatches the `webview-focus`/`webview-blur` and
  `webview-visible`/`webview-hidden` window CustomEvents from that single place (shared overlays
  like popovers listen for them), and invokes its
  `onWebviewFocusChanged`/`onWebviewVisibilityChanged`/`onHostWindowFocusChanged` option callbacks
  so app-level overrides keep working. It also exposes `sendTelemetry()` (buffered, in-order flush
  on ready) and `sendFocusChanged()`.
- App bases (`apps/shared/appBase.ts`) route the focus tracker's debounced reports and the
  `emitTelemetrySentEvent` DOM-event bridge through those controller methods.

### The Graph

The Graph is fully RPC: every service plane lives in
`plus/graph/graphService.ts` (including the full-state push, branch state, and repo connection —
`GraphStateService.onStateChanged` and the `repoStatus` events), and the rows plane (paging,
splices, sync) rides a Supertalk `SequencedChannel` named `graph:rows` — see
`docs/graph-update-pipeline.md`. `plus/graph/protocol.ts` is a pure types module, and its command
executions ride the shared `commands` RPC service.

The Graph keeps one bootstrap-era trait the other surfaces don't: its `GraphStateProvider` seeds
its whole signal-state mirror from the `context=` attribute (the serialized `State` payload built
by `includeBootstrap`) instead of fetching over RPC. The host serializes that attribute with the
tagged-value serializer (`serializeIpcData`, `system/ipcSerialize.js`), so the provider revives it
through `deserializeIpcData` directly — plain `JSON.parse` would silently deliver raw
`{ __ipc: 'date' }` tags for values like `branchState.pr`'s dates.

### Sequencing across teardown

Supertalk defers sends to a microtask flush, so a message fired from a click handler can simply
never arrive if something tears down or navigates the webview before its microtask runs.

This isn't hypothetical: it happened. The Graph's welcome-continue button used to fire a command
(open the welcome view) and, from a parent handler, an RPC call (persist onboarding dismissals,
then `vscode.moveViews` the Graph into the side bar or panel). The move tears down and re-creates
the webview; the deferred persist lost the race against that teardown often enough to silently
drop the dismissal, so the welcome prompt re-appeared on next open. The fix
(`plus/graph/graphService.ts` `GraphWelcomeService.continueToGraph`,
`plus/graph/graphWebview.ts` `onWelcomeContinueToGraph`) folded both effects into one RPC method,
so the persist-then-move sequencing lives inside a single causally-ordered handler.

**Rule**: any durable side effect (persistence, telemetry) must ride inside the same handler that
tears down, moves, or navigates the webview — not in a separate fire-and-forget message. If a
durable effect genuinely must precede the teardown-triggering message, ack-sequence it (await the
write's response before sending it), not fire-and-forget.

The search plane shows the other way out: move a whole plane rather than living with a split one.
Search once ran as a request/response plus a notification stream for one operation, arbitrated by
a monotonic `searchId` stamped on every payload because the split offered no per-operation
cancellation and no causal ordering between a response and the notifications its own handler
emitted. On RPC that counter is unnecessary: the caller's `AbortSignal` crosses the wire, so a
superseded search simply resolves with nothing. The migration deleted the counter outright rather
than porting it, along with the rows-plane rider that re-shipped search results on every rows
emission. Two constraints came out of it and generalize: a plane moves **whole** (a half-migrated
plane is the hazard above, by construction), and any payload on a `save-last` buffered event must
be a **complete snapshot**, never a delta — a hidden webview keeps only the newest emission, so
deltas silently lose everything in between.

## State ownership

Every piece of state falls into one of six categories, and the category determines where it
lives and whether it is persisted.

| Category       | Source of truth | Managed by                        | Persisted                 |
| -------------- | --------------- | --------------------------------- | ------------------------- |
| **Resource**   | host            | `createResource()`                | never — refetched         |
| **Navigation** | surface         | `persisted()`                     | always                    |
| **UI**         | surface         | `persisted()`                     | always                    |
| **Ambient**    | host            | `createRemoteSignalBridge()`      | never — pushed on connect |
| **Runtime**    | surface         | `signal()` or owned by a resource | never                     |
| **Derived**    | computed        | `computed()`                      | never                     |

**Persist navigation and UI state only.** Persisting resource data produces stale reads, large
checkpoints, and correctness bugs; persisting ambient or derived state duplicates a source that
will re-push or recompute anyway.

Navigation state identifies _what the surface is looking at_ (subject ref, mode, active tab,
scope). UI state is _how the user arranged it_ (filters, sort, expanded sections, drafts,
selection).

## Host abstraction

Surfaces never touch `acquireVsCodeApi()` directly. Two seams make an app host-agnostic:

```ts
// src/webviews/apps/shared/host/context.ts:6
export interface HostContext {
	readonly storage: HostStorage;
	createEndpoint(): DisposableEndpoint;
}
```

`getHost()` (`host/context.ts:13`) lazily builds the VS Code default; `setHost()` overrides it for
tests or non-VS Code hosts. `HostStorage` (`host/storage.ts:3`) is a two-method
`get()`/`set()` interface with four implementations in that file: `VsCodeStorage` (wraps
`getState`/`setState`), `BrowserStorage` (`localStorage`), `InMemoryStorage`, and `noopStorage`.
The raw VS Code webview API surface itself is wrapped by `getHostIpcApi()`
(`apps/shared/ipc.ts`) — `postMessage` for the RPC transport's outbound path plus
`getState`/`setState` for persistence — so no app code touches `acquireVsCodeApi()` directly.

## State groups and persistence

Two group primitives, differing only in persistence:

- **`createSignalGroup()`** (`apps/shared/state/signals.ts:31`) — ephemeral. Returns
  `{ signal, resetAll }`. Used by the shared contexts (`ai`, `integrations`, `launchpad`,
  `onboarding`) and the Graph's `detailsState`.
- **`createStateGroup(options?)`** (`apps/shared/state/signals.ts:85`) — adds persistence.
  Returns `{ signal, persisted, resetAll, startAutoPersist, dispose }`
  (`signals.ts:57`). Used by Commit Details, Home, Settings, and Timeline.

`persisted(key, initialValue, opts?)` (`signals.ts:175`) restores from the checkpoint **at
creation time**, so persisted values are readable before RPC connects — that is what lets a
surface paint its restored layout without waiting on the host.

`startAutoPersist()` (`signals.ts:229`) attaches a `Signal.subtle.Watcher` that microtask-batches
writes and returns a stop function. There is no manual `persistState()` call in migrated
surfaces.

### The checkpoint

All persisted keys for a surface live in one blob written to `HostStorage`, alongside three
reserved keys (`signals.ts:72-75`):

| Key    | Meaning                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| `__v`  | schema version; a mismatch runs `options.migrate`                            |
| `__rk` | restore key; a mismatch **discards** the checkpoint rather than migrating it |
| `__ts` | write timestamp                                                              |

`resetAll()` resets ephemeral signals and re-reads the checkpoint to restore persisted ones —
it is the reconnect path, and it keeps registrations. `dispose()` is permanent teardown.

## Resources

`createResource()` (`apps/shared/state/resource.ts:32`) replaces hand-wired
fetch/loading/error/cancel triples:

```ts
// src/webviews/apps/shared/state/resource.ts:10
export interface Resource<T, TArgs extends unknown[] = []> {
	readonly value: ReadableSignal<T>;
	readonly loading: ReadableSignal<boolean>;
	readonly error: ReadableSignal<string | undefined>;
	readonly status: ReadableSignal<ResourceStatus>; // 'idle' | 'loading' | 'success' | 'error'
	readonly generationId: GenerationTracker;
	fetch(...args: TArgs): Promise<void>;
	refetch(): Promise<void>;
	mutate(value: T): void;
	cancel(): void;
	reset(): void;
	dispose(): void;
}
```

The fetcher receives an `AbortSignal` as its first argument. `cancelPrevious` defaults to `true`,
so a second `fetch()` aborts the first. Staleness is guarded twice — by a monotonic request id and
by `signal.aborted` — so a superseded fetch's late resolution is dropped rather than clobbering
newer data. Both callers' promises still resolve; only the winner lands in `value`.

`refetch()` re-runs with the last args and no-ops if never fetched. `mutate()` sets a value
without fetching (optimistic writes). `reset()` cancels and returns to `initialValue`.

## Ambient state

`createRemoteSignalBridge(defaultValue)` (`apps/shared/state/remoteSignal.ts:4`) is a signal that
starts local and is taken over by a host-pushed signal once RPC connects. `disconnect()`
snapshots the remote's last value into the local one, so consumers keep the last known value when
the connection drops — a single `.get()` throughout, with no `signal<ReadableSignal<T>>`
double-unwrap. Used for org settings and account presence (`commitDetails/state.ts:84`, `:87`).

Reserve it for small, low-churn, cross-cutting values. Large per-surface datasets belong in
resources.

## Transport shapes

RPC is transport, not architecture. Traffic takes four shapes:

| Shape              | Use                                    | Example                                         |
| ------------------ | -------------------------------------- | ----------------------------------------------- |
| **Query**          | pure, abortable read                   | `services.git.getCommit(repoPath, sha, signal)` |
| **Command**        | semantic write or side effect          | `services.navigation.setPin(true)`              |
| **Event**          | host says "changed", surface refetches | `onRepositoryChanged(() => commit.refetch())`   |
| **Ambient signal** | small host-owned reactive value        | `subscription.orgSettingsState`                 |

Keep queries **resource-shaped, not screen-shaped**. `getCommit(id)` composes and caches;
`getCommitDetailsState()` couples the host to a layout and blocks progressive rendering.

Shared services are aggregated by `SharedWebviewServices` (`rpc/services/common.ts:41`) and live
in `src/webviews/rpc/` — repositories, repository, config, storage, subscription, integrations,
onboarding, agents, ai, autolinks, branches, commands, telemetry, files, pullRequests, drafts
(under `rpc/services/`), and the shared `webview` group (`rpc/webviewViewService.ts`).

Fire-and-forget helpers: `fireRpc()` (`apps/shared/actions/rpc.ts:203`) logs and surfaces the
error into an error signal; `optimisticFireAndForget()` (`actions/rpc.ts:86`) applies a value
immediately and rolls back on rejection, version-guarded so overlapping writes don't clobber.
`subscribeAll()` (`apps/shared/events/subscriptions.ts:31`) runs subscriptions via
`Promise.allSettled` and returns one combined unsubscribe.

## Lifecycle

`RpcController` (`apps/shared/rpc/rpcController.ts:69`) is a Lit `ReactiveController`. It aborts
any prior in-flight connection on `hostConnected()` — VS Code mounts and unmounts sidebar views
repeatedly — then starts a session: announce, await the host's expose, and report the generation
via the `webview` group's `connect()`. Reconnect is a full teardown and fresh session on the same
long-lived connection, never an incremental resubscribe.

Timeline is the clearest reference implementation
(`apps/plus/timeline/timeline.ts`):

1. **Construct** — `getHost()` (`:56`), then `createTimelineState(host.storage)` (`:61`). The
   checkpoint loads synchronously here, so persisted state is available before RPC exists.
   `RpcController` is created at `:70`.
2. **Connect** — on ready, resolve sub-services, create resources, then `startAutoPersist()`
   (`:147`) _before_ any host-driven state change, then `setupSubscriptions()` (`:157`) so no
   events are missed during the first fetch.
3. **Fetch** — `populateInitialState()` (`:178`) triggers the first load. Persisted navigation is
   a hint; host data is authoritative. A stale persisted ref surfaces as a resource error the UI
   handles.
4. **Teardown** — `disconnectedCallback` (`:88`) reverses it: unsubscribe → stop auto-persist →
   dispose resources (`:95`) → dispose actions (`:100`) → `resetAll()` (`:103`) → `dispose()`
   (`:104`).

There is no "hydration complete" gate. Render reads signals directly and repaints as each
resolves.

## Visibility

VS Code silently drops `postMessage` to a hidden `retainContextWhenHidden: true` webview.
`EventVisibilityBuffer` (`rpc/eventVisibilityBuffer.ts:96`) holds a replay closure per event key
while hidden (latest wins) and flushes on becoming visible; `bufferEventHandler()`
(`:142`) wraps handlers, and every RPC service event goes through it. `SubscriptionTracker`
(`:28`) tracks unsubscribes and carries an epoch counter so a reconnect racing an in-flight
subscription is detected.

Surfaces additionally cancel in-flight resource requests on hide and refetch on restore
(`apps/plus/timeline/timeline.ts:175`).

Current `retainContextWhenHidden` values:

| `true`                                        | `false`                                  |
| --------------------------------------------- | ---------------------------------------- |
| Commit Details, Home, Graph, Timeline, Rebase | Settings, Patch Details, Allowed Signers |

Settings is the proof that persistence covers restore: it runs with `retainContextWhenHidden:
false`, so a tab-away rebuilds the webview and `createSettingsState` restores the layout
(`apps/settings/state.ts:29`). Prefer `false` for new surfaces — treat context retention as an
optimization, not a correctness dependency.

## Choosing a primitive

| Question                                         | Answer                                    |
| ------------------------------------------------ | ----------------------------------------- |
| Host owns it, small and cross-cutting?           | `createRemoteSignalBridge()`              |
| Host owns it, surface needs to know it changed?  | event subscription → `resource.refetch()` |
| Host owns it, fetched on demand?                 | `createResource()`                        |
| Surface owns it, must survive hide/show/refresh? | `persisted()`                             |
| Computed from other state?                       | `computed()`                              |
| Anything else                                    | `signal()`                                |

## Anti-patterns

| Avoid                                         | Why                                               | Instead                              |
| --------------------------------------------- | ------------------------------------------------- | ------------------------------------ |
| Monolithic `getState()` bootstrap             | couples host to layout, blocks progressive render | resource-shaped queries              |
| Screen-shaped RPC (`getCommitDetailsState()`) | hard to compose or reuse                          | `getCommit(id)`                      |
| Persisting domain data                        | stale reads, large checkpoints                    | persist UI intent, refetch data      |
| `signal<ReadableSignal<T>>`                   | double `.get()`, easy to misread                  | `createRemoteSignalBridge()`         |
| Manual loading/error/cancel per fetch         | repetitive, inconsistent                          | `createResource()`                   |
| Transport calls from UI components            | breaks portability and testing                    | an actions layer                     |
| Relying on `retainContextWhenHidden`          | breaks on refresh and off-VS Code                 | persistence + resources              |
| Manual `persistState()`                       | scattered, easy to miss                           | `persisted()` + `startAutoPersist()` |

## Available but unused

Two mechanisms exist and are tested but have no production callers. Know they exist before
building a replacement:

- **`restoreKey`** (`signals.ts:88`) — discards a checkpoint outright when the key doesn't match,
  for breaking continuity across logical sessions (a different repo or entity). Tested at
  `apps/shared/state/__tests__/stateGroup.test.ts:118`. Every current `createStateGroup` call
  passes only `storage` and `version: 1`.
- **`CancellableRequest`** (`apps/shared/cancellableRequest.ts:26`) — superseded by
  `createResource()`, which owns cancellation and staleness. See the note at
  `apps/commitDetails/actions.ts:10`.
