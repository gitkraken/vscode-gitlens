/* oxlint-disable typescript/consistent-type-assertions */
import assert from 'node:assert';
import * as sinon from 'sinon';
import { URI } from 'vscode-uri';
import { defer } from '@gitlens/utils/promise.js';
import { fileUri } from '@gitlens/utils/uri.js';
import { Cache } from '../cache.js';
import type { GitBranch } from '../models/branch.js';
import type { GitDir } from '../models/repository.js';
import type { GitConfigSubProvider } from '../providers/config.js';
import type { GitProvider } from '../providers/provider.js';
import { GitService } from '../service.js';

type GetRepositoryInfo = NonNullable<GitConfigSubProvider['getRepositoryInfo']>;

// Minimal mock provider — only needs enough structure for forRepo/closeRepo to work
function createMockProvider(configOverrides?: Partial<GitConfigSubProvider>): GitProvider {
	return {
		descriptor: { id: 'git', name: 'Test', virtual: false },
		getAbsoluteUri: () => URI.file('/'),
		getRelativePath: () => '',
		branches: {} as GitProvider['branches'],
		commits: {} as GitProvider['commits'],
		config: { ...configOverrides } as GitProvider['config'],
		contributors: {} as GitProvider['contributors'],
		diff: {} as GitProvider['diff'],
		graph: {} as GitProvider['graph'],
		refs: {} as GitProvider['refs'],
		remotes: {} as GitProvider['remotes'],
		revision: {} as GitProvider['revision'],
		status: {} as GitProvider['status'],
		tags: {} as GitProvider['tags'],
	};
}

suite('GitService.forRepo / closeRepo', () => {
	let service: GitService;

	setup(() => {
		service = GitService.createSingleton();
		service.register(createMockProvider(), () => true);
	});

	teardown(() => {
		service.dispose();
	});

	test('forRepo with local path returns a proxy', () => {
		const repo = service.forRepo('/home/user/repo');
		assert.ok(repo != null, 'should return a RepositoryService');
	});

	test('forRepo with local path and file URI string resolve to same cached proxy', () => {
		const fromPath = service.forRepo('/home/user/repo');
		const fromUri = service.forRepo('file:///home/user/repo');
		assert.ok(fromPath != null);
		assert.strictEqual(fromPath, fromUri, 'path and file URI string should resolve to same proxy');
	});

	test('forRepo with non-file URI returns a proxy keyed by full URI string', () => {
		const vfsUri = URI.parse('vscode-vfs://github/owner/repo');
		const repo = service.forRepo(vfsUri);
		assert.ok(repo != null, 'should return a RepositoryService for virtual URI');
	});

	test('forRepo caches and returns same proxy for identical non-file URI', () => {
		const vfsUri = URI.parse('vscode-vfs://github/owner/repo');
		const first = service.forRepo(vfsUri);
		const second = service.forRepo(vfsUri);
		assert.strictEqual(first, second, 'should return same cached proxy');
	});

	test('forRepo with non-file URI string and Uri object resolve to same cached proxy', () => {
		const vfsUri = 'vscode-vfs://github/owner/repo';
		const fromString = service.forRepo(vfsUri);
		const fromUri = service.forRepo(URI.parse(vfsUri));
		assert.ok(fromString != null);
		assert.strictEqual(fromString, fromUri, 'URI string and Uri object should resolve to same proxy');
	});

	test('closeRepo with file URI string evicts proxy created by local path', () => {
		const repo = service.forRepo('/home/user/repo');
		assert.ok(repo != null);

		service.closeRepo('file:///home/user/repo');

		// After close, forRepo should create a new proxy (not the same instance)
		const newRepo = service.forRepo('/home/user/repo');
		assert.ok(newRepo != null);
		assert.notStrictEqual(repo, newRepo, 'should be a new proxy after close');
	});

	test('closeRepo with non-file URI evicts the correct virtual-repo entry', () => {
		const vfsUri = URI.parse('vscode-vfs://github/owner/repo');
		const repo = service.forRepo(vfsUri);
		assert.ok(repo != null);

		service.closeRepo(vfsUri);

		const newRepo = service.forRepo(vfsUri);
		assert.ok(newRepo != null);
		assert.notStrictEqual(repo, newRepo, 'should be a new proxy after close');
	});
});

