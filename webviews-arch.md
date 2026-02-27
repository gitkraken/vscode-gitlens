# Webview Architecture

## Status

Accepted

## Context

GitLens webviews are moving from legacy IPC toward Supertalk RPC plus signals. Three surfaces (Commit Details, Timeline, Home) have been migrated. The RPC migration has improved the shape of the apps, but the foundation is uneven:

### Already Useful

- `setHostIpcFactory()` is a real portability seam
- `RpcController` centralizes connection lifecycle
- Instance-owned app state is the dominant pattern (no module singletons)
- `EventVisibilityBuffer` solves a real VS Code hidden-message problem
- `CancellableRequest` provides cooperative cancellation
- Fire-and-forget helpers (`fireRpc`, `optimisticFireAndForget`) are well-established
- `subscribeAll()` provides clean bulk event subscription with cleanup
- Signal groups with `resetAll()` work correctly

### Still Wrong or Incomplete

- Persistence is scattered across action modules via direct `getHostIpcApi().getState()/setState()` calls
- Endpoint creation is hard-coded in `wrapServices()` and `RpcController`, not adapter-owned
- External data fetching requires 3+ signals and 20+ lines of manual orchestration per fetch (CancellableRequest + loading signal + error signal + try/catch)
- Commit Details has 5 `CancellableRequest` slots, each with its own loading/error boilerplate
- Timeline uses a `_fetchVersion` counter for staleness detection
- Some ambient host state uses `signal<ReadableSignal<T>>` requiring double `.get()` reads
- `createSignalGroup()` only handles reset; persistence is ad hoc
- No `restoreKey` mechanism — version migration alone doesn't prevent cross-context state leaks
- Checkpoint semantics are not explicit enough

This architecture builds on the branch's existing patterns rather than replacing them.

---

## Goals

1. Build **portable surfaces**, not VS Code-specific apps with nicer transport
2. Keep **RPC as transport**, not as the architecture
3. Model external data as **resources**, not hand-wired fetch/loading/error boilerplate
4. Use **signals** for local session state, runtime state, and derivations
5. Restore UI continuity quickly without persisting canonical domain payloads
6. Make `retainContextWhenHidden` an optimization, not a correctness dependency
7. Support staged migration from the current branch without a big bang rewrite

## Non-Goals

1. Do not build a full general-purpose query framework on day one
2. Do not convert webviews into host-pushed Redux-style page stores
3. Do not require a second production host before the VS Code path is stable
4. Do not eliminate all host-pushed state — small ambient RemoteSignals are still useful
5. Do not build adapters for hosts that don't exist yet (YAGNI)

---

## Part 1: State Ownership Model

All state falls into one of six categories. The category determines where it lives, how it's managed, and whether it's persisted.

### 1. Resource State (host-owned canonical data)

External data whose source of truth is the host:

- Commits, diffs, file changes, branches, repositories
- Timeline datasets, launchpad summaries
- Account/subscription/integrations
- Capabilities, org settings (when surface-specific)

**Managed by**: `createResource()` — the webview fetches on demand, the host can invalidate.

**Persisted**: Never. Refetched on restore.

### 2. Navigation State (surface-owned, persisted)

Identifies what the surface is looking at:

- Current subject (commit SHA + repo path)
- Active tab/mode
- Route parameters
- Scope reference

**Managed by**: `persisted()` signals.

**Persisted**: Always. Defines the restore target.

### 3. UI State (surface-owned, persisted)

User's layout and interaction preferences within a session:

- Filters, sorts, groupings
- Expanded/collapsed sections
- Selected IDs, scroll anchors
- Local drafts
- Pinned state

**Managed by**: `persisted()` signals.

**Persisted**: Always. Restores the "feel" of the surface.

### 4. Ambient State (host-pushed, reactive)

Small, cross-cutting host-owned state that multiple surfaces consume:

- Theme
- Auth/account presence
- Subscription/entitlement
- Org settings
- Connectivity

**Managed by**: `RemoteSignalBridge` — default value before RPC connect, live remote value after.

**Persisted**: Never. Host pushes current value on connect.

### 5. Runtime State (ephemeral)

Transient operational state:

- Loading flags (owned by resources)
- Error messages (owned by resources)
- Optimistic overlays
- Pending mutations
- In-flight request handles

**Managed by**: Owned by `createResource()` (loading, error) or plain `signal()`.

