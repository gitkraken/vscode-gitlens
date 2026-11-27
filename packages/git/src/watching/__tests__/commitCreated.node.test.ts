import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { RepositoryChange } from '../../models/repository.js';
import { WatcherRepoChangeEvent } from '../changeEvent.js';
import { isCommitCreated } from '../commitCreated.js';

function event(...changes: RepositoryChange[]): WatcherRepoChangeEvent {
	return new WatcherRepoChangeEvent('/repo', changes);
}

describe('isCommitCreated', () => {
	for (const message of ['commit: x', 'commit (amend): x', 'commit (initial): x']) {
		it(`counts a new "${message}" entry`, () => {
			assert.strictEqual(isCommitCreated('a', { sha: 'b', message: message }, event('head', 'heads')), true);
		});
	}

	for (const message of [
		'commit (merge): Merge branch x',
		'commit (cherry-pick): x',
		'cherry-pick: x',
		'revert: Revert "x"',
		'pull: Fast-forward',
		'merge main: Fast-forward',
		'checkout: moving from main to x',
		'reset: moving to HEAD~1',
		'rebase (finish): returning to refs/heads/main',
	]) {
		it(`ignores a new "${message}" entry`, () => {
			assert.strictEqual(isCommitCreated('a', { sha: 'b', message: message }, event('heads')), false);
		});
	}

	it('counts the first commit of a repository with an empty log', () => {
		assert.strictEqual(isCommitCreated('', { sha: 'b', message: 'commit (initial): x' }, event('heads')), true);
	});

	it('ignores an entry already seen', () => {
		assert.strictEqual(isCommitCreated('b', { sha: 'b', message: 'commit: x' }, event('heads')), false);
	});

	it('ignores the first observation of a repository', () => {
		assert.strictEqual(isCommitCreated(undefined, { sha: 'b', message: 'commit: x' }, event('heads')), false);
	});

	for (const change of ['rebase', 'merge', 'cherryPick', 'revert', 'pausedOp'] as const) {
		it(`ignores a commit when the event carries ${change}`, () => {
			assert.strictEqual(isCommitCreated('a', { sha: 'b', message: 'commit: x' }, event('heads', change)), false);
		});
	}
});