suite('GitService.validateRepo', () => {
	let service: GitService;

	setup(() => {
		service = GitService.createSingleton();
	});

	teardown(() => {
		service.dispose();
	});

	test('returns { valid: false } when no provider can handle the path', async () => {
		service.register(createMockProvider(), () => false);

		const result = await service.validateRepo('/home/user/repo');
		assert.deepStrictEqual(result, { valid: false });
	});

	test('returns { valid: false } when the routed provider does not implement getRepositoryInfo', async () => {
		service.register(createMockProvider(), () => true);

		const result = await service.validateRepo('/home/user/repo');
		assert.deepStrictEqual(result, { valid: false });
	});

	test('returns { valid: false } when getRepositoryInfo resolves to []', async () => {
		const getRepositoryInfo: GetRepositoryInfo = async () => [];
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		const result = await service.validateRepo('/home/user/not-a-repo');
		assert.deepStrictEqual(result, { valid: false });
	});

	test('rejects when getRepositoryInfo rejects, rather than calling the path invalid', async () => {
		const timeout = new Error('git ran past its time limit');
		const getRepositoryInfo: GetRepositoryInfo = () => Promise.reject(timeout);
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		await assert.rejects(service.validateRepo('/home/user/repo'), (ex: unknown) => ex === timeout);
	});

	test('returns { valid: true, safe: false } when getRepositoryInfo resolves to [false]', async () => {
		const getRepositoryInfo: GetRepositoryInfo = async () => [false];
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		const result = await service.validateRepo('/home/user/unsafe-repo');
		assert.deepStrictEqual(result, { valid: true, safe: false });
	});

	test('returns { valid: true, safe: true, repoPath } for [true, repoPath] tuple (bare-repo fallback)', async () => {
		const getRepositoryInfo: GetRepositoryInfo = async () => [true, '/home/user/bare.git'];
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		const result = await service.validateRepo('/home/user/bare.git');
		assert.deepStrictEqual(result, { valid: true, safe: true, repoPath: '/home/user/bare.git' });
	});

	test('returns the full rich object when getRepositoryInfo resolves to the object shape', async () => {
		const getRepositoryInfo: GetRepositoryInfo = async () => ({
			repoPath: '/home/user/repo',
			gitDir: '/home/user/repo/.git',
			commonGitDir: '/home/user/main/.git',
			superprojectPath: '/home/user/super',
		});
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		const result = await service.validateRepo('/home/user/repo/src/file.ts');
		assert.deepStrictEqual(result, {
			valid: true,
			safe: true,
			repoPath: '/home/user/repo',
			gitDir: '/home/user/repo/.git',
			commonGitDir: '/home/user/main/.git',
			superprojectPath: '/home/user/super',
		});
	});

	test('maps the object shape undefined fields through as undefined', async () => {
		const getRepositoryInfo: GetRepositoryInfo = async () => ({
			repoPath: '/home/user/repo',
			gitDir: '/home/user/repo/.git',
			commonGitDir: undefined,
			superprojectPath: undefined,
		});
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		const result = await service.validateRepo('/home/user/repo');
		assert.deepStrictEqual(result, {
			valid: true,
			safe: true,
			repoPath: '/home/user/repo',
			gitDir: '/home/user/repo/.git',
			commonGitDir: undefined,
			superprojectPath: undefined,
		});
	});

	test('accepts string paths, file URI strings, and Uri objects and passes normalized path to the provider', async () => {
		const seen: string[] = [];
		const getRepositoryInfo: GetRepositoryInfo = async cwd => {
			seen.push(cwd);
			return {
				repoPath: '/home/user/repo',
				gitDir: '/home/user/repo/.git',
				commonGitDir: undefined,
				superprojectPath: undefined,
			};
		};
		service.register(createMockProvider({ getRepositoryInfo: getRepositoryInfo }), () => true);

		await service.validateRepo('/home/user/repo');
		await service.validateRepo('file:///home/user/repo');
		await service.validateRepo(URI.file('/home/user/repo'));

		assert.strictEqual(seen.length, 3);
		assert.ok(
			seen.every(p => p === seen[0]),
			`expected all three inputs to route to the same normalized path; got: ${JSON.stringify(seen)}`,
		);
	});
});

