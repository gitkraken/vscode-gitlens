import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { hostname } from 'node:os';
import * as process from 'node:process';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFeatures } from '@gitlens/git/features.js';
import { gitFeaturesByVersion } from '@gitlens/git/features.js';
import type { GkConfigKeys } from '@gitlens/git/providers/config.js';
import type {
	GitHealthDetails,
	GitHealthSnapshot,
	GitMaintenanceSubProvider,
	GitMaintenanceTask,
	GitOptimizationCapability,
	GitOptimizationId,
} from '@gitlens/git/providers/maintenance.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { arePathsEqual, joinPaths } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { escapeRegex } from '@gitlens/utils/string.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { fsExists } from '../exec/exec.js';
import type { Git } from '../exec/git.js';
import { canonicalizeGitConfigKey, isGitBooleanFalse, parseConfigRegexOutput, parseGitBoolean } from './config.js';

/** Deterministic sample of the 256 object fanout dirs (`00`,`10`,…,`f0`) used to extrapolate loose-object count. */
const looseObjectSampleDirs: readonly string[] = Array.from({ length: 16 }, (_, i) =>
	(i * 16).toString(16).padStart(2, '0'),
);

/** How long the global `maintenance.repo` registration list is served from cache (mirrors the config caches). */
const registeredMaintenanceReposTtlMs = 30 * 1000;

/** How long a repo's worktree list is served from cache — worktrees can be added/removed mid-session. */
const worktreePathsTtlMs = 30 * 1000;

/** Demand cadence for the commit-graph write: refreshed at most this often per object database. */
const commitGraphRefreshIntervalMs = 5 * 60 * 1000;

/** Sentinel recorded in a `gk.applied.*` marker when the lever's prior LOCAL value was absent (→ undo unsets it). */
const unsetConfigSentinel = 'unset';
/**
 * Sentinel recorded when the prior LOCAL value was present but EMPTY (`key =`). Git reads an empty value as
 * boolean false, and a local empty value shadows any global value — so undo must restore the empty value, not
 * unset the key (unsetting would let a global `true` resurface). The marker can't store the empty string
 * itself: `--get-regexp` prints a value-less line for it, which the bulk gk-config parser drops.
 */
const emptyConfigSentinel = 'empty';

/**
 * The ONLY tolerable non-zero exits from the config reads/writes below: `--get`/`--get-all`/`--get-regex`
 * exit 1 when the key (or, for `--get-regex`, the pattern) is unset/unmatched, `--unset-all` exits 5 when
 * it was already absent. Any other non-zero means git couldn't read or write the config at all (a held
 * `config.lock`, a read-only `.git`, a malformed file) — which must never be mistaken for "unset"/"already
 * gone", since that reads as success and drops the ownership marker.
 *
 * Note the writes use `--unset-all`, never `--unset`: `--unset` REFUSES a multi-valued key and exits 5 too —
 * the same code as the benign case — leaving the values in place. `--unset-all` removes every local value
 * (the correct restore for an `unset` prior) and reserves 5 for genuinely absent.
 */
const gitConfigGetMissingExitCode = 1;
const gitConfigUnsetMissingExitCode = 5;

/** `update-index --test-untracked-cache` exits 1 when the filesystem can't support it. */
const untrackedCacheUnsupportedExitCode = 1;

/** Poll interval and ceiling for waiting on another window's ownership-marker lock. */
const markerLockRetryMs = 50;
const markerLockMaxAttempts = 20;

/**
 * The Git Health gk markers a snapshot carries: the two not-applicable flags + per-lever ownership, plus
 * the commit-graph disable flag (nested under `commitGraph` in the snapshot, so `Pick` alone can't reach it).
 */
type GkMarkers = Pick<GitHealthSnapshot, 'fsmonitorNotApplicable' | 'untrackedCacheNotApplicable' | 'applied'> & {
	readonly commitGraphDisabled: boolean;
};
const emptyGkMarkers: GkMarkers = {
	fsmonitorNotApplicable: false,
	untrackedCacheNotApplicable: false,
	applied: { untrackedCache: false, fsmonitor: false, manyFiles: false, backgroundMaintenance: false },
	commitGraphDisabled: false,
};

/** `core.fsmonitor` is enabled when set to a truthy bool OR a hook path — unset or any false spelling is "off". */
function isFsmonitorEnabled(value: string | undefined): boolean {
	if (value == null) return false;

	return !isGitBooleanFalse(value);
}

/**
 * Whether `fsmonitor--daemon` reported that this git build has no backend for the platform (as opposed to
 * simply not running yet, which also exits non-zero). Git uses 128 for any fatal, so the message matters.
 */
function isFsmonitorDaemonUnsupported(result: Pick<GitResult, 'exitCode' | 'stdout' | 'stderr'>): boolean {
	if (result.exitCode !== 128) return false;

	return `${result.stderr ?? ''}${result.stdout ?? ''}`.includes('not supported on this platform');
}

/** Platforms with a built-in FSMonitor daemon backend, and the git floor each one needs. */
function fsmonitorFeatureForPlatform(): GitFeatures | undefined {
	switch (process.platform) {
		case 'win32':
		case 'darwin':
			return 'git:fsmonitor';
		// Linux got an inotify backend only in 2.55.
		case 'linux':
			return 'git:fsmonitor:linux';
		default:
			return undefined;
	}
}

/** Parses `git count-objects -v` (`key: number` per line) into the {@link GitHealthDetails} breakdown. */
function parseCountObjects(stdout: string): NonNullable<GitHealthDetails['countObjects']> {
	const values = new Map<string, number>();
	for (const line of stdout.split('\n')) {
		const sep = line.indexOf(':');
		if (sep === -1) continue;

		const key = line.slice(0, sep).trim();
		const value = parseInt(line.slice(sep + 1).trim(), 10);
		if (!Number.isNaN(value)) {
			values.set(key, value);
		}
	}

	// git reports the size fields in KiB — normalize to bytes here.
	return {
		count: values.get('count') ?? 0,
		size: (values.get('size') ?? 0) * 1024,
		inPack: values.get('in-pack') ?? 0,
		packs: values.get('packs') ?? 0,
		sizePack: (values.get('size-pack') ?? 0) * 1024,
		prunePackable: values.get('prune-packable') ?? 0,
		garbage: values.get('garbage') ?? 0,
		sizeGarbage: (values.get('size-garbage') ?? 0) * 1024,
	};
}

