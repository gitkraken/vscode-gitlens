import type { QueueablePullRequest } from '../../shared/mergeQueue.utils.js';
import { isPullRequestQueued } from '../../shared/mergeQueue.utils.js';
import type { SheetDescriptor } from './sheetStack.js';

/** How long after a queued pull request lands before the Graph asks about it again. The host caches a queued pull
 *  request for 5 minutes (`src/cache.ts`), from before this side received it — so a little past that guarantees the
 *  re-ask reaches the provider instead of the same cached answer. */
export const queuedPullRequestRecheckMs = 5 * 60 * 1000 + 15_000;

/** Where the webview re-emits the host's visibility pushes (`webview-visible` / `webview-hidden`, dispatched by
 *  `RpcController` from the shared `webview` service's save-last `onVisibilityChanged`). */
type VisibilitySource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
 * A one-shot timer that doesn't run while the webview is hidden. The Graph is `retainContextWhenHidden`, so a plain
 * timer keeps firing (and asking the host for work) while nobody can see the result. Hiding parks the remaining time;
 * showing resumes it, or fires at once when it came due while hidden.
 *
 * At most one recheck is pending: {@link schedule} replaces the previous one, and the abort listener on its `signal`
 * comes off whenever the recheck fires, is cancelled, or is replaced — so re-arming against one long-lived signal
 * doesn't stack listeners on it.
 */
export class PausableRecheckTimer {
	private _dueAt?: number;
	private _hidden = false;
	private _onDue?: () => void;
	private _signal?: AbortSignal;
	private _timer?: ReturnType<typeof setTimeout>;
	private _visibilitySource?: VisibilitySource;

	constructor(
		private readonly delayMs: number,
		// Resolved on first schedule, not at construction — the owner is constructed outside a DOM in unit tests.
		private readonly getVisibilitySource: () => VisibilitySource = () => window,
	) {}

	get pending(): boolean {
		return this._onDue != null;
	}

	/** Calls `onDue` once `delayMs` of visible time has passed, unless `signal` aborts or this is cancelled first. */
	schedule(onDue: () => void, signal: AbortSignal): void {
		this.cancel();
		if (signal.aborted) return;

		this.listenForVisibility();
		this._onDue = onDue;
		this._signal = signal;
		this._dueAt = Date.now() + this.delayMs;
		signal.addEventListener('abort', this.onAbort, { once: true });
		if (!this._hidden) {
			this.arm(this.delayMs);
		}
	}

	cancel(): void {
		clearTimeout(this._timer);
		this._timer = undefined;
		this._signal?.removeEventListener('abort', this.onAbort);
		this._signal = undefined;
		this._onDue = undefined;
		this._dueAt = undefined;
	}

	dispose(): void {
		this.cancel();
		this._visibilitySource?.removeEventListener('webview-visible', this.onVisible);
		this._visibilitySource?.removeEventListener('webview-hidden', this.onHidden);
		this._visibilitySource = undefined;
		// Visibility is only heard while listening, so a stale `true` would park the next schedule until a
		// `webview-visible` that may already have passed (owners reuse one instance across reconnects)
		this._hidden = false;
	}

	private arm(delay: number): void {
		this._timer = setTimeout(this.fire, delay);
	}

	/** Visibility is tracked from the first schedule on, and stays tracked across reschedules so a recheck armed while
	 *  hidden starts parked. Before the first schedule nothing has been heard, so it starts out visible — the schedule
	 *  is a response to a fetch the webview just received. */
	private listenForVisibility(): void {
		if (this._visibilitySource != null) return;

		this._visibilitySource = this.getVisibilitySource();
		this._visibilitySource.addEventListener('webview-visible', this.onVisible);
		this._visibilitySource.addEventListener('webview-hidden', this.onHidden);
	}

	private readonly fire = (): void => {
		const onDue = this._onDue;
		this.cancel();
		onDue?.();
	};

	private readonly onAbort = (): void => {
		this.cancel();
	};

	private readonly onHidden = (): void => {
		this._hidden = true;
		clearTimeout(this._timer);
		this._timer = undefined;
	};

	private readonly onVisible = (): void => {
		this._hidden = false;
		if (this._onDue == null || this._dueAt == null || this._timer != null) return;

		const remaining = this._dueAt - Date.now();
		if (remaining <= 0) {
			this.fire();
			return;
		}

		this.arm(remaining);
	};
}

/**
 * What a refresh of a queued pull request means for the WIP pane:
 * - `still-queued` — show the refreshed copy and ask again later
 * - `left-queue` — show the refreshed copy (merged, closed or dequeued), or none when the lookup found no pull request
 *   any more (merged and its head branch auto-deleted); what depends on the branch's relationship to
 *   its merge target is stale too
 * - `retry` — the refresh failed; keep the queued copy on screen and ask again later
 * - `stop` — nothing queued is on screen any more, so there is nothing to keep checking
 */
export type QueuedPullRequestRefreshOutcome = 'still-queued' | 'left-queue' | 'retry' | 'stop';

export function getQueuedPullRequestRefreshOutcome(
	shown: QueueablePullRequest | undefined,
	refreshed: PromiseSettledResult<QueueablePullRequest | undefined>,
): QueuedPullRequestRefreshOutcome {
	if (!isPullRequestQueued(shown)) return 'stop';
	// The lookup is made to throw on failure, so a fulfilled empty answer is a real "no pull request": the queue merged
	// it and the provider deleted the head branch. Retrying would hold the branch actions forever.
	if (refreshed.status === 'rejected') return 'retry';
	if (refreshed.value == null) return 'left-queue';

	return isPullRequestQueued(refreshed.value) ? 'still-queued' : 'left-queue';
}

/** The numbers of the queued pull requests open pull request sheets show, as their own or as a stack layer, deduped —
 *  what the sheets need rechecked until each leaves its queue. A still-resolving sheet has nothing to recheck yet. */
export function getQueuedPullRequestSheetNumbers(stack: readonly SheetDescriptor[]): string[] {
	const numbers = new Set<string>();
	for (const d of stack) {
		if (d.kind !== 'pullRequest' || d.pr == null) continue;

		// A layer can be queued under a sheet pull request that isn't (a lower layer holds Rebase Stack back)
		for (const pr of [d.pr, ...(d.layers ?? [])]) {
			if (isPullRequestQueued(pr)) {
				numbers.add(pr.number);
			}
		}
	}
	return [...numbers];
}
