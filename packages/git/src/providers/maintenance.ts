/**
 * Git maintenance / optimization sub-provider — the data plane behind the Git Health feature.
 *
 * Two tiers of levers (see `.work/dev/git-health/spec.md`):
 * - **Auto tier** — inert, repo-local maintenance applied silently: the demand-cadence commit-graph
 *   write and `git maintenance run` one-shots. No config levers — the auto tier never rewrites config.
 * - **Ask tier** — config levers surfaced for one-click apply/undo (`core.untrackedCache`,
 *   `core.fsmonitor`, `git maintenance start`, `feature.manyFiles`).
 *
 * The commit-graph is a task OF this service, not a thing beside it: `MaintenanceGitSubProvider` owns its
 * implementation (a direct `git commit-graph write --reachable --split` — usable at 2.24, unlike the 2.30
 * `maintenance run --task=commit-graph`), its policy, and its demand cadence (minutes throttle + single-flight
 * keyed by common git dir). `GraphGitSubProvider` and the repo-open shape probe merely `request(...)` it.
 *
 * Every method is repo-path-first (so the `RepositoryService` proxy can auto-inject `repoPath`) and
 * `AbortSignal`-able. The provider is optional — it exists only on the desktop CLI provider, so web
 * builds and virtual repos never register it (availability is a per-repo capability, `repo.git.maintenance`).
 */

/**
 * Auto-tier maintenance tasks. `commit-graph` runs a DIRECT `git commit-graph write --reachable --split`
 * (2.24+); `loose-objects`/`incremental-repack` run `git maintenance run --task=…` (2.30+).
 */
export type GitMaintenanceTask = 'commit-graph' | 'loose-objects' | 'incremental-repack';

/** The uniform apply/revert surface for every optimization lever (auto + ask). */
export type GitOptimizationId = 'untrackedCache' | 'fsmonitor' | 'backgroundMaintenance' | 'manyFiles';

/**
 * Cheap per-session shape probe — filesystem stats + config reads only, no expensive git walks. Shared
 * across worktrees (keyed by common path). Everything here is derivable without inflating objects.
 */
export interface GitHealthSnapshot {
	/** Presence + mtime of `objects/info/commit-graph` (or the split `commit-graphs/` chain), and changed-path Bloom filter coverage. */
	readonly commitGraph: {
		readonly present: boolean;
		readonly mtime: number | undefined;
		/** Whether the NEWEST graph layer carries changed-path Bloom filters (`BIDX` chunk). */
		readonly changedPaths: boolean;
		/** Whether this git can write them (the 2.31 gate) — lets the view promise "filters build over time" honestly. */
		readonly changedPathsSupported: boolean;
		/** `true` once the user disabled GitLens's automatic commit-graph maintenance for this repo (`gk.commitGraphDisabled`). */
		readonly disabled: boolean;
		/**
		 * `true` when `core.commitGraph` is EXPLICITLY false in the user's git config — git won't read the
		 * cache, and `ensureCommitGraph` honors the same setting as a write opt-out, so the view must not
		 * claim the graph is (or will be) maintained.
		 */
		readonly readDisabled: boolean;
	};
	/** Presence of `objects/pack/multi-pack-index`. */
	readonly multiPackIndex: boolean;
	/** Count of `*.pack` files in `objects/pack`. */
	readonly packCount: number;
	/** Total bytes of all `*.pack` files. */
	readonly packBytes: number;
	/** Raw loose-object sample (a handful of the 256 fanout dirs); the host extrapolates the estimate. */
	readonly looseObjects: { readonly objectsInSampledDirs: number; readonly dirsSampled: number };
	/** Size of the worktree's `.git/index` in bytes (a tracked-file-count proxy). */
	readonly indexBytes: number;
	/** Exact entry count from the index header (`DIRC`, version, count — all big-endian). `undefined` when the index is missing or the header is unreadable/not `DIRC`. */
	readonly indexEntryCount: number | undefined;
	/** Current state of the config levers this feature toggles. */
	readonly config: {
		readonly fsmonitor: boolean;
		readonly untrackedCache: boolean;
		/**
		 * Whether `core.untrackedCache` carries an explicit value in ANY scope (local/global/system).
		 * {@link untrackedCache} alone can't tell "unset" from a deliberate `false`/`keep`, and this is the
		 * one lever the auto tier applies silently — so it only ever fills in an unset value.
		 */
		readonly untrackedCacheConfigured: boolean;
		readonly manyFiles: boolean;
	};
	/**
	 * Whether this repo is registered for system-scheduled `git maintenance` (global `maintenance.repo`).
	 * `undefined` when the registration list could not be read — never treat that as "not registered": a
	 * repo the user registered themselves would read as unregistered, get suggested again, and a later
	 * Undo would silently remove their registration.
	 */
	readonly maintenanceRegistered: boolean | undefined;
	/** `true` once FSMonitor failed to enable here (from the `gk.fsmonitorNotApplicable` marker) — never re-suggest. */
	readonly fsmonitorNotApplicable: boolean;
	/** `true` once the untracked cache failed git's filesystem probe here (`gk.untrackedCacheNotApplicable`) — never re-suggest. */
	readonly untrackedCacheNotApplicable: boolean;
	/**
	 * Which levers GitLens itself applied (from the `gk.applied.*` ownership markers). Lets the view render a
	 * lever the user turned on themselves as "already enabled" (no Undo) versus one GitLens applied (Apply/Undo).
	 * Distinct from {@link config}, which reports the effective state regardless of who set it.
	 */
	readonly applied: {
		readonly untrackedCache: boolean;
		readonly fsmonitor: boolean;
		readonly manyFiles: boolean;
		readonly backgroundMaintenance: boolean;
	};
	/** Whether the installed git supports `git maintenance run` (2.30+) — gates the auto-tier tasks. */
	readonly supportsMaintenanceRun: boolean;
}

