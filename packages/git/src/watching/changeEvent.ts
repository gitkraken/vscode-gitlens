import { filter, some } from '@gitlens/utils/iterable.js';
import type { RepositoryChange } from '../models/repository.js';

/**
 * An event describing changes to a repository, produced by the watching pipeline.
 *
 * Changes are coalesced within a debounce window — a single event may represent
 * multiple filesystem changes. Use {@link changed} to test for specific change types.
 */
export class WatcherRepoChangeEvent {
	protected readonly _changes: Set<RepositoryChange>;

	constructor(
		/** The repository path this event is for */
		public readonly repoPath: string,
		changes: RepositoryChange[],
	) {
		this._changes = new Set(changes);
	}

	get changes(): ReadonlySet<RepositoryChange> {
		return this._changes;
	}

	toString(changesOnly: boolean = false): string {
		const changeList = [...this._changes].join(', ');
		return changesOnly ? `changes=${changeList}` : `{ repoPath: ${this.repoPath}, changes: ${changeList} }`;
	}

	/**
	 * Test whether any of the specified change types are present in the event.
	 *
	 * @param affected - Change types to test for.
	 * @returns `true` if any of the specified changes are present.
	 */
	changed(...affected: RepositoryChange[]): boolean {
		return some(this._changes, c => affected.includes(c));
	}

	/**
	 * Test whether the event contains ONLY the specified change types.
	 *
	 * `pausedOp` is treated as a union of `cherryPick`, `merge`, `rebase`,
	 * and `revert` for convenience.
	 *
	 * @param affected - Change types to test for.
	 * @returns `true` if the event contains only the specified changes.
	 */
	changedExclusive(...affected: RepositoryChange[]): boolean {
		let changes = this._changes;

		// When checking for specific paused operation types, also accept the union type
		if (
			affected.includes('cherryPick') ||
			affected.includes('merge') ||
			affected.includes('rebase') ||
			affected.includes('revert')
		) {
			if (!affected.includes('pausedOp')) {
				affected = [...affected, 'pausedOp'];
			}
		} else if (affected.includes('pausedOp')) {
			// When checking for the union type exclusively, ignore specific subtypes
			changes = new Set(changes);
			changes.delete('cherryPick');
			changes.delete('merge');
			changes.delete('rebase');
			changes.delete('revert');
		}

		const intersection = [...filter(changes, c => affected.includes(c))];
		return intersection.length === changes.size;
	}

	/** Coalesce: return a new event with all changes from both this and the given set */
	with(changes: RepositoryChange[]): WatcherRepoChangeEvent {
		return new WatcherRepoChangeEvent(this.repoPath, [...this._changes, ...changes]);
	}
}

/**
 * An event describing working tree file changes, produced by the working tree pipeline.
 *
 * Paths have already been filtered through the gitignore filter and noise filter.
 */
export interface WorkingTreeChangeEvent {
	readonly repoPath: string;
	/** Absolute paths of changed files (post-gitignore filtering) */
	readonly paths: ReadonlySet<string>;
}
