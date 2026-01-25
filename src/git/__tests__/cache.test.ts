import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Disposable, Uri } from 'vscode';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import { GitCache } from '../cache.js';
import type { GitDir, PagedResult } from '../gitProvider.js';
import type { GitBranch } from '../models/branch.js';
import { GitTag } from '../models/tag.js';

// Helper to create a mock container with required events
function createMockContainer(): Container {
	const container: unknown = {
		events: {
			on: (): Disposable => ({ dispose: () => {} }),
		},
	};
	return container as Container;
}

// Helper to create a mock GitDir
function createMockGitDir(commonUri: Uri | undefined): GitDir {
	const uri: unknown = { fsPath: '/mock/.git', path: '/mock/.git', scheme: 'file' };
	return {
		uri: uri as Uri,
		commonUri: commonUri,
	};
}

// Helper to create a mock Uri with VS Code's Uri methods
function createMockUri(path: string): Uri {
	const uri = {
		fsPath: path,
		path: path,
		scheme: 'file',
		with: (change: { path?: string; scheme?: string }) => {
			return createMockUri(change.path ?? path);
		},
	};
	return uri as Uri;
}

suite('GitCache Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let mockContainer: Container;

	setup(() => {
		sandbox = sinon.createSandbox();
		// Stub configuration.onDidChange to return a mock disposable
		sandbox.stub(configuration, 'onDidChange').value(() => ({ dispose: () => {} }));
		mockContainer = createMockContainer();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('CommonPath Registry', () => {
		test('registers main repo with commonPath equal to repoPath', () => {
			const cache = new GitCache(mockContainer);
			const repoUri = createMockUri('/code/project');
			const gitDir = createMockGitDir(undefined); // No commonUri means main repo

			cache.registerRepoPath(repoUri, gitDir);

			assert.strictEqual(cache.getCommonPath('/code/project'), '/code/project');
			assert.strictEqual(cache.isWorktree('/code/project'), false);
		});

		test('registers worktree with different commonPath', () => {
			const cache = new GitCache(mockContainer);
			const worktreeUri = createMockUri('/code/project-feature');
			const gitDir = createMockGitDir(createMockUri('/code/project/.git'));

			cache.registerRepoPath(worktreeUri, gitDir);

			assert.strictEqual(cache.getCommonPath('/code/project-feature'), '/code/project');
			assert.strictEqual(cache.isWorktree('/code/project-feature'), true);
		});

		test('getCommonPath returns input path for unregistered paths', () => {
			const cache = new GitCache(mockContainer);

			assert.strictEqual(cache.getCommonPath('/unknown/path'), '/unknown/path');
		});

		test('getWorktreePaths returns all paths sharing a commonPath', () => {
			const cache = new GitCache(mockContainer);

			// Register main repo
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			// Register worktrees
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			const worktreePaths = cache.getWorktreePaths('/code/project');

			assert.strictEqual(worktreePaths.length, 3);
			assert.ok(worktreePaths.includes('/code/project'));
			assert.ok(worktreePaths.includes('/code/project-feature-a'));
			assert.ok(worktreePaths.includes('/code/project-feature-b'));
		});

		test('isWorktree returns false for main repo even when registered with worktrees', () => {
			const cache = new GitCache(mockContainer);

			// Register main repo
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			// Register a worktree
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			assert.strictEqual(cache.isWorktree('/code/project'), false);
			assert.strictEqual(cache.isWorktree('/code/project-feature'), true);
		});
	});

	suite('Shared Cache Accessors', () => {
		test('getTags caches by commonPath for main repo', async () => {
			const cache = new GitCache(mockContainer);
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [
						new GitTag(
							mockContainer,
							commonPath,
							'refs/tags/v1.0',
							'abc123',
							'Release',
							undefined,
							undefined,
						),
					],
				};
			};

			// First call should invoke factory
			const result1 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values.length, 1);
			assert.strictEqual(result1.values[0].repoPath, '/code/project');

			// Second call should use cache
			const result2 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1); // No additional call
			assert.strictEqual(result2.values[0].id, result1.values[0].id);
		});

		test('getTags shares cache between worktrees with cloned tags', async () => {
			const cache = new GitCache(mockContainer);

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [
						new GitTag(
							mockContainer,
							commonPath,
							'refs/tags/v1.0',
							'abc123',
							'Release',
							undefined,
							undefined,
						),
					],
				};
			};

			// Fetch from worktree - should create shared cache at commonPath
			const result1 = await cache.getTags('/code/project-feature', factory);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values[0].repoPath, '/code/project-feature');

			// Fetch from main repo - should use shared cache
			const result2 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1); // No additional call
			assert.strictEqual(result2.values[0].repoPath, '/code/project');

			// Tags have different repoPath but same underlying data
			assert.strictEqual(result1.values[0].name, result2.values[0].name);
			assert.strictEqual(result1.values[0].sha, result2.values[0].sha);
		});

		test('getTags fetches once when main repo queries first', async () => {
			const cache = new GitCache(mockContainer);

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [
						new GitTag(
							mockContainer,
							commonPath,
							'refs/tags/v1.0',
							'abc123',
							'Release',
							undefined,
							undefined,
						),
					],
				};
			};

			// Fetch from main repo first
			const result1 = await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(result1.values[0].repoPath, '/code/project');

			// Fetch from worktree - should clone from shared cache
			const result2 = await cache.getTags('/code/project-feature', factory);
			assert.strictEqual(factoryCallCount, 1); // No additional call
			assert.strictEqual(result2.values[0].repoPath, '/code/project-feature');
		});
	});

	suite('Cache Invalidation', () => {
		test('clearCaches clears shared caches across all worktrees', async () => {
			const cache = new GitCache(mockContainer);

			// Register main repo and worktrees
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature-a'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);
			cache.registerRepoPath(
				createMockUri('/code/project-feature-b'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			const factory = (commonPath: string): PagedResult<GitTag> => {
				factoryCallCount++;
				return {
					values: [
						new GitTag(
							mockContainer,
							commonPath,
							'refs/tags/v1.0',
							'abc123',
							'Release',
							undefined,
							undefined,
						),
					],
				};
			};

			// Populate cache from all paths
			await cache.getTags('/code/project', factory);
			await cache.getTags('/code/project-feature-a', factory);
			await cache.getTags('/code/project-feature-b', factory);
			assert.strictEqual(factoryCallCount, 1); // All shared same cache

			// Clear tags cache from one worktree
			cache.clearCaches('/code/project-feature-a', 'tags');

			// All paths should need to refetch
			await cache.getTags('/code/project', factory);
			assert.strictEqual(factoryCallCount, 2);

			await cache.getTags('/code/project-feature-a', factory);
			assert.strictEqual(factoryCallCount, 2); // Uses newly populated cache

			await cache.getTags('/code/project-feature-b', factory);
			assert.strictEqual(factoryCallCount, 2); // Uses newly populated cache
		});
	});

	suite('Branch Caching', () => {
		test('getBranches caches directly for non-worktree repos', async () => {
			const cache = new GitCache(mockContainer);
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));

			let factoryCallCount = 0;
			const factory = (): PagedResult<GitBranch> => {
				factoryCallCount++;
				return { values: [] };
			};
			const mapper = (
				branches: PagedResult<GitBranch>,
				_targetRepoPath: string,
				_commonPath: string,
			): PagedResult<GitBranch> => branches;

			// First call
			await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);

			// Second call should use cache
			await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);
		});

		test('getBranches shares cache and calls mapper for worktrees', async () => {
			const cache = new GitCache(mockContainer);

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			let mapperCallCount = 0;

			// Use mock branch objects since we're testing caching behavior
			type MockBranch = { name: string; repoPath: string };
			const factory = (commonPath: string): PagedResult<GitBranch> => {
				factoryCallCount++;
				return { values: [{ name: 'main', repoPath: commonPath }] } as unknown as PagedResult<GitBranch>;
			};

			const mapper = (
				branches: PagedResult<GitBranch>,
				targetRepoPath: string,
				_commonPath: string,
			): PagedResult<GitBranch> => {
				mapperCallCount++;
				const mockBranches = branches.values as unknown as MockBranch[];
				return {
					values: mockBranches.map(b => ({ ...b, repoPath: targetRepoPath })),
				} as unknown as PagedResult<GitBranch>;
			};

			// Fetch from worktree
			const result1 = await cache.getBranches('/code/project-feature', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 1);
			assert.strictEqual((result1.values[0] as unknown as MockBranch).repoPath, '/code/project-feature');

			// Second call from same worktree should use cache (no map)
			void (await cache.getBranches('/code/project-feature', factory, mapper));
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 1); // No additional call

			// Fetch from main repo should use shared cache and map (to set current flag)
			const result3 = await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1); // Still uses shared factory data
			assert.strictEqual(mapperCallCount, 2); // Mapper called for main repo
			assert.strictEqual((result3.values[0] as unknown as MockBranch).repoPath, '/code/project');

			// Second call from main repo should use mapped cache
			void (await cache.getBranches('/code/project', factory, mapper));
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 2); // No additional call
		});

		test('getBranches shares cache when main repo queries first', async () => {
			const cache = new GitCache(mockContainer);

			// Register main repo and worktree
			cache.registerRepoPath(createMockUri('/code/project'), createMockGitDir(undefined));
			cache.registerRepoPath(
				createMockUri('/code/project-feature'),
				createMockGitDir(createMockUri('/code/project/.git')),
			);

			let factoryCallCount = 0;
			let mapperCallCount = 0;

			type MockBranch = { name: string; repoPath: string };
			const factory = (commonPath: string): PagedResult<GitBranch> => {
				factoryCallCount++;
				return { values: [{ name: 'main', repoPath: commonPath }] } as unknown as PagedResult<GitBranch>;
			};

			const mapper = (
				branches: PagedResult<GitBranch>,
				targetRepoPath: string,
				_commonPath: string,
			): PagedResult<GitBranch> => {
				mapperCallCount++;
				const mockBranches = branches.values as unknown as MockBranch[];
				return {
					values: mockBranches.map(b => ({ ...b, repoPath: targetRepoPath })),
				} as unknown as PagedResult<GitBranch>;
			};

			// Fetch from main repo first
			const result1 = await cache.getBranches('/code/project', factory, mapper);
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 1);
			assert.strictEqual((result1.values[0] as unknown as MockBranch).repoPath, '/code/project');

			// Fetch from worktree - should use shared factory data
			const result2 = await cache.getBranches('/code/project-feature', factory, mapper);
			assert.strictEqual(factoryCallCount, 1); // No additional factory call
			assert.strictEqual(mapperCallCount, 2); // Mapper called for worktree
			assert.strictEqual((result2.values[0] as unknown as MockBranch).repoPath, '/code/project-feature');

			// Second call from worktree uses mapped cache
			void (await cache.getBranches('/code/project-feature', factory, mapper));
			assert.strictEqual(factoryCallCount, 1);
			assert.strictEqual(mapperCallCount, 2); // No additional call
		});
	});
});
