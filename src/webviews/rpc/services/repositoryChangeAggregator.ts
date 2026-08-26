/**
 * Shared hidden-webview aggregation for repository-change events.
 *
 * While the webview is hidden, per-repo change sets accumulate (unioned) instead of firing one
 * notification per event; on visibility restore, one notification per changed repo path fires
 * with the union of its change types. Shared by {@link RepositoryService.onRepositoryChanged}
 * (always exactly one repo path) and {@link RepositoriesService.onRepositoryChanged} (any number
 * of repo paths) — the single-repo case is simply the size-1 case of the same map.
 */

import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type { EventVisibilityBuffer, EventVisibilityKey } from '../eventVisibilityBuffer.js';
import type { RepositoryChangeEventData } from './types.js';

/** Accumulates and flushes repository-change events for one subscription — see module doc. */
export interface RepositoryChangeAggregator {
	/** Notifies immediately when visible; otherwise accumulates the change into the pending
	 *  union for its repo path and (re-)registers the flush with `buffer`. */
	record(data: RepositoryChangeEventData): void;
	/** Removes the pending flush entry and clears accumulated state. Call from teardown. */
	dispose(): void;
}

/**
 * Creates a {@link RepositoryChangeAggregator} that notifies via `notify` — either immediately
 * (no buffer, or visible) or, while hidden, once per changed repo path when `buffer` restores
 * visibility, with each repo's changes unioned across every event recorded while hidden.
 */
export function createRepositoryChangeAggregator(
	buffer: EventVisibilityBuffer | undefined,
	pendingKey: EventVisibilityKey,
	notify: (data: RepositoryChangeEventData) => void,
): RepositoryChangeAggregator {
	const pending = new Map<string, { uri: string; changes: Set<RepositoryChange> }>();

	return {
		record: function (data: RepositoryChangeEventData): void {
			if (!buffer || buffer.visible) {
				notify(data);

				return;
			}

			let existing = pending.get(data.repoPath);
			if (existing == null) {
				existing = { uri: data.repoUri, changes: new Set() };
				pending.set(data.repoPath, existing);
			} else {
				existing.uri = data.repoUri;
			}
			for (const change of data.changes) {
				existing.changes.add(change);
			}

			buffer.addPending(pendingKey, () => {
				for (const [repoPath, entry] of pending) {
					notify({ repoPath: repoPath, repoUri: entry.uri, changes: [...entry.changes] });
				}
				pending.clear();
			});
		},
		dispose: function (): void {
			buffer?.removePending(pendingKey);
			pending.clear();
		},
	};
}
