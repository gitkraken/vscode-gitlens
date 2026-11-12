import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { isTransientFsError } from '../../exec/gitDirResolver.js';
import { ConfigGitSubProvider } from '../config.js';

type GitDirs = { gitDir: string; commonGitDir: string };
type RepositoryInfo = Awaited<ReturnType<ConfigGitSubProvider['getRepositoryInfo']>>;

/** A read held open until the test settles it, which signals once it has been started */
function holdRead<T>(): { started: Promise<void>; start: () => Promise<T>; settle: (value: T) => void } {
	let markStarted!: () => void;
	const started = new Promise<void>(resolve => {
		markStarted = resolve;
	});
	let settle!: (value: T) => void;
	const result = new Promise<T>(resolve => {
		settle = resolve;
	});
	return {
		started: started,
		start: () => {
			markStarted();
			return result;
		},
		settle: settle,
	};
}

function describe(gitDir: GitDir | undefined): Record<string, string | undefined> | undefined {
	if (gitDir == null) return undefined;

	return { uri: gitDir.uri.fsPath, commonUri: gitDir.commonUri?.fsPath, parentUri: gitDir.parentUri?.fsPath };
}

/**
 * A linked worktree at `worktreePath` of repository A is removed while its git dir is being read, and the path comes
 * back as a worktree of repository B. The read that started before the removal answers A to its own caller, but must
 * not leave that answer cached for the path.
 */
