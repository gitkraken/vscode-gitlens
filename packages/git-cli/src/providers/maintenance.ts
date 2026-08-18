import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { hostname } from 'node:os';
import * as process from 'node:process';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitFeatures } from '@gitlens/git/features.js';
import { gitFeaturesByVersion } from '@gitlens/git/features.js';
import { looseRefsThreshold } from '@gitlens/git/gitHealth.js';
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

/** Stops the ref probe at four times the recommendation threshold: bounded, but still useful for telemetry. */
const looseRefProbeLimit = looseRefsThreshold * 4;

/** Worktree-local ownership journal for the sparse-index command lever. */
const sparseIndexAppliedMarker = 'sparse-index.applied';
const sparseIndexLockFile = 'sparse-index.lock';
const sparseIndexPendingMarker = 'sparse-index.pending';

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
	applied: {
		untrackedCache: false,
		fsmonitor: false,
		manyFiles: false,
		backgroundMaintenance: false,
		sparseIndex: false,
	},
	commitGraphDisabled: false,
};

type ConfigLeverChange = {
	readonly configKey: string;
	readonly markerKey: GkConfigKeys;
	readonly pendingKey: GkConfigKeys;
	readonly value: string;
};

type PendingConfigChange = {
	readonly prior: string;
	readonly value: string;
};

class MarkerLockContentionError extends Error {}

const untrackedCacheChange: ConfigLeverChange = {
	configKey: 'core.untrackedCache',
	markerKey: 'gk.applied.untrackedCache',
	pendingKey: 'gk.pending.untrackedCache',
	value: 'true',
};
const fsmonitorChange: ConfigLeverChange = {
	configKey: 'core.fsmonitor',
	markerKey: 'gk.applied.fsmonitor',
	pendingKey: 'gk.pending.fsmonitor',
	value: 'true',
};
const manyFilesChange: ConfigLeverChange = {
	configKey: 'feature.manyFiles',
	markerKey: 'gk.applied.manyFiles',
	pendingKey: 'gk.pending.manyFiles',
	value: 'true',
};
const skipHashChange: ConfigLeverChange = {
	configKey: 'index.skipHash',
	markerKey: 'gk.applied.skipHash',
	pendingKey: 'gk.pending.skipHash',
	value: 'true',
};
const configLeverChanges: readonly ConfigLeverChange[] = [
	untrackedCacheChange,
	fsmonitorChange,
	manyFilesChange,
	skipHashChange,
];

function encodePendingConfigChange(change: PendingConfigChange): string {
	return JSON.stringify(change);
}

