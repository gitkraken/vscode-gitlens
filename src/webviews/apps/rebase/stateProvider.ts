import { ContextProvider } from '@lit/context';
import type { RebaseTodoCommitAction } from '@gitlens/git/models/rebase.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { IpcSerialized } from '../../../system/ipcSerialize.js';
import type { IpcMessage } from '../../ipc/models/ipc.js';
import type { State as _State, Commit, RebaseEntry } from '../../rebase/protocol.js';
import {
	DidChangeAvatarsNotification,
	DidChangeCommitsNotification,
	DidChangeNotification,
	DidChangeSubscriptionNotification,
	GetMissingAvatarsCommand,
	GetMissingCommitsCommand,
	isCommitEntry,
} from '../../rebase/protocol.js';
import type { ReactiveElementHost } from '../shared/appHost.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { HostIpc } from '../shared/ipc.js';
import { StateProviderBase } from '../shared/stateProviderBase.js';
import { stateContext } from './context.js';

type State = IpcSerialized<_State>;

/**
 * State provider for the Rebase Editor.
 *
 * Architecture: Single Source of Truth with Optimistic Updates
 * - The extension host owns all state (the git-rebase-todo file)
 * - This webview is primarily a view layer - it renders state and sends commands
 * - State updates come from the extension host via DidChangeNotification
 * - Optimistic updates are applied locally for responsiveness, then reconciled with host state
 */
export class RebaseStateProvider extends StateProviderBase<State['webviewId'], State, typeof stateContext> {
	/** Pending avatar requests - collected from entry events, batched and sent (email → sha) */
	private _pendingAvatarEmails = new Map<string, string>();
	/** Emails we've already requested (to avoid duplicates during batching) */
	private _requestedAvatarEmails = new Set<string>();
	/** Debounced function to send pending avatar requests */
	private _sendPendingAvatarRequestsDebounced: Deferrable<() => void> | undefined;

	/** Pending commit enrichment requests - collected from entry events, batched and sent */
	private _pendingCommitShas = new Set<string>();
	/** SHAs we've already requested (to avoid duplicates during batching) */
	private _requestedCommitShas = new Set<string>();
	/** Debounced function to send pending commit requests */
	private _sendPendingCommitRequestsDebounced: Deferrable<() => void> | undefined;

	/**
	 * Signature of the expected entries after the most recent optimistic op (move/shift/changeAction).
	 * Cleared when the host's next state notification matches it (host has caught up).
	 * Used to reject stale notifications that would clobber an optimistic change.
	 */
	private _expectedEntriesSignature: string | undefined;
	/** Timestamp (performance.now()) when _expectedEntriesSignature was set. Used to time-out the optimistic preservation. */
	private _expectedSignatureSetAt: number | undefined;
	/** Maximum time to suppress mismatched notifications. After this, accept incoming as authoritative
	 *  (covers cases where host applies validation rules that diverge from optimistic state). */
	private static readonly optimisticPreservationMs = 1000;

	constructor(host: ReactiveElementHost, bootstrap: string, ipc: HostIpc, logger: LoggerContext) {
		super(host, bootstrap, ipc, logger);

		// Listen for missing data events from entry components
		this.host.addEventListener('missing-avatar', this.onMissingAvatar.bind(this) as EventListener);
		this.host.addEventListener('missing-commit', this.onMissingCommit.bind(this) as EventListener);
	}

