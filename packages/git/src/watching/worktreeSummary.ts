import { areEqual } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError, raceWithSignal } from '@gitlens/utils/cancellation.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { MergeTargetsChangeEvent } from '../cache.js';
import type { GitTrackingUpstream } from '../models/branch.js';
import type { GitDir } from '../models/repository.js';
import type { AheadOfBaseTier } from '../providers/branches.js';
import type { RepositoryService } from '../repositoryService.js';
import type { WatcherRepoChangeEvent } from './changeEvent.js';
import type { RepositoryWatchService, WatchHandle } from './watchService.js';
import type { RepositoryWatchSession } from './watchSession.js';

export interface WorktreeSummaryUpstream {
	/** The upstream's short name (`origin/main`) */
	readonly name: string;
	/**
	 * The remote it tracks, as git reported it; on git too old to report it, the longest of the repository's remote
	 * names that {@link name} starts with, followed by `/` (a remote name can hold a slash). `undefined`, with
	 * {@link branch}, when it names no known remote (a branch tracking another local branch, or a remote since removed)
	 */
	readonly remote: string | undefined;
	/**
	 * The branch on {@link remote} — git's name for it there, which a custom fetch refspec can make differ from the end
	 * of {@link name}; `undefined` whenever {@link remote} is
	 */
	readonly branch: string | undefined;
	readonly missing: boolean;
}

export interface WorktreeSummaryBase {
	/** The ref the count was taken against (see `AheadOfBase.base`) */
	readonly ref: string;
	readonly ahead: number;
	/** The commit {@link ref} pointed at when the count was read; `undefined` when it couldn't be resolved */
	readonly sha: string | undefined;
	/** Where HEAD forked from {@link ref} (see `AheadOfBase.base`) */
	readonly forkPoint: string | undefined;
	/** The source the base came from (see `AheadOfBase.base`) */
	readonly tier: AheadOfBaseTier;
}

export interface WorktreeSummary {
	/** The repository path in {@link getRepositoryKey} form */
	readonly repoPath: string;
	/** The checked-out branch; `undefined` when detached (or unborn with no name) */
	readonly branch: string | undefined;
	readonly detached: boolean;
	/** HEAD's commit; `undefined` when HEAD has no commit yet */
	readonly sha: string | undefined;
	readonly upstream: WorktreeSummaryUpstream | undefined;
	/** Commits ahead of the upstream; 0 without one */
	readonly ahead: number;
	/** Commits behind the upstream; 0 without one */
	readonly behind: number;
	/** Whether there is any staged, unstaged or untracked (non-ignored) change */
	readonly dirty: boolean;
	/**
	 * How far the branch — or a detached HEAD, measured against the default branch — is past its base; `undefined` when
	 * unsupported or there is no base
	 */
	readonly base: WorktreeSummaryBase | undefined;
	/**
	 * Full ref names whose movement can change {@link base}, as `getAheadOfBase` reports them (see
	 * `AheadOfBase.dependsOn`) — given with or without a base, so a watcher also learns when one appears. Empty when
	 * the base isn't read (an unborn HEAD with no name, or a provider without `getAheadOfBase`), and when the base read
	 * failed with no earlier list for this HEAD (the first read, or the one after a checkout).
	 */
	readonly baseDependsOn: readonly string[];
	/**
	 * The latest recompute failed (worktree gone, lock contention); the other fields hold the last values read. Also set
	 * when only the base read failed: the other fields are fresh, and `base` and `baseDependsOn` are their last values,
	 * or `undefined` and empty if the branch changed.
	 */
	readonly stale: boolean;
}

export interface WorktreeSummarySubscribeOptions {
	/** Debounce for repo (`.git`) changes this subscriber asks of the watch session; the shortest across subscribers wins */
	readonly delayMs?: number;
	/** Cap on how long continuous repo activity can defer a recompute; `Infinity` means no cap */
	readonly maxWaitMs?: number;
	/** Debounce for working-tree changes this subscriber asks of the watch session */
	readonly workingTreeDelayMs?: number;
	/** Cap on how long continuous working-tree activity can defer a recompute; `Infinity` means no cap */
	readonly workingTreeMaxWaitMs?: number;
}

