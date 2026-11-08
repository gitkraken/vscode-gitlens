import { raceWithTimeout } from '@gitlens/utils/cancellation.js';
import { joinPaths } from '@gitlens/utils/path.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import type { Cache } from '../cache.js';
import { FileType } from '../context.js';
import type { RepositoryChange } from '../models/repository.js';
import { isIgnoredWorktreeEntry, parseWorktreeAdminPath } from '../utils/repository.utils.js';
import { allWatchedRepositoryChanges, classifyGitDirChange } from './classifyChange.js';
import type { GitDirProbe } from './gitDirPoller.js';
import { GitDirProbeTarget } from './gitDirPoller.js';
import { gitDirCommonProbes, gitDirRootProbes } from './watcherPatterns.js';
import { isNotFound } from './watchGroup.js';
import { defaultRepoDelay } from './watchSession.js';

type ProbeStat = { readonly mtime: number; readonly size: number };
/** The stats of one validation, by absolute path, shared by every git dir it reads */
type StatMemo = Map<string, Promise<ProbeStat | undefined>>;
/** The reading of a path whose stat failed; never a whole second, so never racy */
const unreadable: ProbeStat = { mtime: -1, size: -1 };

export interface UnwatchedCacheValidatorOptions {
	readonly cache: Cache;
	/** A path's modification time (ms since the epoch) and size; `undefined` when it doesn't exist */
	readonly stat: (path: string) => Promise<ProbeStat | undefined>;
	/** A directory's entries with their `FileType`s; a rejection whose `code` is `ENOENT` or `FileNotFound` means it isn't there */
	readonly readDirectory: (path: string) => Promise<readonly (readonly [string, number])[]>;
	/** A file's bytes; `undefined` when it doesn't exist. Without it, no worktree is ignored */
	readonly readFile?: (path: string) => Promise<Uint8Array | undefined>;
	/**
	 * The absolute, normalized folders whose worktrees core ignores (see `GitProvider.getIgnoredWorktreeRoots`), asked
	 * with a `repoPath` whose git dir the cache holds; a worktree in one is left out of the worktree list, so what moves
	 * in its admin entry changes nothing cached. A rejection means none is ignored
	 */
	readonly getIgnoredWorktreeRoots?: (repoPath: string) => Promise<readonly string[]>;
	/**
	 * Caches `repoPath`'s git dir without running git, for a repository nothing resolved one for yet (as when only its
	 * branches, remotes or tags were read); whether one is cached. Without it, or when it answers `false`, such a
	 * repository isn't validated: a layout git's files alone can't answer for (a bare repository, a submodule, a
	 * `--separate-git-dir` checkout, a `core.worktree`) stays unvalidated until a read resolves its git dir. A rejection
	 * is a failure to look, retried soon; `false` is a repository its files can't answer for, tried again rarely
	 */
	readonly resolveGitDir?: (repoPath: string) => Promise<boolean>;
	/**
	 * Whether a `.git` watcher covers `repoPath` and is live (see `RepositoryWatchService.isRepoWatched`): one that is
	 * suspended holds what it hears until it resumes, so a repository is unwatched meanwhile, without being announced
	 */
	readonly isWatched: (repoPath: string) => boolean;
	/** Milliseconds since the epoch, the clock `stat`'s `mtime` is on. Default: `Date.now` */
	readonly now?: () => number;
	/**
	 * How long a read waits for a validation before it's served from the cache as is, and how long a hung file-system
	 * call holds back other repositories' validations. Default: 1000
	 */
	readonly timeoutMs?: number;
	/**
	 * How many of Node's file-system threads (libuv's pool) the validator's calls may hold at once, counting those hung
	 * past {@link timeoutMs}; at most two run at once. Default: 2, which leaves a host two of the pool's default four
	 */
	readonly maxFsThreads?: number;
}

/**
 * A target read within this long of its last validation is served as is: a watched repository's read is as stale, as
 * its watch session debounces what its watcher reports by as much
 */
const validationWindowMs = defaultRepoDelay;
/**
 * How long a repository whose files can't show its git dir (a bare repository, a submodule) is left before they are
 * looked at again. Any read that resolves its git dir with git makes the lookup unneeded
 */
const unresolvableRetryMs = 30_000;
/** Targets kept per kind; one dropped just takes a new baseline */
const maxTargets = 512;
/** Polls one validation runs to take the baselines of the directories it finds; the next validation resumes from there */
const maxDiscoveryPolls = 16;
/**
 * How long a reading stays racy on a file system whose timestamps tick by whole seconds (or two, as FAT's): a write in
 * the same second as the stat leaves the same mtime. Counted both from the mtime and from when the validator first saw
 * the reading, as a server whose clock runs ahead of ours stamps writes with a second that ends, on our clock, no later
 * than this long after we first saw it
 */
const racyMtimeWindowMs = 2000;
/** Racy candidates whose first sighting is remembered; the oldest is dropped past it, which only extends its raciness */
const maxRacyReadings = maxTargets * 8;
/** How long a read waits for a validation before it's served from the cache as is */
const defaultValidationTimeoutMs = 1000;
/** The longest delay `setTimeout` keeps; a longer one (`Infinity` included) fires at once */
const maxValidationTimeoutMs = 2 ** 31 - 1;
/**
 * A stat or listing holds one of Node's file-system threads (libuv's pool, 4 by default) until it returns, which on a
 * hung mount is never, as it can't be cancelled. A repository makes one at a time and the validator two, holding no more
 * threads than it's allowed counting those outstanding past the timeout
 */
const maxFsCallsPerRepo = 1;
const maxFsCalls = 2;
const defaultMaxFsThreads = 2;

const refNamespaces: readonly string[] = ['refs/heads', 'refs/remotes', 'refs/tags'];
const reftableProbePath = 'reftable/tables.list';
const worktreeHeadRegex = /^worktrees\/([^/]+)\/(?:HEAD|reftable\/tables\.list)$/;

