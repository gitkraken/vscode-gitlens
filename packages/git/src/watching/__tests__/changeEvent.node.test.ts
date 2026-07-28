import assert from 'node:assert';
import { describe, it } from 'node:test';
import { WatcherRepoChangeEvent } from '../changeEvent.js';

describe('WatcherRepoChangeEvent', () => {
	describe('constructor', () => {
		it('stores repoPath and deduplicates changes', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads', 'head']);
			assert.strictEqual(e.repoPath, '/repo');
			assert.strictEqual(e.changes.size, 2);
			assert.ok(e.changes.has('head'));
			assert.ok(e.changes.has('heads'));
		});
	});

	describe('changed()', () => {
		it('returns true when any specified change is present', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads']);
			assert.ok(e.changed('head', 'tags'));
		});

		it('returns false when no specified change is present', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head']);
			assert.ok(!e.changed('tags', 'stash'));
		});
	});

	describe('changedExclusive()', () => {
		it('returns true when event contains only specified changes', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads']);
			assert.ok(e.changedExclusive('head', 'heads'));
		});

		it('returns false when event contains extra changes', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads', 'tags']);
			assert.ok(!e.changedExclusive('head', 'heads'));
		});

		it('treats pausedOp as union when checking specific types', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['cherryPick', 'pausedOp']);
			// Checking for cherryPick exclusively should also accept pausedOp
			assert.ok(e.changedExclusive('cherryPick'));
		});

		it('ignores specific subtypes when checking pausedOp exclusively', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['rebase', 'pausedOp']);
			// Checking for pausedOp exclusively should ignore rebase
			assert.ok(e.changedExclusive('pausedOp'));
		});
	});

	describe('with()', () => {
		it('returns a new event with coalesced changes', () => {
			const e1 = new WatcherRepoChangeEvent('/repo', ['head']);
			const e2 = e1.with(['tags', 'stash']);

			// Original unchanged
			assert.strictEqual(e1.changes.size, 1);
			// New has all three
			assert.strictEqual(e2.changes.size, 3);
			assert.ok(e2.changes.has('head'));
			assert.ok(e2.changes.has('tags'));
			assert.ok(e2.changes.has('stash'));
			// Same repoPath
			assert.strictEqual(e2.repoPath, '/repo');
		});

		it('deduplicates when coalescing', () => {
			const e1 = new WatcherRepoChangeEvent('/repo', ['head', 'heads']);
			const e2 = e1.with(['head', 'tags']);
			assert.strictEqual(e2.changes.size, 3); // head, heads, tags
		});
	});

	describe('toString()', () => {
		it('includes repoPath and changes by default', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head']);
			const str = e.toString();
			assert.ok(str.includes('/repo'));
			assert.ok(str.includes('head'));
		});

		it('shows only changes when changesOnly is true', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head']);
			const str = e.toString(true);
			assert.ok(str.startsWith('changes='));
			assert.ok(!str.includes('/repo'));
		});
	});
});
