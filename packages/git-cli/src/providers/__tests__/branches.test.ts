import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import { CacheController } from '@gitlens/utils/promiseCache.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { BranchesGitSubProvider } from '../branches.js';

suite('BranchesGitSubProvider Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let branchesProvider: BranchesGitSubProvider;
	let gitStub: sinon.SinonStubbedInstance<Git>;

	function createGitResult(stdout: string): GitResult {
		return {
			stdout: stdout,
			stderr: undefined,
			exitCode: 0,
			completion: { status: 'exited', code: 0 },
		};
	}

	setup(() => {
		sandbox = sinon.createSandbox();

		// Mock Git
		// We use a concrete class for the stub to satisfy Sinon's requirements,
		// then cast it to the correct StubbedInstance type.
		class MockGit {
			supports(_feature: string) {
				return Promise.resolve(true);
			}
			run(..._args: any[]) {
				return Promise.resolve(createGitResult(''));
			}
			async *stream(..._args: any[]): AsyncGenerator<string> {
				// Default: empty stream. Tests override with `.callsFake(...)`.
			}
		}

		gitStub = sandbox.createStubInstance(MockGit) as unknown as sinon.SinonStubbedInstance<Git>;

		const context = {} as unknown as GitServiceContext;
		// Mock cache with caches that bypass and call the factory directly
		const cache = {
			conflictDetection: {
				getOrCreate: (_repoPath: string, _key: string, factory: () => Promise<unknown>) => factory(),
			},
			getRefs: (
				repoPath: string,
				factory: (
					commonPath: string,
					cacheable: { invalidate: () => void },
					cancellation?: AbortSignal,
				) => Promise<unknown>,
				cancellation?: AbortSignal,
			) => factory(repoPath, { invalidate: () => {} }, cancellation),
		} as unknown as Cache;
		const provider = {} as unknown as CliGitProviderInternal;

		branchesProvider = new BranchesGitSubProvider(context, gitStub, cache, provider);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('getPotentialApplyConflicts should detect intermediate conflicts with OID chaining', async () => {
		const repoPath = '/repo';
		const target = 'main';
		const commits = ['commit1', 'commit2'];

		gitStub.supports.withArgs('git:merge-tree:merge-base').resolves(true);

		// rev-parse to resolve all parent refs in a single call
		gitStub.run
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', 'commit1^', 'commit2^')
			.resolves(createGitResult('parent1\nparent2'));

		// rev-parse target^{tree} (initial tree)
		gitStub.run
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', `${target}^{tree}`)
			.resolves(createGitResult('tree_0'));

		// Step 1: commit1 - merge-tree --write-tree --merge-base (clean)
		gitStub.run
			.withArgs(
				sinon.match.has('cwd', repoPath),
				'merge-tree',
				'--write-tree',
				'-z',
				'--name-only',
				'--no-messages',
				'--merge-base=parent1',
				'tree_0',
				'commit1',
			)
			.resolves(createGitResult('tree_1\0'));

		// Step 2: commit2 - merge-tree --write-tree --merge-base (CONFLICT)
		gitStub.run
			.withArgs(
				sinon.match.has('cwd', repoPath),
				'merge-tree',
				'--write-tree',
				'-z',
				'--name-only',
				'--no-messages',
				'--merge-base=parent2',
				'tree_1',
				'commit2',
			)
			.resolves(createGitResult('tree_2\0conflict.txt\0'));

		const result = await branchesProvider.getPotentialApplyConflicts(repoPath, target, commits);

		assert.ok(result);
		assert.strictEqual(result.status, 'conflicts');
		if (result.status === 'conflicts') {
			assert.deepStrictEqual(result.conflict.shas, ['commit2']);
			assert.strictEqual(result.conflict.files[0].path, 'conflict.txt');
		}
	});

	test('getPotentialApplyConflicts should detect multiple conflicting commits with stopOnFirstConflict: false', async () => {
		const repoPath = '/repo';
		const target = 'main';
		const commits = ['commit1', 'commit2', 'commit3'];

		gitStub.supports.withArgs('git:merge-tree:merge-base').resolves(true);

		// rev-parse to resolve all parent refs in a single call
		gitStub.run
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', 'commit1^', 'commit2^', 'commit3^')
			.resolves(createGitResult('parent1\nparent2\nparent3'));

		// rev-parse target^{tree} (initial tree)
		gitStub.run
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', `${target}^{tree}`)
			.resolves(createGitResult('tree_0'));

		// Step 1: commit1 - CONFLICT on file1.txt
		gitStub.run
			.withArgs(
				sinon.match.has('cwd', repoPath),
				'merge-tree',
				'--write-tree',
				'-z',
				'--name-only',
				'--no-messages',
				'--merge-base=parent1',
				'tree_0',
				'commit1',
			)
			.resolves(createGitResult('tree_1\0file1.txt\0'));

		// Step 2: commit2 - clean merge
		gitStub.run
			.withArgs(
				sinon.match.has('cwd', repoPath),
				'merge-tree',
				'--write-tree',
				'-z',
				'--name-only',
				'--no-messages',
				'--merge-base=parent2',
				'tree_1',
				'commit2',
			)
			.resolves(createGitResult('tree_2\0'));

		// Step 3: commit3 - CONFLICT on file2.txt
		gitStub.run
			.withArgs(
				sinon.match.has('cwd', repoPath),
				'merge-tree',
				'--write-tree',
				'-z',
				'--name-only',
				'--no-messages',
				'--merge-base=parent3',
				'tree_2',
				'commit3',
			)
			.resolves(createGitResult('tree_3\0file2.txt\0'));

		const result = await branchesProvider.getPotentialApplyConflicts(repoPath, target, commits, {
			stopOnFirstConflict: false,
		});

		assert.ok(result);
		assert.strictEqual(result.status, 'conflicts');
		if (result.status === 'conflicts') {
			assert.deepStrictEqual(result.conflict.shas, ['commit1', 'commit3']);
			assert.strictEqual(result.conflict.files.length, 2);
			assert.ok(result.conflict.files.some(f => f.path === 'file1.txt'));
			assert.ok(result.conflict.files.some(f => f.path === 'file2.txt'));
		}
	});

	test('getPotentialApplyConflicts should return clean if no commits', async () => {
		const repoPath = '/repo';

		const result = await branchesProvider.getPotentialApplyConflicts(repoPath, 'main', []);
		assert.strictEqual(result.status, 'clean');
	});

	test('getPotentialApplyConflicts should return error for root commits', async () => {
		const repoPath = '/repo';
		const target = 'main';
		const commits = ['root_commit'];

		// rev-parse fails for root commit (no parent)
		gitStub.run
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', 'root_commit^')
			.rejects(new Error('unknown revision'));

		const result = await branchesProvider.getPotentialApplyConflicts(repoPath, target, commits);
		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.reason, 'noParent');
		}
	});

	test('getPotentialMergeConflicts should return error when unsupported', async () => {
		const repoPath = '/repo';
		const branch = 'feature';
		const target = 'main';

		gitStub.supports.withArgs('git:merge-tree:write-tree').resolves(false);

		const result = await branchesProvider.getPotentialMergeConflicts(repoPath, branch, target);
		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.reason, 'unsupported');
		}
	});

	suite('getBranches upstream remote on git without %(upstream:remotename)', () => {
		function createBranchRecord(name: string, upstream: string): Record<string, unknown> {
			return {
				name: `refs/heads/${name}`,
				objectname: 'a'.repeat(40),
				upstream: upstream,
				upstreamTracking: '',
			};
		}

		function createProvider(records: unknown[]) {
			const getRemotes = sandbox.stub().resolves([{ name: 'origin' }, { name: 'team/fork' }]);
			const invalidate = sandbox.stub();
			const provider = {
				refs: { getRefs: sandbox.stub().resolves(records) },
				config: {
					getDefaultWorktreePath: sandbox.stub().resolves(undefined),
					getGkConfigRegex: sandbox.stub().resolves(new Map()),
				},
				remotes: { getRemotes: getRemotes },
			} as unknown as CliGitProviderInternal;
			const cache = {
				getBranchMetadataMap: (_repoPath: string, factory: (commonPath: string) => Promise<unknown>) =>
					factory('/repo'),
				getBranches: (
					repoPath: string,
					factory: (commonPath: string, cacheable?: unknown, signal?: AbortSignal) => Promise<unknown>,
				) => factory(repoPath, { invalidate: invalidate }),
			} as unknown as Cache;
			Object.assign(gitStub, { supported: sandbox.stub().resolves([]) });

			return {
				getRemotes: getRemotes,
				invalidate: invalidate,
				branches: new BranchesGitSubProvider({} as unknown as GitServiceContext, gitStub, cache, provider),
			};
		}

		test('resolves a slash-named remote from the remote names', async () => {
			const { branches, getRemotes } = createProvider([
				createBranchRecord('local', 'refs/remotes/team/fork/feature'),
			]);

			const result = await branches.getBranches('/repo');

			assert.strictEqual(result.values[0].remoteName, 'team/fork');
			assert.strictEqual(result.values[0].trackingWithoutRemote, 'feature');
			assert.strictEqual(getRemotes.callCount, 1);
		});

		test('does not read the remotes when no upstream is ambiguous', async () => {
			const { branches, getRemotes } = createProvider([
				createBranchRecord('a', 'refs/remotes/origin/a'),
				createBranchRecord('b', 'refs/heads/main'),
			]);

			const result = await branches.getBranches('/repo');

			assert.strictEqual(result.values.length, 2);
			assert.strictEqual(getRemotes.callCount, 0);
		});

		test('treats a local upstream as having no remote without reading the remotes', async () => {
			const { branches, getRemotes } = createProvider([createBranchRecord('local', 'refs/heads/release/2.0')]);

			const result = await branches.getBranches('/repo');

			assert.strictEqual(result.values[0].remoteName, undefined);
			assert.strictEqual(result.values[0].trackingWithoutRemote, 'release/2.0');
			assert.strictEqual(getRemotes.callCount, 0);
		});

		test('falls back to the first segment when the remotes cannot be read', async () => {
			const { branches, getRemotes } = createProvider([
				createBranchRecord('local', 'refs/remotes/team/fork/feature'),
			]);
			getRemotes.rejects(new Error('boom'));

			const result = await branches.getBranches('/repo');

			assert.strictEqual(result.values[0].remoteName, 'team');
		});

		test('does not cache the first-segment fallback when the remotes read comes back empty', async () => {
			const { branches, getRemotes, invalidate } = createProvider([
				createBranchRecord('local', 'refs/remotes/team/fork/feature'),
			]);
			// `getRemotes` resolves a failed `git remote -v` as no remotes rather than rejecting
			getRemotes.resolves([]);

			const result = await branches.getBranches('/repo');

			assert.strictEqual(result.values[0].remoteName, 'team');
			assert.strictEqual(invalidate.callCount, 1);
		});
	});
});