/**
 * The git dir itself, as the gate of the files in it that git writes by lockfile and rename, or creates and deletes:
 * either moves the directory's mtime, so its reading stands in for theirs, which are read only once it moved. Each
 * gate's files have a probe target of their own, whose readings outlast the validations that skip it; were they left
 * out of a shared target instead, their next reading would be a new baseline, losing what changed meanwhile. What git
 * writes in place (`FETCH_HEAD`, an admin entry's `gitdir`, the rebase and sequencer state `--edit-todo` rewrites) is
 * read every time. This saves stats only while the gate holds still: an index write moves the git dir too, so an
 * active checkout reads as much as ever, and an idle one, as unwatched repositories mostly are, reads just the gate.
 */
const gitDirGatePath = '';
const rootGatedPaths: ReadonlySet<string> = new Set([
	'HEAD',
	'ORIG_HEAD',
	'MERGE_HEAD',
	'CHERRY_PICK_HEAD',
	'REVERT_HEAD',
	'REBASE_HEAD',
]);
const commonGatedPaths: ReadonlySet<string> = new Set(['packed-refs', 'config', 'shallow']);

// The index is what working-tree status reads, which these caches aren't; `info/exclude` clears only the gitignore filter
const rootProbes: readonly GitDirProbe[] = gitDirRootProbes.filter(p => p.path !== 'index');
const rootAlwaysProbes: readonly GitDirProbe[] = [
	{ path: gitDirGatePath },
	...rootProbes.filter(p => !rootGatedPaths.has(p.path)),
	{ path: reftableProbePath },
];
const rootGatedProbes: readonly GitDirProbe[] = rootProbes.filter(p => rootGatedPaths.has(p.path));
/**
 * What a worktree's own git dir can report, which is all its validation without a baseline reports: the shared kinds
 * are the common git dir's to report, from a baseline of its own, or by another worktree's watcher that covers it
 */
const rootReportableChanges: readonly RepositoryChange[] = [
	...new Set(
		[...rootAlwaysProbes, ...rootGatedProbes].flatMap((p): RepositoryChange[] => {
			if (p.path === gitDirGatePath) return [];
			// As `classify` reports a worktree's own reftable, which moves with its HEAD
			if (p.path === reftableProbePath) return ['head', 'heads'];

			return (p.emitAs ?? [p.path]).flatMap(path => classifyGitDirChange(path) ?? []);
		}),
	),
];
const commonProbes: readonly GitDirProbe[] = [
	...gitDirCommonProbes.filter(p => p.path !== 'info/exclude'),
	{ path: reftableProbePath },
	// Dropping a stash entry other than the newest rewrites only the stash's reflog, leaving `refs/stash` as it was
	{ path: 'logs/refs/stash', emitAs: ['refs/stash'] },
	// A replacement (`git replace`) changes ancestry, and the cached ref list holds the replace refs
	{ path: 'refs/replace' },
];
const commonAlwaysProbes: readonly GitDirProbe[] = [
	{ path: gitDirGatePath },
	...commonProbes.filter(p => !commonGatedPaths.has(p.path)),
];
const commonGatedProbes: readonly GitDirProbe[] = commonProbes.filter(p => commonGatedPaths.has(p.path));

interface ValidationResult {
	readonly changes: ReadonlySet<RepositoryChange>;
	/** With a `'worktreeHead'` among `changes`, the admin ids of the linked worktrees whose HEAD moved; `undefined` when any may have */
	readonly movedWorktrees: ReadonlySet<string> | undefined;
}

/** Something reads wait for, at most until their timeout */
interface Waitable {
	/** In flight; settles once what it found was applied */
	running?: Promise<void>;
	/** What outlasted a read's wait; while it's still {@link running}, reads don't wait for it */
	slow?: Promise<void>;
	/** What it started that reads wait for through it, which a wait that outlasts it marks slow too */
	readonly started?: (readonly [Waitable, Promise<void>])[];
	settledAt?: number;
}

interface TargetState extends Waitable {
	readonly dir: ProbedGitDir;
	runs: number;
}

/** A resolution of a git dir nothing resolved, then the validation that follows it */
interface ResolutionState extends Waitable {
	readonly started: (readonly [Waitable, Promise<void>])[];
	/** How long after it settled the resolution is tried again: briefly for a failure, longer for a definite "no" */
	retryAfterMs: number;
}

/**
 * Keeps the caches that never expire fresh for repositories no `.git` watcher covers: before such a read, stats the
 * files a watcher would have reported (see {@link UnwatchedCacheValidatorOptions.stat}) and applies what moved to the
 * cache as a watcher event would have. Both a worktree's own git dir and the common one are validated while that
 * worktree is unwatched; while another worktree's watcher covers the common one, what moved there clears only the
 * unwatched worktrees' own entries. A repository whose git dir nothing resolved yet is validated once
 * {@link UnwatchedCacheValidatorOptions.resolveGitDir} resolves one; a repository whose files can't show it is looked at
 * again rarely, and one whose resolution failed within the validation window. A read waits at most
 * {@link UnwatchedCacheValidatorOptions.timeoutMs} for a validation (and a resolution before it); one that outlasts it
 * is left to finish on its own, and the reads meanwhile are served as is.
 */
export class UnwatchedCacheValidator {
	private readonly cache: Cache;
	private readonly isWatched: (repoPath: string) => boolean;
	private readonly now: () => number;
	private readonly timeoutMs: number;
	private readonly resolveGitDir: ((repoPath: string) => Promise<boolean>) | undefined;
	private readonly gate: FileSystemGate;
	/** Since it was created; what {@link getResourceUsage} reports */
	private readonly counts = { validations: 0, validationsApplied: 0, waitsTimedOut: 0, gitDirLookups: 0 };
	private readonly dirOptions: ProbedGitDirOptions;
	/** Keyed by repo path */
	private readonly roots = new Map<string, TargetState>();
	/** Keyed by common path */
	private readonly commons = new Map<string, TargetState>();
	/** Keyed by absolute path; the readings that may be racy, with when each was first read */
	private readonly racyReadings = new Map<string, { mtime: number; size: number; firstSeen: number }>();
	/**
	 * Keyed by repo path; one that found nothing is kept, so the reads meanwhile don't retry it: for the window after a
	 * failure, for {@link unresolvableRetryMs} after a git dir the files can't show
	 */
	private readonly resolutions = new Map<string, ResolutionState>();
	/** The validation {@link onWatched} ran as a watcher attached, by repo path, which reads wait for while it runs */
	private readonly handoffs = new Map<string, Promise<void>>();
	/** By the repo path of a watched worktree, what moved in its common git dir that its watcher was left to clear */
	private readonly deferred = new Map<
		string,
		{ readonly commonPath: string; readonly changes: Set<RepositoryChange> }
	>();