function decodePendingConfigChange(value: string): PendingConfigChange | undefined {
	try {
		const parsed = JSON.parse(value) as Partial<PendingConfigChange>;
		return typeof parsed.prior === 'string' && typeof parsed.value === 'string'
			? { prior: parsed.prior, value: parsed.value }
			: undefined;
	} catch {
		return undefined;
	}
}

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

	request(repoPath: string, task: GitMaintenanceTask): Promise<boolean> | undefined {
		// Only the commit-graph has a demand cadence — its cache is most valuable immediately after a history
		// walk, so graph-load and repo-open hint it and the throttle decides. Other maintenance tasks are owned
		// by the daily pass (a demand write buys nothing there), so they no-op here.
		switch (task) {
			case 'commit-graph':
				return this.ensureCommitGraph(repoPath);
			case 'loose-objects':
			case 'incremental-repack':
			case 'pack-refs':
				return undefined;
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
	 * serializes them; a loser errors and is swallowed. Resolves `true` only when the write completes; the
	 * health service uses that signal for one post-write freshness probe, while graph consumers ignore it.
	 */
	private ensureCommitGraph(repoPath: string): Promise<boolean> {
		// Governed by the auto-tier master switch (`gitlens.gitOptimizations.enabled`), fed into both
		// mapped config slots below.
		if (this.context.config?.maintenance?.enabled === false) return Promise.resolve(false);
		if (this.context.config?.graph?.writeCommitGraph === false) return Promise.resolve(false);

		const lastWrittenAt = this.commitGraphWrittenAt.get(repoPath);
		if (lastWrittenAt != null && Date.now() - lastWrittenAt < commitGraphRefreshIntervalMs) {
			return Promise.resolve(false);
		}

		this.commitGraphWrittenAt.set(repoPath, Date.now());

		return (async () => {
			try {
				if (!(await this.git.supports('git:commit-graph'))) return false;

				// Re-throttle + single-flight on the COMMON git dir so this worktree's write coalesces with
				// its siblings' (they all share the one object database the commit-graph lives in). Resolved
				// via the config sub-provider's cached git-dir, so repeat hints don't re-spawn `rev-parse`.
				const gitDir = await this.provider.config.getGitDir(repoPath).catch(() => undefined);
				const commonKey = gitDir != null ? (gitDir.commonUri ?? gitDir.uri).fsPath : repoPath;
				if (this.commitGraphWriteInflight.has(commonKey)) return false;

				// Skip the common-dir re-throttle when resolution fell back to repoPath itself — the sync
				// gate above JUST stamped that key, so re-checking it here would early-return forever and
				// the write would never run for repos whose git-dir resolve fails.
				if (commonKey !== repoPath) {
					const lastCommonWriteAt = this.commitGraphWrittenAt.get(commonKey);
					if (lastCommonWriteAt != null && Date.now() - lastCommonWriteAt < commitGraphRefreshIntervalMs) {
						return false;
					}

					this.commitGraphWrittenAt.set(commonKey, Date.now());
				}
				this.commitGraphWriteInflight.add(commonKey);
				try {
					if (await this.isCommitGraphWriteDisabled(repoPath)) return false;

					await this.writeCommitGraph(repoPath, true);
					return true;
				} finally {
					this.commitGraphWriteInflight.delete(commonKey);
				}
			} catch {
				// Best-effort acceleration only — never surface failures (shallow/partial clones,
				// read-only repos, ancient gits behind the feature gate, etc.).
				return false;
			}
		})();
	}

	/** Shared opt-out gate for automatic and explicit writes. */
	private async isCommitGraphWriteDisabled(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		// Respect an explicit read opt-out — writing a cache this git will never read is pure waste.
		// `--type=bool` normalizes every falsy spelling Git accepts (`false`/`no`/`off`/`0`). Unset means
		// Git reads the cache; a malformed value isn't false, matching Git's own read behavior.
		const optOut = await this.runQuietly(
			repoPath,
			cancellation,
			'config',
			'--type=bool',
			'--get',
			'core.commitGraph',
		);
		this.throwIfDidNotComplete(optOut, cancellation);
		if (optOut.stdout.trim() === 'false') return true;

		// The per-repository off switch (Git Health), independent of the settings-level auto-tier gates.
		return (await this.provider.config.getGkConfig(repoPath, 'gk.commitGraphDisabled')) === 'true';
	}

	/**
	 * The commit-graph write itself. Always a `--split` write: mere existence isn't enough (a stale or thin
	 * chain — e.g. one auto-gc increment — accelerates nothing); `--split` appends an incremental layer
	 * covering only the uncovered commits (near-no-op when current) and git self-merges layers by its
	 * geometric policy. Background priority: a first write on a huge repo can run for a while and must never
	 * hold a queue slot ahead of interactive work. Throws on failure — callers decide whether to swallow.
	 */
	private async writeCommitGraph(repoPath: string, bounded: boolean, cancellation?: AbortSignal): Promise<void> {
		const partialClone = await this.isPartialClone(repoPath, cancellation);
		const args = ['commit-graph', 'write', '--reachable', bounded || partialClone ? '--split' : '--split=replace'];

		// Changed-path Bloom filters make `git log -- <path>` fast, but computing them for the WHOLE history
		// on a big repo is expensive, so automatic writes seed at most 512 filters. A bounded split write does
		// NOT backfill older layers on later passes; only the explicit task uses an unbounded replace write to
		// provide complete reachable-history coverage. Partial/promisor clones omit filters entirely because
		// computing them needs missing trees and would otherwise lazy-fetch from the network.
		if (!partialClone && (await this.git.supports('git:commit-graph:changed-paths'))) {
			args.push('--changed-paths');
			if (bounded) {
				args.push('--max-new-filters=512');
			}
		}

		await this.git.run(
			{
				cwd: repoPath,
				priority: 'background',
				cancellation: cancellation,
				env: { GIT_NO_LAZY_FETCH: '1' },
				selfMaintenance: true,
			},
			...args,
		);
	}

	/** Config-only partial/promisor detection; never examines an object and therefore cannot itself lazy-fetch. */
	private async isPartialClone(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const result = await this.runQuietly(
			repoPath,
			cancellation,
			'config',
			'--local',
			'--get-regex',
			'^(extensions\\.partialclone|remote\\..*\\.promisor)$',
		);
		this.throwIfDidNotComplete(result, cancellation);
		if (result.exitCode !== 0 && result.exitCode !== gitConfigGetMissingExitCode) {
			throw new Error(`Unable to detect a partial clone (git exited ${String(result.exitCode)})`);
		}
		if (result.exitCode !== 0) return false;

		const config = parseConfigRegexOutput(result.stdout, { includeValueless: true });
		for (const [key, value] of config) {
			if (key === 'extensions.partialclone' || (key.endsWith('.promisor') && parseGitBoolean(value))) {
				return true;
			}
		}
		return false;
	}

	@debug()
	async getHealthSnapshot(repoPath: string, cancellation?: AbortSignal): Promise<GitHealthSnapshot> {
		await this.reconcilePendingConfigChanges(repoPath, cancellation);

		const gitDir = await this.provider.config.getGitDir(repoPath);
		// Object store lives in the COMMON git dir (shared across worktrees); the index is per-worktree.
		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const objectsDir = joinPaths(commonGitDir, 'objects');
		const indexPath = joinPaths(gitDir.uri.fsPath, 'index');

		const [
			commitGraphStat,
			multiPackIndex,
			packs,
			looseObjects,
			indexBytes,
			indexEntryCount,
			sharedIndex,
			conflictOperation,
			config,
			maintenanceRegistered,
			gkMarkers,
			supportsMaintenanceRun,
			changedPaths,
			changedPathsFeatureSupported,
			shallowRepository,
			partialClone,
			looseRefs,
			supportsPackRefsMaintenance,
		] = await Promise.allSettled([
			this.probeCommitGraph(objectsDir),
			fsExists(joinPaths(objectsDir, 'pack', 'multi-pack-index')),
			this.probePacks(objectsDir),
			this.sampleLooseObjects(objectsDir),
			this.fileBytes(indexPath),
			this.probeIndexEntryCount(indexPath),
			this.probeSharedIndex(gitDir.uri.fsPath),
			this.probeConflictOperation(gitDir.uri.fsPath),
			this.probeConfig(repoPath, cancellation),
			this.isMaintenanceRegistered(repoPath, cancellation),
			this.probeGkMarkers(repoPath),
			this.git.supports('git:maintenance'),
			this.probeChangedPathFilters(objectsDir),
			this.git.supports('git:commit-graph:changed-paths'),
			this.probePathPresence(joinPaths(commonGitDir, 'shallow')),
			this.isPartialClone(repoPath, cancellation),
			this.probeLooseRefs(joinPaths(commonGitDir, 'refs')),
			this.git.supports('git:maintenance:pack-refs'),
		]);

		const markers = getSettledValue(gkMarkers) ?? emptyGkMarkers;
		const configValue = getSettledValue(config);
		const sparseIndexState = await this.reconcileSparseIndexMarkers(
			repoPath,
			gitDir.uri.fsPath,
			configValue?.sparseIndex,
			cancellation,
		).catch(() => ({ enabled: configValue?.sparseIndex, applied: false }));
		const rawIndexBytes = getSettledValue(indexBytes) ?? 0;
		const rawIndexEntryCount = getSettledValue(indexEntryCount);
		const sharedIndexValue = getSettledValue(sharedIndex);
		const conflictOperationValue = getSettledValue(conflictOperation);
		const splitIndex =
			configValue?.splitIndex === true || sharedIndexValue?.present === true
				? true
				: configValue != null && sharedIndexValue != null
					? false
					: undefined;
		const indexEntryCountType: GitHealthSnapshot['indexEntryCountType'] =
			configValue == null ||
			rawIndexEntryCount == null ||
			sharedIndexValue == null ||
			conflictOperationValue == null
				? 'unavailable'
				: splitIndex
					? 'split'
					: conflictOperationValue
						? 'conflicted'
						: sparseIndexState.enabled
							? 'sparse'
							: 'full';
		return {
			repository: {
				shallow: getSettledValue(shallowRepository),
				partial: getSettledValue(partialClone),
				sparseCheckout: configValue?.sparseCheckout,
				sparseCheckoutCone: configValue?.sparseCheckoutCone,
				sparseIndex: sparseIndexState.enabled,
				splitIndex: splitIndex,
				refFormat: configValue?.refFormat ?? 'unknown',
			},
			looseRefs: getSettledValue(looseRefs) ?? { count: 0, exact: false },
			commitGraph: {
				...(getSettledValue(commitGraphStat) ?? { present: false, mtime: undefined }),
				changedPaths: getSettledValue(changedPaths) ?? false,
				changedPathsSupported:
					getSettledValue(changedPathsFeatureSupported) === true && getSettledValue(partialClone) === false,
				disabled: markers.commitGraphDisabled,
				readDisabled: configValue?.commitGraphReadDisabled ?? false,
			},
			multiPackIndex: getSettledValue(multiPackIndex) ?? false,
			packCount: getSettledValue(packs)?.count ?? 0,
			packBytes: getSettledValue(packs)?.bytes ?? 0,
			looseObjects: getSettledValue(looseObjects) ?? { objectsInSampledDirs: 0, dirsSampled: 0 },
			// The main file is only the mutable layer of a split index. Include its largest shared base so the
			// byte-size fallback remains a useful working-tree signal instead of classifying it from a tiny delta.
			indexBytes: rawIndexBytes + (indexEntryCountType === 'split' ? (sharedIndexValue?.bytes ?? 0) : 0),
			indexEntryCount:
				indexEntryCountType === 'full' || indexEntryCountType === 'sparse' ? rawIndexEntryCount : undefined,
			indexEntryCountType: indexEntryCountType,
			// `untrackedCacheConfigured: true` on failure — see `probeConfig`, the auto tier must not guess.
			config: configValue ?? {
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
			applied: { ...markers.applied, sparseIndex: sparseIndexState.applied },
			supportsMaintenanceRun: getSettledValue(supportsMaintenanceRun) ?? false,
			supportsPackRefsMaintenance: getSettledValue(supportsPackRefsMaintenance) ?? false,
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
				sparseIndex: false,
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

		const [
			untrackedCacheResult,
			fsmonitorResult,
			backgroundMaintenanceResult,
			manyFilesResult,
			skipHashResult,
			sparseIndexResult,
		] = await Promise.allSettled([
			this.git.supports('git:untrackedCache'),
			fsmonitorFeature != null ? this.git.supports(fsmonitorFeature) : false,
			this.git.supports(maintenanceStartFeature),
			this.git.supports('git:manyFiles'),
			this.git.supports('git:index:skipHash'),
			this.git.supports('git:sparse-index'),
		]);

		const untrackedCache = getSettledValue(untrackedCacheResult) ?? false;
		const fsmonitor = getSettledValue(fsmonitorResult) ?? false;
		const backgroundMaintenance = getSettledValue(backgroundMaintenanceResult) ?? false;
		const manyFiles = getSettledValue(manyFilesResult) ?? false;
		const skipHash = getSettledValue(skipHashResult) ?? false;
		const sparseIndex = getSettledValue(sparseIndexResult) ?? false;

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
				// On Git 2.40+, feature.manyFiles also enables index.skipHash. Its zeroed trailing hash may not
				// be understood by older Git versions or common third-party index readers.
				note:
					manyFiles && skipHash
						? 'Also enables index.skipHash — Git before 2.40 reports the zeroed hash as corrupt, and some libgit2- and JGit-based tools may reject or misdiagnose the index'
						: undefined,
			},
			{
				id: 'sparseIndex',
				supported: sparseIndex,
				reason: sparseIndex ? undefined : requiresGit('git:sparse-index'),
				note: sparseIndex
					? 'Older Git versions and some tools that read the index directly do not understand sparse-directory entries'
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
			if (await this.isCommitGraphWriteDisabled(repoPath, cancellation)) return false;

			await this.writeCommitGraph(repoPath, false, cancellation);
			return true;
		}

		const maintenanceFeature = task === 'pack-refs' ? 'git:maintenance:pack-refs' : 'git:maintenance';
		if (!(await this.git.supports(maintenanceFeature))) return false;

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
		await this.reconcilePendingConfigChanges(repoPath, cancellation);

		switch (id) {
			case 'untrackedCache':
				return this.applyUntrackedCache(repoPath, cancellation);
			case 'fsmonitor':
				return this.applyFsmonitor(repoPath, cancellation);
			case 'backgroundMaintenance':
				return this.startBackgroundMaintenance(repoPath, cancellation);
			case 'manyFiles':
				return this.applyManyFiles(repoPath, cancellation);
			case 'sparseIndex':
				return this.applySparseIndex(repoPath, cancellation);
		}
	}

	@debug()
	async revertOptimization(repoPath: string, id: GitOptimizationId, cancellation?: AbortSignal): Promise<void> {
		await this.reconcilePendingConfigChanges(repoPath, cancellation);

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
			case 'sparseIndex':
				await this.revertSparseIndex(repoPath, cancellation);
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

			return this.applyConfigChangesUnlocked(repoPath, [untrackedCacheChange], cancellation);
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

		if ((await this.probeConfig(repoPath, cancellation)).fsmonitor) return false;

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

		const applied = await this.withMarkerLock(repoPath, async () => {
			await this.reconcilePendingConfigChangesUnlocked(repoPath, cancellation);
			if ((await this.probeConfig(repoPath, cancellation)).fsmonitor) return false;

			return this.applyConfigChangesUnlocked(repoPath, [fsmonitorChange], cancellation);
		});
		if (!applied) return false;

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

		// `feature.manyFiles` implies index v4 + untracked cache; add `index.skipHash` explicitly where
		// the installed git supports it (2.40+) for the extra index-write speedup. Both writes and both
		// ownership markers share one transaction so any failed write/marker restores the whole new state.
		const changes: ConfigLeverChange[] = [manyFilesChange];
		if (await this.git.supports('git:index:skipHash')) {
			changes.push(skipHashChange);
		}

		// feature.manyFiles only DEFAULTS the untracked cache on. Respect an explicit true/false/keep (and
		// avoid probing a bareword, which makes update-index fatal); only an unset key needs the same
		// filesystem-correctness probe as the standalone lever. Re-check under the marker lock so a config
		// change during the potentially slow probe cannot make this decision stale.
		const initialConfig = await this.probeConfig(repoPath, cancellation);

		// A repo already marked not-applicable must not re-run the multi-second filesystem probe on every
		// attempt — an explicit `core.untrackedCache` still overrides the marker, same as below.
		if (
			!initialConfig.untrackedCacheConfigured &&
			(await this.provider.config.getGkConfig(repoPath, 'gk.untrackedCacheNotApplicable')) === 'true'
		) {
			return false;
		}

		const initialSupport = initialConfig.untrackedCacheConfigured
			? undefined
			: await this.testUntrackedCacheSupport(repoPath, cancellation);
		return this.withMarkerLock(repoPath, async () => {
			await this.reconcilePendingConfigChangesUnlocked(repoPath, cancellation);
			const localManyFiles = await this.getLocalConfig(repoPath, manyFilesChange.configKey, cancellation);
			const manyFilesMarker = await this.readGkMarkerUncached(repoPath, manyFilesChange.markerKey, cancellation);
			if (parseGitBoolean(localManyFiles) && manyFilesMarker == null) return false;

			const currentConfig = await this.probeConfig(repoPath, cancellation);
			if (!currentConfig.untrackedCacheConfigured) {
				const supported = initialSupport ?? (await this.testUntrackedCacheSupport(repoPath, cancellation));
				if (!supported) {
					await this.markGkConfigSafe(repoPath, 'gk.untrackedCacheNotApplicable', 'true');
					return false;
				}
			}

			return this.applyConfigChangesUnlocked(repoPath, changes, cancellation);
		});
	}

	/** Enables sparse-directory index entries for an existing cone-mode sparse checkout. */
	private async applySparseIndex(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		if (!(await this.git.supports('git:sparse-index'))) return false;

		const gitDir = await this.provider.config.getGitDir(repoPath);
		const markerPaths = this.getSparseIndexMarkerPaths(gitDir.uri.fsPath);
		return this.withMarkerLock(
			repoPath,
			async () => {
				const config = await this.probeConfig(repoPath, cancellation);
				const current = await this.reconcileSparseIndexMarkersUnlocked(markerPaths, config.sparseIndex);
				if (current.enabled) return current.applied;
				if (!config.sparseCheckout || !config.sparseCheckoutCone) return false;

				const [sharedIndex, conflictOperation] = await Promise.all([
					this.probeSharedIndex(gitDir.uri.fsPath),
					this.probeConflictOperation(gitDir.uri.fsPath),
				]);
				if (sharedIndex?.present === true || conflictOperation) return false;

				await mkdir(markerPaths.dir, { recursive: true });
				const pending = await open(markerPaths.pending, 'wx');
				await pending.close();

				try {
					await this.runSparseCheckoutReapply(repoPath, true, cancellation);
					const completed = await this.reconcileSparseIndexMarkersUnlocked(markerPaths, true);
					return completed.enabled && completed.applied;
				} catch (ex) {
					try {
						// The command can fail after replacing its config/index locks. Repair ownership from the
						// resulting state without the cancelled signal so a successful mutation never loses Undo.
						const repaired = await this.reconcileSparseIndexMarkersUnlocked(
							markerPaths,
							await this.probeSparseIndexEnabled(repoPath),
						);
						if (repaired.enabled && repaired.applied) return true;
					} catch (repairEx) {
						const error = new Error('Unable to enable the sparse index or reconcile its ownership record', {
							cause: ex,
						}) as Error & { errors: unknown[] };
						error.errors = [repairEx];
						throw error;
					}
					throw ex;
				}
			},
			undefined,
			markerPaths,
		);
	}

	/** Expands a sparse index only when this worktree's marker proves GitLens enabled it. */
	private async revertSparseIndex(repoPath: string, cancellation?: AbortSignal): Promise<void> {
		const gitDir = await this.provider.config.getGitDir(repoPath);
		const markerPaths = this.getSparseIndexMarkerPaths(gitDir.uri.fsPath);
		await this.withMarkerLock(
			repoPath,
			async () => {
				const current = await this.reconcileSparseIndexMarkersUnlocked(
					markerPaths,
					await this.probeSparseIndexEnabled(repoPath, cancellation),
				);
				if (!current.applied) return;

				try {
					await this.runSparseCheckoutReapply(repoPath, false, cancellation);
					await rm(markerPaths.applied, { force: true });
				} catch (ex) {
					try {
						const repaired = await this.reconcileSparseIndexMarkersUnlocked(
							markerPaths,
							await this.probeSparseIndexEnabled(repoPath),
						);
						if (!repaired.enabled && !repaired.applied) return;
					} catch (repairEx) {
						const error = new Error(
							'Unable to disable the sparse index or reconcile its ownership record',
							{
								cause: ex,
							},
						) as Error & { errors: unknown[] };
						error.errors = [repairEx];
						throw error;
					}
					throw ex;
				}
			},
			undefined,
			markerPaths,
		);
	}

	private async runSparseCheckoutReapply(
		repoPath: string,
		enabled: boolean,
		cancellation?: AbortSignal,
	): Promise<void> {
		await this.git.run(
			{
				cwd: repoPath,
				errors: 'throw',
				priority: 'background',
				cancellation: cancellation,
				selfMaintenance: true,
			},
			'sparse-checkout',
			'reapply',
			enabled ? '--sparse-index' : '--no-sparse-index',
		);
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

	/**
	 * Reconciles write-ahead records left by an interrupted direct config mutation. The cached namespace read
	 * keeps the normal probe free of extra subprocesses; an actual pending record is re-read under the marker
	 * lock before it is finalized or cleared.
	 */
	private async reconcilePendingConfigChanges(repoPath: string, cancellation?: AbortSignal): Promise<void> {
		const markers = await this.provider.config.getGkConfigRegex(repoPath, '^gk\\.pending\\.');
		if (!configLeverChanges.some(change => markers.has(canonicalizeGitConfigKey(change.pendingKey)))) return;

		await this.withMarkerLock(repoPath, () => this.reconcilePendingConfigChangesUnlocked(repoPath, cancellation));
	}

	/** Body of {@link reconcilePendingConfigChanges} for a caller already holding the marker lock. */
	private async reconcilePendingConfigChangesUnlocked(repoPath: string, cancellation?: AbortSignal): Promise<void> {
		for (const change of configLeverChanges) {
			const raw = await this.readGkMarkerUncached(repoPath, change.pendingKey, cancellation);
			if (raw == null) continue;

			const pending = decodePendingConfigChange(raw);
			if (pending == null || pending.value !== change.value) {
				// A malformed record can't be reconciled into an ownership marker — drop it rather than throw,
				// which would otherwise wedge every future health snapshot/apply/revert on this repo. Failing
				// toward "not GitLens's" is the safe direction: the user keeps whatever config exists, GitLens
				// just never offers Undo for it.
				await this.provider.config.setGkConfig(repoPath, change.pendingKey, undefined);
				continue;
			}

			const applied = await this.readGkMarkerUncached(repoPath, change.markerKey, cancellation);
			if (applied == null) {
				const current = await this.getLocalConfig(repoPath, change.configKey, cancellation);
				if (current === pending.value) {
					await this.provider.config.setGkConfig(repoPath, change.markerKey, pending.prior);
				}
			}

			// If the intended value never landed (or a user changed it afterward), leave the config untouched and
			// drop only the uncommitted journal record. If it did land, ownership was finalized above first.
			await this.provider.config.setGkConfig(repoPath, change.pendingKey, undefined);
		}
	}

	/**
	 * Applies direct config levers for a caller holding the ownership-marker lock. A write-ahead record closes
	 * the crash gap between the local config and ownership files; an ordinary failure restores every config
	 * value and marker without cancellation.
	 */
	private async applyConfigChangesUnlocked(
		repoPath: string,
		changes: readonly ConfigLeverChange[],
		cancellation?: AbortSignal,
	): Promise<boolean> {
		await this.reconcilePendingConfigChangesUnlocked(repoPath, cancellation);

		const states: {
			readonly change: ConfigLeverChange;
			readonly prior: string;
			readonly rollbackPrior: string;
			readonly alreadyOwned: boolean;
		}[] = [];
		let alreadyApplied = false;
		for (const change of changes) {
			const marker = await this.readGkMarkerUncached(repoPath, change.markerKey, cancellation);
			const current = await this.getLocalConfig(repoPath, change.configKey, cancellation);
			if (current === change.value) {
				alreadyApplied ||= marker != null;
				continue;
			}

			const rollbackPrior =
				current == null ? unsetConfigSentinel : current === '' ? emptyConfigSentinel : current;
			if (marker != null) {
				states.push({
					change: change,
					prior: marker,
					rollbackPrior: rollbackPrior,
					alreadyOwned: true,
				});
				continue;
			}

			states.push({
				change: change,
				prior: rollbackPrior,
				rollbackPrior: rollbackPrior,
				alreadyOwned: false,
			});
		}
		if (states.length === 0) return alreadyApplied;

		const written: typeof states = [];
		const marked: typeof states = [];
		const pending = new Set<(typeof states)[number]>();
		try {
			for (const state of states) {
				if (state.alreadyOwned) continue;

				await this.provider.config.setGkConfig(
					repoPath,
					state.change.pendingKey,
					encodePendingConfigChange({ prior: state.prior, value: state.change.value }),
				);
				pending.add(state);
			}

			for (const state of states) {
				await this.setLocalConfig(repoPath, state.change.configKey, state.change.value, cancellation);
				written.push(state);
			}

			for (const state of states) {
				if (state.alreadyOwned) continue;

				await this.provider.config.setGkConfig(repoPath, state.change.markerKey, state.prior);
				marked.push(state);
			}

			for (const state of pending) {
				await this.provider.config.setGkConfig(repoPath, state.change.pendingKey, undefined);
				pending.delete(state);
			}
			return true;
		} catch (ex) {
			const rollbackErrors: unknown[] = [];
			for (const state of written.toReversed()) {
				try {
					await this.restoreLocalConfig(repoPath, state.change.configKey, state.rollbackPrior);
				} catch (rollbackEx) {
					rollbackErrors.push(rollbackEx);
				}
			}
			for (const state of marked.toReversed()) {
				try {
					await this.provider.config.setGkConfig(repoPath, state.change.markerKey, undefined);
				} catch (rollbackEx) {
					rollbackErrors.push(rollbackEx);
				}
			}
			for (const state of pending) {
				try {
					await this.provider.config.setGkConfig(repoPath, state.change.pendingKey, undefined);
				} catch (rollbackEx) {
					rollbackErrors.push(rollbackEx);
				}
			}

			if (rollbackErrors.length) {
				const error = new Error(
					'Unable to apply Git maintenance settings and completely restore their prior values',
					{ cause: ex },
				) as Error & { errors: unknown[] };
				error.errors = rollbackErrors;
				throw error;
			}
			throw ex;
		}
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

	private getSparseIndexMarkerPaths(gitDirPath: string): {
		readonly dir: string;
		readonly applied: string;
		readonly contention: 'sparseIndex';
		readonly lock: string;
		readonly pending: string;
	} {
		const dir = joinPaths(gitDirPath, 'gk');
		return {
			dir: dir,
			applied: joinPaths(dir, sparseIndexAppliedMarker),
			contention: 'sparseIndex',
			lock: joinPaths(dir, sparseIndexLockFile),
			pending: joinPaths(dir, sparseIndexPendingMarker),
		};
	}

	/**
	 * Reconciles the sparse-index command's worktree-local write-ahead marker. The fast path is filesystem
	 * only; a pending or stale-applied marker takes the worktree's sparse-index operation lock and re-reads
	 * Git config before mutating anything, so it cannot act on a snapshot that raced another window's
	 * apply/undo. A live operation keeps that lock across the index rewrite, but snapshots never wait for it:
	 * they return the last committed marker state until the operation publishes its result.
	 */
	private async reconcileSparseIndexMarkers(
		repoPath: string,
		gitDirPath: string,
		knownEnabled: boolean | undefined,
		cancellation?: AbortSignal,
	): Promise<{ enabled: boolean | undefined; applied: boolean }> {
		const markerPaths = this.getSparseIndexMarkerPaths(gitDirPath);
		const [pending, applied] = await Promise.all([fsExists(markerPaths.pending), fsExists(markerPaths.applied)]);
		if (knownEnabled == null) return { enabled: undefined, applied: false };
		if (!pending && (!applied || knownEnabled)) {
			return { enabled: knownEnabled, applied: applied && knownEnabled };
		}

		try {
			return await this.withMarkerLock(
				repoPath,
				async () =>
					this.reconcileSparseIndexMarkersUnlocked(
						markerPaths,
						await this.probeSparseIndexEnabled(repoPath, cancellation),
					),
				{ retryMs: 0, maxAttempts: 0 },
				markerPaths,
			);
		} catch (ex) {
			if (!(ex instanceof MarkerLockContentionError)) throw ex;

			// The config probe is the truthful state even if the lock holder crashed after changing it. Marker
			// presence only proves ownership while that config is still enabled; reconciliation can resume after
			// the live operation finishes or a positively dead owner's lock is removed manually.
			return { enabled: knownEnabled, applied: applied && knownEnabled };
		}
	}

	/** Body of {@link reconcileSparseIndexMarkers} for a caller already holding the ownership lock. */
	private async reconcileSparseIndexMarkersUnlocked(
		markerPaths: { readonly dir: string; readonly applied: string; readonly pending: string },
		enabled: boolean,
	): Promise<{ enabled: boolean; applied: boolean }> {
		const pending = await fsExists(markerPaths.pending);
		let applied = await fsExists(markerPaths.applied);
		if (pending) {
			if (enabled) {
				await mkdir(markerPaths.dir, { recursive: true });
				if (applied) {
					await rm(markerPaths.pending, { force: true });
				} else {
					await rename(markerPaths.pending, markerPaths.applied);
					applied = true;
				}
			} else {
				await rm(markerPaths.pending, { force: true });
			}
		}

		if (applied && !enabled) {
			await rm(markerPaths.applied, { force: true });
			applied = false;
		}

		return { enabled: enabled, applied: applied };
	}

	/** Reads the effective worktree-scoped sparse-index switch without relying on a cached config map. */
	private async probeSparseIndexEnabled(repoPath: string, cancellation?: AbortSignal): Promise<boolean> {
		const result = await this.runQuietly(repoPath, cancellation, 'config', '--bool', '--get', 'index.sparse');
		this.throwIfDidNotComplete(result, cancellation);
		if (result.exitCode === gitConfigGetMissingExitCode) return false;
		if (result.exitCode !== 0) {
			throw new Error(`Unable to read 'index.sparse' (git exited ${String(result.exitCode)})`);
		}

		return parseGitBoolean(result.stdout);
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
	 * Runs `fn` holding an exclusive on-disk lock over one ownership-marker scope. By default that is the
	 * repository family's config-marker scope; callers can provide a worktree-local lock location for an
	 * operation whose state is isolated per worktree. Two layers make this safe across processes:
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
	 * observation can authorize mutation. Recovery is a guided MANUAL step instead: a give-up runs the same PID
	 * probe ONCE, purely to choose the error's wording. For the sparse-operation lock, a confirmed-live owner gets
	 * wait-only guidance, a confirmed-dead owner gets crash-recovery guidance, and an unverifiable owner gets the
	 * lock path plus guarded manual-recovery guidance. The shared marker lock retains its generic non-dead error.
	 * No verdict authorizes an automatic steal.
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
		// `retryMs`/`maxAttempts` define the acquisition policy; health snapshots deliberately use zero retries
		// for the sparse operation lock. The remaining callbacks are test seams: `probeOwner` replaces the real
		// PID probe, `writeRecord` forces post-open setup failures, and `openLock` forces acquisition failures.
		timings?: {
			retryMs?: number;
			maxAttempts?: number;
			probeOwner?: (owner: { host: string; pid: number }) => 'alive' | 'dead' | 'unverifiable';
			writeRecord?: (handle: FileHandle) => Promise<void>;
			openLock?: (lockPath: string) => Promise<FileHandle>;
		},
		lockLocation?: { readonly dir: string; readonly contention?: 'sparseIndex'; readonly lock: string },
	): Promise<T> {
		const retryMs = timings?.retryMs ?? markerLockRetryMs;
		const maxAttempts = timings?.maxAttempts ?? markerLockMaxAttempts;

		const dir = lockLocation?.dir ?? (await this.getGkDir(repoPath));
		const lockPath = lockLocation?.lock ?? joinPaths(dir, 'applied.lock');
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
						throw new MarkerLockContentionError(
							lockLocation?.contention === 'sparseIndex'
								? `A previous VS Code window appears to have crashed while updating the sparse index. ` +
										`Delete '${lockPath}' to recover.`
								: `A previous VS Code window appears to have crashed while updating Git maintenance ` +
										`settings. Delete '${lockPath}' to recover.`,
							{ cause: ex },
						);
					}
					if (lockLocation?.contention === 'sparseIndex' && verdict === 'alive') {
						throw new MarkerLockContentionError(
							'A sparse-index update is still in progress. Wait for it to finish and try again.',
							{ cause: ex },
						);
					}

					throw new MarkerLockContentionError(
						lockLocation?.contention === 'sparseIndex'
							? `Could not verify whether another window is still updating the sparse index. If no ` +
									`update is in progress, delete '${lockPath}' and try again.`
							: `Another window is currently updating Git maintenance settings. If no other VS Code ` +
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
	 * `withMarkerLock`'s doc comment for why a verdict never causes an automatic steal. Returns 'dead' only when
	 * the OS kill-probe returns `ESRCH`, 'alive' when it succeeds, and 'unverifiable' for unreadable/malformed
	 * content, a lock recorded on another host, or a probe that fails with anything but `ESRCH`.
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
	): Promise<
		GitHealthSnapshot['config'] & {
			commitGraphReadDisabled: boolean;
			refFormat: GitHealthSnapshot['repository']['refFormat'];
			sparseCheckout: boolean;
			sparseCheckoutCone: boolean;
			sparseIndex: boolean;
			splitIndex: boolean;
		}
	> {
		// One `git config --get-regex` for the levers, commit-graph read switch, and index shape, reading
		// MERGED config — so a key's presence means the user set it somewhere (local, worktree, global, or
		// system). Git lowercases the section + variable in the output.
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
			'^(core\\.fsmonitor|core\\.untrackedcache|core\\.commitgraph|core\\.sparsecheckout|core\\.sparsecheckoutcone|core\\.splitindex|extensions\\.refstorage|feature\\.manyfiles|index\\.sparse)$',
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
			refFormat:
				map.get('extensions.refstorage') == null
					? 'files'
					: map.get('extensions.refstorage') === 'reftable'
						? 'reftable'
						: 'unknown',
			sparseCheckout: parseGitBoolean(map.get('core.sparsecheckout')),
			sparseCheckoutCone: parseGitBoolean(map.get('core.sparsecheckoutcone')),
			sparseIndex: parseGitBoolean(map.get('index.sparse')),
			splitIndex: parseGitBoolean(map.get('core.splitindex')),
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

	/**
	 * Counts loose refs without traversing past the point where the recommendation decision is already made.
	 * `readDirectory` is a test seam for deterministic ref-layout races between parent and child reads.
	 */
	private async probeLooseRefs(
		refsDir: string,
		readDirectory: (dir: string) => Promise<Dirent[]> = dir => readdir(dir, { withFileTypes: true }),
	): Promise<{ count: number; exact: boolean }> {
		const pending = [refsDir];
		let count = 0;
		while (pending.length !== 0) {
			const dir = pending.pop()!;
			let entries: Dirent[];
			try {
				entries = await readDirectory(dir);
			} catch (ex) {
				const code = (ex as { code?: unknown }).code;
				if (code === 'ENOENT' || (dir !== refsDir && code === 'ENOTDIR')) {
					if (dir === refsDir) return { count: 0, exact: true };

					// Ref updates can remove a child directory or replace it with a same-named ref after its
					// parent was listed. It contributes no child refs now, so continue the bounded walk.
					continue;
				}

				throw ex;
			}

			for (const entry of entries) {
				if (entry.isDirectory()) {
					pending.push(joinPaths(dir, entry.name));
					continue;
				}
				// Lock files are transient coordination state, not refs `pack-refs` can optimize.
				if (entry.name.endsWith('.lock')) continue;

				count++;
				if (count >= looseRefProbeLimit) return { count: count, exact: false };
			}
		}

		return { count: count, exact: true };
	}

	private async statMtime(path: string): Promise<number | undefined> {
		try {
			return (await stat(path)).mtimeMs;
		} catch {
			return undefined;
		}
	}

	/** Presence probe that distinguishes a missing path from an unreadable one. */
	private async probePathPresence(path: string): Promise<boolean> {
		try {
			await stat(path);
			return true;
		} catch (ex) {
			if ((ex as { code?: unknown }).code === 'ENOENT') return false;

			throw ex;
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
	 * Reads the index entry count straight from the index header — `DIRC` signature, version, entry count,
	 * all big-endian, the first 12 bytes of `.git/index` — for free, no `git` invocation needed.
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

	/**
	 * Conservative split-index detection without spawning git or scanning index bodies. A shared-index file
	 * proves this worktree uses split indexes; its largest base file is included in the byte-size proxy. Stale
	 * bases can only make that explicitly-approximate signal larger.
	 */
	private async probeSharedIndex(gitDir: string): Promise<{ present: boolean; bytes: number } | undefined> {
		try {
			const names = (await readdir(gitDir)).filter(name => name.startsWith('sharedindex.'));
			const sizes = await Promise.all(names.map(name => this.fileBytes(joinPaths(gitDir, name))));
			return { present: names.length > 0, bytes: Math.max(0, ...sizes) };
		} catch {
			return undefined;
		}
	}

	/**
	 * Conflict stages duplicate paths in the header count. Operation-state files conservatively suppress the
	 * exact claim without an unconditional `ls-files --unmerged` index scan on every staging event.
	 */
	private async probeConflictOperation(gitDir: string): Promise<boolean> {
		const states = await Promise.all([
			fsExists(joinPaths(gitDir, 'MERGE_HEAD')),
			fsExists(joinPaths(gitDir, 'CHERRY_PICK_HEAD')),
			fsExists(joinPaths(gitDir, 'REVERT_HEAD')),
			fsExists(joinPaths(gitDir, 'rebase-merge')),
			fsExists(joinPaths(gitDir, 'rebase-apply')),
		]);
		return states.some(Boolean);
	}
}
