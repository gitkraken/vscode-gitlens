/* eslint-disable @typescript-eslint/consistent-type-assertions */
import * as assert from 'assert';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitProviderDescriptor } from '../../providers/types.js';
import type { RepositoryWatchService } from '../../watching/watchService.js';
import type { RepositoryInit } from '../repository.js';
import { Repository } from '../repository.js';
import type { RepositoryChangeEvent } from '../repositoryChangeEvent.js';

// Minimal subclass that exposes the protected `onFetchHeadChanged` hook so tests can simulate
// what the FS watcher triggers without standing up a real watch service.
class TestRepository extends Repository {
	triggerOnFetchHeadChanged(): void {
		this.onFetchHeadChanged();
	}
}

function createRepo(): TestRepository {
	const uri = { fsPath: '/repo', path: '/repo', scheme: 'file' } as unknown as Uri;
	// `setupWatching` short-circuits when `gitDir` is undefined, so the mocked watchService is
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