	constructor(options: UnwatchedCacheValidatorOptions) {
		this.cache = options.cache;
		this.isWatched = options.isWatched;
		this.now = options.now ?? ((): number => Date.now());
		this.timeoutMs = Math.min(options.timeoutMs ?? defaultValidationTimeoutMs, maxValidationTimeoutMs);
		this.resolveGitDir = options.resolveGitDir;
		// A `NaN` would fail every slot check, so nothing would ever be validated
		const maxFsThreads = Math.floor(options.maxFsThreads ?? defaultMaxFsThreads);
		this.gate = new FileSystemGate(
			this.timeoutMs,
			Number.isNaN(maxFsThreads) ? defaultMaxFsThreads : Math.max(1, maxFsThreads),
		);
		this.dirOptions = {
			gate: this.gate,
			stat: options.stat,
			readDirectory: options.readDirectory,
			readFile: options.readFile,
			getIgnoredWorktreeRoots: options.getIgnoredWorktreeRoots,
			isRacy: (stat, path) => this.isRacy(stat, path),
		};
	}

	/**
	 * Whether `stat` of `path` may still show the same file a write in its own second would leave. Only a whole-second
	 * mtime can, and only until its second ended: by the mtime's own clock, and by ours since the reading was first
	 * seen, whichever comes first
	 */
	private isRacy(stat: ProbeStat, path: string): boolean {
		const now = this.now();
		if (stat.mtime % 1000 !== 0 || now - stat.mtime >= racyMtimeWindowMs) {
			this.racyReadings.delete(path);
			return false;
		}

		let reading = this.racyReadings.get(path);
		if (reading == null || reading.mtime !== stat.mtime || reading.size !== stat.size) {
			reading = { mtime: stat.mtime, size: stat.size, firstSeen: now };
			this.racyReadings.delete(path);
			this.racyReadings.set(path, reading);
			if (this.racyReadings.size > maxRacyReadings) {
				const oldest = this.racyReadings.keys().next();
				if (!oldest.done) {
					this.racyReadings.delete(oldest.value);
				}
			}
		} else {
			// Kept newest, so the cap drops the reading read longest ago, not one still read
			this.racyReadings.delete(path);
			this.racyReadings.set(path, reading);
			// A clock set back since counts from now, or the reading would stay racy until it caught up
			if (now < reading.firstSeen) {
				reading.firstSeen = now;
			}
		}

		return now - reading.firstSeen < racyMtimeWindowMs;
	}

	/**
	 * Validates what `repoPath`'s reads would be served from, unless a watcher covers it or it was validated within
	 * the last 250ms. `undefined` when there's nothing to wait for; otherwise settles once what moved was applied to
	 * the cache, or after {@link UnwatchedCacheValidatorOptions.timeoutMs} with the cache as is, whichever is first.
	 * Never rejects. A path that can't be read counts as moved as it becomes unreadable and again as it becomes
	 * readable; a directory that can't be listed is listed again at the next validation, and what changes deeper inside
	 * it goes unseen until it can be.
	 */
	validate(repoPath: string): Promise<void> | undefined {
		return this.handoffs.get(repoPath) ?? this.run(repoPath, false);
	}

	/**
	 * A watcher attached to `repoPath`, so it reports only what changes from now on: validates now what changed since
	 * the last validation, whatever the window, and has `repoPath`'s reads wait for it.
	 */
	onWatched(repoPath: string): void {
		const validation = this.run(repoPath, true);
		if (validation == null) return;

		const handoff: Promise<void> = validation.finally(() => {
			if (this.handoffs.get(repoPath) === handoff) {
				this.handoffs.delete(repoPath);
			}
		});
		this.handoffs.set(repoPath, handoff);
	}

	/**
	 * A watcher left `repoPath`, dropping what it held back unreported. What moved in its common git dir that an
	 * unwatched sibling's validation left to it is applied now, since that validation took the shared baseline past it;
	 * whatever else it dropped is still ahead of its own baselines.
	 */
	onUnwatched(repoPath: string): void {
		const deferred = this.deferred.get(repoPath);
		if (deferred == null) return;

		this.deferred.delete(repoPath);
		// To the common path, which keys the shared entries, as `repoPath` may already be unregistered
		this.cache.onRepositoryChanged(deferred.commonPath, deferred.changes);
		// And to a linked worktree's own entries while it is still registered, which its watcher would have cleared too
		if (repoPath !== deferred.commonPath && this.cache.isRegistered(repoPath)) {
			this.cache.applyRepositoryChanges(repoPath, deferred.changes, 'share', { worktreeOnly: true });
		}
	}

	private run(repoPath: string, force: boolean): Promise<void> | undefined {
		if (!force && this.isWatched(repoPath)) return undefined;

		// A watcher attaching has no baseline to hand off without a git dir
		if (this.cache.gitDir.get(repoPath) == null) return force ? undefined : this.resolveThenValidate(repoPath);

		const waits = this.start(repoPath, force);
		return waits?.length ? this.waitAtMost(waits) : undefined;
	}