export interface WorktreeSummarySubscription extends UnifiedDisposable {
	/** The latest summary; `undefined` until the first read succeeds, or after disposal */
	readonly current: WorktreeSummary | undefined;
	/** Fires when the summary's value changes */
	readonly onDidChange: Event<WorktreeSummary>;
}

export interface WorktreeSummaryServiceOptions {
	readonly watchService: RepositoryWatchService;
	readonly getRepository: (repoPath: string) => RepositoryService | undefined;
	/**
	 * Fires as core writes a branch's merge target or base, before the store's promise resolves; the summary re-reads
	 * that branch's stored values then, so a `getSummary` right after an awaited store sees the new base
	 */
	readonly onDidChangeMergeTargets?: Event<MergeTargetsChangeEvent>;
	/**
	 * Maps a worktree path to the repository common path that {@link onDidChangeMergeTargets} events carry; only that
	 * repository's summaries react. Without it, or when it returns `undefined`, every summary reacts.
	 */
	readonly getCommonPath?: (repoPath: string) => string | undefined;
}

/** Read groups, as bit flags so a pending set is a number rather than an allocation per event */
const dirtyField = 1;
const branchField = 2;
const baseField = 4;
/** Re-reads only the stored values the base read consults, and the base itself only when they changed */
const baseKeysField = 8;
/** Every group a full read covers — a base read refreshes the {@link BaseKeys} snapshot itself */
const allFields = dirtyField | branchField | baseField;

const emptyRefs: readonly string[] = Object.freeze([]);

/**
 * The current branch's stored merge targets (user, detected) and recorded base, as `getAheadOfBase` consults them.
 * A detached HEAD has no stored values, so it holds {@link noBaseKeys}.
 */
type BaseKeys = readonly [string | undefined, string | undefined, string | undefined];

const noBaseKeys: BaseKeys = [undefined, undefined, undefined];

interface ReadResult {
	readonly summary: WorktreeSummary;
	readonly baseKeys: BaseKeys | undefined;
	/** Why the base read failed when the rest of the summary was read; the summary is then stale */
	readonly baseError: unknown;
}

interface SummaryEntry {
	readonly key: string;
	/** Aborted when the last subscriber leaves, cancelling any in-flight read */
	readonly abort: AbortController;
	readonly subscribers: Set<SummarySubscription>;
	handle: WatchHandle | undefined;
	/** The timing-neutral listening subscriptions and their event listeners */
	listeners: UnifiedDisposable[] | undefined;
	value: WorktreeSummary | undefined;
	/** The stored base values as of the last base read; a `gk` config change re-reads the base only when they differ */
	baseKeys: BaseKeys | undefined;
	/** Why the latest read failed while there was no value to keep */
	error: Error | undefined;
	/** Read groups due on the next run */
	pending: number;
	/** The active run (or the start-up, which ends in one); cleared in the same turn the loop sees nothing pending */
	running: Promise<void> | undefined;
	disposed: boolean;
}

class SummarySubscription implements WorktreeSummarySubscription {
	private readonly emitter = new Emitter<WorktreeSummary>();
	/** Listener-less session subscriptions that carry this subscriber's timing into the session */
	private timing: UnifiedDisposable[] | undefined;
	private disposed = false;

	constructor(
		private readonly entry: SummaryEntry,
		private readonly options: WorktreeSummarySubscribeOptions | undefined,
		private readonly onDispose: (subscription: SummarySubscription) => void,
	) {}

	get current(): WorktreeSummary | undefined {
		return this.disposed ? undefined : this.entry.value;
	}

	get onDidChange(): Event<WorktreeSummary> {
		return this.emitter.event;
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		if (this.timing != null) {
			for (const d of this.timing) {
				d.dispose();
			}
			this.timing = undefined;
		}
		this.emitter.dispose();
		this.onDispose(this);
	}

