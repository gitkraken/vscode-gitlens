import { areEqual } from '@gitlens/utils/array.js';
import { CancellationError, isCancellationError, raceWithSignal } from '@gitlens/utils/cancellation.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { joinPaths } from '@gitlens/utils/path.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { MergeTargetsChangeEvent } from '../cache.js';
import type { GitTrackingUpstream } from '../models/branch.js';
import type { GitRefTip } from '../models/reference.js';
import type { GitDir } from '../models/repository.js';
import type { AheadOfBase, AheadOfBaseTier } from '../providers/branches.js';
import type { RepositoryService } from '../repositoryService.js';
import type { WatcherRepoChangeEvent } from './changeEvent.js';
import { getRefChangeKind } from './changeEvent.js';
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

export interface WorktreeSummarySnapshot {
	readonly summary: WorktreeSummary;
	/**
	 * When {@link WorktreeSummary.dirty} was read (`Date.now()` as the read started), for a worktree without a
	 * subscription, whose working tree nothing watches, or a subscribed one still showing such a read's (see
	 * {@link WorktreeSummarySubscription.dirtyReadAt}); `undefined` for a subscribed worktree whose summary follows its
	 * working tree
	 */
	readonly dirtyReadAt: number | undefined;
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
	/**
	 * When {@link current}'s dirty flag was read, while it's still the one a read without a subscription found: the
	 * working-tree watch reads it once live. `undefined` once the summary follows its working tree, or after disposal
	 */
	readonly dirtyReadAt: number | undefined;
	/**
	 * Fires when the summary's value changes, and with the same summary when a dirty flag kept from a read without a
	 * subscription is read again (see {@link dirtyReadAt})
	 */
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
	/**
	 * Reads a path's modification time (ms) and size; `undefined` when it doesn't exist, and a rejection means unknown.
	 * With it, a read of a worktree without a subscription re-reads the dirty flag only when the worktree's index file
	 * moved since the last one (or when asked to); without it, on every such read.
	 */
	readonly stat?: (path: string) => Promise<{ readonly mtime: number; readonly size: number } | undefined>;
	/**
	 * For tests only; production never passes it. Called whenever the base re-measure answers in place of a full base
	 * read, with its answer and what a full `getAheadOfBase` of the same branch answers right after (`undefined` when
	 * that rejects or the provider has none), so a test can fail where the shortcut keeps an answer the full read would
	 * not. The summary keeps the re-measure's answer either way. The full read goes through the same provider and
	 * caches as the shortcut, so it checks the shortcut's reasoning, not whether those caches are current. The callback
	 * should record a mismatch for the test to fail on rather than throw: a throw is taken for a failed base read.
	 * Unset, it costs one check of the option.
	 */
	readonly verifyBaseRemeasure?: (remeasured: AheadOfBase, full: AheadOfBase | undefined) => void;
}

/** Read groups, as bit flags so a pending set is a number rather than an allocation per event */
const dirtyField = 1;
const branchField = 2;
const baseField = 4;
/** Re-reads only the stored values the base read consults, and the base itself only when they changed */
const baseKeysField = 8;
/** Re-reads the provider's Git config inputs before deciding whether the base needs a refresh */
const baseConfigField = 16;
/**
 * Refreshes the base after only refs it depends on moved, each named exactly (in {@link SummaryEntry.baseMoves}): when
 * the base's own ref just moved forward, it is re-measured rather than resolved again. {@link baseField} overrides it.
 */
const baseMoveField = 32;
/** Every group a full read covers — a base read refreshes the {@link BaseKeys} snapshot itself */
const allFields = dirtyField | branchField | baseField;

// Shared config and ref changes reach every checkout of a repository together; bound that repository's Git fan-out so
// input can keep moving. Per repository, so a burst in one, or reads hung in it, never holds up another's.
const maxConcurrentReadsPerRepository = 4;
// And across repositories, so a start (or an overflow rescan) over many of them never runs four reads for each at once.
// Each read runs a couple of git processes side by side, so eight leave most of the process queue to foreground
// commands and the CPU to the host; a hung read still frees its slot once git's command timeout ends it.
const maxConcurrentReads = 8;
// Worktrees without a subscription whose last read is kept to answer from: a host listing more than this re-reads the
// least recently asked in full
const maxUnwatchedReads = 256;
// How long a newly subscribed worktree serves its saved dirty flag waiting for its working-tree watch to go live; past
// it, the flag is read without the rescan, so a provider that promised a start that never comes can't leave it
// unconfirmed
const maxDeferredDirtyMs = 10_000;

const emptyRefs: readonly string[] = Object.freeze([]);

/**
 * The current branch's stored merge targets (user, detected) and recorded base, as `getAheadOfBase` consults them.
 * A detached HEAD has no stored values, so it holds {@link noBaseKeys}.
 */
type BaseKeys = readonly [string | undefined, string | undefined, string | undefined];

const noBaseKeys: BaseKeys = [undefined, undefined, undefined];

/**
 * The provider's Git config inputs to the base as one read found them: its entries (see
 * `getAheadOfBaseConfigEntries`), or the opaque key of a provider without them
 */
type BaseConfig = readonly (readonly [key: string, value: string | undefined])[] | string;

interface ReadResult {
	readonly summary: WorktreeSummary;
	readonly baseKeys: BaseKeys | undefined;
	readonly baseConfigKey: string | undefined;
	/** The default branch the base read resolved (see `AheadOfBase.defaultBranch`); `undefined` when unknown */
	readonly baseDefaultBranch: string | null | undefined;
	/** Why the base read failed when the rest of the summary was read; the summary is then stale */
	readonly baseError: unknown;
	/** When the dirty read started; `undefined` when dirty wasn't read but kept from `previous` */
	readonly dirtyReadAt: number | undefined;
}

/**
 * What an unwatched read was read from, taken just before it, so a change landing during the read leaves these looking
 * older than the disk and the next read re-reads what it moved. All of it comes from core's caches, which the `.git`
 * watch drops on a HEAD or ref change, or from one stat.
 */
interface UnwatchedInputs {
	/** HEAD as `getBranch` answered it: the branch (`undefined` when detached), detached, and HEAD's commit */
	readonly branch: string | undefined;
	readonly detached: boolean;
	readonly sha: string | undefined;
	/** The upstream's short name, which a `.git/config` write can change without moving any ref */
	readonly upstream: string | undefined;
	/**
	 * The upstream's tips as a remote-tracking and as a local branch, since its short name doesn't say which; `undefined`
	 * without an upstream
	 */
	readonly upstreamTips: string | undefined;
	/**
	 * The tip of each ref the base depends on, or for a remote's `HEAD` symref the ref it points at (see
	 * {@link getBaseInput}); `undefined` for one that doesn't exist, which counts as unchanged only while it stays out,
	 * and `null` for one that couldn't be read, which never does
	 */
	readonly baseTips: ReadonlyMap<string, string | null | undefined>;
	/** The size and modification time of the worktree's index file; `undefined` when unknown (no stat, or it failed) */
	readonly index: string | undefined;
}