	/** Starts validating `repoPath`, or joins the validations in flight; what a read waits for */
	private start(repoPath: string, force: boolean): (readonly [Waitable, Promise<void>])[] | undefined {
		const gitDir = this.cache.gitDir.get(repoPath);
		if (gitDir == null) return undefined;

		const commonPath = this.cache.getCommonPath(repoPath);
		// A watcher suspended holds what was left to it until it resumes, and suspending announces nothing
		for (const [path, deferred] of this.deferred) {
			if (deferred.commonPath === commonPath && !this.isWatched(path)) {
				this.onUnwatched(path);
			}
		}

		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const root = this.getTarget(this.roots, repoPath, 'root', gitDir.uri.fsPath, commonPath, commonGitDir);
		// Read even while another worktree's watcher covers it: that watcher clears the shared entries, never this
		// worktree's own
		const common = this.getTarget(this.commons, commonPath, 'common', commonGitDir, commonPath, commonGitDir);

		const waits: (readonly [Waitable, Promise<void>])[] = [];
		const previous: Promise<void>[] = [];
		const start = (state: TargetState | undefined): TargetState | undefined => {
			if (state == null) return undefined;

			if (state.running != null) {
				if (!force) {
					if (state.slow !== state.running) {
						waits.push([state, state.running]);
					}
					return undefined;
				}

				previous.push(state.running);
			} else if (!force && state.settledAt != null) {
				// A clock set back since counts as outside the window, or nothing would validate until it caught up
				const elapsed = this.now() - state.settledAt;
				if (elapsed >= 0 && elapsed < validationWindowMs) return undefined;
			}
			return state;
		};
		const startedRoot = start(root);
		const startedCommon = start(common);

		if (startedRoot != null || startedCommon != null) {
			const job = this.runTargets(repoPath, commonPath, startedRoot, startedCommon, previous);
			if (startedRoot != null) {
				startedRoot.running = job;
			}
			if (startedCommon != null) {
				startedCommon.running = job;
			}
			for (const state of [startedRoot, startedCommon]) {
				if (state != null) {
					waits.push([state, job]);
				}
			}
		}

		return waits;
	}

	/**
	 * Resolves the git dir of `repoPath` (through the gate, as one call, keyed by `repoPath` since its common git dir
	 * isn't known yet), then validates it as usual within the same wait. That first validation has no baseline.
	 */
	private resolveThenValidate(repoPath: string): Promise<void> | undefined {
		const resolveGitDir = this.resolveGitDir;
		if (resolveGitDir == null) return undefined;

		let state = this.resolutions.get(repoPath);
		let running = state?.running;
		if (state != null && running != null) {
			if (state.slow === running) return undefined;
		} else {
			if (state?.settledAt != null) {
				const elapsed = this.now() - state.settledAt;
				if (elapsed >= 0 && elapsed < state.retryAfterMs) return undefined;
			}

			state = { started: [], retryAfterMs: validationWindowMs };
			running = this.startResolution(repoPath, resolveGitDir, state);
		}

		return this.waitAtMost([[state, running]]);
	}

	private startResolution(
		repoPath: string,
		resolveGitDir: (repoPath: string) => Promise<boolean>,
		state: ResolutionState,
	): Promise<void> {
		let found = false;
		this.counts.gitDirLookups++;
		const running: Promise<void> = this.gate
			.run(repoPath, () => resolveGitDir(repoPath))
			.catch((): undefined => undefined)
			.then(async resolved => {
				found = resolved === true;
				// Only a definite "no" waits long: a failure may pass
				if (resolved === false) {
					state.retryAfterMs = unresolvableRetryMs;
				}
				if (!found || this.isWatched(repoPath)) return;

				const waits = this.start(repoPath, false);
				if (waits == null) return;

				state.started.push(...waits);
				await Promise.all(waits.map(([, validation]) => validation));
			})
			.finally(() => {
				state.settledAt = this.now();
				state.running = undefined;
				// Reads go by the cached git dir from here on
				if (found && this.resolutions.get(repoPath) === state) {
					this.resolutions.delete(repoPath);
				}
			});
		state.running = running;

		this.resolutions.delete(repoPath);
		this.resolutions.set(repoPath, state);
		if (this.resolutions.size > maxTargets) {
			const oldest = this.resolutions.keys().next();
			if (!oldest.done) {
				this.resolutions.delete(oldest.value);
			}
		}
		return running;
	}

	/**
	 * Settles once `waits`' validations do, or once the timeout elapses, latching those still running as slow (and what
	 * they started) so the reads after it don't wait for them again
	 */
	private waitAtMost(waits: readonly (readonly [Waitable, Promise<void>])[]): Promise<void> {
		const latch = (state: Waitable, running: Promise<void>): void => {
			if (state.running !== running) return;

			state.slow = running;
			for (const [started, startedRunning] of state.started ?? []) {
				latch(started, startedRunning);
			}
		};

		// The waits never reject, so only the timeout lands in the rejection handler
		return raceWithTimeout(Promise.all(waits.map(([, running]) => running)), this.timeoutMs).then(
			() => undefined,
			() => {
				this.counts.waitsTimedOut++;
				for (const [state, running] of waits) {
					latch(state, running);
				}
			},
		);
	}

	/**
	 * What validating has cost, for a host to weigh against watching: counts since the validator was created of the
	 * validations run, those that cleared something, the reads served as is after their wait timed out, the git dir
	 * lookups, and the file-system calls made; and, as of now, the calls stuck on a hung mount and the git dirs kept
	 */
	getResourceUsage(): ResourceUsage {
		return {
			'unwatchedValidation.validations.count': this.counts.validations,
			'unwatchedValidation.validationsApplied.count': this.counts.validationsApplied,
			'unwatchedValidation.waitsTimedOut.count': this.counts.waitsTimedOut,
			'unwatchedValidation.gitDirLookups.count': this.counts.gitDirLookups,
			'unwatchedValidation.fsCalls.count': this.gate.calls,
			'unwatchedValidation.fsCallsStuck.count': this.gate.stuckCalls,
			'unwatchedValidation.gitDirs.count': this.roots.size + this.commons.size,
		};
	}

	/** The repository's other worktrees whose watchers cover its common git dir */
	private getCommonWatchers(repoPath: string, commonPath: string): string[] {
		const watchers = new Set<string>();
		if (commonPath !== repoPath && this.isWatched(commonPath)) {
			watchers.add(commonPath);
		}
		for (const path of this.cache.getWorktreePaths(commonPath)) {
			if (path !== repoPath && this.isWatched(path)) {
				watchers.add(path);
			}
		}
		return [...watchers];
	}

