import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Container } from '../../../../../container.js';
import type { GitCache } from '../../../../../git/cache.js';
import type { GitResult } from '../../../../../git/execTypes.js';
import type { Git } from '../../git.js';
import type { LocalGitProviderInternal } from '../../localGitProvider.js';
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
			cancelled: false,
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
			exec(..._args: any[]) {
				return Promise.resolve(createGitResult(''));
			}
		}

		gitStub = sandbox.createStubInstance(MockGit) as unknown as sinon.SinonStubbedInstance<Git>;

		const container = {} as unknown as Container;
		// Mock cache with conflictDetection that bypasses caching and calls the factory directly
		const cache = {
			conflictDetection: {
				getOrCreate: (_repoPath: string, _key: string, factory: () => Promise<unknown>) => factory(),
			},
		} as unknown as GitCache;
		const provider = {} as unknown as LocalGitProviderInternal;

		branchesProvider = new BranchesGitSubProvider(container, gitStub as unknown as Git, cache, provider);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('getPotentialApplyConflicts should detect intermediate conflicts with OID chaining', async () => {
		const repoPath = '/repo';
		const target = 'main';
		const commits = ['commit1', 'commit2'];

		gitStub.supports.withArgs('git:merge-tree:write-tree').resolves(true);

		// rev-parse to resolve all parent refs in a single call
		gitStub.exec
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', 'commit1^', 'commit2^')
			.resolves(createGitResult('parent1\nparent2'));

		// rev-parse target^{tree} (initial tree)
		gitStub.exec
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', `${target}^{tree}`)
			.resolves(createGitResult('tree_0'));

		// Step 1: commit1 - merge-tree --write-tree --merge-base (clean)
		gitStub.exec
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
		gitStub.exec
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

		gitStub.supports.withArgs('git:merge-tree:write-tree').resolves(true);

		// rev-parse to resolve all parent refs in a single call
		gitStub.exec
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', 'commit1^', 'commit2^', 'commit3^')
			.resolves(createGitResult('parent1\nparent2\nparent3'));

		// rev-parse target^{tree} (initial tree)
		gitStub.exec
			.withArgs(sinon.match.has('cwd', repoPath), 'rev-parse', `${target}^{tree}`)
			.resolves(createGitResult('tree_0'));

		// Step 1: commit1 - CONFLICT on file1.txt
		gitStub.exec
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
		gitStub.exec
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
		gitStub.exec
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
		gitStub.exec
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

		gitStub.supports.withArgs('git:merge-tree').resolves(false);

		const result = await branchesProvider.getPotentialMergeConflicts(repoPath, branch, target);
		assert.strictEqual(result.status, 'error');
		if (result.status === 'error') {
			assert.strictEqual(result.reason, 'unsupported');
		}
	});
});