/** The last read of a worktree without a subscription, answered from until its inputs move */
interface UnwatchedRead {
	readonly result: ReadResult;
	readonly dirtyReadAt: number;
	readonly inputs: UnwatchedInputs;
	/** Read groups due on the next read whatever the inputs say: core's own write of the branch's merge target or base */
	due: number;
}

/** What an unwatched read finds of its inputs before it reads */
interface UnwatchedProbe {
	readonly branch: string | undefined;
	readonly detached: boolean;
	readonly sha: string | undefined;
	readonly upstream: string | undefined;
	/** The ref tips' commits by full name (see {@link getTipsByName}) */
	readonly tips: ReadonlyMap<string, string>;
	/** Where the `HEAD` symref of each remote it read points, by remote name (see {@link readRemoteHeads}) */
	readonly remoteHeads: Map<string, string | null | undefined>;
	readonly index: string | undefined;
}

/** A read of a worktree without a subscription, which concurrent callers share */
class UnwatchedFlight {
	readonly abort = new AbortController();
	/** Callers waiting for it; the read is aborted once none is */
	callers = 0;
	/** Read groups made due while it ran, carried into what it stores */
	due = 0;
	readonly promise: Promise<UnwatchedRead>;

	constructor(
		readonly key: string,
		/** Whether it re-reads the dirty flag whatever its inputs say; a caller asking for that joins only such a read */
		readonly probeDirty: boolean,
		/** Set once no caller waits any longer (or the service is disposed), which aborts the read */
		public disposed: boolean,
		read: (flight: UnwatchedFlight) => Promise<UnwatchedRead>,
	) {
		// A turn later, once the caller registered it: a read failing before its first await must still find itself the
		// registered one, to drop the last read
		this.promise = Promise.resolve().then(() => read(this));
		// Callers race it against their own cancellation, so once every one gave up its rejection has no other handler
		this.promise.catch(noop);
	}
}

interface SummaryEntry {
	readonly key: string;
	/**
	 * The repository's common git directory, which keys its read slots; set once the watch starts, and kept after the
	 * last subscriber leaves, since a read still in flight then frees the slots it took under it
	 */
	slotsKey: string | undefined;
	/** Aborted when the last subscriber leaves, cancelling any in-flight read */
	readonly abort: AbortController;
	readonly subscribers: Set<SummarySubscription>;
	handle: WatchHandle | undefined;
	/** The timing-neutral listening subscriptions and their event listeners */
	listeners: UnifiedDisposable[] | undefined;
	value: WorktreeSummary | undefined;
	/**
	 * The last read without a subscription, which the first run starts from; never answered, since its dirty flag
	 * doesn't follow the working tree
	 */
	seed: WorktreeSummary | undefined;
	/**
	 * When the value's dirty flag was read, while it is still the saved read's (see `queueSeedStart`); `undefined` once
	 * the value follows the working tree
	 */
	dirtyReadAt: number | undefined;
	/** Reads the saved read's dirty flag should the working-tree watch not go live in {@link maxDeferredDirtyMs} */
	dirtyReadTimer: ReturnType<typeof setTimeout> | undefined;
	/** The stored base values as of the last base read; a `gk` config change re-reads the base only when they differ */
	baseKeys: BaseKeys | undefined;
	/**
	 * The config inputs the last base read consulted, as of just before it (see {@link getBaseConfigKey}); a config
	 * change re-reads the base only when they differ
	 */
	baseConfigKey: string | undefined;
	/** The default branch the last base read resolved, for a re-measure to check; `undefined` when unknown */
	baseDefaultBranch: string | null | undefined;
	/** Why the latest read failed while there was no value to keep */
	error: Error | undefined;
	/** Read groups due on the next run */
	pending: number;
	/** The refs the base depends on that moved, by name, for a pending {@link baseMoveField} */
	baseMoves: Set<string> | undefined;
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