	private getTarget(
		targets: Map<string, TargetState>,
		key: string,
		kind: 'root' | 'common',
		basePath: string,
		commonPath: string,
		commonGitDir: string,
	): TargetState {
		let state = targets.get(key);
		if (state?.dir.basePath === basePath && state.dir.commonPath === commonPath) {
			// Kept newest, so the cap drops the target read longest ago
			targets.delete(key);
		} else {
			state = { dir: new ProbedGitDir(kind, basePath, commonPath, commonGitDir, this.dirOptions), runs: 0 };
		}
		targets.set(key, state);

		if (targets.size > maxTargets) {
			const oldest = targets.keys().next();
			if (!oldest.done) {
				targets.delete(oldest.value);
			}
		}
		return state;
	}

	private async runTargets(
		repoPath: string,
		commonPath: string,
		root: TargetState | undefined,
		common: TargetState | undefined,
		previous: readonly Promise<void>[],
	): Promise<void> {
		const rootRun = root != null ? ++root.runs : 0;
		const commonRun = common != null ? ++common.runs : 0;
		// Before anything is awaited: a watcher that attaches from here on reports only what changes after it attached,
		// and its own validation reads the common git dir after this one, from the baseline this one advances
		const watchedAtStart = new Set(this.getCommonWatchers(repoPath, commonPath));
		try {
			// A forced validation reads after the one in flight, never beside it
			if (previous.length) {
				await Promise.all(previous);
			}

			// The root and common git dirs of one validation can share paths: a main checkout's are the same, and a
			// linked worktree's root is an admin entry of the common one
			const memo: StatMemo = new Map();
			const [rootResult, commonResult] = await Promise.all([
				root?.dir.validate(memo, repoPath),
				common?.dir.validate(memo, repoPath),
			]);
			this.counts.validations++;
			if (rootResult?.changes.size || commonResult?.changes.size) {
				this.counts.validationsApplied++;
			}
			this.apply(repoPath, commonPath, rootResult, commonResult, watchedAtStart);
		} catch {
			// `validate` never rejects, so only applying can have thrown; whatever it did apply stands
		} finally {
			// Before the validation settles, so a read it gated finds the window open and runs no other
			const settledAt = this.now();
			if (root != null) {
				root.settledAt = settledAt;
				if (root.runs === rootRun) {
					root.running = undefined;
				}
			}
			if (common != null) {
				common.settledAt = settledAt;
				if (common.runs === commonRun) {
					common.running = undefined;
				}
			}
		}
	}

	/**
	 * Applies what moved to `repoPath`, and what moved in the common git dir to its other unwatched registered worktrees
	 * too, as the common watcher would have told each of them. While another worktree's watcher covers the common git
	 * dir, it already cleared the shared entries, so only the worktrees' own are. A watcher covers it only if it watched
	 * since before the stats began (`watchedAtStart`)
	 */
	private apply(
		repoPath: string,
		commonPath: string,
		root: ValidationResult | undefined,
		common: ValidationResult | undefined,
		watchedAtStart: ReadonlySet<string>,
	): void {
		const watchers = this.getCommonWatchers(repoPath, commonPath).filter(p => watchedAtStart.has(p));
		const commonWatched = watchers.length !== 0;
		const changes = new Set<RepositoryChange>(root?.changes);
		if (!commonWatched) {
			for (const change of common?.changes ?? []) {
				changes.add(change);
			}
		}

		if (changes.size) {
			// Only the common git dir reports a `'worktreeHead'`
			this.cache.onRepositoryChanged(repoPath, changes, {
				movedWorktrees: changes.has('worktreeHead') ? common?.movedWorktrees : undefined,
			});
		}

		if (!common?.changes.size) return;

		if (commonWatched) {
			this.cache.applyRepositoryChanges(repoPath, common.changes, 'share', { worktreeOnly: true });

			// Kept for each watcher until it leaves (see `onUnwatched`), since one that leaves first drops what it held back
			for (const path of watchers) {
				let deferred = this.deferred.get(path);
				if (deferred?.commonPath !== commonPath) {
					deferred = { commonPath: commonPath, changes: new Set() };
					this.deferred.set(path, deferred);
				}
				for (const change of common.changes) {
					deferred.changes.add(change);
				}
			}
		}
		for (const path of this.cache.getWorktreePaths(commonPath)) {
			if (path === repoPath || watchers.includes(path)) continue;

			this.cache.applyRepositoryChanges(path, common.changes, 'share', { worktreeOnly: true });
		}
	}
}

/**
 * Runs file-system calls at most {@link maxFsCalls} at once, and at most {@link maxFsCallsPerRepo} at once for a key;
 * the calls waiting start in the order they came, skipping those whose key is busy. A call outstanding past the
 * timeout is stuck, as on a hung mount: it stops counting against {@link maxFsCalls}, so other keys' calls go on, but
 * keeps its key busy and holds one of the threads the gate is allowed until it returns
 */
class FileSystemGate {
	/** The keys with calls in flight, by how many */
	private readonly busy = new Map<string, number>();
	private readonly waiting: { readonly key: string; readonly start: () => void }[] = [];
	private active = 0;
	private stuck = 0;
	/** The calls made since it was created */
	calls = 0;

	constructor(
		private readonly timeoutMs: number,
		/** Calls in flight at most, stuck ones included */
		private readonly maxThreads: number,
	) {}

	async run<T>(key: string, call: () => Promise<T>): Promise<T> {
		if (this.canStart(key)) {
			this.acquire(key);
		} else {
			await new Promise<void>(resolve => this.waiting.push({ key: key, start: resolve }));
		}

		this.calls++;
		let stuck = false;
		const timer = setTimeout(() => {
			stuck = true;
			this.active--;
			this.stuck++;
			this.drain();
		}, this.timeoutMs);
		// A call alone must not keep a (Node) process alive; in the browser timers are numbers
		if (typeof timer !== 'number') {
			timer.unref();
		}

		try {
			return await call();
		} finally {
			if (stuck) {
				this.stuck--;
			} else {
				clearTimeout(timer);
				this.active--;
			}
			this.release(key);
		}
	}

	/** The calls outstanding past the timeout */
	get stuckCalls(): number {
		return this.stuck;
	}

	private hasSlot(): boolean {
		return this.active < maxFsCalls && this.active + this.stuck < this.maxThreads;
	}

	private canStart(key: string): boolean {
		return this.hasSlot() && (this.busy.get(key) ?? 0) < maxFsCallsPerRepo;
	}

	private acquire(key: string): void {
		this.active++;
		this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
	}