	protected override get deferBootstrap(): boolean {
		return true;
	}

	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
	}

	/** Handles missing-avatar events from entry components */
	private onMissingAvatar(e: CustomEvent<{ email: string; sha?: string }>): void {
		const { email, sha } = e.detail;
		if (!email || !sha) return;
		if (this._requestedAvatarEmails.has(email)) return;

		this._pendingAvatarEmails.set(email, sha);
		this._requestedAvatarEmails.add(email);

		this._sendPendingAvatarRequestsDebounced ??= debounce(this.sendPendingAvatarRequests.bind(this), 50);
		this._sendPendingAvatarRequestsDebounced();
	}

	private sendPendingAvatarRequests(): void {
		if (!this._pendingAvatarEmails.size) return;

		const emails = Object.fromEntries(this._pendingAvatarEmails);
		this._pendingAvatarEmails.clear();

		this.ipc.sendCommand(GetMissingAvatarsCommand, { emails: emails });
	}

	/** Handles missing-commit events from entry components */
	private onMissingCommit(e: CustomEvent<{ sha: string }>): void {
		const { sha } = e.detail;
		if (!sha) return;
		if (this._requestedCommitShas.has(sha)) return;

		this._pendingCommitShas.add(sha);
		this._requestedCommitShas.add(sha);

		this._sendPendingCommitRequestsDebounced ??= debounce(this.sendPendingCommitRequests.bind(this), 50);
		this._sendPendingCommitRequestsDebounced();
	}

	private sendPendingCommitRequests(): void {
		if (!this._pendingCommitShas.size) return;

		const shas = [...this._pendingCommitShas];
		this._pendingCommitShas.clear();

		this.ipc.sendCommand(GetMissingCommitsCommand, { shas: shas });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeNotification.is(msg):
				this._state = this.reconcileIncomingState(msg.params.state);
				this.provider.setValue(this._state, true);
				// Request update to re-render with new state
				this.host.requestUpdate();
				break;

			case DidChangeAvatarsNotification.is(msg):
				this.updateAvatars(msg.params.avatars);
				// Clear requested emails so they can be requested again if needed
				for (const email of Object.keys(msg.params.avatars)) {
					this._requestedAvatarEmails.delete(email);
				}
				break;

			case DidChangeCommitsNotification.is(msg):
				this.updateCommits(msg.params.commits, msg.params.authors, msg.params.isInPlace);
				// Clear requested SHAs so they can be requested again if needed
				for (const sha of Object.keys(msg.params.commits)) {
					this._requestedCommitShas.delete(sha);
				}
				break;

			case DidChangeSubscriptionNotification.is(msg):
				// Subscription change can unlock previously-failed avatar/commit lookups
				// (e.g., Pro upgrade enables integration-backed avatars). Clear blocklists
				// so the next render is allowed to re-ask.
				this._requestedAvatarEmails.clear();
				this._requestedCommitShas.clear();
				this._state = { ...this._state, subscription: msg.params.subscription, timestamp: Date.now() };
				this.provider.setValue(this._state, true);
				// Request update to re-render with new subscription state
				this.host.requestUpdate();
				break;
		}
	}

	/**
	 * Merges an incoming state with the current optimistic state, protecting recent
	 * optimistic moves/action-changes from being clobbered by a stale notification
	 * that the host parsed before observing our write.
	 */
	private reconcileIncomingState(incoming: State): State {
		const expected = this._expectedEntriesSignature;
		if (expected == null || this._state?.entries == null) {
			return { ...incoming, timestamp: Date.now() };
		}

		const incomingSignature = getEntriesSignature(incoming.entries);
		if (incomingSignature === expected) {
			// Host has caught up to our optimistic state — accept as-is
			this.clearExpectedSignature();
			return { ...incoming, timestamp: Date.now() };
		}

		// Time out: if the host has been disagreeing with our optimistic state for too long,
		// it likely applied a validation rule (e.g., forcing oldest commit's action to pick) —
		// accept the host's state as authoritative rather than locking the UI in a lie.
		const elapsed = performance.now() - (this._expectedSignatureSetAt ?? 0);
		if (elapsed > RebaseStateProvider.optimisticPreservationMs) {
			this.clearExpectedSignature();
			return { ...incoming, timestamp: Date.now() };
		}

		const localEntries = this._state.entries;
		const incomingIds = new Set(incoming.entries.map(e => e.id));
		const sameIdSet =
			localEntries.length === incoming.entries.length && localEntries.every(e => incomingIds.has(e.id));

		if (!sameIdSet) {
			// External change altered the entry set (e.g., rebase advanced, entry dropped externally) —
			// the optimistic expectation is no longer meaningful; accept incoming wholesale
			this.clearExpectedSignature();
			return { ...incoming, timestamp: Date.now() };
		}

		// Same ID set but order/action differs from our optimistic state — most likely a
		// stale notification that the host parsed before observing our write. Preserve the
		// local order + actions, but keep the per-entry data (commit enrichment, etc.) from incoming.
		const incomingMap = new Map(incoming.entries.map(e => [e.id, e]));
		const merged = localEntries.map(localEntry => {
			const incomingEntry = incomingMap.get(localEntry.id);
			if (incomingEntry == null) return localEntry;
			// Only commit entries have a user-mutable `action`; for command entries the incoming
			// entry is authoritative as-is
			if (isCommitEntry(localEntry) && isCommitEntry(incomingEntry)) {
				return { ...incomingEntry, action: localEntry.action };
			}
			return incomingEntry;
		});

		return { ...incoming, entries: merged, timestamp: Date.now() };
	}

	private clearExpectedSignature(): void {
		this._expectedEntriesSignature = undefined;
		this._expectedSignatureSetAt = undefined;
	}

	/** Updates author avatars from enhanced avatar data received from the host */
	private updateAvatars(avatars: Record<string, string>): void {
		if (!this._state?.authors) return;

		let hasChanges = false;

		for (const [name, avatarUrl] of Object.entries(avatars)) {
			const author = this._state.authors[name];
			if (author && author.avatarUrl !== avatarUrl) {
				author.avatarUrl = avatarUrl;
				hasChanges = true;
			}
		}

		if (hasChanges) {
			this._state.timestamp = Date.now();
			this.provider.setValue(this._state, true);

			this.host.requestUpdate();
		}
	}

	/** Updates commit data from enriched commit data received from the host */
	private updateCommits(
		commits: Record<string, IpcSerialized<Commit>>,
		authors: Record<string, IpcSerialized<_State>['authors'][string]>,
		isInPlace?: boolean,
	): void {
		if (!this._state) return;

		let hasChanges = false;

		// Update isInPlace if provided
		if (isInPlace != null && this._state.isInPlace !== isInPlace) {
			this._state.isInPlace = isInPlace;
			hasChanges = true;
		}

		// Enrich base commit (onto)
		if (this._state.onto && !this._state.onto.commit) {
			const commit = commits[this._state.onto.sha];
			if (commit) {
				this._state.onto = { ...this._state.onto, commit: commit };
				hasChanges = true;
			}
		}

		// Create new entry objects when enriching to trigger Lit reactivity
		this._state.entries = this._state.entries.map(entry => {
			if (!isCommitEntry(entry) || entry.commit != null) return entry;

			const commit = commits[entry.sha];
			if (commit) {
				hasChanges = true;
				return { ...entry, commit: commit };
			}
			return entry;
		});

		if (this._state.doneEntries) {
			this._state.doneEntries = this._state.doneEntries.map(entry => {
				if (!isCommitEntry(entry) || entry.commit != null) return entry;

				const commit = commits[entry.sha];
				if (commit) {
					hasChanges = true;
					return { ...entry, commit: commit };
				}
				return entry;
			});
		}

		// Merge new authors, preserving existing avatar URLs if already fetched
		for (const [name, author] of Object.entries(authors)) {
			const existing = this._state.authors[name];
			if (existing) {
				// Preserve avatarUrl if it was already fetched
				this._state.authors[name] = { ...author, avatarUrl: existing.avatarUrl ?? author.avatarUrl };
			} else {
				this._state.authors[name] = author;
			}
			hasChanges = true;
		}

		if (hasChanges) {
			this._state = { ...this._state, timestamp: Date.now() };
			this.provider.setValue(this._state, true);

			this.host.requestUpdate();
		}
	}

	/** Commits an optimistic entries update and records the expected signature so the
	 *  next host notification can be reconciled against it. */
	private applyOptimisticEntries(entries: RebaseEntry[]): void {
		if (this._state == null) return;

		// Mirror the host's validation: the oldest commit entry can never be `squash` or `fixup`
		// (there'd be nothing to squash into). If the user's optimistic state would violate that,
		// preemptively force it to `pick` so the local signature matches what the host will write.
		const fixed = enforceOldestPickable(entries);

		this._state = { ...this._state, entries: fixed, timestamp: Date.now() };
		this._expectedEntriesSignature = getEntriesSignature(fixed);
		this._expectedSignatureSetAt = performance.now();
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();
	}

	/**
	 * Apply an optimistic move operation locally for immediate UI feedback.
	 * The host will send the authoritative state via DidChangeNotification.
	 *
	 * This function expects toIndex to be the ACTUAL target position where
	 * the item should end up in the result array. The caller is responsible
	 * for any host-specific adjustments when sending commands.
	 */
	moveEntry(fromIndex: number, toIndex: number): void {
		if (!this._state?.entries || fromIndex === toIndex) return;

		const entries = [...this._state.entries];
		const [moved] = entries.splice(fromIndex, 1);
		entries.splice(toIndex, 0, moved);

		this.applyOptimisticEntries(entries);
	}

	/**
	 * Apply optimistic move for multiple entries, preserving their relative order.
	 */
	moveEntries(ids: string[], toIndex: number): void {
		if (!this._state?.entries || ids.length === 0) return;

		const entries = [...this._state.entries];
		const idSet = new Set(ids);

		// Extract selected entries in current order
		const selectedEntries = entries.filter(e => idSet.has(e.id));

		// Remove selected entries
		const remaining = entries.filter(e => !idSet.has(e.id));

		// Clamp target index
		const clampedTo = Math.max(0, Math.min(toIndex, remaining.length));

		// Insert selected entries at target position
		const newEntries = [...remaining.slice(0, clampedTo), ...selectedEntries, ...remaining.slice(clampedTo)];

		this.applyOptimisticEntries(newEntries);
	}

	/**
	 * Shift entries up or down independently, preserving gaps between non-contiguous selections.
	 */
	shiftEntries(ids: string[], direction: 'up' | 'down'): void {
		if (!this._state?.entries || ids.length === 0) return;

		const entries = [...this._state.entries];
		const idSet = new Set(ids);

		// Get indices of selected entries
		const selectedIndices = entries.map((e, i) => (idSet.has(e.id) ? i : -1)).filter(i => i !== -1);

		if (selectedIndices.length === 0) return;

		if (direction === 'up') {
			// Process from top to bottom to avoid conflicts
			for (const idx of selectedIndices) {
				if (idx === 0) continue;

				const aboveIdx = idx - 1;
				if (!idSet.has(entries[aboveIdx].id)) {
					[entries[aboveIdx], entries[idx]] = [entries[idx], entries[aboveIdx]];
				}
			}
		} else {
			// Process from bottom to top to avoid conflicts
			for (let i = selectedIndices.length - 1; i >= 0; i--) {
				const idx = selectedIndices[i];
				if (idx === entries.length - 1) continue;

				const belowIdx = idx + 1;
				if (!idSet.has(entries[belowIdx].id)) {
					[entries[belowIdx], entries[idx]] = [entries[idx], entries[belowIdx]];
				}
			}
		}

		this.applyOptimisticEntries(entries);
	}

	/**
	 * Apply an optimistic action change locally for immediate UI feedback.
	 * The host will send the authoritative state via DidChangeNotification.
	 */
	changeEntryAction(sha: string, action: RebaseTodoCommitAction): void {
		this.changeEntryActions([{ sha: sha, action: action }]);
	}

	/**
	 * Apply optimistic action changes to multiple entries in a single update.
	 * The host will send the authoritative state via DidChangeNotification.
	 */
	changeEntryActions(changes: { sha: string; action: RebaseTodoCommitAction }[]): void {
		if (!this._state?.entries || changes.length === 0) return;

		const actionMap = new Map(changes.map(c => [c.sha, c.action]));
		const entries = this._state.entries.map(e => {
			if (!isCommitEntry(e)) return e;

			const newAction = actionMap.get(e.sha);
			return newAction != null ? { ...e, action: newAction } : e;
		});

		this.applyOptimisticEntries(entries);
	}
}