	attach(session: RepositoryWatchSession): void {
		if (this.disposed || this.timing != null) return;

		this.timing = [
			session.subscribe({ delayMs: this.options?.delayMs, maxWaitMs: this.options?.maxWaitMs }),
			session.subscribeToWorkingTree({
				delayMs: this.options?.workingTreeDelayMs,
				maxWaitMs: this.options?.workingTreeMaxWaitMs,
			}),
		];
	}

	fire(summary: WorktreeSummary): void {
		this.emitter.fire(summary);
	}
}

/**
 * A cached, change-notifying summary of each subscribed worktree — its branch, upstream and ahead/behind, whether it
 * has working changes, and how far it is past its base — kept current by the repository watch layer.
 *
 * **Lifecycle.** Entries are per repository key and ref-counted across {@link subscribe} calls. The first subscriber
 * starts watching the worktree and reads everything; the last one to leave aborts any in-flight read, releases the
 * watch and drops the value. Each subscriber's timing options join the watch session's cadence (the shortest wins);
 * the service's own listening subscriptions never constrain it.
 *
 * **Field-scoped recompute.** The summary is read in three groups — `dirty` (working changes), `branch` (branch,
 * HEAD's commit, upstream, ahead/behind) and `base` (ahead of base, the base's tip, and the refs it depends on) — and
 * an event recomputes only the groups it can affect: a working-tree edit, an index or ignore-rule change reads only
 * `dirty`; the upstream moving reads only `branch`; a ref the base depends on reads only `base`; a `gk` config change
 * (mostly bookkeeping writes to the shared `.git/gk/config`), or core's own write of the branch's merge target or
 * base, re-reads the branch's stored merge targets and recorded base, and reads `base` only when one of them changed;
 * the checked-out branch moving, or a HEAD change, reads all of them. Stash, unrelated tags and branches, and the like
 * read nothing. One run is in flight per worktree at a time; events during a run are merged into a single follow-up
 * run.
 *
 * **Value-change-only notification.** {@link WorktreeSummarySubscription.onDidChange} and {@link onDidChangeSummary}
 * fire only when some field's value differs from the previous summary — a recompute that reads the same answer is
 * silent, so a consumer can re-render on every event without diffing. A failed recompute keeps the last values and
 * sets `stale` (firing once); the next successful one clears it.
 */
export class WorktreeSummaryService implements UnifiedDisposable {
	private readonly _onDidChangeSummary = new Emitter<WorktreeSummary>();
	/** Fires when the summary of any subscribed worktree changes value */
	get onDidChangeSummary(): Event<WorktreeSummary> {
		return this._onDidChangeSummary.event;
	}

	private readonly entries = new Map<string, SummaryEntry>();
	private readonly watchService: RepositoryWatchService;
	private readonly getRepository: (repoPath: string) => RepositoryService | undefined;
	private readonly getCommonPath: ((repoPath: string) => string | undefined) | undefined;
	private readonly mergeTargetsListener: UnifiedDisposable | undefined;
	private _disposed = false;

	constructor(options: WorktreeSummaryServiceOptions) {
		this.watchService = options.watchService;
		this.getRepository = options.getRepository;
		this.getCommonPath = options.getCommonPath;
		this.mergeTargetsListener = options.onDidChangeMergeTargets?.(e => this.onMergeTargetsChanged(e));
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;

		this._disposed = true;
		this.mergeTargetsListener?.dispose();
		for (const entry of [...this.entries.values()]) {
			for (const subscription of [...entry.subscribers]) {
				subscription.dispose();
			}
		}
		this.entries.clear();
		this._onDidChangeSummary.dispose();
	}

	/** Subscribes to a worktree's summary, starting to watch and read it if this is its first subscriber */
	subscribe(repoPath: string, options?: WorktreeSummarySubscribeOptions): WorktreeSummarySubscription {
		const key = getRepositoryKey(repoPath);

		let entry = this._disposed ? undefined : this.entries.get(key);
		const isNew = entry == null;
		if (entry == null) {
			entry = createEntry(key);
			if (this._disposed) {
				entry.disposed = true;
			} else {
				this.entries.set(key, entry);
			}
		}

		const target = entry;
		const subscription = new SummarySubscription(target, options, s => this.release(target, s));
		target.subscribers.add(subscription);

		if (isNew) {
			if (!target.disposed) {
				target.pending = allFields;
				target.running = this.start(target);
			}
		} else if (target.handle != null) {
			subscription.attach(target.handle.session);
		} else if (target.running == null && !target.disposed) {
			// The start failed (no repository or git directory yet); a new subscriber retries it
			target.pending = allFields;
			target.running = this.start(target);
		}

		return subscription;
	}