	get dirtyReadAt(): number | undefined {
		// Nothing to date before the first value
		return this.disposed || this.entry.value == null ? undefined : this.entry.dirtyReadAt;
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
 * starts watching the worktree and reads everything, or, for a worktree last read without a subscription, starts from
 * that read: it re-reads the groups whose inputs moved since, by the same rules as such a read, and always `dirty` —
 * unless its working-tree watch is still starting, when the rescan that watch owes reads it, and the summary keeps the
 * saved read's flag, with its `dirtyReadAt`, until then. The last one to leave aborts any in-flight read, releases the
 * watch and drops the value. Each subscriber's timing options join the watch session's cadence (the shortest wins);
 * the service's own listening subscriptions never constrain it.
 *
 * **Field-scoped recompute.** The summary is read in three groups — `dirty` (working changes), `branch` (branch,
 * HEAD's commit, upstream, ahead/behind) and `base` (ahead of base, the base's tip, and the refs it depends on) — and
 * an event recomputes only the groups it can affect: a working-tree edit, an index or ignore-rule change reads only
 * `dirty`; the upstream moving reads only `branch`; a ref the base depends on reads only `base`, and when the refs that
 * moved are named and include the base's own ref, as a fetch names them, the provider first tries re-measuring the
 * base from the previous one (one count per worktree when it only moved forward); a `gk` config change
 * (mostly bookkeeping writes to the shared `.git/gk/config`), or core's own write of the branch's merge target or
 * base, re-reads the branch's stored merge targets and recorded base, and reads `base` only when one of them changed;
 * a `.git/config` change reads `branch` and the provider's config inputs to the base (one cached read shared by the
 * repository's checkouts, or one per checkout where config can differ by checkout), and reads `base` only when the
 * inputs its last base read consulted (every branch's tracking but those of branches it didn't depend on), the stored
 * values, HEAD's commit or the upstream changed, unless it was confined to the
 * `branch.<name>` sections of branches the summary neither is on, tracks nor bases on (its `configBranches`), which
 * reads nothing; the checked-out branch moving, or a HEAD change, reads all of them. Stash, unrelated tags and
 * branches, and the like read nothing. One run is in flight per worktree at a time, at most four per repository (the
 * worktrees sharing a common git directory), and at most eight across the service. Runs take turns first come, first
 * served, except that one whose repository is at its cap lets later runs of other repositories go first, so a burst in
 * one repository never delays another's reads: events while a run waits for its turn join it, and events during a run
 * are merged into a single follow-up run.
 *
 * **Value-change-only notification.** {@link WorktreeSummarySubscription.onDidChange} and {@link onDidChangeSummary}
 * fire only when some field's value differs from the previous summary — a recompute that reads the same answer is
 * silent, so a consumer can re-render on every event without diffing. A failed recompute keeps the last values and
 * sets `stale` (firing once); the next successful one clears it. A summary still showing the dirty flag of a read
 * without a subscription fires again, unchanged, once that flag is read again (its `dirtyReadAt` cleared).
 *
 * **Worktrees without a subscription.** {@link getSummary} and {@link getSummarySnapshot} answer one from its last read
 * (kept for the {@link maxUnwatchedReads} most recently asked), re-reading only the groups whose inputs moved since:
 * HEAD's branch or commit reads all of them; the upstream's tip, or its name, reads `branch`; a ref the base depends on
 * (where a remote's `HEAD` symref points, for one) reads `base`, re-measured from the previous one where that can
 * answer; the config inputs its base read consulted read `branch` and the base when they changed; and the worktree's
 * index file reads `dirty`. The inputs come from core's caches, so nothing moved means no git at all; only a `.git`
 * watch of the worktree (or core's own writes) keeps them current, so a host must watch the `.git` of a worktree it
 * asks about this way for others' changes to show. Its working tree is unwatched, so an edit that leaves the index
 * alone goes unseen until `dirty` is read again: the snapshot says when that was, and `probeDirty` reads it anyway.
 * Concurrent reads of a worktree share one, and take no read slot: each is a caller's foreground read, which never
 * waits behind subscribed worktrees' runs. A first subscriber takes over the last read.
 */
export class WorktreeSummaryService implements UnifiedDisposable {
	private readonly _onDidChangeSummary = new Emitter<WorktreeSummary>();
	/**
	 * Fires when the summary of any subscribed worktree changes value, and with the same summary when a dirty flag kept
	 * from a read without a subscription is read again (see {@link WorktreeSummarySubscription.dirtyReadAt})
	 */
	get onDidChangeSummary(): Event<WorktreeSummary> {
		return this._onDidChangeSummary.event;
	}

	private readonly entries = new Map<string, SummaryEntry>();
	/** Reads running for each repository, by its slots key; a repository with none has no entry */
	private readonly activeReadsByRepository = new Map<string, number>();
	private activeReads = 0;
	/** Entries waiting for a read slot, oldest first */
	private readonly readWaiters = new Map<SummaryEntry, (acquired: boolean) => void>();
	/** The last read of each worktree without a subscription, by repository key */
	private readonly unwatchedReads = new LruMap<string, UnwatchedRead>(maxUnwatchedReads);
	/** The read in flight for each worktree without a subscription, by repository key */
	private readonly unwatchedFlights = new Map<string, UnwatchedFlight>();
	private readonly watchService: RepositoryWatchService;
	private readonly getRepository: (repoPath: string) => RepositoryService | undefined;
	private readonly getCommonPath: ((repoPath: string) => string | undefined) | undefined;
	private readonly stat: WorktreeSummaryServiceOptions['stat'];
	private readonly verifyBaseRemeasure: WorktreeSummaryServiceOptions['verifyBaseRemeasure'];
	private readonly mergeTargetsListener: UnifiedDisposable | undefined;
	private _disposed = false;

	constructor(options: WorktreeSummaryServiceOptions) {
		this.watchService = options.watchService;
		this.getRepository = options.getRepository;
		this.getCommonPath = options.getCommonPath;
		this.stat = options.stat;
		this.verifyBaseRemeasure = options.verifyBaseRemeasure;
		this.mergeTargetsListener = options.onDidChangeMergeTargets?.(e => this.onMergeTargetsChanged(e));
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;

		this._disposed = true;
		for (const resolve of this.readWaiters.values()) {
			resolve(false);
		}
		this.readWaiters.clear();
		for (const flight of this.unwatchedFlights.values()) {
			flight.disposed = true;
			flight.abort.abort();
		}
		this.unwatchedFlights.clear();
		this.unwatchedReads.clear();
		this.mergeTargetsListener?.dispose();
		for (const entry of [...this.entries.values()]) {
			for (const subscription of [...entry.subscribers]) {
				subscription.dispose();
			}
		}
		this.entries.clear();
		this._onDidChangeSummary.dispose();
	}

	/**
	 * Subscribes to a worktree's summary, starting to watch and read it if this is its first subscriber: from its last
	 * read without a subscription, if any, re-reading the groups whose inputs moved since and the dirty flag — at once,
	 * or, while its working-tree watch is still starting, as that watch goes live
	 */
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
				// The start takes over the last unwatched read, and a read still in flight no longer stores one
				this.unwatchedFlights.delete(key);
				target.running = this.start(target);
			}
		} else if (target.handle != null) {
			subscription.attach(target.handle.session);
		} else if (target.running == null && !target.disposed) {
			// The start failed (no repository or git directory yet); a new subscriber retries it
			target.running = this.start(target);
		}

		return subscription;
	}

	/**
	 * Returns a worktree's summary. For a subscribed worktree, the cached value — after waiting for any run in flight
	 * or pending; it rejects with the read's error when there is still no value. Otherwise the last read of it,
	 * re-reading what moved since (see {@link getSummarySnapshot}).
	 */
	async getSummary(repoPath: string, cancellation?: AbortSignal): Promise<WorktreeSummary> {
		const key = getRepositoryKey(repoPath);
		const entry = this.entries.get(key);
		if (entry == null) return (await this.getUnwatchedSnapshot(key, false, cancellation)).summary;

		return this.getSubscribedSummary(entry, cancellation);
	}

	/**
	 * Returns a worktree's summary, with when its dirty flag was read. A subscribed worktree answers as
	 * {@link getSummary} does, with `dirtyReadAt` `undefined` once its summary follows its working tree, and until then
	 * the saved read's (see {@link WorktreeSummarySubscription.dirtyReadAt}), which `probeDirty` reads again. Any other
	 * answers from its last read, re-reading only the groups whose inputs moved since (no git when none did), and in
	 * full the first time, or after a failed or stale read. Its working tree is unwatched, so the dirty flag is re-read
	 * only when the index file moved, or with `probeDirty`; a rejection drops the last read. Its inputs are core's
	 * cached answers, which only a `.git` watch of the worktree (or core's own writes) keeps current.
	 */
	async getSummarySnapshot(
		repoPath: string,
		options?: { probeDirty?: boolean; cancellation?: AbortSignal },
	): Promise<WorktreeSummarySnapshot> {
		const key = getRepositoryKey(repoPath);
		const entry = this.entries.get(key);
		if (entry == null) return this.getUnwatchedSnapshot(key, options?.probeDirty ?? false, options?.cancellation);

		return this.getSubscribedSnapshot(entry, options?.probeDirty ?? false, options?.cancellation);
	}

	private async getSubscribedSnapshot(
		entry: SummaryEntry,
		probeDirty: boolean,
		cancellation: AbortSignal | undefined,
	): Promise<WorktreeSummarySnapshot> {
		let summary = await this.getSubscribedSummary(entry, cancellation);
		// Asked for, a dirty flag kept from the saved read is read now rather than once the watch goes live. Looked at
		// after the wait, since the start decides to keep it only once it probed
		if (probeDirty && entry.dirtyReadAt != null) {
			this.queue(entry, dirtyField);
			summary = await this.getSubscribedSummary(entry, cancellation);
		}
		return { summary: summary, dirtyReadAt: entry.dirtyReadAt };
	}

	private async getSubscribedSummary(
		entry: SummaryEntry,
		cancellation: AbortSignal | undefined,
	): Promise<WorktreeSummary> {
		if (entry.running != null) {
			await (cancellation != null ? raceWithSignal(entry.running, cancellation) : entry.running);
		}
		if (entry.disposed) throw new CancellationError();
		if (entry.value != null) return entry.value;

		throw entry.error ?? new Error(`No summary available for '${entry.key}'`);
	}

	/** Joins the read in flight for `key`, or starts one; the read is aborted only once no caller waits for it */
	private async getUnwatchedSnapshot(
		key: string,
		probeDirty: boolean,
		cancellation: AbortSignal | undefined,
	): Promise<WorktreeSummarySnapshot> {
		if (cancellation?.aborted) throw new CancellationError();

		let flight = this.getJoinableFlight(key);
		if (probeDirty) {
			// A read that won't re-read the dirty flag can't answer a caller that asked for it; wait it out, then read
			// again
			while (flight != null && !flight.probeDirty) {
				const waited = flight;
				try {
					await (cancellation != null ? raceWithSignal(waited.promise, cancellation) : waited.promise);
				} catch (ex) {
					if (cancellation?.aborted) throw ex;
				}
				flight = this.getJoinableFlight(key);
				// Settled, though its callers haven't all let go of it yet
				if (flight === waited) {
					flight = undefined;
				}
			}

			// A subscription that started meanwhile answers instead, its summary following the working tree
			const entry = this.entries.get(key);
			if (entry != null) return this.getSubscribedSnapshot(entry, true, cancellation);
		}

		if (flight == null) {
			flight = new UnwatchedFlight(key, probeDirty, this._disposed, f => this.readUnwatched(f));
			if (!this._disposed) {
				this.unwatchedFlights.set(key, flight);
			}
		}

		const current = flight;
		current.callers++;
		try {
			const read = await (cancellation != null ? raceWithSignal(current.promise, cancellation) : current.promise);
			return { summary: read.result.summary, dirtyReadAt: read.dirtyReadAt };
		} finally {
			current.callers--;
			// Settled, or every caller gave up; either way a later caller starts a read of its own. Aborted even once
			// another read or a subscription took its place, which no caller waits on any longer
			if (current.callers === 0) {
				if (this.unwatchedFlights.get(key) === current) {
					this.unwatchedFlights.delete(key);
				}
				current.disposed = true;
				current.abort.abort();
			}
		}
	}

	/**
	 * The read in flight for `key`, unless core wrote a merge target or base while it ran: it may have read the stored
	 * values before the write, and a caller after an awaited write sees them, as one of a subscribed worktree does
	 */
	private getJoinableFlight(key: string): UnwatchedFlight | undefined {
		const flight = this.unwatchedFlights.get(key);
		return flight?.due === 0 ? flight : undefined;
	}

	private async readUnwatched(flight: UnwatchedFlight): Promise<UnwatchedRead> {
		const { key } = flight;
		const signal = flight.abort.signal;
		if (flight.disposed) throw new CancellationError();

		// A stale read's fields can't be trusted (see `queue`), so it is read again in full
		let last = this.unwatchedReads.get(key);
		if (last?.result.summary.stale) {
			last = undefined;
		}

		try {
			const repo = this.getRepository(key);
			if (repo == null) throw new Error(`No repository found for '${key}'`);

			// Core drops every remote's cached `HEAD` symref on any ref change, so after the first read only those the
			// base depends on are read, unless the base is read again
			const headRemotes = last != null ? getHeadRemotes(last.result.summary.baseDependsOn) : undefined;
			const probe = await this.probeUnwatched(repo, headRemotes, true, signal);
			if (flight.disposed) throw new CancellationError();

			let fields: number;
			let baseMoves: Set<string> | undefined;
			if (last == null) {
				// The config inputs too, so a later base move can be re-measured against the key they had
				fields = allFields | baseConfigField;
			} else {
				({ fields, baseMoves } = await getMovedFields(repo, last, probe, flight.probeDirty, signal));
				if (flight.disposed) throw new CancellationError();

				if (fields === 0) {
					this.unwatchedReads.touch(key);
					return last;
				}
			}

			// A base read can come to depend on any remote's `HEAD`, so the rest are read too, before it like the other
			// inputs
			if (headRemotes != null && (fields & (baseField | baseKeysField | baseConfigField | baseMoveField)) !== 0) {
				await readRemoteHeads(repo, probe.remoteHeads, undefined, signal);
				if (flight.disposed) throw new CancellationError();
			}

			// No read slot: like the one-off read it replaces, this is a caller's foreground read, which never waits
			// behind subscribed worktrees' runs
			let result = await readSummary(
				repo,
				key,
				fields,
				last?.result.summary,
				last?.result.baseKeys,
				last?.result.baseConfigKey,
				last?.result.baseDefaultBranch,
				baseMoves,
				signal,
				this.verifyBaseRemeasure,
			);

			// Keep the summary the caller already has when nothing in it changed
			const kept = last?.result.summary;
			if (kept != null && summariesEqual(kept, result.summary)) {
				result = { ...result, summary: kept };
			}
			const read: UnwatchedRead = {
				result: result,
				// Without a last read every group was read, dirty included
				dirtyReadAt: result.dirtyReadAt ?? last?.dirtyReadAt ?? Date.now(),
				inputs: toUnwatchedInputs(probe, result.summary),
				due: flight.due,
			};
			if (this.unwatchedFlights.get(key) === flight && !this.entries.has(key)) {
				this.unwatchedReads.set(key, read);
			}
			return read;
		} catch (ex) {
			if (!isCancellationError(ex) && this.unwatchedFlights.get(key) === flight) {
				this.unwatchedReads.delete(key);
			}
			throw ex;
		}
	}

	/**
	 * Reads an unwatched read's inputs: cached answers but for the index file's stat (see {@link UnwatchedInputs}), with
	 * the `HEAD` symrefs of `remotes` (every remote's when `undefined`); without `statIndex`, the index is unknown
	 */
	private async probeUnwatched(
		repo: RepositoryService,
		remotes: ReadonlySet<string> | undefined,
		statIndex: boolean,
		signal: AbortSignal,
	): Promise<UnwatchedProbe> {
		const remoteHeads = new Map<string, string | null | undefined>();
		const stat = statIndex ? this.stat : undefined;
		const [current, tips, gitDir] = await Promise.all([
			repo.branches.getBranch(undefined, undefined, signal),
			repo.refs.getRefTips(undefined, signal),
			stat != null ? getGitDir(repo) : undefined,
			readRemoteHeads(repo, remoteHeads, remotes, signal),
		]);

		let index: string | undefined;
		if (stat != null && gitDir != null) {
			try {
				const stats = await stat(joinPaths(gitDir.uri.fsPath, 'index'));
				index = stats != null ? `${stats.size}:${stats.mtime}` : '';
			} catch {
				index = undefined;
			}
		}

		const detached = current?.detached ?? false;
		return {
			branch: detached ? undefined : current?.name || undefined,
			detached: detached,
			sha: current?.sha,
			upstream: current?.upstream?.name,
			tips: getTipsByName(tips),
			remoteHeads: remoteHeads,
			index: index,
		};
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
		if (gitDir == null || handle == null) {
			entry.running = undefined;
			this.fail(entry, new Error(`Unable to watch '${entry.key}': no repository or git directory`));
			return;
		}

		// Taken only now: until the watch is placed, core's write of a merge target or base skips the entry but still
		// makes the stored values due on the saved read. A stale one's fields can't be trusted (see `queue`)
		let last = this.unwatchedReads.get(entry.key);
		this.unwatchedReads.delete(entry.key);
		if (last?.result.summary.stale) {
			last = undefined;
		}
		if (last != null) {
			entry.seed = last.result.summary;
			// The values its base read consulted, or the first `gk` config or config change would read the base again
			entry.baseKeys = last.result.baseKeys;
			entry.baseConfigKey = last.result.baseConfigKey;
			entry.baseDefaultBranch = last.result.baseDefaultBranch;
		} else {
			entry.pending |= allFields | baseConfigField;
		}

		entry.handle = handle;
		entry.slotsKey = getRepositoryKey(gitDir.commonUri ?? gitDir.uri);
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

		// Probed once listening, so a change landing meanwhile is queued against the seed rather than missed. Whether
		// the working-tree watch the listeners placed is still starting is asked now: should it go live during the
		// probe, the rescan it queues reads the dirty flag the first run would otherwise read too
		if (last != null) {
			await this.queueSeedStart(entry, last, this.watchService.isWorkingTreeStarting(entry.key));
			if (entry.disposed) return;
		}

		await this.drain(entry);
	}

	/**
	 * Queues the groups of the saved read `last` whose inputs moved since, as an unwatched read finds them, and the
	 * dirty flag, which no input vouches for; everything when its inputs can't be read. With `deferDirty`, the dirty
	 * flag is left to the rescan of a working-tree watch still starting, and the value keeps `last`'s until then
	 */
	private async queueSeedStart(entry: SummaryEntry, last: UnwatchedRead, deferDirty: boolean): Promise<void> {
		const signal = entry.abort.signal;
		let moved: { fields: number; baseMoves: Set<string> | undefined } | undefined;
		try {
			const repo = this.getRepository(entry.key);
			if (repo != null) {
				// No stat of the index: the dirty flag is read whatever it says
				const probe = await this.probeUnwatched(
					repo,
					getHeadRemotes(last.result.summary.baseDependsOn),
					false,
					signal,
				);
				if (entry.disposed) return;

				moved = await getMovedFields(repo, last, probe, true, signal);
			}
		} catch {
			// Unknown inputs, read in full below
		}
		if (entry.disposed) return;

		if (moved == null) {
			dropSeed(entry);
			entry.pending |= allFields | baseConfigField;
			return;
		}

		if (deferDirty) {
			// A working-tree change queued meanwhile still reads it
			entry.pending |= moved.fields & ~dirtyField;
			entry.dirtyReadAt = last.dirtyReadAt;
			// Cleared with `dirtyReadAt`, so it fires only while the saved flag is still shown
			entry.dirtyReadTimer = setTimeout(() => {
				entry.dirtyReadTimer = undefined;
				this.queue(entry, dirtyField);
			}, maxDeferredDirtyMs);
			// Nothing to read before the watch goes live: the saved read is the first value as it is
			if (entry.pending === 0 && entry.seed != null) {
				const seed = entry.seed;
				entry.error = undefined;
				entry.seed = undefined;
				entry.value = seed;
				this.fireChange(entry, seed);
			}
		} else {
			entry.pending |= moved.fields;
		}
		if (moved.baseMoves != null) {
			entry.baseMoves ??= new Set();
			for (const ref of moved.baseMoves) {
				entry.baseMoves.add(ref);
			}
		}
	}

	private onRepoChanged(entry: SummaryEntry, e: WatcherRepoChangeEvent): void {
		const value = entry.value ?? entry.seed;
		if (value == null || e.changed('unknown', 'head')) {
			this.queue(entry, allFields | (e.changed('config') ? baseConfigField : 0));
			return;
		}

		let fields = 0;
		if (e.changed('index', 'ignores')) {
			fields |= dirtyField;
		}
		if (e.changed('config') && e.mayHaveChangedConfig(getConfigRelevantRefs(value))) {
			fields |= branchField | baseKeysField | baseConfigField;
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
		let baseMoves: string[] | undefined;
		if ((fields & baseField) === 0) {
			for (const ref of value.baseDependsOn) {
				if (!e.mayHaveChangedRef(ref)) continue;

				// Only a ref named exactly is known to be the one that moved: a ref directory or a ref kind that changed
				// without names (a packed-refs rewrite, an overflow, a poll) may hide any move
				const kind = getRefChangeKind(ref);
				if (!e.refs.has(ref) || kind == null || e.unnamedRefKinds.has(kind)) {
					fields |= baseField;
					baseMoves = undefined;
					break;
				}

				baseMoves ??= [];
				baseMoves.push(ref);
			}
			if (baseMoves != null) {
				fields |= baseMoveField;
			}
		}

		this.queue(entry, fields, baseMoves);
	}

	/**
	 * Queued synchronously, so a store awaited before `getSummary` finds the run in flight. The watcher's later
	 * `gkConfig` event for the same write then finds the keys unchanged and leaves the base alone.
	 */
	private onMergeTargetsChanged(e: MergeTargetsChangeEvent): void {
		for (const entry of this.entries.values()) {
			// Before the watch starts there's nothing to refresh: the start's own read comes after the write
			if (entry.handle == null) continue;

			// With no value yet, the first read may have read the stored values before the write, so they're read again:
			// with everything when there's no saved read to start from, else compared with that read's
			const value = entry.value;
			if (value != null && (value.branch == null || (e.refs != null && !e.refs.has(value.branch)))) continue;

			if (!this.isInRepository(entry.key, e.repoPath)) continue;

			this.queue(entry, baseKeysField);
		}

		// No ref moves for such a write, so a worktree without a subscription re-reads the stored values on its next read
		for (const read of this.unwatchedReads.values()) {
			const value = read.result.summary;
			if (value.branch == null || (e.refs != null && !e.refs.has(value.branch))) continue;
			if (!this.isInRepository(value.repoPath, e.repoPath)) continue;

			read.due |= baseKeysField;
		}
		// One in flight may have read them before the write, so it takes no more callers; its branch isn't known yet,
		// so any of the repository's
		for (const flight of this.unwatchedFlights.values()) {
			if (!this.isInRepository(flight.key, e.repoPath)) continue;

			flight.due |= baseKeysField;
		}
	}

	private isInRepository(key: string, commonPath: string): boolean {
		const path = this.getCommonPath?.(key);
		return path == null || path === commonPath;
	}

	private queue(entry: SummaryEntry, fields: number, baseMoves?: readonly string[]): void {
		if (entry.disposed || fields === 0) return;

		// Without a value (or a saved read to start from) a partial read has nothing to merge into, and a stale value's
		// fields can't be trusted: a partial read would clear `stale` while vouching for groups it never re-read
		const value = entry.value ?? entry.seed;
		entry.pending |= value == null || value.stale ? fields | allFields | baseConfigField : fields;
		if (baseMoves != null) {
			entry.baseMoves ??= new Set();
			for (const ref of baseMoves) {
				entry.baseMoves.add(ref);
			}
		}
		entry.running ??= this.drain(entry);
	}

	/** Runs until nothing is pending. Never rejects — every failure becomes entry state. */
	private async drain(entry: SummaryEntry): Promise<void> {
		while (entry.pending !== 0 && !entry.disposed) {
			if (!(await this.acquireRead(entry))) break;

			try {
				if (entry.disposed) break;

				// Consume after acquiring: changes that arrived while queued belong to this same read.
				const fields = entry.pending;
				const baseMoves = entry.baseMoves;
				entry.pending = 0;
				entry.baseMoves = undefined;
				await this.run(entry, fields, baseMoves);
			} finally {
				this.releaseRead(entry);
			}
		}
		// Same turn as the loop's last check, so an event can't queue fields that no run will pick up
		entry.running = undefined;
	}

	/**
	 * A read takes one of its repository's slots and one of the service's. Each release hands what it frees to the
	 * waiters first, so a new read takes a slot only when no waiter can use it.
	 */
	private acquireRead(entry: SummaryEntry): Promise<boolean> {
		if (entry.disposed || this._disposed) return Promise.resolve(false);

		if (this.tryTakeReadSlots(entry)) return Promise.resolve(true);

		return new Promise(resolve => this.readWaiters.set(entry, resolve));
	}

	private releaseRead(entry: SummaryEntry): void {
		const key = entry.slotsKey ?? entry.key;
		const active = this.activeReadsByRepository.get(key);
		if (active == null) return;

		if (active > 1) {
			this.activeReadsByRepository.set(key, active - 1);
		} else {
			this.activeReadsByRepository.delete(key);
		}
		this.activeReads--;

		// The oldest waiter whose repository has a free slot goes next, so a repository at its own cap never holds up
		// another's waiters, and a busy checkout rejoins the tail for a follow-up rather than starving its siblings
		for (const [waiter, resolve] of this.readWaiters) {
			if (this.activeReads >= maxConcurrentReads) break;

			if (waiter.disposed || this._disposed) {
				this.readWaiters.delete(waiter);
				resolve(false);
				continue;
			}
			if (!this.tryTakeReadSlots(waiter)) continue;

			this.readWaiters.delete(waiter);
			resolve(true);
		}
	}

	private tryTakeReadSlots(entry: SummaryEntry): boolean {
		if (this.activeReads >= maxConcurrentReads) return false;

		const key = entry.slotsKey ?? entry.key;
		const active = this.activeReadsByRepository.get(key) ?? 0;
		if (active >= maxConcurrentReadsPerRepository) return false;

		this.activeReadsByRepository.set(key, active + 1);
		this.activeReads++;
		return true;
	}

	private async run(entry: SummaryEntry, fields: number, baseMoves: ReadonlySet<string> | undefined): Promise<void> {
		const { value, seed } = entry;
		const previous = value ?? seed;

		let result: ReadResult;
		try {
			const repo = this.getRepository(entry.key);
			if (repo == null) throw new Error(`No repository found for '${entry.key}'`);

			result = await readSummary(
				repo,
				entry.key,
				fields,
				previous,
				entry.baseKeys,
				entry.baseConfigKey,
				entry.baseDefaultBranch,
				baseMoves,
				entry.abort.signal,
				this.verifyBaseRemeasure,
			);
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
		entry.seed = undefined;
		entry.baseKeys = result.baseKeys;
		entry.baseConfigKey = entry.pending & baseConfigField ? undefined : result.baseConfigKey;
		entry.baseDefaultBranch = result.baseDefaultBranch;
		// Any read of the dirty flag ends showing the saved one, even one a branch read adds on finding another branch
		const dirtyConfirmed = result.dirtyReadAt != null && entry.dirtyReadAt != null;
		if (dirtyConfirmed) {
			clearDeferredDirty(entry);
		}
		if (value != null && summariesEqual(value, result.summary)) {
			// Unchanged, but no longer the saved read's
			if (dirtyConfirmed) {
				this.fireChange(entry, value);
			}
			return;
		}

		// The first value is published even when it reads as the seed, as the seed's own object for a host that has it
		const summary = value == null && seed != null && summariesEqual(seed, result.summary) ? seed : result.summary;
		entry.value = summary;
		this.fireChange(entry, summary);
	}

	private fail(entry: SummaryEntry, ex: unknown): void {
		const previous = entry.value;
		if (previous == null) {
			if (entry.seed != null) {
				dropSeed(entry);
				// Changes during the run were queued against the seed; without one they read everything
				if (entry.pending !== 0) {
					entry.pending |= allFields | baseConfigField;
				}
			}
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
		// A waiter holds no slot, so dropping it frees none
		const cancelRead = this.readWaiters.get(entry);
		if (cancelRead != null) {
			this.readWaiters.delete(entry);
			cancelRead(false);
		}
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
		entry.seed = undefined;
		clearDeferredDirty(entry);
		entry.baseKeys = undefined;
		entry.baseConfigKey = undefined;
		entry.baseDefaultBranch = undefined;
		entry.pending = 0;
		entry.baseMoves = undefined;
		entry.running = undefined;

		if (this.entries.get(entry.key) === entry) {
			this.entries.delete(entry.key);
		}
	}
}

/**
 * The local branches whose config sections a summary reads: its branch's (upstream and base keys), and those of the
 * branches it tracks or bases on. The upstream's short name doesn't say whether it's local, so it counts as local too.
 */
function* getConfigRelevantRefs(value: WorktreeSummary): Iterable<string> {
	if (value.branch != null) {
		yield `refs/heads/${value.branch}`;
	}
	if (value.upstream != null) {
		yield `refs/heads/${value.upstream.name}`;
	}
	yield* value.baseDependsOn;
}

/** Drops the saved read a first run was to start from, with the values its base read consulted and its dirty flag */
function dropSeed(entry: SummaryEntry): void {
	entry.seed = undefined;
	clearDeferredDirty(entry);
	entry.baseKeys = undefined;
	entry.baseConfigKey = undefined;
	entry.baseDefaultBranch = undefined;
}

function clearDeferredDirty(entry: SummaryEntry): void {
	entry.dirtyReadAt = undefined;
	clearTimeout(entry.dirtyReadTimer);
	entry.dirtyReadTimer = undefined;
}

function createEntry(key: string): SummaryEntry {
	return {
		key: key,
		slotsKey: undefined,
		abort: new AbortController(),
		subscribers: new Set(),
		handle: undefined,
		listeners: undefined,
		value: undefined,
		seed: undefined,
		dirtyReadAt: undefined,
		dirtyReadTimer: undefined,
		baseKeys: undefined,
		baseConfigKey: undefined,
		baseDefaultBranch: undefined,
		error: undefined,
		pending: 0,
		baseMoves: undefined,
		running: undefined,
		disposed: false,
	};
}

/**
 * Reads the due groups and fills the rest from `previous` (every group when there is none). The branch read comes
 * before the base read, which needs its name; the dirty read runs alongside both. A branch read that finds a
 * different branch (or detached state) also reads the base and dirty groups, and stored base values that differ
 * from `previousBaseKeys` read the base group. A base due only because `baseMoves` moved, with HEAD, the stored
 * values and the config inputs as before, is first re-measured from `previous` and the default branch its read
 * resolved, `previousBaseDefaultBranch` (see `getAheadOfBaseAfterBaseMove`), and read in full only when that can't
 * answer. A failed base read doesn't fail the rest: the summary comes back stale, keeping the previous
 * base and `baseDependsOn` only while the branch is the same.
 */
async function readSummary(
	repo: RepositoryService,
	key: string,
	fields: number,
	previous: WorktreeSummary | undefined,
	previousBaseKeys: BaseKeys | undefined,
	previousBaseConfigKey: string | undefined,
	previousBaseDefaultBranch: string | null | undefined,
	baseMoves: ReadonlySet<string> | undefined,
	signal: AbortSignal | undefined,
	verifyBaseRemeasure: WorktreeSummaryServiceOptions['verifyBaseRemeasure'],
): Promise<ReadResult> {
	if (previous == null) {
		fields |= allFields;
	}

	let dirtyReadAt: number | undefined;
	const startDirtyRead = (): Promise<boolean> => {
		dirtyReadAt = Date.now();
		return readDirty(repo, signal);
	};
	let dirtyRead = fields & dirtyField ? startDirtyRead() : undefined;

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
			dirtyRead ??= startDirtyRead();
		}
	}

	let base = previous?.base;
	let dependsOn = previous?.baseDependsOn ?? emptyRefs;
	let baseKeys = previousBaseKeys;
	let baseKeysRead = false;
	let baseConfigKey = previousBaseConfigKey;
	let baseConfig: BaseConfig | undefined;
	let baseConfigRead = false;
	let baseDefaultBranch = previousBaseDefaultBranch;
	let baseFailed = false;
	let baseError: unknown;
	// A detached HEAD is measured as `undefined`; an unborn HEAD with no name has nothing to measure
	const baseReadable = repo.branches.getAheadOfBase != null && (detached || branch != null);
	if (fields & baseConfigField && !(fields & baseField) && baseReadable) {
		baseConfig = await readBaseConfig(repo, signal);
		baseConfigRead = true;
		// Without a base read due, the branch and upstream are as before, so the inputs to compare are the ones the last
		// base read consulted
		const key = previous != null ? getBaseConfigKey(baseConfig, previous) : undefined;
		if (
			key == null ||
			key !== previousBaseConfigKey ||
			sha !== previous?.sha ||
			!upstreamsEqual(upstream, previous?.upstream)
		) {
			fields |= baseField;
		}
	}
	if (fields & baseKeysField && !(fields & baseField) && baseReadable) {
		baseKeys = await readBaseKeys(repo, branch);
		baseKeysRead = true;
		if (baseKeys == null || previousBaseKeys == null || !baseKeysEqual(baseKeys, previousBaseKeys)) {
			fields |= baseField;
		}
	}
	if (fields & (baseField | baseMoveField)) {
		if (!baseReadable) {
			base = undefined;
			dependsOn = emptyRefs;
			baseKeys = undefined;
			baseConfigKey = undefined;
			baseDefaultBranch = undefined;
		} else {
			// Snapshot before the base read, so a write it misses is one the next `gk` config event sees as a change
			if (!baseKeysRead) {
				baseKeys = await readBaseKeys(repo, branch);
			}
			if (!baseConfigRead && (previous != null || (fields & baseConfigField) !== 0)) {
				baseConfig = await readBaseConfig(repo, signal);
				baseConfigRead = true;
			}
			try {
				let aheadOfBase: AheadOfBase | undefined;
				// The config inputs too, though no config change is due: a write can land between the last read and its
				// event (core evicts its own write's caches before the event fires), and the re-measure reads no config,
				// so the key kept with it would vouch for config the base never saw
				if (
					!(fields & baseField) &&
					baseMoves != null &&
					baseMoves.size !== 0 &&
					previous?.base != null &&
					sha != null &&
					sha === previous.sha &&
					baseKeys != null &&
					previousBaseKeys != null &&
					baseKeysEqual(baseKeys, previousBaseKeys) &&
					getBaseConfigKey(baseConfig, previous) === previousBaseConfigKey
				) {
					aheadOfBase = await repo.branches.getAheadOfBaseAfterBaseMove?.(
						branch,
						{
							head: sha,
							base: previous.base,
							dependsOn: previous.baseDependsOn,
							...(previousBaseDefaultBranch !== undefined
								? { defaultBranch: previousBaseDefaultBranch }
								: undefined),
						},
						[...baseMoves],
						signal,
					);
					if (aheadOfBase != null && verifyBaseRemeasure != null) {
						let full: AheadOfBase | undefined;
						try {
							full = await repo.branches.getAheadOfBase?.(branch, undefined, signal);
						} catch (ex) {
							if (isCancellationError(ex)) throw ex;
						}
						verifyBaseRemeasure(aheadOfBase, full);
					}
				}
				aheadOfBase ??= await repo.branches.getAheadOfBase?.(branch, undefined, signal);
				base = aheadOfBase?.base;
				dependsOn = aheadOfBase?.dependsOn ?? emptyRefs;
				baseDefaultBranch = aheadOfBase?.defaultBranch;
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				baseFailed = true;
				baseError = ex;
				// Keep `baseDependsOn` for the same branch: a fetch moving one of its refs is what retries the base
				const sameBranch = previous != null && branch === previous.branch && detached === previous.detached;
				base = sameBranch ? previous.base : undefined;
				dependsOn = sameBranch ? previous.baseDependsOn : emptyRefs;
				baseKeys = undefined;
				baseConfigRead = false;
				baseConfigKey = undefined;
				baseDefaultBranch = undefined;
			}
		}
	}

	const dirty = dirtyRead != null ? await dirtyRead : (previous?.dirty ?? false);

	const summary: WorktreeSummary = {
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
	};
	// Keyed on what this run's base read (or the one it kept) consulted, from the inputs read before it
	if (baseConfigRead) {
		baseConfigKey = getBaseConfigKey(baseConfig, summary);
	}

	return {
		summary: summary,
		baseKeys: baseKeys,
		baseConfigKey: baseConfigKey,
		baseDefaultBranch: baseDefaultBranch,
		baseError: baseError,
		dirtyReadAt: dirtyReadAt,
	};
}

async function getGitDir(repo: RepositoryService): Promise<GitDir | undefined> {
	try {
		return await repo.config.getGitDir?.();
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		return undefined;
	}
}

/** Each ref list's tips by full name, built once per list, which core's cache shares across a repository's worktrees */
const tipsByNameCache = new WeakMap<readonly GitRefTip[], ReadonlyMap<string, string>>();

function getTipsByName(tips: readonly GitRefTip[]): ReadonlyMap<string, string> {
	let byName = tipsByNameCache.get(tips);
	if (byName == null) {
		const map = new Map<string, string>();
		for (const tip of tips) {
			map.set(tip.fullName, tip.sha);
		}
		byName = map;
		tipsByNameCache.set(tips, byName);
	}
	return byName;
}

/**
 * The read groups due on a read from `last`, given what `probe` found of its inputs since (with the refs the base
 * depends on that moved): those `last` made due, and those whose inputs moved
 */
async function getMovedFields(
	repo: RepositoryService,
	last: UnwatchedRead,
	probe: UnwatchedProbe,
	probeDirty: boolean,
	signal: AbortSignal,
): Promise<{ fields: number; baseMoves: Set<string> | undefined }> {
	let fields = last.due;
	let baseMoves: Set<string> | undefined;
	const { inputs } = last;
	const previous = last.result.summary;
	if (probe.branch !== inputs.branch || probe.detached !== inputs.detached || probe.sha !== inputs.sha) {
		// The branch read only widens to the rest for a different branch, but a commit moves the base count and can
		// leave the working tree clean
		fields |= allFields;
	} else {
		if (probe.upstream !== inputs.upstream) {
			// The config inputs too, which read the base again when the upstream's identity changed
			fields |= branchField | baseConfigField;
		} else if (getUpstreamTips(probe.tips, probe.upstream) !== inputs.upstreamTips) {
			fields |= branchField;
		}
		for (const ref of previous.baseDependsOn) {
			// An unreadable value is unknown, so it moved
			const value = getBaseInput(probe, ref);
			if (value !== null && value === inputs.baseTips.get(ref)) continue;

			baseMoves ??= new Set();
			baseMoves.add(ref);
		}
		if (baseMoves != null) {
			fields |= baseMoveField;
		}
		// A config write the base read consulted (another branch's tracking, a remote, the default branch) moves no
		// ref; one cached read, as a subscribed worktree's config change reads
		if (
			(fields & baseConfigField) === 0 &&
			last.result.baseConfigKey != null &&
			repo.branches.getAheadOfBase != null &&
			(probe.detached || probe.branch != null)
		) {
			const configKey = getBaseConfigKey(await readBaseConfig(repo, signal), previous);
			// An unreadable config is unknown, not changed
			if (configKey != null && configKey !== last.result.baseConfigKey) {
				fields |= branchField | baseConfigField;
			}
		}
	}
	if (probeDirty || probe.index == null || probe.index !== inputs.index) {
		fields |= dirtyField;
	}
	return { fields: fields, baseMoves: baseMoves };
}

/** The upstream's tips as a remote-tracking and as a local branch, since its short name doesn't say which */
function getUpstreamTips(tips: ReadonlyMap<string, string>, upstream: string | undefined): string | undefined {
	if (upstream == null) return undefined;

	return `${tips.get(`refs/remotes/${upstream}`) ?? ''}\0${tips.get(`refs/heads/${upstream}`) ?? ''}`;
}

/**
 * Reads where the `HEAD` symref of each of `remotes` (every remote's when `undefined`) points (`origin/main`) into
 * `heads`, as core's cached local reads answer it, skipping those already there: `undefined` when it has none (a
 * remote since removed included), `null` when the read failed
 */
async function readRemoteHeads(
	repo: RepositoryService,
	heads: Map<string, string | null | undefined>,
	remotes: ReadonlySet<string> | undefined,
	signal: AbortSignal,
): Promise<void> {
	if (remotes?.size === 0) return;

	const names = remotes ?? (await repo.remotes.getRemotes(undefined, signal)).map(r => r.name);
	await Promise.all(
		Array.from(names, async name => {
			if (heads.has(name)) return;

			let target: string | null | undefined;
			try {
				target = await repo.branches.getDefaultBranchName(name, { local: true }, signal);
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				target = null;
			}
			heads.set(name, target);
		}),
	);
}

/** The remote whose `HEAD` symref `ref` is; `undefined` for any other ref */
function getHeadRemote(ref: string): string | undefined {
	if (!ref.startsWith('refs/remotes/') || !ref.endsWith('/HEAD')) return undefined;

	// A remote name can hold a slash, so the remote is everything between
	return ref.slice('refs/remotes/'.length, -'/HEAD'.length);
}

/** The remotes whose `HEAD` symref is among `refs` */
function getHeadRemotes(refs: readonly string[]): Set<string> {
	const remotes = new Set<string>();
	for (const ref of refs) {
		const remote = getHeadRemote(ref);
		if (remote != null) {
			remotes.add(remote);
		}
	}
	return remotes;
}

/**
 * What `probe` found of `ref`, a ref the base depends on: for a remote's `HEAD` symref, which the ref tips leave out,
 * the ref it points at, since its tip follows that ref's, itself a dependency; else its tip. `null` for a symref of a
 * remote it didn't read: only when the read found HEAD elsewhere than the probe did and read the base for that, which
 * the next probe sees as HEAD moving anyway
 */
function getBaseInput(probe: UnwatchedProbe, ref: string): string | null | undefined {
	const remote = getHeadRemote(ref);
	if (remote == null) return probe.tips.get(ref);

	return probe.remoteHeads.has(remote) ? probe.remoteHeads.get(remote) : null;
}

/** The inputs `summary` was read from, as the probe before its read found them */
function toUnwatchedInputs(probe: UnwatchedProbe, summary: WorktreeSummary): UnwatchedInputs {
	const baseTips = new Map<string, string | null | undefined>();
	for (const ref of summary.baseDependsOn) {
		baseTips.set(ref, getBaseInput(probe, ref));
	}
	return {
		branch: probe.branch,
		detached: probe.detached,
		sha: probe.sha,
		upstream: probe.upstream,
		upstreamTips: getUpstreamTips(probe.tips, probe.upstream),
		baseTips: baseTips,
		index: probe.index,
	};
}

async function readBaseConfig(
	repo: RepositoryService,
	signal: AbortSignal | undefined,
): Promise<BaseConfig | undefined> {
	try {
		if (repo.branches.getAheadOfBaseConfigEntries != null) {
			return await repo.branches.getAheadOfBaseConfigEntries(signal);
		}
		return await repo.branches.getAheadOfBaseConfigKey?.(signal);
	} catch (ex) {
		if (isCancellationError(ex)) throw ex;

		return undefined;
	}
}

/**
 * The key of the config inputs a base read for `value` consulted: every entry except the `branch.<name>` ones of local
 * branches outside its {@link getConfigRelevantRefs}, which the read never resolved. So a write to another branch's
 * section, confined (which wakes no summary but changes the inputs) or not, leaves the base alone. An opaque key is
 * taken whole.
 */
function getBaseConfigKey(config: BaseConfig | undefined, value: WorktreeSummary): string | undefined {
	if (config == null || typeof config === 'string') return config;

	const branches = new Set<string>();
	for (const ref of getConfigRelevantRefs(value)) {
		if (ref.startsWith('refs/heads/')) {
			branches.add(ref.substring('refs/heads/'.length));
		}
	}

	let key = '';
	for (const [name, entry] of config) {
		// The subsection is everything between the first and last dot, so a branch name can hold dots
		const last = name.lastIndexOf('.');
		if (
			name.startsWith('branch.') &&
			last > 'branch.'.length &&
			!branches.has(name.substring('branch.'.length, last))
		) {
			continue;
		}

		key += entry != null ? `${name}\n${entry}\0` : `${name}\0`;
	}
	return key;
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

function upstreamsEqual(a: WorktreeSummaryUpstream | undefined, b: WorktreeSummaryUpstream | undefined): boolean {
	return (
		a === b ||
		(a != null &&
			b != null &&
			a.name === b.name &&
			a.remote === b.remote &&
			a.branch === b.branch &&
			a.missing === b.missing)
	);
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
		upstreamsEqual(a.upstream, b.upstream) &&
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