**Persisted**: Never. Reconstructed on each session.

### 6. Derived State (computed)

Computed from other state categories:

- Visible rows, filtered lists
- Enablement flags
- Empty states
- Combined status indicators

**Managed by**: `computed()` signals.

**Persisted**: Never. Recomputed reactively.

### Persistence Rule

Persist **navigation** and **ui** state only. Never persist resource, ambient, runtime, or derived state.

---

## Part 2: Host Abstraction Layer

The webview app layer has one VS Code dependency: `acquireVsCodeApi()` in `ipc.ts`. We formalize the existing `setHostIpcFactory()` escape hatch into a proper host adapter.

The host context is deliberately minimal — only what actually varies between hosts today.

### 2.1 HostStorage

```typescript
// src/webviews/apps/shared/host/storage.ts

export interface HostStorage {
	get(): Record<string, unknown> | undefined;
	set(state: Record<string, unknown>): void;
}

// Implementations
export class VsCodeStorage implements HostStorage {
	private readonly _api = getHostIpcApi();
	get() {
		return this._api.getState() as Record<string, unknown> | undefined;
	}
	set(state: Record<string, unknown>) {
		this._api.setState(state);
	}
}

export class BrowserStorage implements HostStorage {
	constructor(private readonly key: string) {}
	get() {
		const raw = localStorage.getItem(this.key);
		return raw != null ? JSON.parse(raw) : undefined;
	}
	set(state: Record<string, unknown>) {
		localStorage.setItem(this.key, JSON.stringify(state));
	}
}

export class InMemoryStorage implements HostStorage {
	private _state: Record<string, unknown> | undefined;
	get() {
		return this._state;
	}
	set(state: Record<string, unknown>) {
		this._state = state;
	}
}

export const noopStorage: HostStorage = {
	get: () => undefined,
	set: () => {},
};
```

### 2.2 HostContext

```typescript
// src/webviews/apps/shared/host/context.ts

export interface HostContext {
	/** State storage backend */
	storage: HostStorage;
	/** RPC endpoint factory */
	createEndpoint(): DisposableEndpoint;
}

let _host: HostContext | undefined;

export function getHost(): HostContext {
	return (_host ??= createDefaultHost());
}

export function setHost(host: HostContext): void {
	_host = host;
}

function createDefaultHost(): HostContext {
	return {
		storage: new VsCodeStorage(),
		createEndpoint: () => createWebviewEndpoint(),
	};
}
```

Theme is excluded — VS Code injects `--vscode-*` CSS variables natively, and non-VS Code environments handle theming through their own CSS injection. Lifecycle (`visibilitychange`) is a standard DOM event. Neither needs a runtime port.

| Implementation        | `storage`                                  | `createEndpoint()`        | Use case                    |
| --------------------- | ------------------------------------------ | ------------------------- | --------------------------- |
| **VS Code** (default) | `acquireVsCodeApi().getState()/setState()` | `createWebviewEndpoint()` | Production                  |
| **Browser**           | `localStorage`                             | `MessagePort` adapter     | Standalone web app          |
| **Test**              | In-memory `Map`                            | Direct function calls     | Unit tests                  |
| **No-op**             | No-op get/set                              | —                         | Webviews that don't persist |

The existing `setHostIpcFactory()` becomes an internal implementation detail of the VS Code adapter.

### 2.3 Threading Through RpcController

`wrapServices()` accepts an optional `endpoint` factory via `RpcClientOptions` (defaults to `getHost().createEndpoint()`). `RpcController` forwards all options through its `rpcOptions` property, so the endpoint injection path already exists without a dedicated constructor parameter:

```typescript
new RpcController<MyServices>(this, {
	rpcOptions: { endpoint: () => customEndpoint() },
	onReady: services => this._onRpcReady(services),
});
```

---

## Part 3: Declarative State with createStateGroup

### 3.1 Extended State Group

`createSignalGroup()` is extended into `createStateGroup()`:

