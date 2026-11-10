import * as assert from 'assert';
import * as sinon from 'sinon';
import { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { CommitsGitSubProvider } from '../commits.js';
import { ContributorsGitSubProvider } from '../contributors.js';
import { RefsGitSubProvider } from '../refs.js';
import { RemotesGitSubProvider } from '../remotes.js';
import { TagsGitSubProvider } from '../tags.js';

const repoPath = '/repo';
const recordSep = '\x1E';
const fieldSep = '\x1D';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function exitedWith(code: number, stderr: string): GitResult {
	return { stdout: '', stderr: stderr, exitCode: code, completion: { status: 'exited', code: code } };
}

function failedToStart(): GitResult {
	return {
		stdout: '',
		stderr: undefined,
		completion: { status: 'failed', reason: 'unstarted', error: new Error('spawn failed') },
	};
}

// A `for-each-ref` record carries, in order: current, name, objectname, peeledObjectname, upstream, upstreamTracking,
// committerDate, creatorDate, authorDate, subject, push
function refRecords(records: { name: string; sha: string }[]): string {
	return records
		.map(r => `${recordSep}${['', r.name, r.sha, '', '', '', '', '', '', '', ''].join(fieldSep)}${fieldSep}`)
		.join('');
}

const tagRecords = refRecords([
	{ name: 'refs/heads/main', sha: 'a'.repeat(40) },
	{ name: 'refs/tags/v1', sha: 'b'.repeat(40) },
]);
const branchOnlyRecords = refRecords([{ name: 'refs/heads/main', sha: 'a'.repeat(40) }]);

suite('A failed git read is not kept by the cache', () => {
	let cache: Cache;
	let run: sinon.SinonStub<[options: unknown, ...args: string[]], Promise<GitResult>>;
	let git: Git;
	const context = {} as unknown as GitServiceContext;

	setup(() => {
		cache = new Cache();
		run = sinon.stub<[options: unknown, ...args: string[]], Promise<GitResult>>();
		git = { run: run, supported: () => Promise.resolve([]) } as unknown as Git;
	});

	teardown(() => {
		sinon.restore();
		cache.dispose();
	});

	function createRefs(): RefsGitSubProvider {
		return new RefsGitSubProvider(context, git, cache, {} as unknown as CliGitProviderInternal);
	}

	function createTags(refs: RefsGitSubProvider): TagsGitSubProvider {
		return new TagsGitSubProvider(context, git, cache, { refs: refs } as unknown as CliGitProviderInternal);
	}

	suite('getTags', () => {
		test('a failed ref listing is returned empty but not kept', async () => {
			run.onFirstCall().resolves(exitedWith(128, 'fatal: unable to read refs'));
			run.onSecondCall().resolves(exited(tagRecords));
			const tags = createTags(createRefs());

			assert.deepStrictEqual((await tags.getTags(repoPath)).values, []);

			const second = await tags.getTags(repoPath);
			assert.deepStrictEqual(
				second.values.map(t => t.name),
				['v1'],
			);
		});

		test('a read that throws is returned empty but not kept', async () => {
			const getRefs = sinon.stub();
			getRefs.onFirstCall().rejects(new Error('boom'));
			getRefs.onSecondCall().resolves([
				{
					name: 'refs/tags/v1',
					objectname: 'b'.repeat(40),
					peeledObjectname: '',
					subject: '',
					creatorDate: '',
					authorDate: '',
				},
			]);
			const tags = new TagsGitSubProvider(context, git, cache, {
				refs: { getRefs: getRefs },
			} as unknown as CliGitProviderInternal);

			assert.deepStrictEqual((await tags.getTags(repoPath)).values, []);
			assert.deepStrictEqual(
				(await tags.getTags(repoPath)).values.map(t => t.name),
				['v1'],
			);
		});

		test('a repository with no refs is read once', async () => {
			run.resolves(exited(''));
			const tags = createTags(createRefs());

			assert.deepStrictEqual((await tags.getTags(repoPath)).values, []);
			assert.deepStrictEqual((await tags.getTags(repoPath)).values, []);
			assert.strictEqual(run.callCount, 1);
		});

		test('a repository with refs but no tags is read once', async () => {
			run.resolves(exited(branchOnlyRecords));
			const tags = createTags(createRefs());

			assert.deepStrictEqual((await tags.getTags(repoPath)).values, []);
			assert.deepStrictEqual((await tags.getTags(repoPath)).values, []);
			assert.strictEqual(run.callCount, 1);
		});
	});

	suite('getRefTips', () => {
		test('a failed ref listing is returned empty but not kept', async () => {
			run.onFirstCall().resolves(failedToStart());
			run.onSecondCall().resolves(exited(tagRecords));
			const refs = createRefs();

			assert.deepStrictEqual(await refs.getRefTips(repoPath), []);

			const second = await refs.getRefTips(repoPath);
			assert.deepStrictEqual(
				second.map(t => t.fullName),
				['refs/heads/main', 'refs/tags/v1'],
			);
		});

		test('a repository with no refs is read once', async () => {
			run.resolves(exited(''));
			const refs = createRefs();

			assert.deepStrictEqual(await refs.getRefTips(repoPath), []);
			assert.deepStrictEqual(await refs.getRefTips(repoPath), []);
			assert.strictEqual(run.callCount, 1);
		});
	});

	suite('getBestRemotesWithProviders', () => {
		const remoteListing =
			'origin\thttps://github.com/owner/name.git (fetch)\norigin\thttps://github.com/owner/name.git (push)\n';

		function createRemotes(): RemotesGitSubProvider {
			return new RemotesGitSubProvider(context, git, cache, {
				config: {},
			} as unknown as CliGitProviderInternal);
		}

		test('a failed remote listing is returned empty but not kept', async () => {
			run.onFirstCall().rejects(new Error('boom'));
			run.onSecondCall().resolves(exited(remoteListing));
			const remotes = createRemotes();

			assert.deepStrictEqual(await remotes.getBestRemotesWithProviders(repoPath), []);

			const second = await remotes.getBestRemotesWithProviders(repoPath);
			assert.deepStrictEqual(
				second.map(r => r.name),
				['origin'],
			);
		});

		test('a repository with no remotes is read once', async () => {
			run.resolves(exited(''));
			const remotes = createRemotes();

			assert.deepStrictEqual(await remotes.getBestRemotesWithProviders(repoPath), []);
			assert.deepStrictEqual(await remotes.getBestRemotesWithProviders(repoPath), []);
			assert.strictEqual(run.callCount, 1);
		});

		test('remotes with no provider are an answer that is kept', async () => {
			run.resolves(exited('origin\t/srv/git/name.git (fetch)\norigin\t/srv/git/name.git (push)\n'));
			const remotes = createRemotes();

			assert.deepStrictEqual(await remotes.getBestRemotesWithProviders(repoPath), []);
			assert.notStrictEqual(cache.bestRemotes.get(repoPath), undefined);
			assert.strictEqual(run.callCount, 1);
		});
	});

	suite('read through a linked worktree', () => {
		const worktree = '/repo-wt';
		const remoteListing =
			'origin\thttps://github.com/owner/name.git (fetch)\norigin\thttps://github.com/owner/name.git (push)\n';

		setup(() => {
			cache.registerRepoPath(fileUri(repoPath), { uri: fileUri(`${repoPath}/.git`) });
			cache.registerRepoPath(fileUri(worktree), {
				uri: fileUri(`${repoPath}/.git/worktrees/wt`),
				commonUri: fileUri(`${repoPath}/.git`),
			});
		});

		test('a failed ref listing leaves the worktree no empty copy of the tags', async () => {
			run.onFirstCall().resolves(exitedWith(128, 'fatal: unable to read refs'));
			run.onSecondCall().resolves(exited(tagRecords));
			const tags = createTags(createRefs());

			assert.deepStrictEqual((await tags.getTags(worktree)).values, []);
			assert.deepStrictEqual(
				(await tags.getTags(worktree)).values.map(t => t.name),
				['v1'],
			);
		});

		test('a failed ref listing leaves the worktree no empty copy of the ref tips', async () => {
			run.onFirstCall().resolves(failedToStart());
			run.onSecondCall().resolves(exited(tagRecords));
			const refs = createRefs();

			assert.deepStrictEqual(await refs.getRefTips(worktree), []);
			assert.deepStrictEqual(
				(await refs.getRefTips(worktree)).map(t => t.fullName),
				['refs/heads/main', 'refs/tags/v1'],
			);
		});

		test('a failed remote listing leaves the worktree no empty copy of the remotes', async () => {
			run.onFirstCall().rejects(new Error('boom'));
			run.onSecondCall().resolves(exited(remoteListing));
			const remotes = new RemotesGitSubProvider(context, git, cache, {
				config: {},
			} as unknown as CliGitProviderInternal);

			assert.deepStrictEqual(await remotes.getBestRemotesWithProviders(worktree), []);
			assert.deepStrictEqual(
				(await remotes.getBestRemotesWithProviders(worktree)).map(r => r.name),
				['origin'],
			);
		});
	});

	suite('getInitialCommitSha', () => {
		const sha = 'c'.repeat(40);

		function createCommits(): CommitsGitSubProvider {
			return new CommitsGitSubProvider(context, git, cache, {} as unknown as CliGitProviderInternal);
		}

		const failures: [string, () => Promise<GitResult>][] = [
			[
				'an exit that is not an unborn HEAD',
				() => Promise.resolve(exitedWith(128, 'fatal: unable to read tree')),
			],
			['a run that never started', () => Promise.resolve(failedToStart())],
			['a run that throws', () => Promise.reject(new Error('boom'))],
		];

		function testFailure(name: string, fail: () => Promise<GitResult>): void {
			test(`${name} answers undefined but is not kept`, async () => {
				run.onFirstCall().callsFake(fail);
				run.onSecondCall().resolves(exited(`${sha}\n`));
				const commits = createCommits();

				assert.strictEqual(await commits.getInitialCommitSha(repoPath), undefined);
				assert.strictEqual(await commits.getInitialCommitSha(repoPath), sha);
			});
		}

		for (const [name, fail] of failures) {
			testFailure(name, fail);
		}

		test('an unborn HEAD answers undefined and is read once', async () => {
			run.resolves(exitedWith(128, "fatal: bad revision 'HEAD'\n"));
			const commits = createCommits();

			assert.strictEqual(await commits.getInitialCommitSha(repoPath), undefined);
			assert.strictEqual(await commits.getInitialCommitSha(repoPath), undefined);
			assert.strictEqual(run.callCount, 1);
		});

		test('an unborn HEAD reported as an unknown revision is read once', async () => {
			run.resolves(
				exitedWith(
					128,
					"fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n",
				),
			);
			const commits = createCommits();

			assert.strictEqual(await commits.getInitialCommitSha(repoPath), undefined);
			assert.strictEqual(await commits.getInitialCommitSha(repoPath), undefined);
			assert.strictEqual(run.callCount, 1);
		});

		test('the first of several root commits is kept', async () => {
			run.resolves(exited(`${sha}\n${'d'.repeat(40)}\n`));
			const commits = createCommits();

			assert.strictEqual(await commits.getInitialCommitSha(repoPath), sha);
			assert.strictEqual(await commits.getInitialCommitSha(repoPath), sha);
			assert.strictEqual(run.callCount, 1);
		});

		test('a cancelled read rejects and is not kept', async () => {
			const controller = new AbortController();
			run.onFirstCall().callsFake(() => {
				controller.abort();
				return Promise.resolve(exitedWith(128, 'cancelled'));
			});
			run.onSecondCall().resolves(exited(`${sha}\n`));
			const commits = createCommits();

			await assert.rejects(commits.getInitialCommitSha(repoPath, controller.signal));
			assert.strictEqual(await commits.getInitialCommitSha(repoPath), sha);
		});
	});

	suite('getContributorsStats', () => {
		const shortlog = '     3\tAlice\n     1\tBob\n';
		const stats = { count: 2, contributions: [3, 1] };

		function createContributors(): ContributorsGitSubProvider {
			return new ContributorsGitSubProvider(context, git, cache, {} as unknown as CliGitProviderInternal);
		}

		test('a failed read answers undefined but is not kept', async () => {
			run.onFirstCall().rejects(new Error('boom'));
			run.onSecondCall().resolves(exited(shortlog));
			const contributors = createContributors();

			assert.strictEqual(await contributors.getContributorsStats(repoPath), undefined);
			assert.deepStrictEqual(await contributors.getContributorsStats(repoPath), stats);
		});

		test('a repository with no commits is read once', async () => {
			run.resolves(exited(''));
			const contributors = createContributors();

			assert.strictEqual(await contributors.getContributorsStats(repoPath), undefined);
			assert.strictEqual(await contributors.getContributorsStats(repoPath), undefined);
			assert.strictEqual(run.callCount, 1);
		});

		test('a read with no custom lifetime still expires', async () => {
			run.resolves(exited(shortlog));
			const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
			try {
				const contributors = createContributors();

				assert.deepStrictEqual(await contributors.getContributorsStats(repoPath), stats);
				assert.deepStrictEqual(await contributors.getContributorsStats(repoPath), stats);
				assert.strictEqual(run.callCount, 1);

				clock.tick(1000 * 60 * 60 + 1);

				assert.deepStrictEqual(await contributors.getContributorsStats(repoPath), stats);
				assert.strictEqual(run.callCount, 2);
			} finally {
				clock.restore();
			}
		});

		test('a read with a timeout expires after twice the timeout', async () => {
			run.resolves(exited(shortlog));
			const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
			try {
				const contributors = createContributors();

				await contributors.getContributorsStats(repoPath, undefined, undefined, 1000);
				await contributors.getContributorsStats(repoPath, undefined, undefined, 1000);
				assert.strictEqual(run.callCount, 1);

				clock.tick(2001);

				await contributors.getContributorsStats(repoPath, undefined, undefined, 1000);
				assert.strictEqual(run.callCount, 2);
			} finally {
				clock.restore();
			}
		});
	});
});
