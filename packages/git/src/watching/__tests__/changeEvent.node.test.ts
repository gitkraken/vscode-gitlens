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

	describe('mayHaveChangedRef()', () => {
		it('matches a named ref exactly', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['heads'], { names: ['refs/heads/main'] });
			assert.ok(e.mayHaveChangedRef('refs/heads/main'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/other'));
			assert.deepStrictEqual([...e.refs], ['refs/heads/main']);
		});

		it('treats a named ref directory as covering every ref beneath it, on a `/` boundary', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['heads'], { names: ['refs/heads/feature'] });
			assert.ok(e.mayHaveChangedRef('refs/heads/feature'));
			assert.ok(e.mayHaveChangedRef('refs/heads/feature/x'));
			assert.ok(e.mayHaveChangedRef('refs/heads/feature/x/y'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/feature-x'));

			const prefix = new WatcherRepoChangeEvent('/repo', ['heads'], { names: ['refs/heads/fe'] });
			assert.ok(!prefix.mayHaveChangedRef('refs/heads/feature'));
		});

		it('matches any ref of an unnamed kind', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['heads', 'remotes'], {
				names: ['refs/heads/main'],
				unnamed: ['remotes'],
			});
			assert.ok(e.mayHaveChangedRef('refs/remotes/origin/anything'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/other'));
		});

		it("returns false when the ref's kind isn't among the changes, or the ref has no watched kind", () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads'], {
				names: ['refs/heads/main', 'refs/tags/v1'],
				unnamed: ['tags'],
			});
			assert.ok(!e.mayHaveChangedRef('refs/tags/v1'));
			assert.ok(!e.mayHaveChangedRef('refs/remotes/origin/main'));
			assert.ok(!e.mayHaveChangedRef('refs/notes/commits'));
		});

		it('treats every ref kind as unnamed when constructed without refs', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads', 'stash']);
			assert.strictEqual(e.refs.size, 0);
			assert.deepStrictEqual([...e.unnamedRefKinds].sort(), ['heads', 'stash']);
			assert.ok(e.mayHaveChangedRef('refs/heads/anything'));
			assert.ok(e.mayHaveChangedRef('refs/stash'));
			assert.ok(e.mayHaveChangedRef('HEAD'));
			assert.ok(!e.mayHaveChangedRef('refs/tags/v1'));
		});

		it('gives pseudo-refs the heads kind', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads'], { names: ['HEAD'] });
			assert.ok(e.mayHaveChangedRef('HEAD'));
			assert.ok(!e.mayHaveChangedRef('ORIG_HEAD'));
			assert.ok(!e.mayHaveChangedRef('refs/heads/main'));

			const noHeads = new WatcherRepoChangeEvent('/repo', ['head'], { names: ['HEAD'] });
			assert.ok(!noHeads.mayHaveChangedRef('HEAD'));
		});

		it('treats HEAD as moved by any heads change, since it is usually a symref to the checked-out branch', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['heads'], { names: ['refs/heads/main'] });
			assert.ok(e.mayHaveChangedRef('HEAD'));
			assert.ok(!e.mayHaveChangedRef('ORIG_HEAD'));

			const tagsOnly = new WatcherRepoChangeEvent('/repo', ['tags'], { names: ['refs/tags/v1'] });
			assert.ok(!tagsOnly.mayHaveChangedRef('HEAD'));
		});

		it('merges names and unnamed kinds in with()', () => {
			const e1 = new WatcherRepoChangeEvent('/repo', ['heads'], { names: ['refs/heads/a'] });
			const e2 = e1.with(['heads', 'remotes'], { names: ['refs/heads/b'], unnamed: ['remotes'] });
			assert.deepStrictEqual([...e2.refs].sort(), ['refs/heads/a', 'refs/heads/b']);
			assert.ok(e2.mayHaveChangedRef('refs/heads/a'));
			assert.ok(e2.mayHaveChangedRef('refs/heads/b'));
			assert.ok(!e2.mayHaveChangedRef('refs/heads/c'));
			assert.ok(e2.mayHaveChangedRef('refs/remotes/origin/x'));

			// Without refs, the added ref kinds are unnamed
			const e3 = e1.with(['tags']);
			assert.deepStrictEqual([...e3.refs], ['refs/heads/a']);
			assert.ok(!e3.mayHaveChangedRef('refs/heads/c'));
			assert.ok(e3.mayHaveChangedRef('refs/tags/v1'));
		});
	});

	describe('announced', () => {
		it('is empty unless given', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'heads']);
			assert.strictEqual(e.announced.size, 0);
		});

		it('keeps only the announced kinds that are among the changes', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['head', 'index'], undefined, ['index', 'tags']);
			assert.deepStrictEqual([...e.announced], ['index']);
		});

		it('drops a kind with() reports again, and keeps the rest', () => {
			const e = new WatcherRepoChangeEvent('/repo', ['heads', 'index'], undefined, ['heads', 'index']);
			const e2 = e.with(['heads', 'tags']);
			assert.deepStrictEqual([...e2.announced], ['index']);
			assert.deepStrictEqual([...e.announced], ['heads', 'index']);
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