```typescript
// src/webviews/apps/shared/state/signals.ts

export function createStateGroup(options?: {
	storage?: HostStorage;
	version?: number;
	restoreKey?: string;
	migrate?: (raw: Record<string, unknown>, fromVersion: number | undefined) => Record<string, unknown> | undefined;
}): StateGroup;

interface StateGroup {
	/** Create an ephemeral signal (resets to initialValue on resetAll) */
	signal: <T>(initialValue: T) => Signal.State<T>;
	/** Create a persisted signal — auto-restored from backend, auto-saved */
	persisted: <T>(key: string, initialValue: T, options?: PersistedOptions<T>) => Signal.State<T>;
	/** Reset all ephemeral signals to defaults. Persisted signals re-read from backend. */
	resetAll: () => void;
	/** Start auto-persistence via Signal.subtle.Watcher. Returns dispose fn. */
	startAutoPersist: () => () => void;
	/** Dispose everything (cancel watcher, clear registrations). */
	dispose: () => void;
}

interface PersistedOptions<T> {
	/** Transform for storage (extract subset, convert types). Defaults to identity. */
	serialize?: (value: T) => unknown;
	/** Validate + transform from storage. Return undefined to use initialValue. */
	deserialize?: (raw: unknown) => T | undefined;
}
```

### 3.2 How Persistence Works

1. **On creation**: `persisted('mode', 'commit')` synchronously reads from `HostStorage.get()`. If the key exists, passes validation, and the `restoreKey` matches, the signal starts with the persisted value. Otherwise uses `initialValue`.

2. **On change**: After `startAutoPersist()`, a `Signal.subtle.Watcher` observes all persisted signals. On any change, a microtask batches all dirty signals into a single `HostStorage.set()` call.

3. **On reset**: `resetAll()` resets ephemeral signals to code defaults. Persisted signals re-read from the backend (user preferences survive reset).

4. **Versioning**: Stored as `{ __v: 1, __rk: 'repo:abc', mode: 'commit', pinned: false, ... }`. If version mismatch, `migrate()` is called. If no migration function or it returns undefined, persisted state is discarded (safe default).

5. **Restore key**: `restoreKey` controls continuity. If the host wants to break continuity (e.g., opened a different repo, deep link to a specific commit), it changes the key. If the persisted `__rk` doesn't match the current `restoreKey`, persisted state is discarded. This cleanly solves "I persisted state for repo A but now I'm viewing repo B" without complex reconciliation.

### 3.3 Checkpoint Shape

The persisted checkpoint is a flat record with metadata keys:

```typescript
type Checkpoint = {
	/** Schema version for migration */
	__v: number;
	/** Restore key for continuity control */
	__rk: string;
	/** Timestamp for staleness (informational only) */
	__ts: number;
	/** All persisted signal values keyed by their registration key */
	[key: string]: unknown;
};
```

Checkpoint contents should stay small and user-visible:

- active tab or mode
- route parameters
- selected id
- filters and sorts
- expanded sections
- pane layout
- scroll anchor
- draft text

Never checkpoint: domain payloads, large datasets, loading flags, transient errors, optimistic overlays, or derived state.

### 3.4 Restore Precedence

State is resolved in this order:

1. Code defaults (signal initial values)
2. Bootstrap / host defaults
3. Persisted checkpoint, only if `restoreKey` matches
4. Host `forced` overrides
5. Query and ambient host results as authoritative truth

This achieves two things: the surface keeps continuity where appropriate, and the host can still force correctness when needed.

### 3.5 Before / After

**Before** (Timeline `actions.ts` — manual persistence):

```typescript
persistState(): void {
	const state = getHostIpcApi().getState() ?? {};
	getHostIpcApi().setState({
		...state,
		period: this.state.period.get(),
		sliceBy: this.state.sliceBy.get(),
		showAllBranches: this.state.showAllBranches.get(),
		scope: this.state.scope.get(),
	});
}
```

**After** (persistence is automatic):

```typescript
// state.ts
const { signal, persisted, resetAll, startAutoPersist, dispose } = createStateGroup({
	storage: host.storage,
	version: 1,
	restoreKey,
});

const period = persisted('period', defaultPeriod);
const sliceBy = persisted('sliceBy', 'author');
const showAllBranches = persisted('showAllBranches', false);
const scope = persisted<TimelineScope | undefined>('scope', undefined);
// No manual persistState() needed — auto-persisted on change
```

---

## Part 4: Resource Primitive

### 4.1 The Problem

Every async data fetch currently requires 3+ signals and 20+ lines of manual orchestration. Commit Details has 5 `CancellableRequest` slots, each with loading signal + error signal + try/catch boilerplate. Timeline uses a `_fetchVersion` counter for staleness. These are all the same pattern: "fetch data, track loading, handle errors, cancel previous request."