	/**
	 * Returns a worktree's summary. For a subscribed worktree, the cached value — after waiting for any run in flight
	 * or pending; it rejects with the read's error when there is still no value. Otherwise a one-off full read that
	 * is neither cached nor watched.
	 */
	async getSummary(repoPath: string, cancellation?: AbortSignal): Promise<WorktreeSummary> {
		const key = getRepositoryKey(repoPath);
		const entry = this.entries.get(key);
		if (entry == null) {
			const repo = this.getRepository(key);
			if (repo == null) throw new Error(`No repository found for '${key}'`);

			const result = await readSummary(repo, key, allFields, undefined, undefined, cancellation);
			return result.summary;
		}

		if (entry.running != null) {
			await (cancellation != null ? raceWithSignal(entry.running, cancellation) : entry.running);
		}
		if (entry.disposed) throw new CancellationError();
		if (entry.value != null) return entry.value;

		throw entry.error ?? new Error(`No summary available for '${key}'`);
	}

	getResourceUsage(): ResourceUsage {
		return { 'worktreeSummary.entries.count': this.entries.size };
	}

	private async start(entry: SummaryEntry): Promise<void> {
		let gitDir: GitDir | undefined;
		try {
			gitDir = await this.getRepository(entry.key)?.config.getGitDir?.();
		} catch (ex) {
			if (entry.disposed) return;

			entry.running = undefined;
			if (!isCancellationError(ex)) {
				this.fail(entry, ex);
			}
			return;
		}
		if (entry.disposed) return;

		const handle = gitDir != null ? this.watchService.watch(entry.key, gitDir) : undefined;
		if (handle == null) {
			entry.running = undefined;
			this.fail(entry, new Error(`Unable to watch '${entry.key}': no repository or git directory`));
			return;
		}

		entry.handle = handle;
		const session = handle.session;
		// Timing-neutral: the cadence comes from the subscribers' own session subscriptions (see `attach`)
		const repoSub = session.subscribe({ delayMs: Infinity, maxWaitMs: Infinity });
		const workingTreeSub = session.subscribeToWorkingTree({ delayMs: Infinity, maxWaitMs: Infinity });
		entry.listeners = [
			repoSub.onDidChange(e => this.onRepoChanged(entry, e)),
			workingTreeSub.onDidChangeWorkingTree(() => this.queue(entry, dirtyField)),
			repoSub,
			workingTreeSub,
		];
		for (const subscription of entry.subscribers) {
			subscription.attach(session);
		}

		await this.drain(entry);
	}

	private onRepoChanged(entry: SummaryEntry, e: WatcherRepoChangeEvent): void {
		const value = entry.value;
		if (value == null || e.changed('unknown', 'head')) {
			this.queue(entry, allFields);
			return;
		}

		let fields = 0;
		if (e.changed('index', 'ignores')) {
			fields |= dirtyField;
		}
		if (e.changed('config')) {
			fields |= branchField | baseField;
		}
		if (e.changed('gkConfig')) {
			fields |= baseKeysField;
		}
		if (value.branch != null && e.mayHaveChangedRef(`refs/heads/${value.branch}`)) {
			fields |= allFields;
		}
		// The upstream's short name doesn't say whether it's remote or local (`--track main`), so test both forms
		if (
			value.upstream != null &&
			(e.mayHaveChangedRef(`refs/remotes/${value.upstream.name}`) ||
				e.mayHaveChangedRef(`refs/heads/${value.upstream.name}`))
		) {
			fields |= branchField;
		}
		if ((fields & baseField) === 0) {
			for (const ref of value.baseDependsOn) {
				if (e.mayHaveChangedRef(ref)) {
					fields |= baseField;
					break;
				}
			}
		}

		this.queue(entry, fields);
	}