/** On-demand detail computed only when the Git Health view opens (cheap-ish git walks). */
export interface GitHealthDetails {
	/** `git rev-list --count --all` — total reachable commits. `undefined` if the walk failed. */
	readonly commitCount: number | undefined;
	/**
	 * Parsed `git count-objects -v` breakdown. `undefined` if it failed. The `size`, `sizePack`, and
	 * `sizeGarbage` fields are normalized to BYTES — git itself reports them in KiB.
	 */
	readonly countObjects:
		| {
				readonly count: number;
				readonly size: number;
				readonly inPack: number;
				readonly packs: number;
				readonly sizePack: number;
				readonly prunePackable: number;
				readonly garbage: number;
				readonly sizeGarbage: number;
		  }
		| undefined;
}

/** Whether a given optimization lever is available for a repo, with a user-facing reason when it isn't. */
export interface GitOptimizationCapability {
	readonly id: GitOptimizationId;
	readonly supported: boolean;
	/** Present only when `supported` is `false` — why (git version, platform, virtual FS). */
	readonly reason?: string;
	/** Optional caveat to surface even when supported (e.g. `manyFiles` enabling an index older tools can't read). */
	readonly note?: string;
}

export interface GitMaintenanceSubProvider {
	/** Cheap filesystem + config probe of the repo's object store and lever states. */
	getHealthSnapshot(repoPath: string, cancellation?: AbortSignal): Promise<GitHealthSnapshot>;
	/** On-demand commit count + `count-objects` breakdown (only when the view opens). */
	getHealthDetails(repoPath: string, cancellation?: AbortSignal): Promise<GitHealthDetails>;
	/** Availability of each optimization lever (git version + platform gated). */
	getCapabilities(repoPath: string): Promise<GitOptimizationCapability[]>;
	/**
	 * Fire-and-forget hint that a task's cache is worth refreshing now, applying that task's cadence policy.
	 * `commit-graph` runs the demand cadence (minutes throttle + single-flight, both keyed by common git dir),
	 * fully gated on the auto-tier switches; `loose-objects`/`incremental-repack` are no-ops here (the daily
	 * pass owns them). Never throws, never blocks — the service decides whether anything actually runs.
	 */
	request(repoPath: string, task: GitMaintenanceTask): void;
	/**
	 * Atomically claims the once-per-`intervalMs` maintenance pass for this repo, stamping the shared
	 * `gk.maintenanceLastRun` if and only if the claim succeeds. Returns `false` when another window already
	 * holds it. Read-then-write from the host would not be atomic across VS Code windows, so the claim lives
	 * here where it can be taken under a real file lock.
	 */
	claimMaintenancePass(repoPath: string, intervalMs: number): Promise<boolean>;
	/**
	 * Runs a single maintenance task now (the explicit "Run Maintenance Now" path). Resolves `true` when the
	 * task ran, `false` when the installed git can't run it (not-applicable). A genuine command failure
	 * THROWS the git error so the ask-tier UI can surface it. `commit-graph` writes directly (2.24+);
	 * `loose-objects`/`incremental-repack` go through `git maintenance run --task=…` (2.30+).
	 */
	runMaintenanceTask(repoPath: string, task: GitMaintenanceTask, cancellation?: AbortSignal): Promise<boolean>;
	/**
	 * Applies an optimization lever. Returns `true` when it took effect; `false` for a legitimate
	 * not-applicable outcome (e.g. the FSMonitor daemon wouldn't start, or the untracked cache failed git's
	 * filesystem probe — the config is restored and the repo recorded not-applicable so it's never
	 * re-suggested). A genuine command failure (config write refused, `maintenance start` errored) THROWS.
	 * Before mutating, the lever's prior value is recorded so {@link revertOptimization} can restore it.
	 */
	applyOptimization(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<boolean>;
	/**
	 * Reverts a lever GitLens applied back to its recorded prior value (never a hardcoded inverse). A no-op
	 * when GitLens didn't apply it (no ownership marker) — a user-enabled lever is never touched. A genuine
	 * command failure THROWS.
	 */
	revertOptimization(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<void>;
	/**
	 * Enables or disables GitLens's automatic commit-graph maintenance for this repo — a per-repository off
	 * switch, distinct from the global `gitlens.gitOptimizations.enabled` master switch. Writes the
	 * `gk.commitGraphDisabled` marker when disabling; clears it when re-enabling (tolerating an
	 * already-absent marker). User-clicked, so a genuine write failure THROWS.
	 */
	setCommitGraphDisabled(repoPath: string, disabled: boolean, cancellation?: AbortSignal): Promise<void>;
}
