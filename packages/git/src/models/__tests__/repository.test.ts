/* eslint-disable @typescript-eslint/consistent-type-assertions */
import * as assert from 'assert';
import { mixinDisposable } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitProviderDescriptor } from '../../providers/types.js';
import { WatcherRepoChangeEvent } from '../../watching/changeEvent.js';
import type { RepositoryWatchService } from '../../watching/watchService.js';
import type { RepositoryInit } from '../repository.js';
import { Repository } from '../repository.js';
import type { RepositoryChangeEvent } from '../repositoryChangeEvent.js';

// Minimal subclass that exposes protected hooks so tests can simulate what the FS watcher
// triggers without standing up a real watch service.
class TestRepository extends Repository {
	triggerOnFetchHeadChanged(): void {
		this.onFetchHeadChanged();
	}

	triggerOnGitIgnoreChanged(): void {
		this.onGitIgnoreChanged();
	}
}

function createRepo(): TestRepository {
	const uri = { fsPath: '/repo', path: '/repo', scheme: 'file' } as unknown as Uri;
	// `watch()` short-circuits when `gitDir` is undefined, so the mocked watchService is
	// never touched — an empty object stub satisfies the type.
	const watchService: RepositoryWatchService = {} as RepositoryWatchService;
	const init: RepositoryInit = {
		id: 'test-repo',
		path: '/repo',
		uri: uri,
		name: 'repo',
		provider: { id: 'git', name: 'Test', virtual: false } satisfies GitProviderDescriptor,
		gitDir: undefined,
		index: 0,
		root: true,
		watchService: watchService,
	};
	return new TestRepository(init);
}

suite('Repository.markFetched / onFetchHeadChanged', () => {
	test('markFetched(t) sets `_lastFetched` to t and fires the `lastFetched` change event', () => {
		const repo = createRepo();
		try {
			const events: RepositoryChangeEvent[] = [];
			repo.onDidChange(e => events.push(e));

			const t = 1_700_000_000_000;
			repo.markFetched(t);

			assert.strictEqual(repo.lastFetchedCached, t);
			assert.strictEqual(events.length, 1, 'expected one change event');
			assert.ok(events[0].changed('lastFetched'), "event should include 'lastFetched'");
		} finally {
			repo.dispose();
		}
	});

	test('markFetched is monotonic — a smaller timestamp does not move `_lastFetched`', () => {
		const repo = createRepo();
		try {
			const events: RepositoryChangeEvent[] = [];
			repo.onDidChange(e => events.push(e));

			repo.markFetched(2_000);
			repo.markFetched(1_000); // earlier — must be ignored

			assert.strictEqual(repo.lastFetchedCached, 2_000);
			assert.strictEqual(events.length, 1, 'no-op markFetched should not fire a redundant event');
		} finally {
			repo.dispose();
		}
	});

	test('markFetched does not fire when the value is unchanged (equal timestamp)', () => {
		const repo = createRepo();
		try {
			repo.markFetched(5_000);

			const events: RepositoryChangeEvent[] = [];
			repo.onDidChange(e => events.push(e));

			repo.markFetched(5_000); // same value
			assert.strictEqual(events.length, 0, 'equal-timestamp markFetched should be a silent no-op');
			assert.strictEqual(repo.lastFetchedCached, 5_000);
		} finally {
			repo.dispose();
		}
	});

	test('onFetchHeadChanged does NOT reset `_lastFetched` (regression for the FS-watcher clobber bug)', () => {
		const repo = createRepo();
		try {
			repo.markFetched(9_000);

			const events: RepositoryChangeEvent[] = [];
			repo.onDidChange(e => events.push(e));

			repo.triggerOnFetchHeadChanged();

			assert.strictEqual(
				repo.lastFetchedCached,
				9_000,
				'`_lastFetched` must survive onFetchHeadChanged so markFetched is not clobbered',
			);
			assert.strictEqual(events.length, 1, 'onFetchHeadChanged should still force-fire the lastFetched event');
			assert.ok(events[0].changed('lastFetched'));
		} finally {
			repo.dispose();
		}
	});
});