### 4.2 The Resource API

```typescript
// src/webviews/apps/shared/state/resource.ts

export type ResourceStatus = 'idle' | 'loading' | 'success' | 'error';

export interface Resource<T, TArgs extends unknown[] = []> {
	/** Current value (initialValue while idle/loading, fetched value after success). */
	readonly value: ReadableSignal<T>;
	/** Whether a fetch is in flight. */
	readonly loading: ReadableSignal<boolean>;
	/** The latest error, if any. */
	readonly error: ReadableSignal<string | undefined>;
	/** Composite status: 'idle' | 'loading' | 'success' | 'error'. */
	readonly status: ReadableSignal<ResourceStatus>;

	/** Trigger a fetch with new args. Cancels any in-flight request. */
	fetch(...args: TArgs): Promise<void>;
	/** Re-run the last fetch with the same args. */
	refetch(): Promise<void>;
	/** Optimistically set value (overwritten by next fetch). */
	mutate(value: T): void;
	/** Cancel any in-flight request. */
	cancel(): void;
	/** Dispose (cancel + cleanup). */
	dispose(): void;
}

export function createResource<T, TArgs extends unknown[] = []>(
	fetcher: (signal: AbortSignal, ...args: TArgs) => Promise<T>,
	options?: {
		initialValue?: T;
		/** If true (default), cancel previous request when a new one starts. */
		cancelPrevious?: boolean;
	},
): Resource<T, TArgs>;
```

### 4.3 Implementation Notes

- Built on `AbortController` internally (same as current `CancellableRequest`)
- Each `fetch()` creates a new `AbortController`, aborts the previous if `cancelPrevious` is true
- `loading` signal set synchronously on fetch start, cleared on settle
- `error` signal cleared on fetch start, set on catch (non-abort errors only)
- `refetch()` replays last args — no-op if never fetched
- `mutate()` sets value without fetching (for optimistic updates)
- `dispose()` aborts in-flight + nulls out signals
- Works with any async function — not coupled to Supertalk or RPC

### 4.4 Before / After

**Before** (Commit Details — one of 5 CancellableRequest flows):

```typescript
private readonly _commitRequest = new CancellableRequest();

async fetchCommit(repoPath: string, sha: string) {
	this.state.loading.set(true);
	this.state.error.set(undefined);
	try {
		const result = await this._commitRequest.run(signal =>
			this.services.git.getCommit(repoPath, sha, signal),
		);
		if (result == null) return; // cancelled
		this.state.commit.set(result.value);
		this.state.loading.set(false);
		// fire enrichment...
	} catch (ex) {
		this.state.error.set(ex.message);
		this.state.loading.set(false);
	}
}
```

**After**:

```typescript
// state.ts
const commit = createResource<CommitDetails | undefined, [string, string]>(
	(signal, repoPath, sha) => services.git.getCommit(repoPath, sha, signal),
	{ initialValue: undefined },
);

// actions.ts — no CancellableRequest, no manual loading/error
async showCommit(repoPath: string, sha: string) {
	await state.commit.fetch(repoPath, sha);
	// Fire enrichment in parallel (resources independently track loading/error)
	state.autolinks.fetch(repoPath, sha);
	state.enriched.fetch(repoPath, sha);
}

// UI template — single source of loading/error/value
${when(state.commit.loading.get(), () => html`<loading-spinner></loading-spinner>`)}
${when(state.commit.error.get(), err => html`<error-banner .message=${err}></error-banner>`)}
${when(state.commit.value.get(), commit => html`<commit-details .commit=${commit}></commit-details>`)}
```

### 4.5 Resource vs AsyncComputed

signal-utils provides `AsyncComputed` which auto-reruns when signal dependencies change. This is useful for derived async state (e.g., "when selected SHA changes, refetch reachability"). Most GitLens fetches are imperative (user clicks, event arrives), not dependency-driven.

**Recommendation**: Build `createResource()` as a standalone primitive. Consider `AsyncComputed` later for truly reactive derived resources. The two are complementary, not competing.

---

## Part 5: RemoteSignalBridge

### 5.1 The Problem

Host-pushed reactive state currently requires a signal-of-signal pattern:

```typescript
const orgSettings = signal<ReadableSignal<{ ai: boolean; drafts: boolean }>>({
	get: () => ({ ai: false, drafts: false }),
});
// Usage: orgSettings.get().get() — double .get()
```

