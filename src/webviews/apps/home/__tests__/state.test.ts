import * as assert from 'assert';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { restoreOverviewRepositoryPath } from '../actions.js';
import { createHomeState } from '../state.js';

suite('createHomeState Test Suite', () => {
	test('should restore the persisted overview repository path', () => {
		const storage = new InMemoryStorage();
		storage.set({
			__v: 1,
			overviewRepositoryPath: '/repo/a',
		});

		const state = createHomeState(storage);

		assert.strictEqual(state.overviewRepositoryPath.get(), '/repo/a');
	});

	test('should persist the selected overview repository path', async () => {
		const storage = new InMemoryStorage();
		const state = createHomeState(storage);
		const stop = state.startAutoPersist();

		state.overviewRepositoryPath.set('/repo/b');

		await new Promise<void>(resolve => queueMicrotask(resolve));

		assert.strictEqual(storage.get()?.['overviewRepositoryPath'], '/repo/b');
		assert.strictEqual(storage.get()?.['__v'], 1);

		stop();
	});

	test('should clear a persisted overview repository path when the host cannot restore it', async () => {
		const state = createHomeState(new InMemoryStorage());
		state.overviewRepositoryPath.set('/repo/missing');

		await restoreOverviewRepositoryPath(state, {
			setOverviewRepository: () => Promise.resolve(undefined),
			getOverviewRepositoryState: () =>
				Promise.reject(
					new Error('getOverviewRepositoryState should not be called when a persisted path exists'),
				),
		});

		assert.strictEqual(state.overviewRepositoryPath.get(), undefined);
	});

	test('should seed the selected overview repository path from the current host selection', async () => {
		const state = createHomeState(new InMemoryStorage());

		await restoreOverviewRepositoryPath(state, {
			setOverviewRepository: () =>
				Promise.reject(new Error('setOverviewRepository should not be called without a persisted path')),
			getOverviewRepositoryState: () => Promise.resolve('/repo/current'),
		});

		assert.strictEqual(state.overviewRepositoryPath.get(), '/repo/current');
	});
});
