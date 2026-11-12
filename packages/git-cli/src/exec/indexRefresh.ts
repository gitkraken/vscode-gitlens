import { normalizePath } from '@gitlens/utils/path.js';
import type { Git } from './git.js';
import { gitConfigsStatus } from './git.js';

export interface IndexRefresherOptions {
	/** Runs the refreshing `git status` */
	git: Pick<Git, 'run'>;
	/** The index file's modified time; `undefined` when it can't be read (no checkout, no index) */
	statIndexMtimeMs: (checkoutPath: string) => Promise<number | undefined>;
	/**
	 * Whether {@link IndexRefresher.refreshAfter} refreshes after core's own writes; off by default, since each refresh is
	 * a status of the whole checkout, worth it only where that checkout will be read again. {@link IndexRefresher.schedule}
	 * runs either way.
	 */
	afterWrites?: boolean;
	now?: () => number;
	/** Calls `fn` after `ms` and returns a function that cancels it; the default timer doesn't keep the process alive */
	setTimer?: (fn: () => void, ms: number) => () => void;
}

interface Entry {
	/** The checkout's path as the first schedule gave it, which the provider's caches are keyed by */
	readonly path: string;
	task: Promise<void>;
	/** Whether the status has started: a write that lands after that may have missed it */
	running: boolean;
	/** Whether another write was scheduled while the status was running */
	again: boolean;
	/** Whether another write was scheduled while the refresh waited: it may have stamped the index in a later second */
	joined: boolean;
	/** Ends the wait for the clock early, while there is one */
	cancelWait: (() => void) | undefined;
}

/**
 * The refresh's own cap, far past git's default: a status that re-hashes a large checkout can run for minutes and must
 * be allowed to finish, while one stuck on a stalled file system would otherwise hold a git slot, and keep that
 * checkout from ever being refreshed again, for as long as the process lives
 */
export const indexRefreshTimeoutMs = 10 * 60 * 1000;

function setUnrefTimer(fn: () => void, ms: number): () => void {
	const timer = setTimeout(fn, ms);
	timer.unref();
	return () => clearTimeout(timer);
}

/**
 * Rewrites a checkout's index once, in the background, after git has written a batch of its files.
 *
 * A write that touches many files (a clone, a worktree add, a branch switch, a fast-forward) stamps them in the same
 * second as the index file, and git compares timestamps at whole-second precision: an entry whose second is not
 * earlier than the index file's is "racily clean", so git can't trust it, and every later status or diff re-hashes the
 * file for as long as nothing rewrites the index. Core's own status reads run with `GIT_OPTIONAL_LOCKS=0`, so they
 * never write the refreshed index back.
 *
 * The refresh waits until the clock is in a later second than the index file's: one that rewrote the index in the same
 * second as the last file written would leave the entries racy all the same. It is a `status`, not `update-index
 * --refresh`: the latter holds the index lock for the whole re-hash, so a writer in the checkout meanwhile (a reset, a
 * first `git add`) would fail with "index.lock exists", whereas a status locks only for the short write at the end and
 * skips that write, still exiting 0, when someone else holds the lock. Optional locks are forced on for it because that
 * write is the whole point, applied over the inherited environment so a user's own `GIT_OPTIONAL_LOCKS=0` can't defeat it.
 *
 * One queue per checkout: a schedule while the refresh is waiting joins it, since the status hasn't read the tree yet,
 * and the wait is taken again from the index as that write left it; one while the status runs causes exactly one more
 * refresh after it, however many arrive, since the write may have landed after the status read the tree. Nothing here
 * throws, nor does a checkout removed meanwhile.
 */
export class IndexRefresher {
	private readonly _entries = new Map<string, Entry>();
	private _disposed = false;
	private readonly _now: () => number;
	private readonly _setTimer: (fn: () => void, ms: number) => () => void;

	constructor(private readonly options: IndexRefresherOptions) {
		this._now = options.now ?? Date.now;
		this._setTimer = options.setTimer ?? setUnrefTimer;
	}

	/** Cancels the waits and stops anything more from starting; a status already running is left to finish */
	dispose(): void {
		this._disposed = true;
		for (const entry of this._entries.values()) {
			entry.cancelWait?.();
		}
	}

	/** The refresh waiting or running for a checkout, if any */
	pending(checkoutPath: string): Promise<void> | undefined {
		return this._entries.get(normalizePath(checkoutPath))?.task;
	}

