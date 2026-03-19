import { join } from '@gitlens/utils/iterable.js';
import { WatcherRepoChangeEvent } from '../watching/changeEvent.js';
import type { Repository, RepositoryChange } from './repository.js';

/**
 * An event describing changes to a repository, with a reference to the
 * repository instance that changed. This is the public-facing event
 * consumed by views, services, and commands.
 *
 * Extends `WatcherRepoChangeEvent` so all change-testing logic
 * (`changed`, `changedExclusive`, `pausedOp` handling) lives in one place.
 */
export class RepositoryChangeEvent extends WatcherRepoChangeEvent {
	constructor(
		public readonly repository: Repository,
		changes: RepositoryChange[],
	) {
		super(repository.path, changes);
	}

	override toString(changesOnly: boolean = false): string {
		return changesOnly
			? `changes=${join(this._changes, ', ')}`
			: `{ repository: ${this.repository?.name ?? ''}, changes: ${join(this._changes, ', ')} }`;
	}

	override with(changes: RepositoryChange[]): RepositoryChangeEvent {
		return new RepositoryChangeEvent(this.repository, [...this._changes, ...changes]);
	}
}