	private release(key: string): void {
		const count = (this.busy.get(key) ?? 1) - 1;
		if (count > 0) {
			this.busy.set(key, count);
		} else {
			this.busy.delete(key);
		}
		this.drain();
	}

	private drain(): void {
		let i = 0;
		while (i < this.waiting.length && this.hasSlot()) {
			const waiter = this.waiting[i];
			if (!this.canStart(waiter.key)) {
				i++;
				continue;
			}

			this.waiting.splice(i, 1);
			// Claimed before it resumes, so no call that comes meanwhile takes its slot
			this.acquire(waiter.key);
			waiter.start();
		}
	}
}

interface ProbedGitDirOptions {
	/** Shared by every git dir the validator reads */
	readonly gate: FileSystemGate;
	readonly stat: (path: string) => Promise<ProbeStat | undefined>;
	readonly readDirectory: (path: string) => Promise<readonly (readonly [string, number])[]>;
	readonly readFile: ((path: string) => Promise<Uint8Array | undefined>) | undefined;
	readonly getIgnoredWorktreeRoots: ((repoPath: string) => Promise<readonly string[]>) | undefined;
	readonly isRacy: (stat: ProbeStat, path: string) => boolean;
}

/** The probes of a gate's files, read only once the gate moved */
interface GatedTarget {
	readonly target: GitDirProbeTarget;
	/** Whether its baseline was taken */
	read: boolean;
}

/**
 * The readings of one git dir: a worktree's own (`root`), or the common one, whose ref directories and worktree admin
 * entries it finds by listing them. A directory is listed only after its reading was recorded, so whatever a listing
 * missed moves the directory again. A path that can't be read counts as moved as it becomes unreadable and again as it
 * becomes readable; a directory that can't be listed keeps what it held and is listed again at the next validation, so
 * what changes deeper inside it goes unseen until it can be. Without a baseline, a worktree's own git dir reports only
 * what its probes can, the common one everything.
 */
class ProbedGitDir {
	/** The probes read every time, the gates among them */
	private target: GitDirProbeTarget;
	/** By the path of their gate: the git dir's own, and each admin entry's */
	private readonly gated = new Map<string, GatedTarget>();
	private baselined = false;
	/** The directories found under the ref namespaces, which a ref created or deleted in them moves */
	private readonly refDirs = new Set<string>();
	/** By admin id, whether core ignores the linked worktree, which leaves only its `gitdir` probed */
	private readonly worktrees = new Map<string, { ignored: boolean }>();
	/** The probes that moved during the current validation, by path */
	private readonly moved = new Map<string, GitDirProbe>();
	/** The paths of the probes that moved in the last poll */
	private readonly movedInPoll = new Set<string>();
	/** The gates that moved during the current validation */
	private readonly movedGates = new Set<string>();
	/** The admin ids found during the current validation */
	private readonly foundWorktrees = new Set<string>();
	/** The admin ids removed during the current validation, by whether they were ignored */
	private readonly removedWorktrees = new Map<string, boolean>();
	/** The admin ids whose ignored status flipped during the current validation */
	private readonly flippedWorktrees = new Set<string>();
	/**
	 * The directories the next validation lists whether they moved or not: those that couldn't be listed, and those
	 * left at {@link maxDiscoveryPolls}
	 */
	private readonly pendingDirs = new Set<string>();
	/** The admin ids left at {@link maxDiscoveryPolls}, whose `gitdir` the next validation reads whether it moved or not */
	private readonly pendingEntries = new Set<string>();
	/** The common git dir's own `reftable/tables.list`; only while it's there do the admin entries have their own */
	private readonly reftablePath: string | undefined;
	/** Whether {@link reftablePath} was there at its last reading */
	private reftable = false;
	/** The current validation's */
	private memo: StatMemo | undefined;
	/** The current validation's repository, whose git dir the cache holds */
	private repoPath: string | undefined;
	/** The current validation's, once a worktree needed them */
	private ignoredRoots: Promise<readonly string[]> | undefined;

	constructor(
		readonly kind: 'root' | 'common',
		readonly basePath: string,
		/** The repository's common path as the cache resolved it */
		readonly commonPath: string,
		/**
		 * The repository's common git dir, which keys its file-system calls in the gate, shared with its worktrees':
		 * unlike the common path, the same for a worktree the cache never registered
		 */
		private readonly gateKey: string,
		private readonly options: ProbedGitDirOptions,
	) {
		this.reftablePath = kind === 'common' ? joinPaths(basePath, reftableProbePath) : undefined;
		this.target = this.createTarget(() => this.getProbes());
		this.addGated(gitDirGatePath, kind === 'root' ? rootGatedProbes : commonGatedProbes);
	}

	/**
	 * Polls the probes and answers what moved since the last validation; everything it can report when there's no
	 * baseline. `memo` holds the stats of the validation it's part of
	 */
	async validate(memo: StatMemo, repoPath: string): Promise<ValidationResult> {
		this.moved.clear();
		this.movedGates.clear();
		this.foundWorktrees.clear();
		this.removedWorktrees.clear();
		this.flippedWorktrees.clear();
		this.memo = memo;
		this.repoPath = repoPath;

		let failed = false;
		try {
			await this.poll();
			if (this.kind === 'common') {
				await this.discover();
			}
			await this.pollGated();
		} catch {
			failed = true;
		} finally {
			this.memo = undefined;
			this.repoPath = undefined;
			this.ignoredRoots = undefined;
		}

		if (failed || !this.baselined) {
			if (failed) {
				this.target = this.createTarget(() => this.getProbes());
				this.gated.clear();
				this.addGated(gitDirGatePath, this.kind === 'root' ? rootGatedProbes : commonGatedProbes);
				this.baselined = false;
				this.refDirs.clear();
				this.worktrees.clear();
				this.pendingDirs.clear();
				this.pendingEntries.clear();
				this.reftable = false;
			} else {
				this.baselined = true;
			}
			return {
				changes: new Set(this.kind === 'root' ? rootReportableChanges : allWatchedRepositoryChanges),
				movedWorktrees: undefined,
			};
		}

		return this.classify();
	}

