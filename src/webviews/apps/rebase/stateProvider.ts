import { ContextProvider } from '@lit/context';
import type { RebaseTodoCommitAction } from '../../../git/models/rebase';
import type { IpcSerialized } from '../../../system/ipcSerialize';
import type { IpcMessage } from '../../protocol';
import type { State as _State } from '../../rebase/protocol';
import { DidChangeAvatarsNotification, DidChangeNotification, isCommitEntry } from '../../rebase/protocol';
import type { ReactiveElementHost } from '../shared/appHost';
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
	protected override get deferBootstrap(): boolean {
		return true;
	}

	protected override createContextProvider(state: State): ContextProvider<typeof stateContext, ReactiveElementHost> {
		return new ContextProvider(this.host, { context: stateContext, initialValue: state });
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
				break;
		}
	}

	/**
	 * Updates author avatars from enhanced avatar data received from the host.
	 * This is called when the host fetches higher-quality avatars from Git providers.
	 */
	private updateAvatars(avatars: Record<string, string>): void {
		if (!this._state?.authors) return;

		// Create updated authors object with new avatar URLs
		const updatedAuthors = { ...this._state.authors };
		let hasChanges = false;

		for (const [name, avatarUrl] of Object.entries(avatars)) {
			if (updatedAuthors[name] && updatedAuthors[name].avatarUrl !== avatarUrl) {
				updatedAuthors[name] = { ...updatedAuthors[name], avatarUrl: avatarUrl };
				hasChanges = true;
			}
		}

		if (hasChanges) {
			this._state = { ...this._state, authors: updatedAuthors, timestamp: Date.now() };
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