	/** Starts a refresh of the checkout's index in the background, or joins the one in progress. Never throws. */
	schedule(checkoutPath: string): void {
		if (this._disposed) return;

		const key = normalizePath(checkoutPath);
		const entry = this._entries.get(key);
		if (entry == null) {
			const created: Entry = {
				path: checkoutPath,
				task: Promise.resolve(),
				running: false,
				again: false,
				joined: false,
				cancelWait: undefined,
			};
			this._entries.set(key, created);
			created.task = this.run(key, created);
			return;
		}

		if (entry.running) {
			entry.again = true;
		} else {
			entry.joined = true;
		}
	}

	/**
	 * Runs a write, then schedules a refresh when it rewrote the checkout's index, which is the sign that it rewrote
	 * files; a write that touched none (already up to date, a switch to the commit already checked out) leaves the index
	 * alone and schedules none. A write that fails is checked the same way before its error is rethrown untouched: a
	 * merge or rebase that stops on conflicts has rewritten the clean files and the index first, and those are read the
	 * most while the conflicts are resolved, whereas a checkout or merge refused outright leaves the index alone and
	 * schedules none (a stash apply or push rewrites it first, so schedules one even when refused or with nothing to
	 * save). Only the check is awaited, not the refresh it may schedule.
	 *
	 * `checkoutPath` is the checkout the write rewrote, which isn't always the one it ran in. Without
	 * {@link IndexRefresherOptions.afterWrites}, it only runs the write.
	 */
	async refreshAfter<T>(checkoutPath: string, write: () => Promise<T>): Promise<T> {
		if (!this.options.afterWrites) return write();

		const startedAt = this._now();
		try {
			return await write();
		} finally {
			await this.scheduleIfIndexRewritten(checkoutPath, startedAt);
		}
	}

	private async scheduleIfIndexRewritten(checkoutPath: string, writeStartedAt: number): Promise<void> {
		try {
			const mtimeMs = await this.options.statIndexMtimeMs(checkoutPath);
			if (mtimeMs != null && mtimeMs >= Math.floor(writeStartedAt / 1000) * 1000) {
				this.schedule(checkoutPath);
			}
		} catch {}
	}

	private async run(key: string, entry: Entry): Promise<void> {
		try {
			do {
				entry.again = false;
				entry.running = false;
				await this.refreshOnce(entry);
			} while (entry.again && !this._disposed);
		} catch {
			// Best-effort: a failed refresh only leaves the entries as untrusted as they were
		} finally {
			this._entries.delete(key);
		}
	}

	private async refreshOnce(entry: Entry): Promise<void> {
		const checkoutPath = entry.path;
		// A write that joined while this waited may have stamped the index in a later second than the one waited out
		do {
			entry.joined = false;
			const mtimeMs = await this.options.statIndexMtimeMs(checkoutPath);
			if (mtimeMs == null) return;

			// The file system can stamp the index ahead of this clock (a network or VM-shared folder, a clock set back),
			// and waiting for this clock to reach that second could take any time. The file system's own clock was at
			// least at the stamp when the stat read it, so it has passed that second once the rest of the second has gone
			// by since
			const laterSecondMs = (Math.floor(mtimeMs / 1000) + 1) * 1000;
			const deadlineMs = Math.min(laterSecondMs, this._now() + laterSecondMs - mtimeMs);
			for (let wait = deadlineMs - this._now(); wait > 0; wait = deadlineMs - this._now()) {
				if (this._disposed) return;

				await new Promise<void>(resolve => {
					const cancel = this._setTimer(resolve, wait);
					entry.cancelWait = () => {
						cancel();
						resolve();
					};
				});
				entry.cancelWait = undefined;
			}
			if (this._disposed) return;
		} while (entry.joined);

		entry.running = true;
		await this.options.git.run(
			{
				cwd: checkoutPath,
				// Skips the rename detection between HEAD and the index, which the refresh doesn't need; older git ignores it
				configs: [...gitConfigsStatus, '-c', 'status.renames=false'],
				env: { GIT_OPTIONAL_LOCKS: '1' },
				errors: 'ignore',
				priority: 'background',
				selfMaintenance: true,
				timeout: indexRefreshTimeoutMs,
			},
			'status',
			'--porcelain',
			'-uno',
			// The index refreshes all the same; this only skips the status git runs inside each submodule
			'--ignore-submodules=all',
		);
	}
}

/** {@link IndexRefresher.refreshAfter}, or only the write when there is no refresher */
export function refreshIndexAfter<T>(
	refresher: IndexRefresher | undefined,
	checkoutPath: string,
	write: () => Promise<T>,
): Promise<T> {
	return refresher != null ? refresher.refreshAfter(checkoutPath, write) : write();
}