### 5.2 The Solution

```typescript
// src/webviews/apps/shared/state/remoteSignal.ts

export function createRemoteSignalBridge<T>(defaultValue: T): RemoteSignalBridge<T>;

interface RemoteSignalBridge<T> {
	/** Read value — default before connect, remote after. Single .get(). */
	get(): T;
	/** Connect to RemoteSignal from RPC. Call once in onRpcReady. */
	connect(remote: ReadableSignal<T>): void;
	/** Disconnect (cleanup). */
	disconnect(): void;
}
```

Implementation: `Signal.Computed` that reads from a local `Signal.State` (pre-connect) or the connected `RemoteSignal` (post-connect). Switching is transparent to consumers.

**Before:** `state.orgSettings.get().get()` (double unwrap)
**After:** `state.orgSettings.get()` (single read)

### 5.3 When to Use RemoteSignalBridge

The bridge is useful when the surface needs a **readable default before RPC connects** — for example, rendering skeleton UI that depends on ambient state (org settings, subscription tier) before the handshake completes.

When a surface already shows loading state until RPC connects and then injects resolved remote signals directly into Lit context, the bridge adds no value. Home uses this direct injection pattern:

```typescript
// Wait for RPC, resolve remote signal properties, inject directly
const [subscriptionSignal, orgSettingsSignal] = await Promise.all([
	subscription.subscriptionState,
	subscription.orgSettingsState,
]);
subscriptionCtx.setValue({ subscription: subscriptionSignal, orgSettings: orgSettingsSignal });
```

**Use the bridge** when consumers read ambient state during pre-connect rendering.
**Use direct injection** when the surface is behind a loading gate until RPC connects.

---

## Part 6: Progressive Hydration & Lifecycle

### 6.1 Signal Tiers

Every webview's data maps to three tiers that determine startup ordering:

| Signal Tier    | Phase     | Blocks paint? | Examples                                                |
| -------------- | --------- | ------------- | ------------------------------------------------------- |
| **Identity**   | Phase 0-1 | Restore only  | Mode, pinned, scope, subject reference                  |
| **Core**       | Phase 2   | Yes           | Commit details, WIP changes, timeline dataset           |
| **Enrichment** | Phase 3   | No            | Autolinks, PR associations, signatures, AI explanations |

### 6.2 Lifecycle Phases

Every webview follows this protocol:

```
Phase 0: CONSTRUCT (synchronous, before RPC)
  |-- getHost() -> resolve HostContext
  |-- createXState(host.storage, restoreKey) -> signals with persisted restore
  +-- First render from persisted navigation + ui state (instant, no jitter)
      restoreKey checked -- if mismatch, persisted state discarded

Phase 1: CONNECT (async, onRpcReady)
  |-- Resolve sub-services: await Promise.all([services.git, services.config, ...])
  |-- Connect RemoteSignalBridges (orgSettings, hasAccount, etc.)
  |-- Set up event subscriptions via subscribeAll()
  +-- startAutoPersist()

Phase 2: CORE FETCH (blocks first meaningful paint)
  |-- Fetch layout-critical resources (commit, dataset, overview)
  |-- Persisted navigation is a "hint" -- host data is authoritative
  +-- Stale persisted ref? Resource returns error/empty -> UI handles gracefully

Phase 3: ENRICHMENT (fire-and-forget, progressive)
  |-- resource.fetch() for non-critical data (autolinks, enriched, reachability)
  |-- Each resource independently tracks its own loading/error
  +-- UI renders progressively as resources resolve
```

### 6.3 Visibility Model

The `EventVisibilityBuffer` already coalesces host events while webviews are hidden. Extended with resource awareness:

**On hidden** (`visibilitychange` to `'hidden'`):

- Cancel in-flight resource requests (VS Code silently drops responses while hidden)
- Flush persistence (auto-persist watcher handles this)
- Leave event subscriptions active (`EventVisibilityBuffer` coalesces)

**On visible** (`visibilitychange` to `'visible'`):

- Refetch stale visible resources
- Replayed buffered events trigger resource refetches automatically

**On destroy** (webview disposed, `disconnectedCallback`):

- Dispose all resources (cancel + cleanup)
- Unsubscribe all event subscriptions
- Disconnect remote signal bridges
- Stop auto-persistence
- Reset state