suite('BranchesGitSubProvider stored merge target Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let branchesProvider: BranchesGitSubProvider;
	let gkConfig: Record<string, string | undefined>;
	let getGkConfig: sinon.SinonStub;
	let setGkConfig: sinon.SinonStub;
	let checkRef: sinon.SinonStub;
	let getBranchOverview: sinon.SinonStub;

	const repoPath = '/repo';

	setup(() => {
		sandbox = sinon.createSandbox();

		gkConfig = {};
		getGkConfig = sandbox.stub().callsFake((_repoPath: string, key: string) => Promise.resolve(gkConfig[key]));
		setGkConfig = sandbox.stub().resolves();
		// Default: every ref exists with its own name as the symbolic name
		checkRef = sandbox
			.stub()
			.callsFake((_repoPath: string, ref: string) => Promise.resolve({ name: ref, missing: false }));
		getBranchOverview = sandbox.stub().resolves('overview');

		const provider = {
			commits: { isAncestorOf: sandbox.stub().resolves(false) },
			config: {
				getConfig: sandbox.stub().resolves(undefined),
				getGkConfig: getGkConfig,
				setGkConfig: setGkConfig,
			},
			refs: {
				getMergeBase: sandbox.stub().resolves(undefined),
				// Nothing is listed, so every existence check goes through `checkRef`
				getRefs: sandbox.stub().resolves([]),
				getSymbolicReferenceName: sandbox.stub().resolves(undefined),
				getSymbolicReferenceNameOrMissing: checkRef,
				validateReference: sandbox.stub().resolves(undefined),
			},
			remotes: { getRemotes: () => Promise.resolve([{ name: 'origin' }]) },
			branches: { getBranch: () => Promise.resolve(undefined) },
		} as unknown as CliGitProviderInternal;
		const cache = {
			deleteMergeTarget: sandbox.stub(),
			getAheadOfBaseConfigKey: () => Promise.resolve(undefined),
			getBranchOverview: getBranchOverview,
			getCommonPath: (path: string) => path,
			getMergeTarget: (
				_repoPath: string,
				_key: string,
				factory: (commonPath: string, cacheable: CacheController) => Promise<unknown>,
			) => factory(repoPath, new CacheController()),
		} as unknown as Cache;

		branchesProvider = new BranchesGitSubProvider(
			{} as unknown as GitServiceContext,
			{} as unknown as Git,
			cache,
			provider,
		);
	});

	teardown(() => {
		sandbox.restore();
	});

	function gone(...refs: string[]): void {
		checkRef.callsFake((_repoPath: string, ref: string) =>
			Promise.resolve(refs.includes(ref) ? { name: undefined, missing: true } : { name: ref, missing: false }),
		);
	}

	suite('getStoredMergeTargetBranchName', () => {
		test('returns the resolved user pick with a single check', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			gkConfig['branch.feature.gk-merge-target'] = 'origin/detected';
			checkRef.resolves({ name: 'origin/user', missing: false });

			assert.strictEqual(
				await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'),
				'origin/user',
			);
			assert.strictEqual(checkRef.callCount, 1);
			assert.strictEqual(checkRef.firstCall.args[1], 'origin/user');
			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('falls back to the detected target when the user pick is gone', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			gkConfig['branch.feature.gk-merge-target'] = 'origin/detected';
			gone('origin/user');

			assert.strictEqual(
				await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'),
				'origin/detected',
			);
			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('falls back to the legacy detected key', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			gkConfig['branch.feature.gk-target-base'] = 'origin/legacy';
			gone('origin/user');

			assert.strictEqual(
				await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'),
				'origin/legacy',
			);
		});

		test('returns undefined when both are gone', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			gkConfig['branch.feature.gk-merge-target'] = 'origin/detected';
			gone('origin/user', 'origin/detected');

			assert.strictEqual(await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'), undefined);
			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('keeps the stored name when the check could not complete', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			gkConfig['branch.feature.gk-merge-target'] = 'origin/detected';
			checkRef.resolves({ name: undefined, missing: false });

			assert.strictEqual(
				await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'),
				'origin/user',
			);
			assert.strictEqual(checkRef.callCount, 1);
		});

		test('keeps the raw stored name when it exists without a symbolic name', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'abc1234';
			checkRef.resolves({ name: undefined, missing: false });

			assert.strictEqual(await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'), 'abc1234');
		});

		test('checks a name shared by the user pick and the detected target only once', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/same';
			gkConfig['branch.feature.gk-merge-target'] = 'origin/same';
			gone('origin/same');

			assert.strictEqual(await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'), undefined);
			assert.strictEqual(checkRef.callCount, 1);
		});

		test('returns undefined when nothing is stored, without checking', async () => {
			assert.strictEqual(await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature'), undefined);
			assert.strictEqual(checkRef.callCount, 0);
		});

		test('detectedOnly never reads the user pick', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			gkConfig['branch.feature.gk-merge-target'] = 'origin/detected';

			assert.strictEqual(
				await branchesProvider.getStoredMergeTargetBranchName(repoPath, 'feature', { detectedOnly: true }),
				'origin/detected',
			);
			assert.ok(!getGkConfig.getCalls().some(c => c.args[1] === 'branch.feature.gk-merge-target-user'));
			assert.strictEqual(checkRef.callCount, 1);
		});

		test('forwards the priority and cancellation to the check', async () => {
			gkConfig['branch.feature.gk-merge-target-user'] = 'origin/user';
			const cancellation = new AbortController().signal;

			await branchesProvider.getStoredMergeTargetBranchName(
				repoPath,
				'feature',
				{ priority: 'interactive' },
				cancellation,
			);

			assert.deepStrictEqual(checkRef.firstCall.args[2], { priority: 'interactive' });
			assert.strictEqual(checkRef.firstCall.args[3], cancellation);
		});
	});

	suite('getBranchContributionsOverview Tier 1', () => {
		function stubFallbacks(): void {
			// The base branch the overview falls through to is the recorded one
			gkConfig['branch.feature.gk-merge-base'] = 'origin/base';
			sandbox.stub(branchesProvider, 'getDefaultBranchName').resolves('origin/default');
		}

		test('skips a stored target whose branch is gone and falls through to the base branch', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'origin/gone';
			gone('origin/gone');
			stubFallbacks();

			await branchesProvider.getBranchContributionsOverview(repoPath, 'feature');

			assert.strictEqual(getBranchOverview.callCount, 1);
			assert.strictEqual(getBranchOverview.firstCall.args[1], 'feature|origin/base');
			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('uses the stored target when its branch exists', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'origin/parent';
			stubFallbacks();

			await branchesProvider.getBranchContributionsOverview(repoPath, 'feature');

			assert.strictEqual(getBranchOverview.firstCall.args[1], 'feature|origin/parent');
		});

		test('keeps the stored target when it could not be checked', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'origin/parent';
			checkRef.resolves({ name: undefined, missing: false });
			stubFallbacks();

			await branchesProvider.getBranchContributionsOverview(repoPath, 'feature');

			assert.strictEqual(getBranchOverview.firstCall.args[1], 'feature|origin/parent');
		});

		test('falls through to the base branch when the pull request names the same gone target', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'origin/main';
			gone('origin/main');
			stubFallbacks();
			sandbox.stub(branchesProvider, 'getBranch').resolves({
				name: 'feature',
				remote: false,
				upstream: { name: 'origin/feature', missing: false },
			} as unknown as GitBranch);

			await branchesProvider.getBranchContributionsOverview(repoPath, 'feature', {
				associatedPullRequest: Promise.resolve({ refs: { base: { branch: 'main' } } }),
			});

			assert.strictEqual(getBranchOverview.firstCall.args[1], 'feature|origin/base');
			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('skips a pull request base whose branch is gone and falls through to the base branch', async () => {
			gone('origin/parent');
			stubFallbacks();
			sandbox.stub(branchesProvider, 'getBranch').resolves({
				name: 'feature',
				remote: false,
				upstream: { name: 'origin/feature', missing: false },
			} as unknown as GitBranch);

			await branchesProvider.getBranchContributionsOverview(repoPath, 'feature', {
				associatedPullRequest: Promise.resolve({ refs: { base: { branch: 'parent' } } }),
			});

			assert.strictEqual(getBranchOverview.firstCall.args[1], 'feature|origin/base');
			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('keeps and stores the pull request base when it could not be checked', async () => {
			checkRef.resolves({ name: undefined, missing: false });
			stubFallbacks();
			sandbox.stub(branchesProvider, 'getBranch').resolves({
				name: 'feature',
				remote: false,
				upstream: { name: 'origin/feature', missing: false },
			} as unknown as GitBranch);

			await branchesProvider.getBranchContributionsOverview(repoPath, 'feature', {
				associatedPullRequest: Promise.resolve({ refs: { base: { branch: 'main' } } }),
			});
			// The store is fire-and-forget
			await new Promise(resolve => setImmediate(resolve));

			assert.strictEqual(getBranchOverview.firstCall.args[1], 'feature|origin/main');
			assert.strictEqual(setGkConfig.callCount, 1);
			assert.deepStrictEqual(setGkConfig.firstCall.args.slice(1, 3), [
				'branch.feature.gk-merge-target',
				'origin/main',
			]);
		});
	});

	suite('storeMergeTargetBranchName', () => {
		test('skips the write when the stored target is unchanged', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'origin/main';

			await branchesProvider.storeMergeTargetBranchName(repoPath, 'feature', 'origin/main');

			assert.strictEqual(setGkConfig.callCount, 0);
		});

		test('writes a changed target', async () => {
			gkConfig['branch.feature.gk-merge-target'] = 'origin/gone';

			await branchesProvider.storeMergeTargetBranchName(repoPath, 'feature', 'origin/main', {
				skipInvalidation: ['branchOverviews'],
			});

			assert.deepStrictEqual(setGkConfig.firstCall.args, [
				repoPath,
				'branch.feature.gk-merge-target',
				'origin/main',
				{ skipInvalidation: ['branchOverviews'] },
			]);
		});
	});
});
