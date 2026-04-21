/* eslint-disable @typescript-eslint/consistent-type-assertions */
import assert from 'node:assert';
import { URI } from 'vscode-uri';
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