suite('GitService.forRepo — registering a checkout before its first read', () => {
	const repoPath = '/home/user/repo';
	const gitDir: GitDir = { uri: fileUri(`${repoPath}/.git`) };
	/** Past the limit a read waits for a registration */
	const registrationWaitMs = 10 * 1000;

	let service: GitService;
	let cache: Cache;
	/** The paths the registrar was asked to register */
	let asked: string[];
	/** The sub-provider methods whose bodies started, in order */
	let started: string[];
	const branch = Promise.resolve(undefined as GitBranch | undefined);

	/** Lets macrotasks run, so a read that isn't waiting on anything has started and settled */
	async function flush(): Promise<void> {
		for (let i = 0; i < 5; i++) {
			await new Promise<void>(resolve => setImmediate(resolve));
		}
	}

	function createProvider(options?: { ensureRegistered?: boolean }): GitProvider {
		const provider: GitProvider = {
			...createMockProvider({
				getGitDir: () => {
					started.push('getGitDir');
					return Promise.resolve(gitDir);
				},
			}),
			branches: {
				getBranch: () => {
					started.push('getBranch');
					return branch;
				},
			} as unknown as GitProvider['branches'],
			graph: {
				searchGraph: async function* () {
					started.push('searchGraph');
					yield* [];
					return undefined;
				},
			} as unknown as GitProvider['graph'],
			worktrees: {
				getWorktreesDefaultUri: () => {
					started.push('getWorktreesDefaultUri');
					return gitDir.uri;
				},
			} as unknown as GitProvider['worktrees'],
		};
		if (options?.ensureRegistered !== false) {
			provider.ensureRegistered = path => cache.ensureRegistered(path);
		}
		return provider;
	}

	setup(() => {
		asked = [];
		started = [];
		cache = new Cache();
		service = GitService.createSingleton();
	});

	teardown(() => {
		service.dispose();
		cache.dispose();
	});

	test('calls straight through when the provider asks nothing, or no registrar is set', () => {
		service.register(createProvider({ ensureRegistered: false }), () => true);
		assert.strictEqual(service.forRepo(repoPath)!.branches.getBranch(), branch);
		assert.strictEqual(service.forRepo(repoPath)!.worktrees!.getWorktreesDefaultUri(), gitDir.uri);
		service.dispose();

		service = GitService.createSingleton();
		service.register(createProvider(), () => true);
		assert.strictEqual(service.forRepo(repoPath)!.branches.getBranch(), branch);
		assert.deepStrictEqual(started, ['getBranch', 'getWorktreesDefaultUri', 'getBranch']);
	});

	test('calls straight through, asking nothing, for a registered checkout however its path is spelled', () => {
		service.register(createProvider(), () => true);
		cache.setRepoPathRegistrar(path => {
			asked.push(path);
			return Promise.resolve();
		});
		cache.registerRepoPath(fileUri(`${repoPath}/`), gitDir);

		for (const spelling of [repoPath, `${repoPath}/`, `file://${repoPath}`, URI.file(repoPath).toString()]) {
			assert.strictEqual(service.forRepo(spelling)!.branches.getBranch(), branch, spelling);
		}
		assert.deepStrictEqual(asked, []);
	});

	test('starts a read of an unregistered checkout once the registrar registered it, asking once', async () => {
		service.register(createProvider(), () => true);
		const registration = defer<void>();
		cache.setRepoPathRegistrar(path => {
			asked.push(path);
			return registration.promise;
		});

		const repo = service.forRepo(repoPath)!;
		const first = repo.branches.getBranch();
		const second = repo.branches.getBranch();
		await flush();
		assert.deepStrictEqual(asked, [repoPath]);
		assert.deepStrictEqual(started, [], 'waits for the registration');

		cache.registerRepoPath(fileUri(repoPath), gitDir);
		registration.fulfill();
		assert.strictEqual(await first, undefined);
		assert.strictEqual(await second, undefined);
		assert.deepStrictEqual(started, ['getBranch', 'getBranch']);

		assert.strictEqual(repo.branches.getBranch(), branch, 'registered from here on');
		assert.deepStrictEqual(asked, [repoPath]);
	});

	test('calls straight through for a path the registrar declines, and asks again at the next read', () => {
		service.register(createProvider(), () => true);
		cache.setRepoPathRegistrar(path => {
			asked.push(path);
			return undefined;
		});

		const repo = service.forRepo(repoPath)!;
		assert.strictEqual(repo.branches.getBranch(), branch);
		assert.strictEqual(repo.branches.getBranch(), branch);
		assert.deepStrictEqual(asked, [repoPath, repoPath]);
	});

	test('runs the read when the registrar throws or rejects', async () => {
		service.register(createProvider(), () => true);
		const repo = service.forRepo(repoPath)!;

		cache.setRepoPathRegistrar(() => {
			throw new Error('registrar threw');
		});
		assert.strictEqual(repo.branches.getBranch(), branch);

		cache.setRepoPathRegistrar(() => Promise.reject(new Error('registrar rejected')));
		assert.strictEqual(await repo.branches.getBranch(), undefined);
		assert.deepStrictEqual(started, ['getBranch', 'getBranch']);
	});

	test('stops waiting on a registrar that hangs, without waiting again until it settles', async () => {
		const clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			service.register(createProvider(), () => true);
			const registration = defer<void>();
			cache.setRepoPathRegistrar(path => {
				asked.push(path);
				return registration.promise;
			});

			const repo = service.forRepo(repoPath)!;
			const waiting = repo.branches.getBranch();
			clock.tick(registrationWaitMs - 1);
			await flush();
			assert.deepStrictEqual(started, []);

			clock.tick(1);
			assert.strictEqual(await waiting, undefined);
			assert.deepStrictEqual(started, ['getBranch']);

			assert.strictEqual(repo.branches.getBranch(), branch, 'no wait while the registrar still runs');
			assert.deepStrictEqual(asked, [repoPath]);

			// Settled without registering: the next read asks again
			registration.fulfill();
			await flush();
			assert.strictEqual(clock.countTimers(), 0);
			void repo.branches.getBranch();
			assert.deepStrictEqual(asked, [repoPath, repoPath]);
		} finally {
			clock.restore();
		}
	});

	test('a synchronous, async-generator or git dir method calls straight through, still asking for a registration', async () => {
		service.register(createProvider(), () => true);
		const registration = defer<void>();
		cache.setRepoPathRegistrar(path => {
			asked.push(path);
			return registration.promise;
		});

		const repo = service.forRepo(repoPath)!;
		assert.strictEqual(repo.worktrees!.getWorktreesDefaultUri(), gitDir.uri);
		assert.deepStrictEqual(asked, [repoPath], 'the first call asks');

		const search = repo.graph.searchGraph({ query: 'x' });
		assert.strictEqual(typeof search.next, 'function', 'the generator itself, not a promise of it');
		await search.next();

		const gitDirRead = repo.config.getGitDir!();
		assert.deepStrictEqual(started, ['getWorktreesDefaultUri', 'searchGraph', 'getGitDir'], 'started at once');
		assert.strictEqual(await gitDirRead, gitDir);
		assert.deepStrictEqual(asked, [repoPath]);
	});

	/** Reads through a registrar that resolves the git dir through the service, then registers it */
	async function readThroughRegistrarUsingService(awaitsFirst: boolean): Promise<void> {
		service.register(createProvider(), () => true);
		cache.setRepoPathRegistrar(path => {
			asked.push(path);
			return (async () => {
				if (awaitsFirst) {
					await Promise.resolve();
				}
				const resolved = await service.forRepo(path)!.config.getGitDir!();
				cache.registerRepoPath(fileUri(path), resolved!);
			})();
		});

		const read = service.forRepo(repoPath)!.branches.getBranch();
		await flush();
		assert.deepStrictEqual(started, ['getGitDir', 'getBranch']);
		assert.strictEqual(await read, undefined);
		assert.strictEqual(cache.isRegistered(repoPath), true);
		assert.deepStrictEqual(asked, [repoPath]);
	}

	test('a registrar that resolves the git dir through the service and registers it completes', () =>
		readThroughRegistrarUsingService(false));

	test('a registrar that resolves the git dir through the service after an await and registers it completes', () =>
		readThroughRegistrarUsingService(true));
});