	private createTarget(getProbes: () => Iterable<GitDirProbe>): GitDirProbeTarget {
		return new GitDirProbeTarget(
			this.basePath,
			{ stat: path => this.stat(path), invalidate: () => {} },
			getProbes,
			new Map(),
			(_event, probe) => {
				if (isGatePath(probe.path)) {
					this.movedGates.add(probe.path);
					return;
				}

				this.moved.set(probe.path, probe);
				this.movedInPoll.add(probe.path);
			},
			{ isRacy: this.options.isRacy },
		);
	}

	private addGated(gatePath: string, probes: readonly GitDirProbe[]): void {
		this.gated.set(gatePath, { target: this.createTarget(() => probes), read: false });
	}

	private addWorktreeGated(id: string): void {
		this.addGated(`worktrees/${id}`, [{ path: `worktrees/${id}/HEAD` }, { path: `worktrees/${id}/locked` }]);
	}

	private async stat(path: string): Promise<ProbeStat | undefined> {
		let stat = this.memo?.get(path);
		if (stat == null) {
			// Mapped before it's shared, so the root and common git dirs read the same
			stat = this.options.gate
				.run(this.gateKey, () => this.options.stat(path))
				.catch((ex: unknown) => {
					// A path under one that is now a file (a ref directory replaced by a ref of its name) isn't there
					if (isNotFound(ex) || isNotADirectory(ex)) return undefined;

					// Read as a reading of its own rather than skipped (as the probe target skips a stat that throws), so
					// the path moves as it becomes unreadable and as it becomes readable again
					return unreadable;
				});
			this.memo?.set(path, stat);
		}

		const result = await stat;
		if (path === this.reftablePath && result !== unreadable) {
			this.reftable = result != null;
		}
		return result;
	}

	private poll(): Promise<void> {
		this.movedInPoll.clear();
		return this.target.poll();
	}

	/** Polls the files of each gate that moved during this validation, and of each never read */
	private async pollGated(): Promise<void> {
		const due = [...this.gated].filter(([gate, gated]) => !gated.read || this.movedGates.has(gate));
		await Promise.all(
			due.map(async ([, gated]) => {
				await gated.target.poll();
				gated.read = true;
			}),
		);
	}

	private getProbes(): GitDirProbe[] {
		if (this.kind === 'root') return [...rootAlwaysProbes];

		const probes = [...commonAlwaysProbes];
		for (const path of this.refDirs) {
			probes.push({ path: path });
		}
		for (const [id, { ignored }] of this.worktrees) {
			probes.push({ path: `worktrees/${id}/gitdir` });
			if (ignored) continue;

			probes.push({ path: `worktrees/${id}` });
			if (this.reftable) {
				probes.push({ path: `worktrees/${id}/${reftableProbePath}` });
			}
		}
		return probes;
	}

	/** The listed directories that moved in the last poll */
	private getMovedDirs(): string[] {
		return [...this.movedInPoll].filter(p => p === 'worktrees' || refNamespaces.includes(p) || this.refDirs.has(p));
	}

	/** The known admin ids whose `gitdir` moved in the last poll */
	private getMovedGitdirs(): string[] {
		const ids: string[] = [];
		for (const path of this.movedInPoll) {
			const entry = parseWorktreeAdminPath(path);
			if (entry?.file === 'gitdir' && this.worktrees.has(entry.id)) {
				ids.push(entry.id);
			}
		}
		return ids;
	}

	/**
	 * Lists the directories that moved in the last poll (every one, the first time), and polls again while that finds
	 * new ones, so they have readings before the caches are read again: the move of the directory they're in already
	 * reported whatever they hold. Reads whether each admin entry new to it, or whose `gitdir` moved, is ignored, once
	 * that `gitdir` has a reading. Also lists what an earlier validation left: the directories it couldn't list, and
	 * what was still to list or read when it reached {@link maxDiscoveryPolls}.
	 */
	private async discover(): Promise<void> {
		let dirs = this.baselined
			? [...new Set([...this.pendingDirs, ...this.getMovedDirs()])]
			: [...refNamespaces, 'worktrees'];
		let entries = this.baselined ? [...new Set([...this.pendingEntries, ...this.getMovedGitdirs()])] : [];
		this.pendingEntries.clear();

		for (let polls = 0; ; polls++) {
			const found = dirs.length ? await this.list(dirs) : { dirs: [], worktrees: [] };
			const unignored = entries.length ? await this.readIgnored(entries) : false;
			if (!found.dirs.length && !found.worktrees.length && !unignored) return;

			// Even at the cap, so what was just found has a reading before the caches are read again
			await this.poll();
			dirs = [...found.dirs, ...this.getMovedDirs()];
			entries = [...new Set([...found.worktrees, ...this.getMovedGitdirs()])];

			if (polls === maxDiscoveryPolls) {
				for (const dir of dirs) {
					this.pendingDirs.add(dir);
				}
				for (const id of entries) {
					this.pendingEntries.add(id);
				}
				return;
			}
		}
	}

	/**
	 * Lists `dirs`, dropping the directories (or admin entries) no longer in them, and answers what's new. One that
	 * can't be listed keeps what it held, and is left for the next validation to list
	 */
	private async list(dirs: readonly string[]): Promise<{ dirs: string[]; worktrees: string[] }> {
		const found: { dirs: string[]; worktrees: string[] } = { dirs: [], worktrees: [] };

		await Promise.all(
			dirs.map(async dir => {
				const names = await this.readDirectories(dir);
				if (names == null) {
					this.pendingDirs.add(dir);
					return;
				}

				this.pendingDirs.delete(dir);
				if (dir === 'worktrees') {
					for (const [id, { ignored }] of this.worktrees) {
						if (!names.includes(id)) {
							this.removedWorktrees.set(id, ignored);
							this.worktrees.delete(id);
							this.gated.delete(`worktrees/${id}`);
						}
					}
					for (const id of names) {
						if (!this.worktrees.has(id)) {
							// Probed as not ignored until its `gitdir` is read
							this.worktrees.set(id, { ignored: false });
							this.addWorktreeGated(id);
							this.foundWorktrees.add(id);
							found.worktrees.push(id);
						}
					}
					return;
				}

				const children = new Set(names.map(name => `${dir}/${name}`));
				for (const path of this.refDirs) {
					if (path.substring(0, path.lastIndexOf('/')) !== dir || children.has(path)) continue;

					for (const p of this.refDirs) {
						if (p === path || p.startsWith(`${path}/`)) {
							this.refDirs.delete(p);
							this.pendingDirs.delete(p);
						}
					}
				}
				for (const path of children) {
					if (!this.refDirs.has(path)) {
						this.refDirs.add(path);
						found.dirs.push(path);
					}
				}
			}),
		);
		return found;
	}

