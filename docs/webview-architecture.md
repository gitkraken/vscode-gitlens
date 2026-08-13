# Webview Architecture

How webview apps hold state and talk to the extension host. GitLens runs **two communication
layers side by side** — a legacy IPC message protocol and a Supertalk RPC + signals stack — and
which one a surface uses is a property of that surface, not of the infrastructure. For the
webview IPC protocol itself see `docs/architecture.md`; for styling see `docs/webview-styling.md`;
for the Commit Graph's rows channel see `docs/graph-update-pipeline.md`.

## The two layers

`WebviewController` instantiates **both** channels for every surface regardless of which one that
surface uses: an `RpcHost` (`src/webviews/webviewController.ts:225`) and the legacy
`notify()` / pending-notification queue (`src/webviews/webviewController.ts:976` onward). A
surface's layer is determined by what its provider and app code call.

| Surface         | Layer                       | Evidence                                                                                                       |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Settings        | RPC only                    | `apps/settings/settings.ts:66`; `settings/protocol.ts` is 7 lines, 0 IPC types                                 |
| Commit Details  | RPC only                    | `apps/commitDetails/commitDetails.ts:59`; `commitDetails/protocol.ts` has 0 IPC types                          |
| Home            | RPC, plus one legacy bridge | `apps/home/home.ts:103`; host still fires `DidChangeSubscription` for `PromosContext`                          |
| Timeline        | RPC, plus one legacy bridge | `apps/plus/timeline/timeline.ts:70`; bridge documented at `plus/timeline/timelineWebview.ts:116`               |
| Commit Graph    | **Hybrid**                  | RPC for auxiliary services; legacy IPC carries the primary data plane (92 IPC types, `plus/graph/protocol.ts`) |
| Patch Details   | Legacy IPC                  | no `RpcController`; 30 IPC types                                                                               |
| Rebase          | Legacy IPC                  | no `RpcController`; 29 IPC types                                                                               |
| Welcome         | Legacy IPC                  | no `RpcController`; 6 IPC types                                                                                |
| Allowed Signers | Legacy IPC                  | no `RpcController`; 5 IPC types                                                                                |

`src/webviews/protocol.ts` is **not** legacy-only — it defines the core-scope handshake every
surface uses (`WebviewReadyRequest`, focus/visibility/configuration notifications,
`ApplicablePromoRequest`) at `src/webviews/protocol.ts:23-104`, consumed by RPC and legacy
surfaces alike.

### The Graph is hybrid, and the split matters

The Graph has an `RpcController` (`apps/plus/graph/graph.ts:66`), but RPC covers only auxiliary
services — `graphInspect`, `launchpad`, `walkthrough`, `sidebar`, `welcome`, `graphTimeline`,
`graphTreemap` (`plus/graph/graphService.ts:728`) — plus the shared services. Rows, selection,
search, columns, refs, and WIP all travel over legacy IPC. The ledger-diffed splice channel in
`docs/graph-update-pipeline.md` is an `IpcNotification`: published at
`plus/graph/graphWebview.ts:882`, declared at `plus/graph/protocol.ts:1870`, consumed through
`onMessageReceived` at `apps/plus/graph/stateProvider.ts:1679`. Do not assume Graph work happens
over RPC.

### Cross-transport ordering has no guarantee

A surface that mixes both layers cannot assume send order survives to the host. Legacy IPC posts
synchronously (`webview.postMessage` inline in the same tick); Supertalk defers sends to a
microtask flush. Two messages fired back-to-back from the same click handler — one on each
transport — race, and the one on Supertalk can simply never arrive if something tears down or
navigates the webview before its microtask runs.

This isn't hypothetical: it happened. The Graph's welcome-continue button used to fire a legacy
IPC command (open the welcome view) and, from a parent handler, a Supertalk RPC call (persist
onboarding dismissals, then `vscode.moveViews` the Graph into the side bar or panel). The move
tears down and re-creates the webview; the RPC's microtask-deferred send lost the race against
that teardown often enough to silently drop the dismissal, so the welcome prompt re-appeared on
next open. The fix (`plus/graph/graphService.ts` `GraphWelcomeService.continueToGraph`,
`plus/graph/graphWebview.ts` `onWelcomeContinueToGraph`) folded both effects into one RPC method,
so the persist-then-move sequencing lives inside a single causally-ordered handler instead of
depending on two transports racing correctly.

**Rule**: for any interaction where one message's handler tears down, moves, or navigates the
webview, that message must be sent _last_, and any durable side effect (persistence, telemetry)
must ride inside that same message's handler — not a separate message on the other transport,
regardless of send order. If a durable effect genuinely must precede the teardown-triggering
message on a different transport, it must be ack-sequenced (await the write's response before
sending the second message), not fire-and-forget.

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

`setHostIpcFactory()` (`apps/shared/ipc.ts:41`) is the lower-level seam — call it before any
RPC/IPC initialization to supply a non-VS Code `postMessage`/`getState`/`setState`.

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
in `src/webviews/rpc/services/` — repositories, repository, config, storage, subscription,
integrations, onboarding, agents, ai, autolinks, branches, commands, telemetry, files,
pullRequests, drafts.

Fire-and-forget helpers: `fireRpc()` (`apps/shared/actions/rpc.ts:203`) logs and surfaces the
error into an error signal; `optimisticFireAndForget()` (`actions/rpc.ts:86`) applies a value
immediately and rolls back on rejection, version-guarded so overlapping writes don't clobber.
`subscribeAll()` (`apps/shared/events/subscriptions.ts:31`) runs subscriptions via
`Promise.allSettled` and returns one combined unsubscribe.

## Lifecycle

`RpcController` (`apps/shared/rpc/rpcController.ts:69`) is a Lit `ReactiveController`. It aborts
any prior in-flight connection on `hostConnected()` — VS Code mounts and unmounts sidebar views
repeatedly — then calls `wrapServices()` (`apps/shared/rpcClient.ts:139`). Reconnect is a full
teardown and fresh `wrapServices()`, never an incremental resubscribe.

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