/**
 * Builds a stable, comparable representation of the entries list so the webview can
 * detect when the host's notification matches its optimistic state. Includes order,
 * id, and action (the only fields the user can mutate via optimistic ops).
 */
export function getEntriesSignature(entries: RebaseEntry[]): string {
	return entries.map(e => (isCommitEntry(e) ? `${e.id}:${e.action}` : `${e.id}:cmd`)).join('|');
}

/**
 * Mirrors the host's validation rule: the oldest commit entry's action cannot be `squash`
 * or `fixup` (there's nothing earlier to squash/fixup into). If it is, override to `pick`.
 * Returns the input array unchanged when no fix is needed.
 *
 * Keeping this rule in sync with the host (see `RebaseTodoDocument.changeActions` /
 * `ensureValidOldestAction`) keeps optimistic state matching what the host will write,
 * avoiding the 1s reconciliation timeout flicker.
 */
export function enforceOldestPickable(entries: RebaseEntry[]): RebaseEntry[] {
	const oldestIndex = entries.findIndex(isCommitEntry);
	if (oldestIndex === -1) return entries;

	const oldest = entries[oldestIndex];
	if (!isCommitEntry(oldest) || (oldest.action !== 'squash' && oldest.action !== 'fixup')) {
		return entries;
	}

	const next = entries.slice();
	next[oldestIndex] = { ...oldest, action: 'pick' };
	return next;
}