**On reconnect** (destroyed + recreated): Full lifecycle from Phase 0. Persistence restores navigation + ui state. Resources refetch from scratch.

### 6.4 In the Lit Component

```typescript
@customElement('gl-timeline-app')
export class GlTimelineApp extends SignalWatcherWebviewApp {
	private _host = getHost();
	private _state = createTimelineState(this._host.storage);
	private _rpc = new RpcController<TimelineServices>(this, {
		endpoint: this._host.createEndpoint,
		onReady: s => this._onRpcReady(s),
		onError: error => this._state.error.set(error.message),
	});
	private _actions?: TimelineActions;
	private _cleanup?: () => void;

	async _onRpcReady(services: Remote<TimelineServices>): Promise<void> {
		// Phase 1: CONNECT
		const resolved = await resolveServices(services);
		this._actions = new TimelineActions(this._state, resolved);

		const unsub = await setupSubscriptions(services, resolved, this._actions);
		const unpersist = this._state.startAutoPersist();
		this._cleanup = () => {
			unsub();
			unpersist();
		};

		// Phase 2: CORE FETCH
		await this._actions.populateInitialState();

		// Phase 3: ENRICHMENT (if any — Timeline has none)
	}

	disconnectedCallback() {
		this._cleanup?.();
		this._state.dispose();
		super.disconnectedCallback();
	}
}
```

---

## Part 7: Host-Side Provider Model

Host-side state providers are **scoped to a single webview panel instance**, not global singletons. This is a hard constraint that the webview-side architecture is designed to complement.

When a webview opens, the `WebviewController` creates a dedicated provider instance. The provider holds only state relevant to that specific panel. When the panel closes, the provider is disposed and garbage-collected.

The provider implements `getRpcServices()` to expose methods to the webview via `RpcHost`. This ensures:

- No cross-panel state leaks
- Clean garbage collection when panels close
- Independent event bus listeners per panel
- Resources fetch from scoped provider methods
- Remote signals bridge scoped provider state
- Events are subscribed per-panel

New webviews must follow this pattern.

---

## Part 8: Transport Model

RPC is transport, not architecture. The webview never calls raw `postMessage()`. All host communication flows through typed Supertalk services organized into four shapes:

### Queries (Resources)

Pure reads. Idempotent, abortable. Resource-shaped, not screen-shaped.

```typescript
// Prefer:
services.git.getCommit(repoPath, sha, signal);
services.git.getWipChanges(repoPath, signal);
services.getDataset(scope, config);

// Avoid:
services.getCommitDetailsState(); // screen-shaped — couples host to layout
```

### Commands (Actions)

Semantic writes or side effects.

```typescript
services.navigation.setPin(true);
services.navigation.switchMode('wip', repoPath);
services.config.set('views.commitDetails.files', layout);
```

### Events (Subscriptions -> Refetch)

Host notifies, surface decides what to refetch.

```typescript
services.git.onCommitSelected(event => state.commit.fetch(event.repoPath, event.sha));
services.git.onRepositoryChanged(() => state.commit.refetch());
```

### Ambient Signals (Host-pushed reactive state)

Small, shared, low-churn. Not the model for large surface datasets.

```typescript
subscription.orgSettingsState; // RemoteSignal<{ ai: boolean; drafts: boolean }>
subscription.hasAccountState; // RemoteSignal<boolean>
```

---

## Part 9: State Classification Decision Tree

```
Is the source of truth on the host?
|-- YES -> Small, cross-cutting, changes infrequently?
|   |-- YES -> RemoteSignalBridge (host pushes via Supertalk SignalHandler)
|   |         Examples: orgSettings, hasAccount, subscriptionState
|   +-- NO -> Does the webview need a "something changed" notification?
|       |-- YES -> Event subscription -> resource.refetch()
|       |         Examples: onRepositoryChanged -> commit.refetch()
|       +-- NO -> Resource (webview fetches on demand)
|                Examples: commit, wip, dataset, launchpadSummary
+-- NO (surface-owned) -> Should it survive hide/show/refresh?
    |-- YES -> Identifies what we're looking at?
    |   |-- YES -> persisted() signal (navigation state)
    |   |         Examples: mode, currentSubject, activeTab, scope
    |   +-- NO -> persisted() signal (ui state)
    |             Examples: pinned, filters, overviewFilter, sliceBy, expandedSections
    +-- NO -> Is it computed from other state?
        |-- YES -> computed() signal (derived state)
        |         Examples: visibleRows, canNavigateBack, enablement
        +-- NO -> signal() (ephemeral runtime state)
                  Examples: loading, error, optimistic overlays
```