// Builds a repo backed by a mock watch service whose `watch()` returns a single shared, ref-counted
// handle, letting us observe the caller-owned `watch()` lifecycle without a real FS watcher.
function createWatchedRepo(): {
	repo: TestRepository;
	fireSessionRepoChange: (e: WatcherRepoChangeEvent) => void;
	getWatchCalls: () => number;
	getHandleDisposes: () => number;
} {
	const repoEmitter = new Emitter<WatcherRepoChangeEvent>();
	const wtEmitter = new Emitter<{ repoPath: string; paths: ReadonlySet<string> }>();

	const session = {
		repoPath: '/repo',
		subscribe: () => mixinDisposable({ onDidChange: repoEmitter.event }, () => {}),
		subscribeToWorkingTree: () => mixinDisposable({ onDidChangeWorkingTree: wtEmitter.event }, () => {}),
		fireChange: () => {},
	};

	let watchCalls = 0;
	let handleDisposes = 0;
	const watchService = {
		watch: () => {
			watchCalls++;
			return mixinDisposable({ session: session }, () => {
				handleDisposes++;
			});
		},
	} as unknown as RepositoryWatchService;

	const uri = { fsPath: '/repo', path: '/repo', scheme: 'file' } as unknown as Uri;
	const init: RepositoryInit = {
		id: 'test-repo',
		path: '/repo',
		uri: uri,
		name: 'repo',
		provider: { id: 'git', name: 'Test', virtual: false } satisfies GitProviderDescriptor,
		gitDir: { uri: { fsPath: '/repo/.git', path: '/repo/.git', scheme: 'file' } as unknown as Uri },
		index: 0,
		root: true,
		watchService: watchService,
	};

	return {
		repo: new TestRepository(init),
		fireSessionRepoChange: e => repoEmitter.fire(e),
		getWatchCalls: () => watchCalls,
		getHandleDisposes: () => handleDisposes,
	};
}

suite('Repository.watch (caller-owned watch lifecycle)', () => {
	test('watch() delivers session repo-change events via onDidChange and reflects `watching`', () => {
		const { repo, fireSessionRepoChange } = createWatchedRepo();
		try {
			assert.strictEqual(repo.watching, false, 'not watching before watch()');

			const events: RepositoryChangeEvent[] = [];
			repo.onDidChange(e => events.push(e));

			const lease = repo.watch();
			assert.strictEqual(repo.watching, true, 'watching after watch()');

			fireSessionRepoChange(new WatcherRepoChangeEvent('/repo', ['head']));
			assert.strictEqual(events.length, 1, 'expected the bridged change event');
			assert.ok(events[0].changed('head'));

			lease.dispose();
			assert.strictEqual(repo.watching, false, 'not watching after the lease is disposed');
		} finally {
			repo.dispose();
		}
	});

	test('an unwatched repository drops non-forced change events', () => {
		const { repo } = createWatchedRepo();
		try {
			const events: RepositoryChangeEvent[] = [];
			repo.onDidChange(e => events.push(e));

			// No watch() lease held → no session handle → the non-forced change is dropped
			repo.triggerOnGitIgnoreChanged();
			assert.strictEqual(events.length, 0, 'non-forced change must be dropped while unwatched');
		} finally {
			repo.dispose();
		}
	});

	test('watch() and watchWorkingTree() share one handle, released only when both leases are gone', () => {
		const { repo, getWatchCalls, getHandleDisposes } = createWatchedRepo();
		try {
			const repoLease = repo.watch();
			const wtLease = repo.watchWorkingTree();
			assert.strictEqual(getWatchCalls(), 1, 'both leases share a single underlying watch handle');
			assert.strictEqual(getHandleDisposes(), 0);

			repoLease.dispose();
			assert.strictEqual(getHandleDisposes(), 0, 'handle survives while the working-tree lease is held');
			assert.strictEqual(repo.watching, false, 'repo-change lease released');

			wtLease.dispose();
			assert.strictEqual(getHandleDisposes(), 1, 'handle released once the last lease is gone');
		} finally {
			repo.dispose();
		}
	});
});