	/**
	 * Queued synchronously, so a store awaited before `getSummary` finds the run in flight. The watcher's later
	 * `gkConfig` event for the same write then finds the keys unchanged and leaves the base alone.
	 */
	private onMergeTargetsChanged(e: MergeTargetsChangeEvent): void {
		for (const entry of this.entries.values()) {
			// Before the watch starts there's nothing to refresh: the start's own read comes after the write
			if (entry.handle == null) continue;

			// With no value yet, the first read may have read the stored values before the write, so `queue` reads
			// everything again
			const value = entry.value;
			if (value != null && (value.branch == null || (e.refs != null && !e.refs.has(value.branch)))) continue;

			const commonPath = this.getCommonPath?.(entry.key);
			if (commonPath != null && commonPath !== e.repoPath) continue;

			this.queue(entry, baseKeysField);
		}
	}

	private queue(entry: SummaryEntry, fields: number): void {
		if (entry.disposed || fields === 0) return;

		// Without a value a partial read has nothing to merge into, and a stale value's fields can't be trusted: a
		// partial read would clear `stale` while vouching for groups it never re-read
		entry.pending |= entry.value == null || entry.value.stale ? allFields : fields;
		entry.running ??= this.drain(entry);
	}

	/** Runs until nothing is pending. Never rejects — every failure becomes entry state. */
	private async drain(entry: SummaryEntry): Promise<void> {
		while (entry.pending !== 0 && !entry.disposed) {
			const fields = entry.pending;
			entry.pending = 0;
			await this.run(entry, fields);
		}
		// Same turn as the loop's last check, so an event can't queue fields that no run will pick up
		entry.running = undefined;
	}

	private async run(entry: SummaryEntry, fields: number): Promise<void> {
		const previous = entry.value;

		let result: ReadResult;
		try {
			const repo = this.getRepository(entry.key);
			if (repo == null) throw new Error(`No repository found for '${entry.key}'`);

			result = await readSummary(repo, entry.key, fields, previous, entry.baseKeys, entry.abort.signal);
		} catch (ex) {
			if (entry.disposed || isCancellationError(ex)) return;

			this.fail(entry, ex);
			return;
		}
		if (entry.disposed) return;

		if (result.summary.stale && (previous == null || !previous.stale)) {
			Logger.warn(
				`WorktreeSummaryService: reading the base of '${entry.key}' failed: ${String(result.baseError)}`,
			);
		}

		entry.error = undefined;
		entry.baseKeys = result.baseKeys;
		if (previous != null && summariesEqual(previous, result.summary)) return;

		entry.value = result.summary;
		this.fireChange(entry, result.summary);
	}

	private fail(entry: SummaryEntry, ex: unknown): void {
		const previous = entry.value;
		if (previous == null) {
			if (entry.error == null) {
				Logger.warn(`WorktreeSummaryService: reading '${entry.key}' failed: ${String(ex)}`);
			}
			entry.error = ex instanceof Error ? ex : new Error(String(ex));
			return;
		}
		if (previous.stale) return;

		Logger.warn(`WorktreeSummaryService: refreshing '${entry.key}' failed: ${String(ex)}`);
		const summary: WorktreeSummary = { ...previous, stale: true };
		entry.value = summary;
		this.fireChange(entry, summary);
	}

	private fireChange(entry: SummaryEntry, summary: WorktreeSummary): void {
		for (const subscription of entry.subscribers) {
			subscription.fire(summary);
		}
		this._onDidChangeSummary.fire(summary);
	}

	private release(entry: SummaryEntry, subscription: SummarySubscription): void {
		entry.subscribers.delete(subscription);
		if (entry.subscribers.size !== 0) return;

		entry.disposed = true;
		entry.abort.abort();
		if (entry.listeners != null) {
			for (const d of entry.listeners) {
				d.dispose();
			}
			entry.listeners = undefined;
		}
		entry.handle?.dispose();
		entry.handle = undefined;
		entry.value = undefined;
		entry.baseKeys = undefined;
		entry.pending = 0;
		entry.running = undefined;

		if (this.entries.get(entry.key) === entry) {
			this.entries.delete(entry.key);
		}
	}
}