### Quick Reference

| Pattern              | Category   | Persist? | Example                                    |
| -------------------- | ---------- | -------- | ------------------------------------------ |
| `signal()`           | runtime    | no       | loading, error, expandedSections           |
| `persisted()`        | navigation | yes      | mode, currentSubject, activeTab            |
| `persisted()`        | ui         | yes      | pinned, filters, overviewFilter, sliceBy   |
| `computed()`         | derived    | no       | visibleRows, canNavigateBack               |
| `createResource()`   | resource   | no       | commit, wip, dataset, launchpadSummary     |
| `RemoteSignalBridge` | ambient    | no       | orgSettings, hasAccount, subscriptionState |
| Event -> refetch     | resource   | no       | onRepositoryChanged -> commit.refetch()    |

---

## Part 10: Multi-Instance Model

Each surface instance is uniquely identified by:

- **appId**: which webview type (commitDetails, timeline, home, graph)
- **instanceId**: specific panel/tab instance (for multi-panel scenarios)
- **subject**: what it's looking at (commit SHA, repo path, timeline scope)
- **restoreKey**: continuity token (changed by host to break continuity)

Rules:

- Session state (navigation + ui) is **per-instance** — each panel has its own filters, tab, selection
- Resource caches can be **shared across instances** by key (same commit SHA = same data)
- Ambient state is **shared globally** — all instances see the same orgSettings, subscription
- Persistence keys are namespaced by instanceId to avoid checkpoint collisions

---

## Part 11: `retainContextWhenHidden` Evaluation

| Webview          | Current | Recommendation      | Reason                                                           |
| ---------------- | ------- | ------------------- | ---------------------------------------------------------------- |
| Commit Details   | `true`  | **Keep `true`**     | Live FS watching, complex multi-resource state                   |
| Home             | `true`  | **Keep `true`**     | Nested contexts, deferred launchpad, many domain contexts        |
| Timeline         | `true`  | **Move to `false`** | Simple state, single dataset resource, persistence covers config |
| Graph            | `true`  | **Keep `true`**     | Virtualized rows, scroll position, selection                     |
| Settings         | `false` | **Keep `false`**    | Simple forms                                                     |
| Rebase           | `true`  | **Keep `true`**     | Active editing state                                             |
| **New webviews** | —       | **Default `false`** | Persistence + Resources handle restore                           |

Timeline is the proof-of-concept. Once the persistence layer is proven: set `retainContextWhenHidden: false` -> on show: fresh HTML -> `createTimelineState(persistence)` restores config/scope -> RPC reconnects -> `dataset.fetch()` reloads data.

---

## Part 12: Anti-Patterns

| Anti-pattern                                         | Why                                                         | Instead                                          |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| Monolithic `getState()` bootstrap                    | Couples host to screen layout, blocks progressive rendering | Resource-centric queries + progressive hydration |
| Screen-shaped APIs (`getCommitDetailsState()`)       | Tight coupling, hard to compose or reuse                    | Resource-shaped APIs (`getCommit(id)`)           |
| Persisting domain data for restore                   | Stale data, large payloads, correctness bugs                | Persist only UI intent, refetch domain data      |
| `signal<ReadableSignal<T>>` double-unwrap            | Confusing API, easy to forget inner `.get()`                | `RemoteSignalBridge` with single `.get()`        |
| Manual loading/error/cancel per fetch                | Repetitive boilerplate, inconsistent error handling         | `createResource()`                               |
| Transport calls from UI components                   | Breaks portability, hard to test                            | Actions layer between UI and RPC                 |
| Relying on `retainContextWhenHidden` for correctness | Breaks on refresh, breaks in non-VS Code hosts              | Persistence + Resources handle restore           |
| Building adapters for hosts that don't exist yet     | YAGNI, speculative complexity                               | VS Code adapter + test adapter only              |
| Manual `persistState()` calls                        | Scattered, easy to miss, inconsistent                       | `persisted()` signals with `startAutoPersist()`  |

---

## Implementation Sequence