	/**
	 * Reads whether core ignores each of the admin entries `ids`, from their `gitdir`; answers whether one known as
	 * ignored no longer is, whose gate the next poll must take a reading of. A read that fails ignores nothing
	 */
	private async readIgnored(ids: readonly string[]): Promise<boolean> {
		const { readFile, getIgnoredWorktreeRoots } = this.options;
		if (readFile == null || getIgnoredWorktreeRoots == null || this.repoPath == null) return false;

		const repoPath = this.repoPath;
		const roots = await (this.ignoredRoots ??= getIgnoredWorktreeRoots(repoPath).catch(() => []));

		let unignored = false;
		await Promise.all(
			ids.map(async id => {
				let ignored = false;
				if (roots.length) {
					const adminDir = joinPaths(this.basePath, 'worktrees', id);
					let gitdir: Uint8Array | undefined;
					try {
						gitdir = await this.options.gate.run(this.gateKey, () =>
							readFile(joinPaths(adminDir, 'gitdir')),
						);
					} catch {}
					ignored = isIgnoredWorktreeEntry(adminDir, gitdir, roots) === true;
				}

				const entry = this.worktrees.get(id);
				if (entry == null || entry.ignored === ignored) return;

				entry.ignored = ignored;
				// A new entry was reported as the move of the `worktrees` directory it appeared in
				if (!this.foundWorktrees.has(id)) {
					this.flippedWorktrees.add(id);
				}
				if (ignored) {
					this.gated.delete(`worktrees/${id}`);
				} else {
					this.addWorktreeGated(id);
					unignored = true;
				}
			}),
		);
		return unignored;
	}

	/** The names of the directories in `dir`; none when it isn't there, and `undefined` when it couldn't be listed */
	private async readDirectories(dir: string): Promise<string[] | undefined> {
		try {
			const entries = await this.options.gate.run(this.gateKey, () =>
				this.options.readDirectory(joinPaths(this.basePath, dir)),
			);
			return entries.filter(([, type]) => (type & FileType.Directory) !== 0).map(([name]) => name);
		} catch (ex) {
			if (isNotFound(ex) || isNotADirectory(ex)) return [];

			return undefined;
		}
	}

	/**
	 * The admin ids, not ignored, that the listings of this validation added or removed; none when all were ignored, and
	 * `undefined` when the listings changed nothing, so what moved the `worktrees` directory is unknown
	 */
	private getAddedOrRemovedWorktrees(): string[] | undefined {
		if (!this.foundWorktrees.size && !this.removedWorktrees.size) return undefined;

		const ids: string[] = [];
		for (const id of this.foundWorktrees) {
			const entry = this.worktrees.get(id);
			if (entry != null && !entry.ignored) {
				ids.push(id);
			}
		}
		for (const [id, ignored] of this.removedWorktrees) {
			// One found and gone again within the validation was never reported
			if (!ignored && !this.foundWorktrees.has(id)) {
				ids.push(id);
			}
		}
		return ids;
	}

	private classify(): ValidationResult {
		const changes = new Set<RepositoryChange>();
		const movedWorktrees = new Set<string>();
		let anyWorktreeMoved = false;

		const add = (...kinds: RepositoryChange[]): void => {
			for (const kind of kinds) {
				changes.add(kind);
			}
		};

		for (const probe of this.moved.values()) {
			if (this.kind === 'common') {
				// Nothing in an ignored worktree's admin entry is cached, nor its going
				const entry = parseWorktreeAdminPath(probe.path);
				if (entry != null && (this.worktrees.get(entry.id)?.ignored ?? this.removedWorktrees.get(entry.id))) {
					continue;
				}
			}

			for (const path of probe.emitAs ?? [probe.path]) {
				if (path === reftableProbePath) {
					if (this.kind === 'root') {
						add('head', 'heads');
					} else {
						add('heads', 'remotes', 'tags', 'stash');
					}
					continue;
				}

				if (this.kind === 'common') {
					if (path === 'FETCH_HEAD') {
						add('lastFetched');
						continue;
					}

					// An admin entry added or removed, as its HEAD appearing or going would report to a watcher
					if (path === 'worktrees') {
						const ids = this.getAddedOrRemovedWorktrees();
						if (ids == null) {
							add('worktrees', 'worktreeHead');
							anyWorktreeMoved = true;
						} else if (ids.length) {
							add('worktrees', 'worktreeHead');
							for (const id of ids) {
								movedWorktrees.add(id);
							}
						}
						continue;
					}

					const match = worktreeHeadRegex.exec(path);
					if (match != null) {
						add('worktrees', 'worktreeHead');
						movedWorktrees.add(match[1]);
						continue;
					}
				}

				const kinds = classifyGitDirChange(path);
				if (kinds != null) {
					add(...kinds);
				}
			}
		}

		// A worktree ignored or no longer: it left the worktree list or joined it, as an entry removed or added would
		for (const id of this.flippedWorktrees) {
			add('worktrees', 'worktreeHead');
			movedWorktrees.add(id);
		}

		return { changes: changes, movedWorktrees: anyWorktreeMoved ? undefined : movedWorktrees };
	}
}

/** A gate's own move reports nothing: the git dir itself, or a linked worktree's admin entry */
function isGatePath(path: string): boolean {
	if (path === gitDirGatePath) return true;

	const entry = parseWorktreeAdminPath(path);
	return entry != null && entry.file == null;
}

/** A component of the path is a file: Node's error, or the one VS Code's file system raises */
function isNotADirectory(ex: unknown): boolean {
	const code = (ex as { code?: unknown } | undefined)?.code;
	return code === 'ENOTDIR' || code === 'FileNotADirectory';
}