function createEntry(key: string): SummaryEntry {
	return {
		key: key,
		abort: new AbortController(),
		subscribers: new Set(),
		handle: undefined,
		listeners: undefined,
		value: undefined,
		baseKeys: undefined,
		error: undefined,
		pending: 0,
		running: undefined,
		disposed: false,
	};
}

/**
 * Reads the due groups and fills the rest from `previous` (every group when there is none). The branch read comes
 * before the base read, which needs its name; the dirty read runs alongside both. A branch read that finds a
 * different branch (or detached state) also reads the base and dirty groups, and stored base values that differ
 * from `previousBaseKeys` read the base group. A failed base read doesn't fail the rest: the summary comes back stale,
 * keeping the previous base and `baseDependsOn` only while the branch is the same.
 */
async function readSummary(
	repo: RepositoryService,
	key: string,
	fields: number,
	previous: WorktreeSummary | undefined,
	previousBaseKeys: BaseKeys | undefined,
	signal: AbortSignal | undefined,
): Promise<ReadResult> {
	if (previous == null) {
		fields = allFields;
	}

	let dirtyRead = fields & dirtyField ? readDirty(repo, signal) : undefined;

	let branch = previous?.branch;
	let detached = previous?.detached ?? false;
	let sha = previous?.sha;
	let upstream = previous?.upstream;
	let ahead = previous?.ahead ?? 0;
	let behind = previous?.behind ?? 0;
	if (fields & branchField) {
		const current = await repo.branches.getBranch(undefined, undefined, signal);
		detached = current?.detached ?? false;
		branch = detached ? undefined : current?.name || undefined;
		sha = current?.sha;
		upstream = current?.upstream != null ? await toSummaryUpstream(repo, current.upstream, signal) : undefined;
		ahead = current?.upstream?.state.ahead ?? 0;
		behind = current?.upstream?.state.behind ?? 0;

		if (previous != null && (branch !== previous.branch || detached !== previous.detached)) {
			fields |= baseField;
			dirtyRead ??= readDirty(repo, signal);
		}
	}

	let base = previous?.base;
	let dependsOn = previous?.baseDependsOn ?? emptyRefs;
	let baseKeys = previousBaseKeys;
	let baseKeysRead = false;
	let baseFailed = false;
	let baseError: unknown;
	// A detached HEAD is measured as `undefined`; an unborn HEAD with no name has nothing to measure
	const baseReadable = repo.branches.getAheadOfBase != null && (detached || branch != null);
	if (fields & baseKeysField && !(fields & baseField) && baseReadable) {
		baseKeys = await readBaseKeys(repo, branch);
		baseKeysRead = true;
		if (baseKeys == null || previousBaseKeys == null || !baseKeysEqual(baseKeys, previousBaseKeys)) {
			fields |= baseField;
		}
	}
	if (fields & baseField) {
		if (!baseReadable) {
			base = undefined;
			dependsOn = emptyRefs;
			baseKeys = undefined;
		} else {
			// Snapshot before the base read, so a write it misses is one the next `gk` config event sees as a change
			if (!baseKeysRead) {
				baseKeys = await readBaseKeys(repo, branch);
			}
			try {
				const aheadOfBase = await repo.branches.getAheadOfBase?.(branch, undefined, signal);
				base = aheadOfBase?.base;
				dependsOn = aheadOfBase?.dependsOn ?? emptyRefs;
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				baseFailed = true;
				baseError = ex;
				// Keep `baseDependsOn` for the same branch: a fetch moving one of its refs is what retries the base
				const sameBranch = previous != null && branch === previous.branch && detached === previous.detached;
				base = sameBranch ? previous.base : undefined;
				dependsOn = sameBranch ? previous.baseDependsOn : emptyRefs;
				baseKeys = undefined;
			}
		}
	}

	const dirty = dirtyRead != null ? await dirtyRead : (previous?.dirty ?? false);

	return {
		summary: {
			repoPath: key,
			branch: branch,
			detached: detached,
			sha: sha,
			upstream: upstream,
			ahead: ahead,
			behind: behind,
			dirty: dirty,
			base: base,
			baseDependsOn: dependsOn,
			stale: baseFailed,
		},
		baseKeys: baseKeys,
		baseError: baseError,
	};
}