suite('ConfigGitSubProvider.getGitDir across an unregister', () => {
	const worktreePath = '/repos/a.worktrees/w';
	const gitDirsA: GitDirs = { gitDir: '/repos/a/.git/worktrees/w', commonGitDir: '/repos/a/.git' };
	const gitDirsB: GitDirs = { gitDir: '/repos/b/.git/worktrees/w', commonGitDir: '/repos/b/.git' };
	const gitDirA: GitDir = { uri: fileUri(gitDirsA.gitDir), commonUri: fileUri(gitDirsA.commonGitDir) };

	let cache: Cache;
	let provider: ConfigGitSubProvider;
	let readGitDirs: sinon.SinonStub<[repoPath: string], Promise<GitDirs | undefined>>;
	let getRepositoryInfo: sinon.SinonStub<[cwd: string], Promise<RepositoryInfo>>;

	setup(() => {
		cache = new Cache();
		provider = new ConfigGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{ isPathTrusted: () => true } as unknown as Git,
			cache,
			{ getAbsoluteUri: (path: string) => fileUri(path) } as unknown as CliGitProviderInternal,
		);
		readGitDirs = sinon.stub(
			provider as unknown as { readGitDirsWithoutGit(repoPath: string): Promise<GitDirs | undefined> },
			'readGitDirsWithoutGit',
		);
		getRepositoryInfo = sinon.stub(provider, 'getRepositoryInfo');

		cache.registerRepoPath(fileUri(worktreePath), gitDirA);
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	suite('read from the filesystem', () => {
		async function readAcrossClose(close: () => void): Promise<void> {
			const read = holdRead<GitDirs | undefined>();
			readGitDirs.onFirstCall().callsFake(read.start);
			readGitDirs.resolves(gitDirsB);

			const inFlight = provider.getGitDir(worktreePath);
			await read.started;
			close();
			read.settle(gitDirsA);

			assert.deepStrictEqual(describe(await inFlight), describe(gitDirA), 'the read answers its own caller');
		}

		test('an unregister mid-read leaves no git dir cached', async () => {
			await readAcrossClose(() => cache.unregisterRepoPath(worktreePath));

			assert.strictEqual(describe(cache.gitDir.get(worktreePath)), undefined);
		});

		test('the next read after an unregister mid-read answers the new repository', async () => {
			await readAcrossClose(() => cache.unregisterRepoPath(worktreePath));

			assert.deepStrictEqual(describe(await provider.getGitDir(worktreePath)), {
				uri: gitDirsB.gitDir,
				commonUri: gitDirsB.commonGitDir,
				parentUri: undefined,
			});
		});

		test('a reset mid-read leaves no git dir cached', async () => {
			await readAcrossClose(() => cache.reset());

			assert.strictEqual(describe(cache.gitDir.get(worktreePath)), undefined);
		});

		test('a reset mid-read of a path never registered leaves no git dir cached', async () => {
			const neverRegistered = '/repos/c';
			const read = holdRead<GitDirs | undefined>();
			readGitDirs.onFirstCall().callsFake(read.start);

			const inFlight = provider.getGitDir(neverRegistered);
			await read.started;
			cache.reset();
			read.settle({ gitDir: '/repos/c/.git', commonGitDir: '/repos/c/.git' });
			await inFlight;

			assert.strictEqual(describe(cache.gitDir.get(neverRegistered)), undefined);
		});

		test('a call after an unregister mid-read answers the new repository rather than joining the read', async () => {
			const read = holdRead<GitDirs | undefined>();
			readGitDirs.onFirstCall().callsFake(read.start);
			readGitDirs.resolves(gitDirsB);

			const beforeClose = provider.getGitDir(worktreePath);
			await read.started;
			cache.unregisterRepoPath(worktreePath);
			const afterClose = provider.getGitDir(worktreePath);
			read.settle(gitDirsA);

			const gitDirB = { uri: gitDirsB.gitDir, commonUri: gitDirsB.commonGitDir, parentUri: undefined };
			assert.deepStrictEqual(describe(await beforeClose), describe(gitDirA), 'the read answers its own caller');
			assert.deepStrictEqual(describe(await afterClose), gitDirB);
			assert.deepStrictEqual(describe(cache.gitDir.get(worktreePath)), gitDirB);
			assert.strictEqual(readGitDirs.callCount, 2);
		});

		test('getDefaultWorktreePath after an unregister mid-read answers the new repository rather than joining the call', async () => {
			const read = holdRead<GitDirs | undefined>();
			readGitDirs.onFirstCall().callsFake(read.start);
			readGitDirs.resolves(gitDirsB);

			const beforeClose = provider.getDefaultWorktreePath(worktreePath);
			await read.started;
			cache.unregisterRepoPath(worktreePath);
			const afterClose = provider.getDefaultWorktreePath(worktreePath);
			read.settle(gitDirsA);

			assert.strictEqual(await beforeClose, '/repos/a');
			assert.strictEqual(await afterClose, '/repos/b');
		});

		test('calls with no unregister between them share one read', async () => {
			const read = holdRead<GitDirs | undefined>();
			readGitDirs.onFirstCall().callsFake(read.start);
			readGitDirs.resolves(gitDirsB);

			const first = provider.getGitDir(worktreePath);
			await read.started;
			const second = provider.getGitDir(worktreePath);
			read.settle(gitDirsA);

			assert.deepStrictEqual(describe(await first), describe(gitDirA));
			assert.deepStrictEqual(describe(await second), describe(gitDirA));
			assert.strictEqual(readGitDirs.callCount, 1);
		});
	});

	suite('read through git', () => {
		setup(() => {
			readGitDirs.resolves(undefined);
		});

		/** The path vanished mid-read, so rev-parse failed and the read fell back to `<path>/.git` */
		async function readAcrossClose(): Promise<void> {
			const read = holdRead<RepositoryInfo>();
			getRepositoryInfo.onFirstCall().callsFake(read.start);
			getRepositoryInfo.resolves({
				repoPath: worktreePath,
				gitDir: gitDirsB.gitDir,
				commonGitDir: gitDirsB.commonGitDir,
				superprojectPath: undefined,
			});

			const inFlight = provider.getGitDir(worktreePath);
			await read.started;
			cache.unregisterRepoPath(worktreePath);
			read.settle([]);

			assert.deepStrictEqual(
				describe(await inFlight),
				{ uri: `${worktreePath}/.git`, commonUri: undefined, parentUri: undefined },
				'the read answers its own caller',
			);
		}

		test('an unregister mid-read leaves no git dir cached', async () => {
			await readAcrossClose();

			assert.strictEqual(describe(cache.gitDir.get(worktreePath)), undefined);
		});

		test('the next read after an unregister mid-read answers the new repository', async () => {
			await readAcrossClose();

			assert.deepStrictEqual(describe(await provider.getGitDir(worktreePath)), {
				uri: gitDirsB.gitDir,
				commonUri: gitDirsB.commonGitDir,
				parentUri: undefined,
			});
		});
	});
});

suite('ConfigGitSubProvider.resolveGitDirWithoutGit', () => {
	let cache: Cache;
	let trusted: boolean;
	let provider: ConfigGitSubProvider;
	let getRepositoryInfo: sinon.SinonStub<[cwd: string], Promise<RepositoryInfo>>;

	setup(() => {
		cache = new Cache();
		trusted = true;
		provider = new ConfigGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{ isPathTrusted: () => trusted, getRunEnvironment: () => ({}) } as unknown as Git,
			cache,
			{ getAbsoluteUri: (path: string) => fileUri(path) } as unknown as CliGitProviderInternal,
		);
		getRepositoryInfo = sinon.stub(provider, 'getRepositoryInfo');
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	function stubReadGitDirs(): sinon.SinonStub<
		[repoPath: string, rejectIfTransient?: boolean],
		Promise<GitDirs | undefined>
	> {
		return sinon.stub(
			provider as unknown as {
				readGitDirsWithoutGit(repoPath: string, rejectIfTransient?: boolean): Promise<GitDirs | undefined>;
			},
			'readGitDirsWithoutGit',
		);
	}

	test('caches the git dirs read from the files, as getGitDir would', async () => {
		stubReadGitDirs().resolves({ gitDir: '/repos/a/.git/worktrees/w', commonGitDir: '/repos/a/.git' });

		assert.strictEqual(await provider.resolveGitDirWithoutGit('/repos/a.worktrees/w'), true);
		assert.deepStrictEqual(describe(cache.gitDir.get('/repos/a.worktrees/w')), {
			uri: '/repos/a/.git/worktrees/w',
			commonUri: '/repos/a/.git',
			parentUri: undefined,
		});
		assert.strictEqual(getRepositoryInfo.callCount, 0);
	});

	test('answers false, caching nothing and never running git, when only git can answer', async () => {
		stubReadGitDirs().resolves(undefined);

		assert.strictEqual(await provider.resolveGitDirWithoutGit('/repos/bare.git'), false);
		assert.strictEqual(cache.gitDir.get('/repos/bare.git'), undefined);
		assert.strictEqual(getRepositoryInfo.callCount, 0);
	});

	test('reads so that a failure that may pass rejects, rather than answering false', async () => {
		const read = stubReadGitDirs().resolves(undefined);

		await provider.resolveGitDirWithoutGit('/repos/a');
		assert.deepStrictEqual(read.firstCall.args, ['/repos/a', true]);
	});

	test('tells a file-system failure that may pass from one that is the layout', () => {
		for (const code of ['EIO', 'ETIMEDOUT', 'ESTALE', 'EMFILE', 'ENOTCONN']) {
			assert.strictEqual(isTransientFsError(Object.assign(new Error(code), { code: code })), true, code);
		}
		for (const code of ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM']) {
			assert.strictEqual(isTransientFsError(Object.assign(new Error(code), { code: code })), false, code);
		}
		assert.strictEqual(isTransientFsError(new Error('no code')), false);
	});

	test('rejects, caching nothing, when the path is unregistered mid-read', async () => {
		const read = holdRead<GitDirs | undefined>();
		stubReadGitDirs().callsFake(read.start);
		cache.registerRepoPath(fileUri('/repos/a'), { uri: fileUri('/repos/a/.git') });

		const resolving = provider.resolveGitDirWithoutGit('/repos/a');
		await read.started;
		cache.unregisterRepoPath('/repos/a');
		read.settle({ gitDir: '/repos/a/.git', commonGitDir: '/repos/a/.git' });

		await assert.rejects(resolving);
		assert.strictEqual(cache.gitDir.get('/repos/a'), undefined);
	});

	suite('on disk', () => {
		let root: string;
		let repoPath: string;

		setup(() => {
			root = mkdtempSync(join(tmpdir(), 'gitlens-resolve-git-dir-'));
			repoPath = join(root, 'repo');
			mkdirSync(join(repoPath, '.git', 'objects'), { recursive: true });
			mkdirSync(join(repoPath, '.git', 'refs'));
			writeFileSync(join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
			writeFileSync(join(repoPath, '.git', 'config'), '[core]\n\tbare = false\n');
		});

		teardown(() => {
			rmSync(root, { recursive: true, force: true });
		});

		test("reads a standard repository's git dir", async () => {
			assert.strictEqual(await provider.resolveGitDirWithoutGit(repoPath), true);
			assert.strictEqual(cache.gitDir.get(repoPath)?.uri.fsPath, join(repoPath, '.git'));
			assert.strictEqual(getRepositoryInfo.callCount, 0);
		});

		test('reads nothing in a path the host does not trust', async () => {
			trusted = false;

			assert.strictEqual(await provider.resolveGitDirWithoutGit(repoPath), false);
			assert.strictEqual(cache.gitDir.get(repoPath), undefined);
			assert.strictEqual(getRepositoryInfo.callCount, 0);
		});
	});
});