export class MaintenanceGitSubProvider implements GitMaintenanceSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	// Last commit-graph refresh this session, keyed by BOTH worktree path (cheap synchronous re-entry
	// throttle) and resolved common git dir (the authoritative throttle — worktrees share one object
	// database, so N open worktrees must coalesce to one write). The namespaces can't collide: worktree
	// keys are working-tree roots, common-dir keys are `.git` directory paths.
	private readonly commitGraphWrittenAt = new Map<string, number>();
	// Common git dirs with a write currently running — single-flight so overlapping hints (or several
	// worktrees racing the same interval boundary) never stack concurrent writes on one object database.
	private readonly commitGraphWriteInflight = new Set<string>();

	request(repoPath: string, task: GitMaintenanceTask): void {
		// Only the commit-graph has a demand cadence — its cache is most valuable immediately after a history
		// walk, so graph-load and repo-open hint it and the throttle decides. loose-objects/incremental-repack
		// are owned by the daily pass (a demand write buys nothing there), so they no-op here.
		switch (task) {
			case 'commit-graph':
				void this.ensureCommitGraph(repoPath);
				break;
			case 'loose-objects':
			case 'incremental-repack':
				break;
		}
	}

	/**
	 * Opportunistically refreshes git's commit-graph (the demand cadence behind `request('commit-graph')`).
	 * Without one that COVERS the history, any ordered walk (`--date-order`/`--topo-order` — exactly the
	 * graph's initial load) must inflate every commit object to sort BEFORE the first row can be emitted,
	 * costing a full-history walk per open; the commit-graph also accelerates `git log`, merge-base, and
	 * ahead/behind across the whole extension. It's a standard acceleration cache (`git gc`/`git maintenance`
	 * write it routinely) and is always safe to delete. Fire-and-forget: refreshed at most every few minutes
	 * per object database (a current chain makes the write a near-no-op), at background queue priority,
	 * failures swallowed. Cross-WINDOW writes aren't coordinated here — git's own `commit-graph-chain.lock`
	 * serializes them; a loser errors and is swallowed. Returns the background write's promise (or `undefined`
	 * when gated) purely so tests can await the fire-and-forget work — production callers `void` it.
	 */
	private ensureCommitGraph(repoPath: string): Promise<void> | undefined {
		// Governed by the auto-tier master switch (`gitlens.gitOptimizations.enabled`), fed into both
		// mapped config slots below.
		if (this.context.config?.maintenance?.enabled === false) return undefined;
		if (this.context.config?.graph?.writeCommitGraph === false) return undefined;

		const lastWrittenAt = this.commitGraphWrittenAt.get(repoPath);
		if (lastWrittenAt != null && Date.now() - lastWrittenAt < commitGraphRefreshIntervalMs) {
			return undefined;
		}

		this.commitGraphWrittenAt.set(repoPath, Date.now());

		return (async () => {
			try {
				if (!(await this.git.supports('git:commit-graph'))) return;

				// Re-throttle + single-flight on the COMMON git dir so this worktree's write coalesces with
				// its siblings' (they all share the one object database the commit-graph lives in). Resolved
				// via the config sub-provider's cached git-dir, so repeat hints don't re-spawn `rev-parse`.
				const gitDir = await this.provider.config.getGitDir(repoPath).catch(() => undefined);
				const commonKey = gitDir != null ? (gitDir.commonUri ?? gitDir.uri).fsPath : repoPath;
				if (this.commitGraphWriteInflight.has(commonKey)) return;

				// Skip the common-dir re-throttle when resolution fell back to repoPath itself — the sync
				// gate above JUST stamped that key, so re-checking it here would early-return forever and
				// the write would never run for repos whose git-dir resolve fails.
				if (commonKey !== repoPath) {
					const lastCommonWriteAt = this.commitGraphWrittenAt.get(commonKey);
					if (lastCommonWriteAt != null && Date.now() - lastCommonWriteAt < commitGraphRefreshIntervalMs) {
						return;
					}

					this.commitGraphWrittenAt.set(commonKey, Date.now());
				}
				this.commitGraphWriteInflight.add(commonKey);
				try {
					// Respect an explicit read opt-out — writing a cache this git will never read is pure waste.
					// `--type=bool` so every falsy spelling git accepts (`false`/`no`/`off`/`0`) normalizes to
					// `false`; unset (the overwhelmingly common case) means git reads it, and a malformed value
					// errors out (errors swallowed → empty stdout) → proceed, matching git's own read behavior.
					const optOut = await this.runQuietly(
						repoPath,
						undefined,
						'config',
						'--type=bool',
						'--get',
						'core.commitGraph',
					);
					if (optOut.stdout.trim() === 'false') return;

					// The per-repository off switch (Git Health), independent of the two settings-level gates above.
					if ((await this.provider.config.getGkConfig(repoPath, 'gk.commitGraphDisabled')) === 'true') return;

					await this.writeCommitGraph(repoPath);
				} finally {
					this.commitGraphWriteInflight.delete(commonKey);
				}
			} catch {
				// Best-effort acceleration only — never surface failures (shallow/partial clones,
				// read-only repos, ancient gits behind the feature gate, etc.).
			}
		})();
	}

	/**
	 * The commit-graph write itself. Always a `--split` write: mere existence isn't enough (a stale or thin
	 * chain — e.g. one auto-gc increment — accelerates nothing); `--split` appends an incremental layer
	 * covering only the uncovered commits (near-no-op when current) and git self-merges layers by its
	 * geometric policy. Background priority: a first write on a huge repo can run for a while and must never
	 * hold a queue slot ahead of interactive work. Throws on failure — callers decide whether to swallow.
	 */
	private async writeCommitGraph(repoPath: string, cancellation?: AbortSignal): Promise<void> {
		const args = ['commit-graph', 'write', '--reachable', '--split'];

		// Changed-path Bloom filters make `git log -- <path>` fast, but computing them for the WHOLE history
		// on a big repo is expensive — `--max-new-filters` bounds a single background write to stay cheap.
		// Coverage still grows to completion: each incremental `--split` write computes filters for the NEXT
		// batch of newest-first uncovered commits, so the cache fills in over successive background passes.
		if (await this.git.supports('git:commit-graph:changed-paths')) {
			args.push('--changed-paths', '--max-new-filters=512');
		}

		await this.git.run(
			{ cwd: repoPath, priority: 'background', cancellation: cancellation, selfMaintenance: true },
			...args,
		);
	}

	@debug()
	async getHealthSnapshot(repoPath: string, cancellation?: AbortSignal): Promise<GitHealthSnapshot> {
		const gitDir = await this.provider.config.getGitDir(repoPath);
		// Object store lives in the COMMON git dir (shared across worktrees); the index is per-worktree.
		const objectsDir = joinPaths((gitDir.commonUri ?? gitDir.uri).fsPath, 'objects');
		const indexPath = joinPaths(gitDir.uri.fsPath, 'index');

		const [
			commitGraphStat,
			multiPackIndex,
			packs,
			looseObjects,
			indexBytes,
			indexEntryCount,
			config,
			maintenanceRegistered,
			gkMarkers,
			supportsMaintenanceRun,
			changedPaths,
			changedPathsSupported,
		] = await Promise.allSettled([
			this.probeCommitGraph(objectsDir),
			fsExists(joinPaths(objectsDir, 'pack', 'multi-pack-index')),
			this.probePacks(objectsDir),
			this.sampleLooseObjects(objectsDir),
			this.fileBytes(indexPath),
			this.probeIndexEntryCount(indexPath),
			this.probeConfig(repoPath, cancellation),
			this.isMaintenanceRegistered(repoPath, cancellation),
			this.probeGkMarkers(repoPath),
			this.git.supports('git:maintenance'),
			this.probeChangedPathFilters(objectsDir),
			this.git.supports('git:commit-graph:changed-paths'),
		]);

		const markers = getSettledValue(gkMarkers) ?? emptyGkMarkers;
		return {
			commitGraph: {
				...(getSettledValue(commitGraphStat) ?? { present: false, mtime: undefined }),
				changedPaths: getSettledValue(changedPaths) ?? false,
				changedPathsSupported: getSettledValue(changedPathsSupported) ?? false,
				disabled: markers.commitGraphDisabled,
				readDisabled: getSettledValue(config)?.commitGraphReadDisabled ?? false,
			},
			multiPackIndex: getSettledValue(multiPackIndex) ?? false,
			packCount: getSettledValue(packs)?.count ?? 0,
			packBytes: getSettledValue(packs)?.bytes ?? 0,
			looseObjects: getSettledValue(looseObjects) ?? { objectsInSampledDirs: 0, dirsSampled: 0 },
			indexBytes: getSettledValue(indexBytes) ?? 0,
			indexEntryCount: getSettledValue(indexEntryCount),
			// `untrackedCacheConfigured: true` on failure — see `probeConfig`, the auto tier must not guess.
			config: getSettledValue(config) ?? {
				fsmonitor: false,
				untrackedCache: false,
				untrackedCacheConfigured: true,
				manyFiles: false,
			},
			// A rejection (the registration list was unreadable) must surface as `undefined`, never `false` —
			// see the doc on `maintenanceRegistered` for why.
			maintenanceRegistered: getSettledValue(maintenanceRegistered),
			fsmonitorNotApplicable: markers.fsmonitorNotApplicable,
			untrackedCacheNotApplicable: markers.untrackedCacheNotApplicable,
			applied: markers.applied,
			supportsMaintenanceRun: getSettledValue(supportsMaintenanceRun) ?? false,
		};
	}

	/**
	 * Reads all Git Health gk markers (not-applicable flags + `gk.applied.*` ownership) from ONE bulk
	 * `.git/gk/config` read (git lowercases the section + variable in `--get-regexp` output, preserving the
	 * `applied` subsection). A read failure degrades to all-false — the report just re-suggests, never crashes.
	 */
	private async probeGkMarkers(repoPath: string): Promise<GkMarkers> {
		const map = await this.provider.config
			.getGkConfigRegex(repoPath, '^gk\\.')
			.catch(() => new Map<string, string>());

		return {
			fsmonitorNotApplicable: map.get('gk.fsmonitornotapplicable') === 'true',
			untrackedCacheNotApplicable: map.get('gk.untrackedcachenotapplicable') === 'true',
			applied: {
				untrackedCache: map.has('gk.applied.untrackedcache'),
				fsmonitor: map.has('gk.applied.fsmonitor'),
				manyFiles: map.has('gk.applied.manyfiles'),
				backgroundMaintenance: map.has('gk.applied.backgroundmaintenance'),
			},
			commitGraphDisabled: map.get('gk.commitgraphdisabled') === 'true',
		};
	}

	@debug()
	async getHealthDetails(repoPath: string, cancellation?: AbortSignal): Promise<GitHealthDetails> {
		const [commitCountResult, countObjectsResult] = await Promise.allSettled([
			this.runQuietly(repoPath, cancellation, 'rev-list', '--count', '--all'),
			this.runQuietly(repoPath, cancellation, 'count-objects', '-v'),
		]);

		const commitCountRaw = getSettledValue(commitCountResult)?.stdout.trim();
		const commitCount = commitCountRaw ? parseInt(commitCountRaw, 10) : undefined;
		const countObjectsStdout = getSettledValue(countObjectsResult)?.stdout;

		return {
			commitCount: commitCount != null && !Number.isNaN(commitCount) ? commitCount : undefined,
			countObjects: countObjectsStdout ? parseCountObjects(countObjectsStdout) : undefined,
		};
	}

	// Capabilities depend only on git version + platform, both fixed for the session — computed once.
	private _capabilities: Promise<GitOptimizationCapability[]> | undefined;

	@debug()
	getCapabilities(_repoPath: string): Promise<GitOptimizationCapability[]> {
		return (this._capabilities ??= this.getCapabilitiesCore());
	}

	private async getCapabilitiesCore(): Promise<GitOptimizationCapability[]> {
		const requiresGit = (feature: GitFeatures, suffix?: string): string =>
			`Requires Git ${gitFeaturesByVersion.get(feature)} or later${suffix ?? ''}`;

		// The scheduler gate differs by platform: launchctl/schtasks (win/mac) vs systemd timer (Linux,
		// since 2.31–2.33 is cron-only and modern distros often ship without cron).
		const maintenanceStartFeature = this.backgroundMaintenanceFeature;
		// The FSMonitor floor is per-platform (Linux's inotify backend is much newer), and a platform with no
		// backend at all has no floor to check.
		const fsmonitorFeature = fsmonitorFeatureForPlatform();

		const [untrackedCacheResult, fsmonitorResult, backgroundMaintenanceResult, manyFilesResult, skipHashResult] =
			await Promise.allSettled([
				this.git.supports('git:untrackedCache'),
				fsmonitorFeature != null ? this.git.supports(fsmonitorFeature) : false,
				this.git.supports(maintenanceStartFeature),
				this.git.supports('git:manyFiles'),
				this.git.supports('git:index:skipHash'),
			]);

		const untrackedCache = getSettledValue(untrackedCacheResult) ?? false;
		const fsmonitor = getSettledValue(fsmonitorResult) ?? false;
		const backgroundMaintenance = getSettledValue(backgroundMaintenanceResult) ?? false;
		const manyFiles = getSettledValue(manyFilesResult) ?? false;
		const skipHash = getSettledValue(skipHashResult) ?? false;

		return [
			{
				id: 'untrackedCache',
				supported: untrackedCache,
				reason: untrackedCache ? undefined : requiresGit('git:untrackedCache'),
			},
			{
				id: 'fsmonitor',
				supported: fsmonitor,
				reason:
					fsmonitorFeature == null
						? 'Only available on Windows, macOS, and Linux'
						: !fsmonitor
							? requiresGit(fsmonitorFeature)
							: undefined,
			},
			{
				id: 'backgroundMaintenance',
				supported: backgroundMaintenance,
				reason: backgroundMaintenance
					? undefined
					: requiresGit(
							maintenanceStartFeature,
							maintenanceStartFeature === 'git:maintenance:start:systemd'
								? ' (for systemd timer scheduling)'
								: undefined,
						),
			},
			{
				id: 'manyFiles',
				supported: manyFiles,
				reason: manyFiles ? undefined : requiresGit('git:manyFiles'),
				// On Git 2.40+, feature.manyFiles also enables index.skipHash, whose index older tools can't read.
				note:
					manyFiles && skipHash
						? 'Also enables index.skipHash — the resulting index cannot be read by Git older than 2.40, libgit2, or JGit'
						: undefined,
			},
		];
	}

	@debug()
	async runMaintenanceTask(repoPath: string, task: GitMaintenanceTask, cancellation?: AbortSignal): Promise<boolean> {
		// Not-applicable (the installed git can't run this task) short-circuits to `false`; a genuine command
		// failure throws (the git error propagates so the ask-tier "Run Maintenance Now" UI can surface it).
		if (task === 'commit-graph') {
			// Direct write, gated at 2.24 — routing through `maintenance run --task=commit-graph` (2.30) would
			// drop 2.24–2.29 users on the highest-value lever. The explicit path skips the demand throttle.
			if (!(await this.git.supports('git:commit-graph'))) return false;

			await this.writeCommitGraph(repoPath, cancellation);
			return true;
		}

		if (!(await this.git.supports('git:maintenance'))) return false;

		await this.git.run(
			{
				cwd: repoPath,
				errors: 'throw',
				priority: 'background',
				cancellation: cancellation,
				selfMaintenance: true,
			},
			'maintenance',
			'run',
			`--task=${task}`,
		);
		return true;
	}

	@debug()
	async applyOptimization(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<boolean> {
		switch (id) {
			case 'untrackedCache':
				return this.applyUntrackedCache(repoPath, cancellation);
			case 'fsmonitor':
				return this.applyFsmonitor(repoPath, cancellation);
			case 'backgroundMaintenance':
				return this.startBackgroundMaintenance(repoPath, cancellation);
			case 'manyFiles':
				return this.applyManyFiles(repoPath, cancellation);
		}
	}

	@debug()
	async revertOptimization(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<void> {
		switch (id) {
			case 'untrackedCache':
				await this.revertConfigLever(
					repoPath,
					'core.untrackedCache',
					'gk.applied.untrackedCache',
					cancellation,
				);
				break;
			case 'fsmonitor':
				if (await this.revertConfigLever(repoPath, 'core.fsmonitor', 'gk.applied.fsmonitor', cancellation)) {
					// Stop the daemon so it doesn't linger after the config is gone (best-effort) — only when
					// WE applied fsmonitor; a user-enabled daemon (no marker) is left running.
					await this.runQuietly(repoPath, cancellation, 'fsmonitor--daemon', 'stop');
				}
				break;
			case 'backgroundMaintenance':
				await this.revertBackgroundMaintenance(repoPath, cancellation);
				break;
			case 'manyFiles':
				// Ownership is checked without clearing anything, then the SUB-lever is restored first.
				// `revertConfigLever` clears the marker it acts on, so doing the parent first would strand a
				// failed or cancelled `index.skipHash` restore: the retry would find no parent marker and
				// skip straight past the sub-lever, leaving it set forever.
				if ((await this.provider.config.getGkConfig(repoPath, 'gk.applied.manyFiles')) != null) {
					// `index.skipHash` is only ever set on 2.40+, so its marker is absent otherwise and this
					// no-ops.
					await this.revertConfigLever(repoPath, 'index.skipHash', 'gk.applied.skipHash', cancellation);
					await this.revertConfigLever(repoPath, 'feature.manyFiles', 'gk.applied.manyFiles', cancellation);
				}
				break;
		}
	}

	/**
	 * The Git Health per-repository commit-graph off switch (`gk.commitGraphDisabled`). Unlike the
	 * ownership markers above, this isn't a "record prior, then restore" lever — it's a plain flag with no
	 * underlying config value to protect — so it needs no marker lock; two windows toggling it concurrently
	 * just resolve to whichever write lands last.
	 */
	@debug()
	async setCommitGraphDisabled(repoPath: string, disabled: boolean, cancellation?: AbortSignal): Promise<void> {
		if (disabled) {
			await this.provider.config.setGkConfig(repoPath, 'gk.commitGraphDisabled', 'true');
			return;
		}

		// Tolerate an already-absent marker (re-enabling twice, or a repo GitLens never disabled):
		// `setGkConfig`'s underlying `--unset` throws on a genuinely missing key, so check first.
		if ((await this.readGkMarkerUncached(repoPath, 'gk.commitGraphDisabled', cancellation)) == null) return;

		await this.provider.config.setGkConfig(repoPath, 'gk.commitGraphDisabled', undefined);
	}

	private async applyUntrackedCache(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		// Bail before the probe when the lever is already configured (bareword included) — nothing to apply
		// either way, and the probe below isn't safe to run unconditionally: `core.untrackedCache` is one of
		// git's few TRISTATE config keys (`true`/`false`/`keep`), and unlike a plain boolean its tristate
		// reader has no NULL case — `update-index --test-untracked-cache` (and `git status`) FATALS on a
		// bareword `core.untrackedCache` ("missing value for 'core.untrackedcache'") rather than reading it
		// as true. This is a fast-path only; the authoritative check re-runs inside the lock below.
		if ((await this.probeConfig(repoPath, cancellation)).untrackedCacheConfigured) return false;

		// Untracked cache is only CORRECT when directory mtimes are reliable; on network/virtual filesystems
		// it produces wrong `git status`. Gate on git's own filesystem probe (it can take a few seconds, but
		// this only runs at apply time — already background/daily). A failure records not-applicable (like
		// fsmonitor) so it's never auto-retried.
		if (!(await this.testUntrackedCacheSupport(repoPath, cancellation))) {
			await this.markGkConfigSafe(repoPath, 'gk.untrackedCacheNotApplicable', 'true');
			return false;
		}

		// Decide and mutate inside ONE lock, as late as possible. The filesystem probe above can take several
		// seconds on a large repo — ample time for the user to set this key themselves — and re-checking
		// outside the lock would still leave a gap between the check and the write.
		//
		// This cannot be made airtight against an external writer: a plain `git config` from a terminal
		// takes no lock we can observe, so a write landing between our final read and ours still loses. The
		// window is now two git invocations rather than the length of the probe.
		return this.withMarkerLock(repoPath, async () => {
			if ((await this.probeConfig(repoPath, cancellation)).untrackedCacheConfigured) return false;

			await this.recordPriorUnlocked(repoPath, 'core.untrackedCache', 'gk.applied.untrackedCache', cancellation);
			await this.setLocalConfig(repoPath, 'core.untrackedCache', 'true', cancellation);
			return true;
		});
	}

	/** Whether git's filesystem probe says the untracked cache can be used here (exit 0). */
	private async testUntrackedCacheSupport(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const result = await this.runQuietly(repoPath, cancellation, 'update-index', '--test-untracked-cache');
		// A cancelled/timed-out probe resolves `exitCode: 0` — never read that as "supported". This probe
		// exists to keep the untracked cache OFF filesystems with unreliable directory mtimes, which are
		// exactly the slow/network filesystems where it is most likely to hit the timeout.
		this.throwIfDidNotComplete(result, cancellation);
		// 0 = this filesystem supports it, 1 = it doesn't. Any OTHER exit isn't a verdict about the
		// filesystem at all — a spawn-level failure (a non-numeric error code parses to NaN) or a repo-level
		// error — and the caller turns `false` into a PERMANENT not-applicable marker. Throw instead, so a
		// one-off hiccup during a background pass just retries on the next pass.
		if (result.exitCode !== 0 && result.exitCode !== untrackedCacheUnsupportedExitCode) {
			throw new Error(`Untracked-cache probe did not complete (git exited ${String(result.exitCode)})`);
		}
		return result.exitCode === 0;
	}

	private async applyFsmonitor(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const scope = getScopedLogger();

		const fsmonitorFeature = fsmonitorFeatureForPlatform();
		if (fsmonitorFeature == null) return false;
		if (!(await this.git.supports(fsmonitorFeature))) return false;

		// A new-enough git is not proof the daemon can actually run here — the backend is compiled per
		// platform. Ask it directly BEFORE touching config, because the warm-up below cannot tell us: with an
		// unsupported daemon `git status` exits 0 in silence, so trusting it would leave `core.fsmonitor=true`
		// set on a repo that gains nothing from it.
		const probe = await this.runQuietly(repoPath, cancellation, 'fsmonitor--daemon', 'status');
		this.throwIfDidNotComplete(probe, cancellation);
		if (isFsmonitorDaemonUnsupported(probe)) {
			scope?.warn(`FSMonitor daemon unsupported by this git build for '${repoPath}'; marking not-applicable`);
			await this.markGkConfigSafe(repoPath, 'gk.fsmonitorNotApplicable', 'true');
			return false;
		}

		await this.recordPriorAndMark(repoPath, 'core.fsmonitor', 'gk.applied.fsmonitor', cancellation);
		await this.setLocalConfig(repoPath, 'core.fsmonitor', 'true', cancellation);

		// A `status` with `core.fsmonitor=true` spins up the built-in daemon; if it can't start, the command
		// errors. Run it quietly so the EXIT CODE stays visible — the distinction between "git ran and
		// rejected this repo" and "the command never completed" decides whether the repo earns a permanent
		// not-applicable marker.
		const result = await this.runQuietly(repoPath, cancellation, 'status', '--porcelain');
		// Check "did it complete" BEFORE the exit code: a cancelled or never-run command also resolves 0.
		if (result.completion.status === 'exited' && result.exitCode === 0 && cancellation?.aborted !== true) {
			return true;
		}

		// Roll back on a signal that can't itself be aborted: this path exists to leave the repo exactly as we
		// found it, and a rollback cancelled halfway leaves `core.fsmonitor` ON with its ownership marker
		// cleared — the lever stuck on, and GitLens no longer offering to undo it.
		await this.restorePriorAndClear(repoPath, 'core.fsmonitor', 'gk.applied.fsmonitor');
		await this.runQuietly(repoPath, undefined, 'fsmonitor--daemon', 'stop');

		// A cancelled or timed-out warm-up says nothing about whether the daemon can start — and a first cold
		// `status` on the very large repos fsmonitor targets is exactly what hits the timeout.
		this.throwIfDidNotComplete(result, cancellation);
		// Neither does a failure to run git at all, which surfaces as a non-numeric error code (→ NaN). Only a
		// real git exit is evidence about THIS repo, so only that earns the permanent marker.
		if (!Number.isInteger(result.exitCode)) {
			throw new Error(`FSMonitor warm-up did not complete (git exited ${String(result.exitCode)})`);
		}

		// Before blaming FSMonitor, re-run the same command now that the rollback has restored the prior
		// config — i.e. the baseline. If THAT fails too, the repository is broken for an unrelated reason (a
		// corrupt index, permissions) and recording not-applicable would permanently suppress a lever that
		// was never the cause.
		const baseline = await this.runQuietly(repoPath, cancellation, 'status', '--porcelain');
		this.throwIfDidNotComplete(baseline, cancellation);
		if (baseline.exitCode !== 0) {
			throw new Error(
				`Repository status fails independently of FSMonitor (git exited ${String(baseline.exitCode)})`,
			);
		}

		scope?.warn(`FSMonitor failed to start for '${repoPath}'; reverting and marking not-applicable`);
		await this.markGkConfigSafe(repoPath, 'gk.fsmonitorNotApplicable', 'true');
		return false;
	}

	private async applyManyFiles(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		// Self-gate like the other invasive levers: older git accepts the unknown key silently, so without
		// this a direct (or stale) caller gets `true` back for a setting that does nothing. Report-level
		// capability filtering doesn't protect callers that reach `applyOptimization` some other way.
		if (!(await this.git.supports('git:manyFiles'))) return false;

		await this.recordPriorAndMark(repoPath, 'feature.manyFiles', 'gk.applied.manyFiles', cancellation);
		await this.setLocalConfig(repoPath, 'feature.manyFiles', 'true', cancellation);

		// `feature.manyFiles` implies index v4 + untracked cache; add `index.skipHash` explicitly where
		// the installed git supports it (2.40+) for the extra index-write speedup.
		if (await this.git.supports('git:index:skipHash')) {
			await this.recordPriorAndMark(repoPath, 'index.skipHash', 'gk.applied.skipHash', cancellation);
			await this.setLocalConfig(repoPath, 'index.skipHash', 'true', cancellation);
		}
		return true;
	}

	/**
	 * The `git maintenance start` version gate for the current platform: launchctl/schtasks scheduling
	 * (win/mac) needs 2.31; Linux relies on a systemd timer (2.34), since 2.31–2.33 is cron-only and
	 * modern distros often ship without cron.
	 */
	private get backgroundMaintenanceFeature(): 'git:maintenance:start' | 'git:maintenance:start:systemd' {
		return process.platform === 'win32' || process.platform === 'darwin'
			? 'git:maintenance:start'
			: 'git:maintenance:start:systemd';
	}

	private async startBackgroundMaintenance(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const scope = getScopedLogger();

		if (!(await this.git.supports(this.backgroundMaintenanceFeature))) return false;

		// Resolve the path we're about to register BEFORE recording anything, so the marker below records what
		// was actually used rather than something undo has to re-derive later.
		const registeredPath = await this.resolveMaintenanceRepoPath(repoPath, cancellation);

		// Re-check registration with a FRESH read (bypass the registered-repos TTL cache): the report that
		// drove this apply can be stale, and without this a registration made between the probe and the
		// click gets claimed as ours — a later Undo would then unregister someone else's entry.
		this._registeredMaintenanceRepos = undefined;
		if (await this.isPathRegistered(repoPath, registeredPath, cancellation)) return false;

		// Record priors BEFORE starting. `git maintenance register` sets local `maintenance.auto=false` AND
		// `maintenance.strategy=incremental`, and `unregister` restores NEITHER — so both must be captured or
		// undo silently leaves a key behind. `start` can also fail after writing config while installing the
		// scheduler, so recording first is what makes even a partial start recoverable.
		//
		// Both go through `recordPriorAndMark`, which is idempotent: a second apply must not re-record the
		// prior, or it captures the value git itself just wrote and undo "restores" that instead.
		await this.recordPriorAndMark(repoPath, 'maintenance.auto', 'gk.applied.maintenanceAuto', cancellation);
		await this.recordPriorAndMark(repoPath, 'maintenance.strategy', 'gk.applied.maintenanceStrategy', cancellation);
		// The marker's VALUE is the registered path, not just presence. `git maintenance register` records a
		// per-worktree path, so undo must unregister EXACTLY what was registered: re-deriving it wedges undo
		// whenever the derivation differs at revert time (a `worktree list` that failed here and fell back to
		// this worktree, or a sibling the user registered since).
		await this.provider.config.setGkConfig(repoPath, 'gk.applied.backgroundMaintenance', registeredPath);

		// `start` registers the repo AND installs the system scheduler (launchctl/schtasks/systemd/cron). A
		// genuine failure throws (the ask-tier UI surfaces it); unsupported already returned false above.
		try {
			await this.git.run(
				{
					cwd: registeredPath,
					errors: 'throw',
					priority: 'background',
					cancellation: cancellation,
					selfMaintenance: true,
				},
				'maintenance',
				'start',
			);
		} catch (ex) {
			// `start` can fail AFTER registering, while installing the scheduler (e.g. Git ≥ 2.34 on a Linux
			// box with no systemd actually running — the version gate can't detect that), leaving the repo
			// registered with `maintenance.auto=false` and nothing scheduled: strictly worse than before. The
			// markers written above make that recoverable, but nothing would ever PROMPT the undo — so undo it
			// here, unsignalled, then rethrow so the ask-tier UI still surfaces the original failure.
			this._registeredMaintenanceRepos = undefined;
			await this.revertBackgroundMaintenance(repoPath).catch((revertEx: unknown) =>
				scope?.error(revertEx, `Unable to roll back a partial 'maintenance start' for '${repoPath}'`),
			);
			throw ex;
		}

		this._registeredMaintenanceRepos = undefined;
		return true;
	}

	private async revertBackgroundMaintenance(repoPath: string, cancellation?: AbortSignal): Promise<void> {
		const scope = getScopedLogger();

		// No ownership marker → GitLens didn't register it → never unregister the user's own registration.
		const marker = await this.provider.config.getGkConfig(repoPath, 'gk.applied.backgroundMaintenance');
		if (marker == null) return;

		// The marker records the path we registered (older markers stored `true` — fall back to the same
		// derivation those were written with).
		const registeredPath =
			marker === 'true' ? await this.resolveMaintenanceRepoPath(repoPath, cancellation) : marker;

		// `maintenance unregister` exits non-zero when the repo isn't registered; `--force` (which suppresses
		// that) only exists on Git ≥ 2.39, so tolerate the benign non-zero exit via `errors: 'ignore'`.
		// `unregister` also targets the CWD's repository, so it needs that worktree to still exist.
		let unregistered = false;
		if ((await this.git.supports('git:maintenance')) && (await fsExists(registeredPath))) {
			const result = await this.runQuietly(registeredPath, cancellation, 'maintenance', 'unregister');
			// A cancelled unregister resolves `exitCode: 0` just like the benign "wasn't registered" exit —
			// don't clear the ownership markers below on the strength of a command that never ran.
			this.throwIfDidNotComplete(result, cancellation);
			this._registeredMaintenanceRepos = undefined;

			// `unregister` also exits non-zero for a REAL failure, and pre-2.39 git has no `--force` to tell
			// that apart from the benign "wasn't registered" — so confirm rather than trust the exit code.
			// Check OUR path only, never the whole worktree family: a sibling the user registered themselves
			// is theirs to remove, and waiting for it to disappear would block undo forever.
			unregistered = !(await this.isPathRegistered(repoPath, registeredPath, cancellation));
		}

		if (!unregistered) {
			// Neither precondition above is guaranteed at undo time — the worktree may be gone, or git may
			// have been downgraded below `maintenance`. Delete the exact global entry ourselves instead of
			// giving up: dropping ownership here while the registration survives would leave the repo
			// scheduled forever with nothing left to identify it as GitLens's. `--fixed-value` (2.30+, the
			// same floor as `git maintenance`) stops the path being read as a regex; both the recorded and
			// the symlink-resolved spelling are tried, since `register` stores the resolved one.
			for (const candidate of await this.resolveRegistrationCandidates([registeredPath])) {
				await this.runQuietly(
					repoPath,
					cancellation,
					'config',
					'--global',
					'--unset',
					'--fixed-value',
					'maintenance.repo',
					candidate,
				);
			}
			this._registeredMaintenanceRepos = undefined;

			if (await this.isPathRegistered(repoPath, registeredPath, cancellation)) {
				throw new Error('Unable to unregister background maintenance');
			}

			scope?.warn(`Removed the global maintenance.repo entry for '${registeredPath}' directly`);
		}

		// `unregister` restores NEITHER key `register` wrote — verified against git: both `maintenance.auto`
		// and `maintenance.strategy` survive it. Restore each recorded prior ourselves, else undo leaves the
		// repo with no scheduled maintenance, no auto-gc, and a stray strategy key: strictly worse than
		// before it was applied. Restore BEFORE clearing markers, so a failure here is retryable.
		const priorAuto = await this.provider.config.getGkConfig(repoPath, 'gk.applied.maintenanceAuto');
		if (priorAuto != null) {
			await this.restoreLocalConfig(repoPath, 'maintenance.auto', priorAuto, cancellation);
		}
		// Guarded on both sides: a marker written by a build that predates strategy tracking won't have this
		// key, and clearing an absent gk key errors rather than no-oping.
		const priorStrategy = await this.provider.config.getGkConfig(repoPath, 'gk.applied.maintenanceStrategy');
		if (priorStrategy != null) {
			await this.restoreLocalConfig(repoPath, 'maintenance.strategy', priorStrategy, cancellation);
			await this.provider.config.setGkConfig(repoPath, 'gk.applied.maintenanceStrategy', undefined);
		}

		// The OS scheduler `start` installed is deliberately LEFT IN PLACE. It's global rather than per-repo,
		// and `git maintenance register` (which a user may well have run by hand) does not install one — so
		// tearing it down here could silently stop maintenance for repos GitLens never touched. A scheduler
		// with nothing registered simply finds no work, whereas removing one someone else relies on is not
		// recoverable by them. Leaving it inert is the safer asymmetry.
		if (priorAuto != null) {
			await this.provider.config.setGkConfig(repoPath, 'gk.applied.maintenanceAuto', undefined);
		}
		await this.provider.config.setGkConfig(repoPath, 'gk.applied.backgroundMaintenance', undefined);
	}

	/**
	 * Records a config lever's prior LOCAL value (or the `unset` sentinel) under its ownership marker BEFORE
	 * mutating, so undo restores the exact prior and never a hardcoded inverse; the marker's presence also
	 * means "applied by GitLens" (so undo is never offered for a user-enabled lever).
	 */
	private async recordPriorAndMark(
		repoPath: string,
		configKey: string,
		markerKey: GkConfigKeys,
		cancellation?: AbortSignal,
	): Promise<void> {
		// Idempotent by design, and atomic across processes. An existing marker means WE already applied this
		// lever, so the value it holds IS the user's prior — re-recording would capture the value GitLens
		// itself set (a second apply from a stale view action, or a sibling window racing this one) and undo
		// would then "restore" the lever to on, permanently. The first record is the only truthful one.
		//
		// The check and the write are two separate git invocations, so an in-memory guard would only protect
		// one provider; the lock is what makes the pair safe between VS Code windows.
		await this.withMarkerLock(repoPath, () =>
			this.recordPriorUnlocked(repoPath, configKey, markerKey, cancellation),
		);
	}

	/** The body of {@link recordPriorAndMark}, for callers already holding the marker lock. */
	private async recordPriorUnlocked(
		repoPath: string,
		configKey: string,
		markerKey: GkConfigKeys,
		cancellation?: AbortSignal,
	): Promise<void> {
		// Read UNCACHED: the provider's bulk gk map can be stale for exactly the window the lock exists to
		// close — another process may have written the marker since it was populated.
		if ((await this.readGkMarkerUncached(repoPath, markerKey, cancellation)) != null) return;

		// `getLocalConfig` reads via `--get-regex`, not `--get` — see its doc comment for why: `--get` can't
		// tell a bareword-true prior apart from an explicit-empty (false) one. A bareword prior comes back as
		// the string `'true'` here, which falls into the plain `prior` branch below and is recorded verbatim —
		// `key true` is the value git's CLI writes for the same boolean, since it has no way to write a bareword.
		const prior = await this.getLocalConfig(repoPath, configKey, cancellation);
		await this.provider.config.setGkConfig(
			repoPath,
			markerKey,
			prior == null ? unsetConfigSentinel : prior === '' ? emptyConfigSentinel : prior,
		);
	}

	@debug()
	async claimMaintenancePass(repoPath: string, intervalMs: number): Promise<boolean> {
		// The stamp is the CROSS-WINDOW throttle, so reading it and writing it must be one transaction —
		// otherwise two windows both observe an expired value and both run a pass. Uses the same lock and
		// the same uncached read as the ownership markers.
		return this.withMarkerLock(repoPath, async () => {
			const raw = await this.readGkMarkerUncached(repoPath, 'gk.maintenanceLastRun');
			const last = raw != null ? Date.parse(raw) : Number.NaN;
			if (!Number.isNaN(last) && Date.now() - last < intervalMs) return false;

			// Claim BEFORE the work, not after: a pass can run for minutes, and a window probing in that gap
			// would otherwise see no stamp and start a second concurrent pass over the same object database.
			await this.provider.config.setGkConfig(repoPath, 'gk.maintenanceLastRun', new Date().toISOString(), {
				skipInvalidation: ['branchOverviews', 'baseBranchName'],
			});
			return true;
		});
	}

	/** The `.git/gk/` directory (common dir, so worktrees of a repo share it). */
	private async getGkDir(repoPath: string): Promise<string> {
		const gitDir = await this.provider.config.getGitDir(repoPath);
		return joinPaths((gitDir.commonUri ?? gitDir.uri).fsPath, 'gk');
	}

	/** Reads an ownership marker straight from `.git/gk/config`, bypassing every cache. */
	private async readGkMarkerUncached(
		repoPath: string,
		markerKey: GkConfigKeys,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const result = await this.runQuietly(
			repoPath,
			cancellation,
			'config',
			'--file',
			joinPaths(await this.getGkDir(repoPath), 'config'),
			'--get',
			markerKey,
		);
		this.throwIfDidNotComplete(result, cancellation);
		if (result.exitCode !== 0 && result.exitCode !== gitConfigGetMissingExitCode) {
			throw new Error(`Unable to read the '${markerKey}' marker (git exited ${String(result.exitCode)})`);
		}
		return result.stdout.trim() || undefined;
	}

	/**
	 * Runs `fn` holding an exclusive on-disk lock over this repo family's ownership markers. Two layers make
	 * this safe across processes:
	 *
	 * - **Exclusive-create ownership, with an identity record.** `open(lockPath, 'wx')` — the same `O_EXCL`
	 *   primitive git uses for its own `*.lock` files — is the only atomic step; a contender that loses the
	 *   race retries for up to `maxAttempts`, then fails loudly rather than proceeding unlocked (see below).
	 *   The winner immediately writes its host, pid, and a fresh random `ownerId` into the lock file — an
	 *   identity record, not a liveness lease, since nothing here ever acts on it while another holder is
	 *   still running.
	 * - **Ownership-verified release.** On the way out, the lock file is removed only if its `ownerId` still
	 *   matches the one this call wrote — a fresh random value per acquisition can't collide with a
	 *   re-created lock the way an inode COULD in principle on some filesystems, so it's the primary check;
	 *   the inode is also compared as a cheap secondary one.
	 *
	 * A lock left behind by a crashed window is deliberately NOT recovered automatically. Two designs were
	 * tried and rejected. Time-based leasing can't tell a dead owner from a slow one — an age alone doesn't
	 * distinguish them (git timeouts are user-configurable, and can be disabled entirely), and making it tell
	 * them apart takes a full lease-plus-fencing-token protocol this lock has no need for otherwise.
	 * Automatic stealing (rename the lock aside once a PID probe says its owner is provably dead) was tried
	 * next, and is unsound for a different reason: automatic recovery of an abandoned fixed-path lock cannot
	 * be made race-free using only the portable stock-Node primitives available here (exclusive-create and
	 * rename) — every recovery attempt separates observation from mutation, so a delayed stealer can rename
	 * away a NEW, live lock a fresh contender created in the gap between the probe and the rename, evicting a
	 * holder that was never dead. Kernel-managed advisory locking (`flock`) would close that gap, but Node
	 * exposes no portable interface to it and a native, platform-sensitive dependency is disproportionate
	 * here. Therefore a contender NEVER mutates an existing lock — only the creator removes one, and no stale
	 * observation can authorize mutation. Recovery is a guided MANUAL step instead: a give-up runs the same PID probe ONCE, purely to choose the error's
	 * wording — a confirmed-dead ('dead' verdict) owner gets an error naming the lock file to delete;
	 * anything else (live, unverifiable, or on another host) gets the generic "another window" error. Either
	 * way the fix is the same: delete the named lock file and retry.
	 *
	 * Because a live holder can't lose its lock, `fn` needs no cancellation coupling to the lock itself — the
	 * critical section only ever ends on its own terms.
	 *
	 * Acquisition beyond the initial `open` is not atomic: the ownership record is written in a separate step
	 * just after. A crash landing exactly there — not caught by anything, since the process is gone — leaves
	 * a permanently-empty orphan lock; the give-up error's manual-deletion instructions are the only recovery
	 * for that case, same as for a confirmed-dead owner. A failure our OWN code can observe in that window
	 * (the post-`mkdir` setup, or the ownership write itself) is different: it fails closed, removing the
	 * lock it just created — ownership is certain there, since we hold the only handle — before rethrowing,
	 * so a transient error (e.g. `ENOSPC`) never strands a lock nothing can ever prove dead.
	 *
	 * Deliberately NOT named `config.lock` — that's the name git takes when writing `.git/gk/config` itself.
	 */
	private async withMarkerLock<T>(
		repoPath: string,
		fn: () => Promise<T>,
		// Test seam only — production call sites rely on the module defaults below. `probeOwner` REPLACES the
		// real `process.kill(pid, 0)` liveness probe used for the give-up error's wording, so a test can stage
		// a dead (or unverifiable) owner deterministically. `writeRecord` REPLACES the real ownership-record
		// write, so a test can force the post-open setup to fail. `openLock` REPLACES the real
		// `open(lockPath, 'wx')` acquisition, so a test can force it to fail deterministically (POSIX mode
		// bits don't reliably block child creation on Windows).
		timings?: {
			retryMs?: number;
			maxAttempts?: number;
			probeOwner?: (owner: { host: string; pid: number }) => 'alive' | 'dead' | 'unverifiable';
			writeRecord?: (handle: FileHandle) => Promise<void>;
			openLock?: (lockPath: string) => Promise<FileHandle>;
		},
	): Promise<T> {
		const retryMs = timings?.retryMs ?? markerLockRetryMs;
		const maxAttempts = timings?.maxAttempts ?? markerLockMaxAttempts;

		const dir = await this.getGkDir(repoPath);
		const lockPath = joinPaths(dir, 'applied.lock');
		try {
			await mkdir(dir, { recursive: true });
		} catch (ex) {
			// Never proceed unlocked: a lock that can't even be set up must not let the guarded transaction
			// run without one. Recoverable by the same manual fix as any other acquisition failure.
			throw new Error(
				`Could not acquire the Git maintenance settings lock at '${lockPath}'. If this persists and no ` +
					`other VS Code window is using this repository, delete that file and try again.`,
				{ cause: ex },
			);
		}

		let handle;
		for (let attempt = 0; handle == null; attempt++) {
			try {
				handle = await (timings?.openLock ? timings.openLock(lockPath) : open(lockPath, 'wx'));
			} catch (ex) {
				if ((ex as NodeJS.ErrnoException).code !== 'EEXIST') {
					// Never proceed unlocked: the whole point is that a concurrent window must not read a
					// stale "marker absent" and record the wrong prior. Failing loudly is recoverable; racing
					// is not.
					throw new Error(
						`Could not acquire the Git maintenance settings lock at '${lockPath}'. If this persists ` +
							`and no other VS Code window is using this repository, delete that file and try again.`,
						{ cause: ex },
					);
				}

				// Bounded so a lock this window can never take (see the doc comment above) doesn't spin the
				// loop forever.
				if (attempt >= maxAttempts) {
					// One diagnostic probe, purely to choose the error's wording — see the doc comment above
					// for why a 'dead' verdict still doesn't get stolen from automatically.
					const verdict = await this.probeLockOwner(lockPath, timings?.probeOwner).catch(
						() => 'unverifiable' as const,
					);
					if (verdict === 'dead') {
						throw new Error(
							`A previous VS Code window appears to have crashed while updating Git maintenance ` +
								`settings. Delete '${lockPath}' to recover.`,
							{ cause: ex },
						);
					}

					throw new Error(
						`Another window is currently updating Git maintenance settings. If no other VS Code ` +
							`window is using this repository, delete '${lockPath}' and try again.`,
						{ cause: ex },
					);
				}

				await new Promise(resolve => setTimeout(resolve, retryMs));
			}
		}

		// Narrowed into a const so the rest of this method sees the non-undefined type.
		const lockHandle = handle;
		// A fresh random value per acquisition — the primary identity the release check below verifies.
		const ownerId = randomUUID();
		let ino;
		try {
			// Recorded as early as possible, so a contender that arrives at any point during our hold finds
			// an owner to probe rather than an empty file it must treat as unverifiable.
			const writeRecord =
				timings?.writeRecord ??
				(async (h: FileHandle) => {
					await h.writeFile(JSON.stringify({ host: hostname(), pid: process.pid, ownerId: ownerId }));
				});
			await writeRecord(lockHandle);
			// Secondary check for release below — see there for why ownerId is the primary one.
			ino = (await lockHandle.stat()).ino;
		} catch (ex) {
			// A failure here (e.g. ENOSPC) is usually ours to clean up — but not always: the same
			// only-the-creator-removes invariant the release path enforces above applies here too. If the lock
			// was manually deleted and RECREATED by a new owner in this exact window, removing it unconditionally
			// would delete THEIR file. Verify identity first: `handle.stat()` reads through our own open
			// descriptor (valid even after the path is unlinked or replaced) against a fresh stat of the path
			// itself; ENOENT or a mismatch means nothing of ours remains there, so skip the rm.
			const ourStat = await lockHandle.stat().catch(() => undefined);
			await lockHandle.close().catch(() => {});
			const pathStat = await stat(lockPath).catch(() => undefined);
			if (ourStat != null && ourStat.ino === pathStat?.ino) {
				await rm(lockPath, { force: true }).catch(() => {});
			}
			throw new Error(
				`Could not acquire the Git maintenance settings lock at '${lockPath}'. If this persists and no ` +
					`other VS Code window is using this repository, delete that file and try again.`,
				{ cause: ex },
			);
		}

		try {
			return await fn();
		} finally {
			await lockHandle.close().catch(() => {});
			// Only remove the file if it's still the one we created — `ownerId` is the authoritative check,
			// the inode compared too as a cheap secondary one; neither alone is proof on every filesystem, but
			// both matching is.
			const currentOwner = await readFile(lockPath, 'utf8')
				.then(raw => (raw ? (JSON.parse(raw) as { ownerId?: unknown }) : undefined))
				.catch(() => undefined);
			const current = await stat(lockPath).catch(() => undefined);
			if (currentOwner?.ownerId === ownerId && current?.ino === ino) {
				await rm(lockPath, { force: true }).catch(() => {});
			}
		}
	}

	/**
	 * Diagnoses the process recorded in `lockPath` for the give-up error's wording ONLY — see
	 * `withMarkerLock`'s doc comment for why a verdict never causes an automatic steal. 'dead' only when the
	 * OS kill-probe returns `ESRCH`; every other outcome (unreadable/malformed content, a lock recorded on
	 * another host, a probe that succeeds, or fails with anything but `ESRCH`) is 'unverifiable'.
	 */
	private async probeLockOwner(
		lockPath: string,
		probeOwner?: (owner: { host: string; pid: number }) => 'alive' | 'dead' | 'unverifiable',
	): Promise<'alive' | 'dead' | 'unverifiable'> {
		const owner = await readFile(lockPath, 'utf8')
			.then(raw => (raw ? (JSON.parse(raw) as { host?: unknown; pid?: unknown }) : undefined))
			.catch(() => undefined);
		// Empty or unparseable: either the owner is mid-open/mid-write (a race with our own read) or a crash
		// landed exactly between its `open` and its ownership write, orphaning a permanently-empty lock —
		// neither is evidence the owner is dead.
		if (owner == null || typeof owner.host !== 'string' || typeof owner.pid !== 'number') return 'unverifiable';

		if (probeOwner != null) return probeOwner({ host: owner.host, pid: owner.pid });

		// A lock recorded on another host (shared filesystem) can't be probed locally — a PID probe here would
		// be asking about an unrelated process on THIS machine.
		if (owner.host !== hostname()) return 'unverifiable';

		try {
			// Signal 0: sends nothing, only asks the OS whether the process exists and is ours to signal.
			process.kill(owner.pid, 0);
			return 'alive'; // No throw — alive, or at least not provably dead.
		} catch (ex) {
			// ESRCH = no such process → provably dead. EPERM (belongs to someone else) and anything else
			// can't be told apart from "alive". PID recycling also lands here as "alive" (we can't tell),
			// which is the correct conservative answer.
			return (ex as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unverifiable';
		}
	}

	/**
	 * Reverts a config lever GitLens applied: restores its recorded prior LOCAL value (set it back, or unset
	 * when the prior was absent) and clears the marker. Returns `false` (a no-op) when no marker exists —
	 * a lever the user enabled themselves is never touched.
	 */
	private async revertConfigLever(
		repoPath: string,
		configKey: string,
		markerKey: GkConfigKeys,
		cancellation?: AbortSignal,
	): Promise<boolean> {
		// Same transaction boundary as apply, and the same uncached read. Without both, a window holding a
		// stale "marker absent" concludes the lever isn't GitLens's and Undo silently does nothing while the
		// config stays enabled.
		return this.withMarkerLock(repoPath, async () => {
			const prior = await this.readGkMarkerUncached(repoPath, markerKey, cancellation);
			if (prior == null) return false;

			await this.restoreLocalConfig(repoPath, configKey, prior, cancellation);
			await this.provider.config.setGkConfig(repoPath, markerKey, undefined);
			return true;
		});
	}

	/** Restores a lever's config to its recorded prior after a failed apply, then drops the ownership marker. */
	private async restorePriorAndClear(
		repoPath: string,
		configKey: string,
		markerKey: GkConfigKeys,
		cancellation?: AbortSignal,
	): Promise<void> {
		const prior = await this.provider.config.getGkConfig(repoPath, markerKey);
		if (prior != null) {
			await this.restoreLocalConfig(repoPath, configKey, prior, cancellation);
		}
		await this.provider.config.setGkConfig(repoPath, markerKey, undefined);
	}

	/** Sets a local config value back to a recorded prior, decoding the `unset`/`empty` sentinels. */
	private async restoreLocalConfig(
		repoPath: string,
		key: string,
		prior: string,
		cancellation?: AbortSignal,
	): Promise<void> {
		if (prior === unsetConfigSentinel) {
			await this.unsetLocalConfig(repoPath, key, cancellation);
		} else if (prior === emptyConfigSentinel) {
			await this.setLocalConfig(repoPath, key, '', cancellation);
		} else {
			await this.setLocalConfig(repoPath, key, prior, cancellation);
		}
	}

	/** Writes a gk marker, swallowing+logging any failure — a marker write must never fail the apply itself. */
	private async markGkConfigSafe(repoPath: string, key: GkConfigKeys, value: string): Promise<void> {
		const scope = getScopedLogger();
		try {
			await this.provider.config.setGkConfig(repoPath, key, value);
		} catch (ex) {
			scope?.error(ex, `Failed to record '${key}' marker`);
		}
	}

	/**
	 * Throws when a run that swallowed its errors (`errors: 'ignore'`) was actually cancelled or never ran.
	 * Such a run resolves with no meaningful exit code, so `completion` — not `exitCode` — is the only thing
	 * that proves a command ran. Without this a timeout reads as a clean success, and a safety probe or an
	 * undo would act on a command that never happened.
	 */
	private throwIfDidNotComplete(result: Pick<GitResult, 'completion'>, cancellation: AbortSignal | undefined): void {
		if (result.completion.status === 'cancelled' || cancellation?.aborted === true) {
			throw new CancellationError();
		}
		// `failed` covers both a queue rejection/spawn failure (`unstarted`) and a signal kill, neither of
		// which produced a trustworthy result — for a maintenance probe both must read as "did not run".
		if (result.completion.status === 'failed') throw new Error('Git command did not run');
	}

	/**
	 * Reads a config key's LOCAL-scope value (independent of global/system config). `undefined` when unset.
	 *
	 * Uses `--get-regex` (anchored to the exact key), not `--get`: `--get` exits 0 with EMPTY stdout for
	 * BOTH a bareword entry (`[section]\n\tkey`, valid syntax, git-boolean TRUE) and an explicit empty value
	 * (`key =`, git-boolean FALSE) — indistinguishable, which would record a bareword-true prior as the
	 * `unset` sentinel and let undo flip the user's true to false. `--get-regex` prints the two differently
	 * (a bareword line has no space; an empty value keeps a trailing one), which `parseConfigRegexOutput`'s
	 * `includeValueless` tells apart; for a multi-valued key it also prints every value in file order, so the
	 * LAST line in the map is still the `--get`-equivalent value.
	 */
	private async getLocalConfig(
		repoPath: string,
		key: string,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const result = await this.git.run(
			{
				cwd: repoPath,
				errors: 'ignore',
				runLocally: true,
				cancellation: cancellation,
				selfMaintenance: true,
			},
			'config',
			'--local',
			'--get-regex',
			`^${escapeRegex(key)}$`,
		);
		this.throwIfDidNotComplete(result, cancellation);
		// An unreadable config must not read back as "unset": that value gets recorded as the lever's prior,
		// so a later undo would DELETE a setting the user had all along instead of restoring it. Exit 1 is
		// git's "no match" — genuinely unset, the same discipline as `--get`.
		if (result.exitCode !== 0 && result.exitCode !== gitConfigGetMissingExitCode) {
			throw new Error(`Unable to read '${key}' (git exited ${result.exitCode})`);
		}
		if (result.exitCode !== 0) return undefined;

		// A bareword line maps to `'true'`, an explicit-empty line to `''` — collapsing either into the
		// other misrecords the prior undo later restores. Deliberately NOT `.trim()`-ed: an explicit-empty
		// line's meaning IS its trailing space, and `.trim()` on the whole (possibly multi-line) stdout
		// strips it whenever that line lands last — `parseConfigRegexOutput` already skips the blank line a
		// trailing newline produces, so no trim is needed. Canonicalize for the lookup: `--get-regex` prints
		// the section + variable name lowercased.
		return parseConfigRegexOutput(result.stdout, { includeValueless: true }).get(canonicalizeGitConfigKey(key));
	}

	/** Sets a LOCAL config value. Throws the git error on a genuine write failure (config refused). */
	private async setLocalConfig(
		repoPath: string,
		key: string,
		value: string,
		cancellation?: AbortSignal,
	): Promise<void> {
		await this.git.run(
			{
				cwd: repoPath,
				errors: 'throw',
				runLocally: true,
				cancellation: cancellation,
				selfMaintenance: true,
			},
			'config',
			'--local',
			key,
			value,
		);
		this.cache.deleteConfig(repoPath, key);
	}

	private async unsetLocalConfig(repoPath: string, key: string, cancellation?: AbortSignal): Promise<void> {
		// `--unset-all` of an absent key exits non-zero; `errors: 'ignore'` swallows that without throwing.
		// It is deliberately not `--unset`, which refuses a multi-valued key with the SAME exit 5 while
		// leaving the values set — indistinguishable from the benign case, so undo would clear its ownership
		// marker with the lever still on. See the exit-code constants above.
		const result = await this.git.run(
			{
				cwd: repoPath,
				errors: 'ignore',
				runLocally: true,
				cancellation: cancellation,
				selfMaintenance: true,
			},
			'config',
			'--local',
			'--unset-all',
			key,
		);
		// ...but so does a cancelled/timed-out run, and so does a genuine write failure. Surface both, so an
		// undo can't clear its ownership marker — handing the lever back to the user as "theirs", with no
		// Undo ever offered again — while the config is in fact still set.
		this.throwIfDidNotComplete(result, cancellation);
		if (result.exitCode !== 0 && result.exitCode !== gitConfigUnsetMissingExitCode) {
			throw new Error(`Unable to unset '${key}' (git exited ${result.exitCode})`);
		}

		this.cache.deleteConfig(repoPath, key);
	}

	/** Best-effort run; returns the result so callers that must distinguish "didn't run" can check it. */
	private async runQuietly(
		repoPath: string,
		cancellation: AbortSignal | undefined,
		...args: string[]
	): Promise<GitResult> {
		return this.git.run(
			{
				cwd: repoPath,
				errors: 'ignore',
				priority: 'background',
				cancellation: cancellation,
				selfMaintenance: true,
			},
			...args,
		);
	}

	private async probeConfig(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<GitHealthSnapshot['config'] & { commitGraphReadDisabled: boolean }> {
		// One `git config --get-regex` for the three levers plus the commit-graph read switch, reading MERGED
		// config — so a key's presence means the user set it somewhere (local, global, or system). Git
		// lowercases the section + variable in the output.
		//
		// Deliberately NOT routed through the config sub-provider's cached helper: that one swallows git
		// errors and resolves an EMPTY map, which is indistinguishable from "none of these keys are set" —
		// and the silent auto tier must never mistake an unreadable config for an unset one and rewrite it.
		// Reading directly keeps the exit code, which tells the two apart.
		const result = await this.runQuietly(
			repoPath,
			cancellation,
			'config',
			'--get-regex',
			'^(core\\.fsmonitor|core\\.untrackedcache|core\\.commitgraph|feature\\.manyfiles)$',
		);
		this.throwIfDidNotComplete(result, cancellation);
		// Exit 1 is git's "no matches" — genuinely unset. Anything else means we couldn't read the
		// config; `getHealthSnapshot` turns the throw into a fail-closed snapshot.
		if (result.exitCode !== 0 && result.exitCode !== gitConfigGetMissingExitCode) {
			throw new Error(`Unable to read git config (git exited ${String(result.exitCode)})`);
		}

		// `includeValueless`: a BAREWORD entry (`core.untrackedCache` with no `=value`) is git's own
		// boolean-true shorthand — a naive parse drops it (no space in the line), misreporting a lever
		// the user has genuinely enabled as both "off" and "unconfigured" (eligible to be re-suggested).
		// An explicit EMPTY value (`core.untrackedCache=`, a deliberate false) is a DIFFERENT, byte-distinct
		// line (it keeps a trailing space) and was already parsed correctly without this option.
		//
		// Deliberately NOT `.trim()`-ed: when the empty-value line lands last, `.trim()` on the whole
		// (possibly multi-line) stdout strips that meaningful trailing space and it misreads as a bareword.
		// `parseConfigRegexOutput` already skips the blank line a trailing newline produces.
		const map = parseConfigRegexOutput(result.stdout, { includeValueless: true });

		return {
			fsmonitor: isFsmonitorEnabled(map.get('core.fsmonitor')),
			untrackedCache: parseGitBoolean(map.get('core.untrackedcache')),
			untrackedCacheConfigured: map.has('core.untrackedcache'),
			manyFiles: parseGitBoolean(map.get('feature.manyfiles')),
			// Explicitly-false only — an unset key means git reads the cache (the default). Surfaced so the
			// Health view can't claim the commit-graph is "maintained by GitLens" when `ensureCommitGraph`
			// honors this same setting as a write opt-out.
			commitGraphReadDisabled:
				map.has('core.commitgraph') && isGitBooleanFalse(map.get('core.commitgraph') ?? ''),
		};
	}

	// The registered-repo list is process-global git state — cache it briefly (invalidated on
	// register/unregister) so N repos probed together read it with one subprocess, not N.
	private _registeredMaintenanceRepos: { at: number; paths: string[] } | undefined;

	/** The global `maintenance.repo` list. Throws rather than reporting an unreadable list as "none". */
	private async readRegisteredMaintenancePaths(repoPath: string, cancellation?: AbortSignal): Promise<string[]> {
		const cached = this._registeredMaintenanceRepos;
		if (cached != null && Date.now() - cached.at <= registeredMaintenanceReposTtlMs) return cached.paths;

		const result = await this.runQuietly(
			repoPath,
			cancellation,
			'config',
			'--global',
			'--get-all',
			'maintenance.repo',
		);
		// An aborted or unreadable list resolves EMPTY under `errors: 'ignore'`. Reading that as "nothing is
		// registered" would both cache a lie and let a revert clear ownership for a still-registered repo.
		// Exit 1 is git's "key not set" — a genuinely empty list.
		this.throwIfDidNotComplete(result, cancellation);
		if (result.exitCode !== 0 && result.exitCode !== gitConfigGetMissingExitCode) {
			throw new Error(`Unable to read registered maintenance repos (git exited ${String(result.exitCode)})`);
		}

		const paths = result.stdout
			.split('\n')
			.map(line => line.trim())
			.filter(line => line !== '');
		this._registeredMaintenanceRepos = { at: Date.now(), paths: paths };
		return paths;
	}

	/**
	 * `git maintenance register` stores the symlink-RESOLVED worktree path, while GitLens deliberately keeps
	 * the symlinked path as the repo path — so match against both spellings.
	 */
	private async matchesRegistered(registered: readonly string[], paths: readonly string[]): Promise<boolean> {
		if (!registered.length) return false;

		const candidates = await this.resolveRegistrationCandidates(paths);
		for (const line of registered) {
			for (const candidate of candidates) {
				if (arePathsEqual(line, candidate)) return true;
			}
		}
		return false;
	}

	/** Each path plus its symlink-resolved spelling — `maintenance register` stores the resolved one. */
	private async resolveRegistrationCandidates(paths: readonly string[]): Promise<string[]> {
		const candidates = new Set(paths);
		for (const path of paths) {
			const real = await realpath(path).catch(() => undefined);
			if (real != null) {
				candidates.add(real);
			}
		}
		return [...candidates];
	}

	/**
	 * Whether ANY worktree of this repo family is registered — the DETECTION question ("should we suggest
	 * this?"). Family-wide, because a sibling the user registered already covers the shared object database,
	 * and suggesting it again would leave two scheduled entries for one repo.
	 */
	private async isMaintenanceRegistered(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const registered = await this.readRegisteredMaintenancePaths(repoPath, cancellation);
		return this.matchesRegistered(registered, await this.resolveWorktreePaths(repoPath, cancellation));
	}

	/**
	 * Whether ONE specific path is registered — the OWNERSHIP question ("did our unregister take?"). Never
	 * ask this family-wide: a sibling the user registered is theirs, and it would block undo forever.
	 */
	private async isPathRegistered(repoPath: string, path: string, cancellation?: AbortSignal): Promise<boolean> {
		const registered = await this.readRegisteredMaintenancePaths(repoPath, cancellation);
		return this.matchesRegistered(registered, [path]);
	}

	// Cached briefly rather than for the session: a worktree added or removed mid-session must become visible
	// to family detection, else a sibling the user registers afterwards is never seen and the repo gets
	// re-suggested for maintenance it already has. The TTL keeps it off the per-probe hot path.
	private readonly _worktreePaths = new Map<string, { at: number; paths: string[] }>();

	/**
	 * Every worktree path of this repo, MAIN FIRST — git's `worktree list` order, which holds regardless of
	 * which worktree it runs from, and lists the repo itself for a bare one.
	 *
	 * `git maintenance register` records the CURRENT worktree's path, so a repo family can accumulate
	 * several `maintenance.repo` entries — several scheduled runs over a single shared object database —
	 * while the `gk.applied.*` ownership marker lives in the shared common git dir and can only describe
	 * one of them. GitLens therefore REGISTERS the main worktree ({@link resolveMaintenanceRepoPath}) but
	 * DETECTS across the whole family, so a registration the user made from a sibling isn't missed.
	 */
	private async resolveWorktreePaths(repoPath: string, cancellation?: AbortSignal): Promise<string[]> {
		// Keyed by the COMMON path: the worktree list is identical for every sibling of a repo family, so a
		// per-worktree key would spawn one `worktree list` per open sibling instead of one per family.
		const cacheKey = this.cache.getCommonPath(repoPath);
		const cached = this._worktreePaths.get(cacheKey);
		if (cached != null && Date.now() - cached.at <= worktreePathsTtlMs) return cached.paths;

		const result = await this.runQuietly(repoPath, cancellation, 'worktree', 'list', '--porcelain');
		// Fall back to the repo path (today's behavior) rather than caching a cancelled or failed read.
		if (result.completion.status !== 'exited' || result.exitCode !== 0 || cancellation?.aborted === true) {
			return [repoPath];
		}

		const paths = result.stdout
			.split('\n')
			.filter(l => l.startsWith('worktree '))
			.map(l => l.slice('worktree '.length).trim())
			.filter(l => l !== '');
		if (!paths.length) return [repoPath];

		this._worktreePaths.set(cacheKey, { at: Date.now(), paths: paths });
		return paths;
	}

	/** The path GitLens registers for background maintenance: the repo's MAIN worktree. */
	private async resolveMaintenanceRepoPath(repoPath: string, cancellation?: AbortSignal): Promise<string> {
		return (await this.resolveWorktreePaths(repoPath, cancellation))[0];
	}

	private async probeCommitGraph(objectsDir: string): Promise<{ present: boolean; mtime: number | undefined }> {
		const infoDir = joinPaths(objectsDir, 'info');
		// A repo may have a single `commit-graph` file OR a split `commit-graphs/` chain dir — either counts.
		const [single, split] = await Promise.allSettled([
			this.statMtime(joinPaths(infoDir, 'commit-graph')),
			this.statMtime(joinPaths(infoDir, 'commit-graphs')),
		]);

		const mtime = getSettledValue(single) ?? getSettledValue(split);
		return { present: mtime != null, mtime: mtime };
	}

	/**
	 * Whether the NEWEST commit-graph layer carries changed-path Bloom filters (the `BIDX` chunk). Only the
	 * newest layer matters here — `--changed-paths` computes filters for the just-written batch, so an older
	 * base layer written without them says nothing about current coverage. Reads only the header + chunk
	 * lookup table (a handful of bytes), never the graph body. Never throws — any failure (missing file, a
	 * malformed chain, a truncated read) reads as "no filters", matching every other probe in this file.
	 */
	private async probeChangedPathFilters(objectsDir: string): Promise<boolean> {
		try {
			const infoDir = joinPaths(objectsDir, 'info');
			const graphPath = await this.resolveNewestCommitGraphLayer(infoDir);
			return await this.hasBloomFilterChunk(graphPath);
		} catch {
			return false;
		}
	}

	/** The newest graph layer's file path: the chain's last-listed layer when split, else the single file. */
	private async resolveNewestCommitGraphLayer(infoDir: string): Promise<string> {
		const chainPath = joinPaths(infoDir, 'commit-graphs', 'commit-graph-chain');
		try {
			const chain = await readFile(chainPath, 'utf8');
			const hashes = chain
				.split('\n')
				.map(line => line.trim())
				.filter(line => line !== '');
			if (hashes.length) {
				return joinPaths(infoDir, 'commit-graphs', `graph-${hashes.at(-1)!}.graph`);
			}
		} catch {
			// No chain (or unreadable) — fall through to the single-file layout.
		}

		return joinPaths(infoDir, 'commit-graph');
	}

	/**
	 * Reads a commit-graph file's fixed 8-byte header (`CGPH` magic, version, hash version, chunk count,
	 * base-graph count) plus the chunk lookup table (`(chunkCount + 1)` entries of 4-byte id + 8-byte
	 * big-endian offset), and reports whether a `BIDX` (Bloom-filter-index) chunk id is present. Bounded to
	 * the header + table only — never reads the graph body.
	 */
	private async hasBloomFilterChunk(graphPath: string): Promise<boolean> {
		let handle;
		try {
			handle = await open(graphPath, 'r');

			const header = Buffer.alloc(8);
			const { bytesRead: headerBytesRead } = await handle.read(header, 0, 8, 0);
			if (headerBytesRead < 8 || header.toString('ascii', 0, 4) !== 'CGPH') return false;

			const chunkCount = header.readUInt8(6);
			const tableLength = (chunkCount + 1) * 12;
			const table = Buffer.alloc(tableLength);
			const { bytesRead: tableBytesRead } = await handle.read(table, 0, tableLength, 8);
			if (tableBytesRead < tableLength) return false;

			for (let i = 0; i <= chunkCount; i++) {
				const offset = i * 12;
				if (table.toString('ascii', offset, offset + 4) === 'BIDX') return true;
			}

			return false;
		} finally {
			await handle?.close().catch(() => {});
		}
	}

	private async probePacks(objectsDir: string): Promise<{ count: number; bytes: number }> {
		const packDir = joinPaths(objectsDir, 'pack');
		let entries: string[];
		try {
			entries = await readdir(packDir);
		} catch {
			return { count: 0, bytes: 0 };
		}

		const packFiles = entries.filter(name => name.endsWith('.pack'));
		const sizes = await Promise.allSettled(packFiles.map(name => this.fileBytes(joinPaths(packDir, name))));
		const bytes = sizes.reduce((sum, r) => sum + (getSettledValue(r) ?? 0), 0);

		return { count: packFiles.length, bytes: bytes };
	}

	private async sampleLooseObjects(
		objectsDir: string,
	): Promise<{ objectsInSampledDirs: number; dirsSampled: number }> {
		const counts = await Promise.allSettled(
			looseObjectSampleDirs.map(async dir => {
				try {
					return (await readdir(joinPaths(objectsDir, dir))).length;
				} catch {
					// A missing fanout dir means ~no objects with that prefix — count it as 0, not skipped.
					return 0;
				}
			}),
		);

		const objectsInSampledDirs = counts.reduce((sum, r) => sum + (getSettledValue(r) ?? 0), 0);
		return { objectsInSampledDirs: objectsInSampledDirs, dirsSampled: looseObjectSampleDirs.length };
	}

	private async statMtime(path: string): Promise<number | undefined> {
		try {
			return (await stat(path)).mtimeMs;
		} catch {
			return undefined;
		}
	}

	private async fileBytes(path: string): Promise<number> {
		try {
			return (await stat(path)).size;
		} catch {
			return 0;
		}
	}

	/**
	 * Reads the exact tracked-file count straight from the index header — `DIRC` signature, version, entry
	 * count, all big-endian, the first 12 bytes of `.git/index` — for free, no `git` invocation needed.
	 * `undefined` on any failure (missing index, short read, wrong signature): never a guess, never a throw.
	 */
	private async probeIndexEntryCount(indexPath: string): Promise<number | undefined> {
		let handle;
		try {
			handle = await open(indexPath, 'r');
			const header = Buffer.alloc(12);
			const { bytesRead } = await handle.read(header, 0, 12, 0);
			if (bytesRead < 12 || header.toString('ascii', 0, 4) !== 'DIRC') return undefined;

			return header.readUInt32BE(8);
		} catch {
			return undefined;
		} finally {
			await handle?.close().catch(() => {});
		}
	}
}
