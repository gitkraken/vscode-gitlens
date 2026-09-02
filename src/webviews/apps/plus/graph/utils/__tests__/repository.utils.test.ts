import * as assert from 'assert';
import type { GraphRepository } from '../../../../../plus/graph/protocol.js';
import { countOpenRepositories, getSelectedRepoFamily, worktreeDisplayName } from '../repository.utils.js';

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

suite('countOpenRepositories', () => {
	test('returns 0 when there are no repositories', () => {
		assert.strictEqual(countOpenRepositories(undefined), 0);
		assert.strictEqual(countOpenRepositories([]), 0);
	});

	test('returns 1 for a single repo with no worktrees', () => {
		const repositories = [makeRepo({ id: '/home', path: '/home' })];

		assert.strictEqual(countOpenRepositories(repositories), 1);
	});

	// The switcher's whole point: a worktree the user opened as a workspace folder is a place they can
	// switch TO, even though it shares a family with the main repo.
	test('counts worktrees the user opened as separate switch targets', () => {
		const repositories = [
			makeRepo({ id: '/home', path: '/home' }),
			makeRepo({ id: '/wt1', path: '/wt1', commonPath: '/home' }),
			makeRepo({ id: '/wt2', path: '/wt2', commonPath: '/home' }),
		];

		assert.strictEqual(countOpenRepositories(repositories), 3);
	});

	test('counts distinct repos', () => {
		const repositories = [makeRepo({ id: '/home', path: '/home' }), makeRepo({ id: '/other', path: '/other' })];

		assert.strictEqual(countOpenRepositories(repositories), 2);
	});

	// The one entry that isn't a user choice — the host appends the bound-but-closed repo so the picker
	// can name `selectedRepository`. Counting it would sprout a switcher in a genuinely single-repo
	// workspace the moment the user scopes to a worktree.
	test('excludes the rebind-injected closed entry', () => {
		const repositories = [
			makeRepo({ id: '/home', path: '/home' }),
			makeRepo({ id: '/wt', path: '/wt', commonPath: '/home', closed: true }),
		];

		assert.strictEqual(countOpenRepositories(repositories), 1);
	});

	test('an open worktree still counts while another is injected', () => {
		const repositories = [
			makeRepo({ id: '/home', path: '/home' }),
			makeRepo({ id: '/wt1', path: '/wt1', commonPath: '/home' }),
			makeRepo({ id: '/wt2', path: '/wt2', commonPath: '/home', closed: true }),
		];

		assert.strictEqual(countOpenRepositories(repositories), 2);
	});
});

suite('worktreeDisplayName', () => {
	test('uses the matching repositories entry name', () => {
		const repositories = [makeRepo({ id: '/wt', path: '/wt', name: 'repo: feature-x', commonPath: '/home' })];

		assert.strictEqual(worktreeDisplayName(repositories, '/wt'), 'repo: feature-x');
	});

	test('falls back to the path basename for a worktree the webview has no entry for', () => {
		assert.strictEqual(worktreeDisplayName([], '/code/repo.worktrees/feature-x'), 'feature-x');
		assert.strictEqual(worktreeDisplayName(undefined, '/code/repo.worktrees/feature-x'), 'feature-x');
	});
});