### Phase 1: Foundation (Host + Storage + Resource + Bridge)

All primitives in a single phase to enable end-to-end validation on the first migrated surface.

**New files:**

| File                                             | Purpose                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/webviews/apps/shared/host/storage.ts`       | `HostStorage` interface + VS Code, localStorage, in-memory, no-op implementations |
| `src/webviews/apps/shared/host/context.ts`       | `HostContext` interface + `getHost()`/`setHost()`                                 |
| `src/webviews/apps/shared/state/resource.ts`     | `createResource()` — async data lifecycle primitive                               |
| `src/webviews/apps/shared/state/remoteSignal.ts` | `createRemoteSignalBridge()` — host-pushed state without double `.get()`          |

**Modified files:**

| File                                        | Change                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/webviews/apps/shared/state/signals.ts` | Extend `createSignalGroup()` -> add `persisted()`, `startAutoPersist()`, `restoreKey`, versioning |
| `src/webviews/apps/shared/rpcClient.ts`     | Accept optional endpoint factory (remove hard-coded `createWebviewEndpoint()`)                    |

**Tests:** Version migration, batch persistence, `restoreKey` continuity, resource fetch/cancel/refetch/mutate/error/dispose, abort propagation, remote signal bridge lifecycle.

### Phase 2: Migrate Timeline (simplest, proves all patterns)

Timeline is the ideal proving ground — it's already instance-owned, query-driven, and has the simplest state.

**Modified files:**

| File                                          | Change                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/webviews/apps/plus/timeline/state.ts`    | Use `createStateGroup()` with `persisted()` for config + scope; `createResource()` for dataset |
| `src/webviews/apps/plus/timeline/actions.ts`  | Remove manual `persistState()`, fetch version gating, loading/error boilerplate                |
| `src/webviews/apps/plus/timeline/timeline.ts` | Thread `HostContext`                                                                           |

**Verify:** Config persists across refresh, dataset loads correctly, scope change events trigger refetch, visibility change cancels + re-fetches.

### Phase 3: Migrate Commit Details (most complex)

**Modified files:**

| File                                               | Change                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/webviews/apps/commitDetails/state.ts`         | `persisted()` for mode/pinned/subject; `createResource()` for commit, wip, reachability, autolinks, enriched |
| `src/webviews/apps/commitDetails/actions.ts`       | Remove 5 `CancellableRequest` slots, manual loading/error, `persistState()`                                  |
| `src/webviews/apps/commitDetails/commitDetails.ts` | Thread `HostContext`, add `RemoteSignalBridge` for orgSettings + hasAccount                                  |

**Verify:** Mode/pinned persist, commit loads with cancel-previous, enrichment fires in parallel, WIP watching works, cancel-on-hide works, no double `.get()`.

### Phase 4: Migrate Home

**Modified files:**

| File                                     | Change                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `src/webviews/apps/plus/home/state.ts`   | `persisted()` for overviewFilter; `createResource()` for overview data |
| `src/webviews/apps/plus/home/home.ts`    | Thread `HostContext`                                                   |
| `src/webviews/apps/plus/home/actions.ts` | Simplify tiered loading with resource pattern                          |

**Verify:** Overview filter persists, progressive populate works, direct RemoteSignal contexts work.

### Phase 5: Polish + Portability Proof

1. Move Timeline to `retainContextWhenHidden: false` (proves persistence + resources handle full restore)
2. Create a minimal test harness: in-memory host + direct function calls — proves the abstraction works without VS Code APIs
3. Document state classification guide and lifecycle protocol as code comments in shared modules

---

## Verification Criteria

1. **Build**: `pnpm run build` passes at each phase
2. **Tests**: `pnpm run test` passes; new unit tests for `createStateGroup`, `createResource`, `createRemoteSignalBridge`
3. **Manual per-webview:**
   - Persisted settings survive hide/show and refresh
   - Resources show correct loading -> value -> error states
   - RemoteSignalBridges update reactively when host signals change
   - Rapid navigation cancels previous requests (no stale data flash)
   - Visibility hide cancels in-flight requests; show re-fetches
4. **Portability proof:** A test harness runs a webview state module with in-memory host + direct function calls — no VS Code APIs touched
5. **Timeline `retainContextWhenHidden: false`:** Config and scope restore correctly after hide/show cycle
6. **No regressions:** All existing webview behavior works identically from the user's perspective