/**
 * Reads {@link BaseKeys} for `branch`, normalized the way `getAheadOfBase` reads them. `undefined` when any read
 * failed — an unknown snapshot, so the next `gk` config change reads the base rather than trusting it. A detached
 * HEAD (`branch` undefined) has no stored values to read.
 */
async function readBaseKeys(repo: RepositoryService, branch: string | undefined): Promise<BaseKeys | undefined> {
	if (branch == null) return noBaseKeys;

	try {
		const [user, detected, recorded] = await Promise.all([
			repo.branches.getStoredUserMergeTargetBranchName?.(branch),
			repo.branches.getStoredDetectedMergeTargetBranchName?.(branch),
			repo.config.getGkConfig?.(`branch.${branch}.gk-merge-base`),
		]);
		return [user?.trim() || undefined, detected?.trim() || undefined, recorded?.trim() || undefined];
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		return undefined;
	}
}

function baseKeysEqual(a: BaseKeys, b: BaseKeys): boolean {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function readDirty(repo: RepositoryService, signal: AbortSignal | undefined): Promise<boolean> {
	const read = repo.status.hasWorkingChanges({ untracked: true }, signal);
	// Awaited only after the branch and base reads; if one of those throws first, this rejection has no other handler
	read.catch(noop);
	return read;
}

function noop(): void {}

/**
 * Uses the remote and branch git reported for the upstream; only when it reported neither does this split the name
 * at the longest remote name it starts with (no split when none matches or nothing follows it)
 */
async function toSummaryUpstream(
	repo: RepositoryService,
	upstream: GitTrackingUpstream,
	signal: AbortSignal | undefined,
): Promise<WorktreeSummaryUpstream> {
	const { name, missing } = upstream;

	if (upstream.local) return { name: name, remote: undefined, branch: undefined, missing: missing };

	if (upstream.remote) {
		const { remote } = upstream;
		const branch =
			upstream.remoteBranch || (name.startsWith(`${remote}/`) ? name.substring(remote.length + 1) : undefined);
		return { name: name, remote: branch ? remote : undefined, branch: branch || undefined, missing: missing };
	}

	let remote: string | undefined;
	for (const r of await repo.remotes.getRemotes(undefined, signal)) {
		if (r.name && name.startsWith(`${r.name}/`) && (remote == null || r.name.length > remote.length)) {
			remote = r.name;
		}
	}

	const branch = remote != null ? name.substring(remote.length + 1) : undefined;
	return {
		name: name,
		remote: branch ? remote : undefined,
		branch: branch || undefined,
		missing: missing,
	};
}

function summariesEqual(a: WorktreeSummary, b: WorktreeSummary): boolean {
	return (
		a.repoPath === b.repoPath &&
		a.branch === b.branch &&
		a.detached === b.detached &&
		a.sha === b.sha &&
		a.ahead === b.ahead &&
		a.behind === b.behind &&
		a.dirty === b.dirty &&
		a.stale === b.stale &&
		areEqual(a.baseDependsOn, b.baseDependsOn) &&
		(a.upstream === b.upstream ||
			(a.upstream != null &&
				b.upstream != null &&
				a.upstream.name === b.upstream.name &&
				a.upstream.remote === b.upstream.remote &&
				a.upstream.branch === b.upstream.branch &&
				a.upstream.missing === b.upstream.missing)) &&
		(a.base === b.base ||
			(a.base != null &&
				b.base != null &&
				a.base.ref === b.base.ref &&
				a.base.ahead === b.base.ahead &&
				a.base.sha === b.base.sha &&
				a.base.forkPoint === b.base.forkPoint &&
				a.base.tier === b.base.tier))
	);
}
