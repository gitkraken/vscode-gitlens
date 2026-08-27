import * as assert from 'assert';
import type { GraphRepository } from '../../../../../plus/graph/protocol.js';
import { getSelectedRepoFamily } from '../repository.utils.js';

function makeRepo(overrides: Partial<GraphRepository> & Pick<GraphRepository, 'id' | 'path'>): GraphRepository {
	return { name: overrides.id, uri: `file://${overrides.path}`, virtual: false, ...overrides };
}

suite('getSelectedRepoFamily', () => {
	test('returns commonPath for a worktree repo', () => {
		const repositories = [
			makeRepo({ id: '/home', path: '/home' }),
			makeRepo({ id: '/wt', path: '/wt', commonPath: '/home' }),
		];

		assert.strictEqual(getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/wt' }), '/home');
	});

	test('returns the repo path itself when there is no commonPath', () => {
		const repositories = [makeRepo({ id: '/home', path: '/home' })];

		assert.strictEqual(getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/home' }), '/home');
	});

	test('a worktree and its main repo resolve to the same family', () => {
		const repositories = [
			makeRepo({ id: '/home', path: '/home' }),
			makeRepo({ id: '/wt', path: '/wt', commonPath: '/home' }),
		];

		const homeFamily = getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/home' });
		const wtFamily = getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/wt' });

		assert.strictEqual(homeFamily, wtFamily);
	});

	test('two sibling worktrees resolve to the same family', () => {
		const repositories = [
			makeRepo({ id: '/home', path: '/home' }),
			makeRepo({ id: '/wt1', path: '/wt1', commonPath: '/home' }),
			makeRepo({ id: '/wt2', path: '/wt2', commonPath: '/home' }),
		];

		const wt1Family = getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/wt1' });
		const wt2Family = getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/wt2' });

		assert.strictEqual(wt1Family, wt2Family);
	});

	test('falls back to the first repository when the selected id is absent', () => {
		const repositories = [makeRepo({ id: '/home', path: '/home' })];

		assert.strictEqual(
			getSelectedRepoFamily({ repositories: repositories, selectedRepository: '/missing' }),
			'/home',
		);
	});

	test('returns undefined when there are no repositories', () => {
		assert.strictEqual(
			getSelectedRepoFamily({ repositories: undefined, selectedRepository: undefined }),
			undefined,
		);
	});
});
