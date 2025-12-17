import { ContextProvider } from '@lit/context';
import type { RebaseTodoCommitAction } from '../../../git/models/rebase';
import type { Deferrable } from '../../../system/function/debounce';
import { debounce } from '../../../system/function/debounce';
import type { IpcSerialized } from '../../../system/ipcSerialize';
import type { IpcMessage } from '../../protocol';
import type { State as _State, Commit } from '../../rebase/protocol';
import {
	DidChangeAvatarsNotification,
	DidChangeCommitsNotification,
	DidChangeNotification,
	DidChangeSubscriptionNotification,
	GetMissingAvatarsCommand,
	GetMissingCommitsCommand,
	isCommitEntry,
} from '../../rebase/protocol';
import type { ReactiveElementHost } from '../shared/appHost';
import type { LoggerContext } from '../shared/contexts/logger';
import type { HostIpc } from '../shared/ipc';
import { StateProviderBase } from '../shared/stateProviderBase';
import { stateContext } from './context';

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

		const shas = Array.from(this._pendingCommitShas);
		this._pendingCommitShas.clear();

		this.ipc.sendCommand(GetMissingCommitsCommand, { shas: shas });
	}

	protected override onMessageReceived(msg: IpcMessage): void {
		switch (true) {
			case DidChangeNotification.is(msg):
				this._state = { ...msg.params.state, timestamp: Date.now() };
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
				this._state = { ...this._state, subscription: msg.params.subscription, timestamp: Date.now() };
				this.provider.setValue(this._state, true);
				// Request update to re-render with new subscription state
				this.host.requestUpdate();
				break;
		}
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

		this._state = { ...this._state, entries: entries, timestamp: Date.now() };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();
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

		this._state = { ...this._state, entries: newEntries, timestamp: Date.now() };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();
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

		this._state = { ...this._state, entries: entries, timestamp: Date.now() };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();
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

		this._state = { ...this._state, entries: entries, timestamp: Date.now() };
		this.provider.setValue(this._state, true);
		this.host.requestUpdate();
	}
}
