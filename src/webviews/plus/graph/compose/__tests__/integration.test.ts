import * as assert from 'assert';
import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Container } from '../../../../../container.js';
import type { GitRepositoryService } from '../../../../../git/gitRepositoryService.js';
import type { CachedPlan } from '../../../../../plus/coretools/compose/integration.js';
import type {
	AiGenerateParams,
	AiGenerateResult,
	AiModelPort,
	ComposeGitPort,
	ComposeHunk,
	ComposePlan,
	GitExecOptions,
} from '../../../../../plus/coretools/compose/types.js';
import { REDACTED_HUNK_CONTENT } from '../../../../../plus/coretools/compose/utils.js';
import { GraphComposeIntegration } from '../integration.js';

type TestCommit = ComposePlan['allOrderedCommits'][number];

function makeCommit(id: string): TestCommit {
	return { id: id, message: `msg-${id}`, explanation: '', hunkIndices: [] };
}

function makeHunk(index: number, fileName: string, originalFileName?: string, content = ''): ComposeHunk {
	return {
		index: index,
		fileName: fileName,
		originalFileName: originalFileName,
		diffHeader: '',
		hunkHeader: '',
		content: content,
		additions: 0,
		deletions: 0,
	};
}

/** Build a plan whose branches share commit-object references the way the library does:
 *  `grouping.branches[i]` IS `branches[i].branchGroup`, and every branch's `commits` array holds the
 *  same objects as `allOrderedCommits`. */
function makePlan(branches: { id: string; commitIds: string[] }[]): {
	plan: ComposePlan;
	byId: Map<string, TestCommit>;
} {
	const allCommits: TestCommit[] = [];
	const byId = new Map<string, TestCommit>();
	const branchPlans = branches.map(b => {
		const commits = b.commitIds.map(id => {
			const commit = makeCommit(id);
			allCommits.push(commit);
			byId.set(id, commit);
			return commit;
		});
		const branchGroup = { id: b.id, name: b.id, title: b.id, description: '', commits: [...commits] };
		return { branchGroup: branchGroup, orderedCommitIds: b.commitIds.slice() };
	});

	const plan: ComposePlan = {
		grouping: { branches: branchPlans.map(bp => bp.branchGroup) },
		ordering: {
			branches: branchPlans.map(bp => ({
				branchId: bp.branchGroup.id,
				orderedCommitIds: bp.orderedCommitIds.slice(),
			})),
			rationale: '',
		},
		branches: branchPlans,
		allOrderedCommits: allCommits,
	};

	return { plan: plan, byId: byId };
}

function seed(sut: GraphComposeIntegration, cacheKey: string, plan: ComposePlan): void {
	(sut as unknown as { _cache: Map<string, CachedPlan> })._cache.set(cacheKey, { plan: plan } as CachedPlan);
}

/** Single-branch plan whose commits carry explicit `hunkIndices`, plus the source-hunk pool a file
 *  move matches against. */
function makePlanWithHunks(
	commits: { id: string; hunkIndices: number[] }[],
	sourceHunks: ComposeHunk[],
): { plan: ComposePlan; sourceHunks: ComposeHunk[] } {
	const { plan } = makePlan([{ id: 'branch', commitIds: commits.map(c => c.id) }]);
	for (const c of commits) {
		// Shared references (makePlan) mean this also updates the branchGroup.commits entry.
		plan.allOrderedCommits.find(x => x.id === c.id)!.hunkIndices = c.hunkIndices.slice();
	}
	return { plan: plan, sourceHunks: sourceHunks };
}

function seedFull(
	sut: GraphComposeIntegration,
	cacheKey: string,
	plan: ComposePlan,
	sourceHunks: ComposeHunk[],
	aiExcludedFiles?: string[],
): void {
	(sut as unknown as { _cache: Map<string, CachedPlan> })._cache.set(cacheKey, {
		plan: plan,
		sourceHunks: sourceHunks,
		aiExcludedFiles: aiExcludedFiles,
	} as CachedPlan);
}

const sortedIndices = (hunkIndices: readonly number[]) => [...hunkIndices].sort((a, b) => a - b);

const ids = (commits: readonly TestCommit[]) => commits.map(c => c.id);

suite('graph/compose/integration reorderCachedPlan', () => {
	const cacheKey = 'test-key';

	test('reorders allOrderedCommits and the single branch id lists', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan } = makePlan([{ id: 'b', commitIds: ['c1', 'c2', 'c3'] }]);
		seed(sut, cacheKey, plan);

		const ok = sut.reorderCachedPlan(cacheKey, ['c3', 'c1', 'c2']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(ids(plan.allOrderedCommits), ['c3', 'c1', 'c2']);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c3', 'c1', 'c2']);
		assert.deepStrictEqual(plan.ordering.branches[0].orderedCommitIds, ['c3', 'c1', 'c2']);
		assert.deepStrictEqual(ids(plan.branches[0].branchGroup.commits), ['c3', 'c1', 'c2']);
		// grouping.branches[0] shares the branchGroup reference, so it reorders with it.
		assert.deepStrictEqual(ids(plan.grouping.branches[0].commits), ['c3', 'c1', 'c2']);
	});

	test('reuses the existing commit objects (never clones)', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan, byId } = makePlan([{ id: 'b', commitIds: ['c1', 'c2', 'c3'] }]);
		seed(sut, cacheKey, plan);

		sut.reorderCachedPlan(cacheKey, ['c2', 'c3', 'c1']);

		assert.strictEqual(plan.allOrderedCommits[0], byId.get('c2'));
		assert.strictEqual(plan.allOrderedCommits[1], byId.get('c3'));
		assert.strictEqual(plan.allOrderedCommits[2], byId.get('c1'));
	});

	test('preserves branch membership while reordering within the global order', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan } = makePlan([
			{ id: 'a', commitIds: ['a1', 'a2'] },
			{ id: 'b', commitIds: ['b1', 'b2'] },
		]);
		seed(sut, cacheKey, plan);

		const ok = sut.reorderCachedPlan(cacheKey, ['a2', 'a1', 'b2', 'b1']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(ids(plan.allOrderedCommits), ['a2', 'a1', 'b2', 'b1']);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['a2', 'a1']);
		assert.deepStrictEqual(plan.branches[1].orderedCommitIds, ['b2', 'b1']);
		assert.deepStrictEqual(plan.ordering.branches[0].orderedCommitIds, ['a2', 'a1']);
		assert.deepStrictEqual(plan.ordering.branches[1].orderedCommitIds, ['b2', 'b1']);
	});

	test('rejects a non-permutation and leaves the plan untouched', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const { plan } = makePlan([{ id: 'b', commitIds: ['c1', 'c2', 'c3'] }]);
		seed(sut, cacheKey, plan);

		// Wrong id, missing id, duplicate, and wrong length all reject.
		assert.strictEqual(sut.reorderCachedPlan(cacheKey, ['c1', 'c2', 'nope']), false);
		assert.strictEqual(sut.reorderCachedPlan(cacheKey, ['c1', 'c2']), false);
		assert.strictEqual(sut.reorderCachedPlan(cacheKey, ['c1', 'c2', 'c2']), false);

		assert.deepStrictEqual(ids(plan.allOrderedCommits), ['c1', 'c2', 'c3']);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c1', 'c2', 'c3']);
	});

	test('returns false on a cache miss', () => {
		const sut = new GraphComposeIntegration({} as Container);
		assert.strictEqual(sut.reorderCachedPlan('unknown-key', ['c1']), false);
	});
});

suite('graph/compose/integration moveFilesBetweenCommits', () => {
	const cacheKey = 'test-key';

	test("moves a file's hunks between commits, leaving both in place", () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'a.ts'), makeHunk(2, 'b.ts'), makeHunk(3, 'c.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1, 2] },
				{ id: 'c2', hunkIndices: [3] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['a.ts']);

		assert.strictEqual(ok, true);
		const c1 = plan.allOrderedCommits.find(c => c.id === 'c1')!;
		const c2 = plan.allOrderedCommits.find(c => c.id === 'c2')!;
		assert.deepStrictEqual(c1.hunkIndices, [2]);
		assert.deepStrictEqual(sortedIndices(c2.hunkIndices), [0, 1, 3]);
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1', 'c2'],
		);
	});

	test('moves every hunk of multiple files in a single mutation', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'b.ts'), makeHunk(2, 'b.ts'), makeHunk(3, 'c.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1, 2, 3] },
				{ id: 'c2', hunkIndices: [] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['a.ts', 'b.ts']);

		assert.strictEqual(ok, true);
		const c1 = plan.allOrderedCommits.find(c => c.id === 'c1')!;
		const c2 = plan.allOrderedCommits.find(c => c.id === 'c2')!;
		assert.deepStrictEqual(c1.hunkIndices, [3]);
		assert.deepStrictEqual(sortedIndices(c2.hunkIndices), [0, 1, 2]);
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1', 'c2'],
		);
	});

	test('prunes the source once after moving every file out of it', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'b.ts'), makeHunk(2, 'z.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1] },
				{ id: 'c2', hunkIndices: [2] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['a.ts', 'b.ts']);

		assert.strictEqual(ok, true);
		// c1 emptied by the batch → pruned; c2 holds all three files' hunks.
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c2'],
		);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c2']);
		assert.deepStrictEqual(sortedIndices(plan.allOrderedCommits[0].hunkIndices), [0, 1, 2]);
	});

	test('prunes the source commit when its last file is moved out', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'c.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0] },
				{ id: 'c2', hunkIndices: [1] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c2', 'c1', ['c.ts']);

		assert.strictEqual(ok, true);
		// c2 emptied → pruned from allOrderedCommits and every shared branch read site.
		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1'],
		);
		assert.deepStrictEqual(plan.branches[0].orderedCommitIds, ['c1']);
		assert.deepStrictEqual(
			plan.branches[0].branchGroup.commits.map(c => c.id),
			['c1'],
		);
		assert.deepStrictEqual(plan.ordering.branches[0].orderedCommitIds, ['c1']);
		assert.deepStrictEqual(sortedIndices(plan.allOrderedCommits[0].hunkIndices), [0, 1]);
	});

	test('matches renamed files on originalFileName', () => {
		const sut = new GraphComposeIntegration({} as Container);
		// old.ts → new.ts rename: the hunk carries the current name plus the original.
		const sourceHunks = [makeHunk(0, 'new.ts', 'old.ts'), makeHunk(1, 'b.ts'), makeHunk(2, 'd.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1] },
				{ id: 'c2', hunkIndices: [2] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['old.ts']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(plan.allOrderedCommits.find(c => c.id === 'c1')!.hunkIndices, [1]);
		assert.deepStrictEqual(sortedIndices(plan.allOrderedCommits.find(c => c.id === 'c2')!.hunkIndices), [0, 2]);
	});

	test('rejects invalid moves and leaves the plan untouched', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts'), makeHunk(1, 'b.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0] },
				{ id: 'c2', hunkIndices: [1] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c1', ['a.ts']), false); // same commit
		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'nope', ['a.ts']), false); // unknown target
		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['zzz.ts']), false); // file not in source
		assert.strictEqual(sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', []), false); // no files
		assert.strictEqual(sut.moveFilesBetweenCommits('bad-key', 'c1', 'c2', ['a.ts']), false); // cache miss

		assert.deepStrictEqual(
			plan.allOrderedCommits.map(c => c.id),
			['c1', 'c2'],
		);
		assert.deepStrictEqual(plan.allOrderedCommits.find(c => c.id === 'c1')!.hunkIndices, [0]);
	});

	// Git names an untracked directory that is itself a repository with a trailing slash
	// (`nested-repo/`), but the compose hunk for it is a slash-less gitlink (`nested-repo`) — the
	// webview's path list for a move can carry either shape, and both must match the same hunk.
	test('matches a trailing-slash path against its slash-less gitlink hunk', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'nested-repo'), makeHunk(1, 'b.ts')];
		const { plan } = makePlanWithHunks(
			[
				{ id: 'c1', hunkIndices: [0, 1] },
				{ id: 'c2', hunkIndices: [] },
			],
			sourceHunks,
		);
		seedFull(sut, cacheKey, plan, sourceHunks);

		const ok = sut.moveFilesBetweenCommits(cacheKey, 'c1', 'c2', ['nested-repo/']);

		assert.strictEqual(ok, true);
		assert.deepStrictEqual(plan.allOrderedCommits.find(c => c.id === 'c1')!.hunkIndices, [1]);
		assert.deepStrictEqual(plan.allOrderedCommits.find(c => c.id === 'c2')!.hunkIndices, [0]);
	});
});

// `getMaskedHunksForCachedCommit` normalizes `aiExcludedFiles` at read time (idempotent
// defense on top of the normalize-on-write in `generatePlanForGraphDetails`) so a trailing-slash
// exclusion entry still matches a slash-less gitlink hunk. These tests seed the cache directly via
// `seedFull`, bypassing the write-side normalization, to exercise the read-side normalization itself.
suite('graph/compose/integration getMaskedHunksForCachedCommit', () => {
	const cacheKey = 'test-key';

	test('redacts an ai-excluded untracked nested repository despite the trailing-slash mismatch', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [
			makeHunk(0, 'nested-repo', undefined, 'gitlink content'),
			makeHunk(1, 'b.ts', undefined, 'plain content'),
		];
		const { plan } = makePlanWithHunks([{ id: 'c1', hunkIndices: [0, 1] }], sourceHunks);
		seedFull(sut, cacheKey, plan, sourceHunks, ['nested-repo/']);

		const result = sut.getMaskedHunksForCachedCommit(cacheKey, 'c1');

		assert.ok(result != null);
		assert.strictEqual(result.hunks.find(h => h.fileName === 'nested-repo')!.content, REDACTED_HUNK_CONTENT);
		assert.strictEqual(result.hunks.find(h => h.fileName === 'b.ts')!.content, 'plain content');
	});

	test('leaves content alone when nothing is ai-excluded', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'a.ts', undefined, 'plain content')];
		const { plan } = makePlanWithHunks([{ id: 'c1', hunkIndices: [0] }], sourceHunks);
		seedFull(sut, cacheKey, plan, sourceHunks, []);

		const result = sut.getMaskedHunksForCachedCommit(cacheKey, 'c1');

		assert.strictEqual(result!.hunks[0].content, 'plain content');
	});

	test('matches a rename via originalFileName after normalization', () => {
		const sut = new GraphComposeIntegration({} as Container);
		const sourceHunks = [makeHunk(0, 'nested-repo-renamed', 'nested-repo', 'gitlink content')];
		const { plan } = makePlanWithHunks([{ id: 'c1', hunkIndices: [0] }], sourceHunks);
		seedFull(sut, cacheKey, plan, sourceHunks, ['nested-repo/']);

		const result = sut.getMaskedHunksForCachedCommit(cacheKey, 'c1');

		assert.strictEqual(result!.hunks[0].content, REDACTED_HUNK_CONTENT);
	});
});

// Ignore the user's global/system git config so the temp repos behave predictably; identity comes
// from the environment, so the library's own `commit-tree` calls pick it up too.
const gitEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
	GIT_TERMINAL_PROMPT: '0',
	GIT_AUTHOR_NAME: 't',
	GIT_AUTHOR_EMAIL: 't@t',
	GIT_COMMITTER_NAME: 't',
	GIT_COMMITTER_EMAIL: 't@t',
};

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf8', env: gitEnv });
}

/** The library's git port over a plain `git` process — what `createComposeGitPort` provides through
 *  GitLens's git runner in the product. */
function createTestGitPort(repo: string): ComposeGitPort {
	return {
		exec: (args: string[], options?: GitExecOptions) =>
			new Promise<string>((resolve, reject) => {
				const proc = spawn('git', args, {
					cwd: repo,
					env: { ...gitEnv, ...options?.env },
					signal: options?.signal,
				});
				let stdout = '';
				let stderr = '';
				proc.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
				proc.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
				proc.on('error', reject);
				// git may exit before reading its input; surface that as a rejection, not an uncaught EPIPE.
				proc.stdin.on('error', reject);
				proc.on('close', code =>
					code === 0
						? resolve(stdout)
						: reject(new Error(`git ${args.join(' ')} exited with ${code}: ${stderr}`)),
				);
				proc.stdin.end(options?.stdin);
			}),
	};
}

const scriptedOutput = (value: unknown): AiGenerateResult => ({ text: `<output>${JSON.stringify(value)}</output>` });

/** Stands in for the model: the grouping call gets every hunk it was shown in one commit, and the
 *  ordering call keeps that commit. Pinning the plan keeps these tests about what apply does with a
 *  plan, not about what a model decides — the exclusion is the only variable. */
function createScriptedModelPort(): AiModelPort {
	return {
		generate: (params: AiGenerateParams): Promise<AiGenerateResult> => {
			// Ordering continues the grouping session, so only the latest message tells the steps apart.
			const prompt = params.messages.at(-1)?.content ?? '';
			if (/optimal (?:commit )?order/i.test(prompt)) {
				return Promise.resolve(
					scriptedOutput({
						branches: [{ branchId: 'branch-1', orderedCommitIds: ['commit-1'] }],
						rationale: '',
					}),
				);
			}

			const match = /\(indices: ([\d, ]+)\)/.exec(prompt);
			if (match == null) throw new Error('Scripted model: the grouping prompt listed no hunk indices');

			return Promise.resolve(
				scriptedOutput({
					branches: [
						{
							id: 'branch-1',
							name: '',
							title: 'Compose',
							description: '',
							commits: [
								{
									id: 'commit-1',
									message: 'Compose changes',
									explanation: '',
									hunks: match[1].split(',').map(i => Number(i.trim())),
								},
							],
						},
					],
				}),
			);
		},
	};
}

class TestGraphComposeIntegration extends GraphComposeIntegration {
	constructor(private readonly repo: string) {
		super({} as Container);
	}

	protected override createGitPort(): ComposeGitPort {
		return createTestGitPort(this.repo);
	}

	protected override createAiModelPort(): AiModelPort {
		return createScriptedModelPort();
	}
}

// The apply-time `hunkFilter` (#5628): `applyPlanForGraphDetails` rebuilds the user exclusion filter
// from the cached plan, so an excluded file is left in the working tree instead of committed, and the
// library's drift check compares like with like — the snapshot hash was taken over the filtered set,
// so an unfiltered re-collection would fail with SAFETY_CHECK_FAILED. Runs the real library against a
// temp repository; only the model is scripted.
suite('graph/compose/integration applyPlanForGraphDetails exclusions (temp repo)', function () {
	this.timeout(60000);

	let repo: string;

	setup(() => {
		repo = mkdtempSync(join(tmpdir(), 'gl-compose-apply-'));
		git(repo, 'init', '-q', '-b', 'main');
		writeFileSync(join(repo, 'a.txt'), 'a1\na2\na3\n');
		writeFileSync(join(repo, 'b.txt'), 'b1\n');
		writeFileSync(join(repo, 'old.txt'), Array.from({ length: 10 }, (_, i) => `line ${i + 1}\n`).join(''));
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', 'base');
	});

	teardown(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	const modifyA = (): void => writeFileSync(join(repo, 'a.txt'), 'a1\na2 changed\na3\n');

	const addNestedRepository = (): void => {
		const nested = join(repo, 'nested-repo');
		mkdirSync(nested);
		git(nested, 'init', '-q', '-b', 'main');
		writeFileSync(join(nested, 'inner.txt'), 'inner\n');
		git(nested, 'add', '-A');
		git(nested, 'commit', '-q', '-m', 'inner');
	};

	// One edited line out of ten keeps the move well inside git's rename-similarity threshold.
	const renamedContent = Array.from({ length: 10 }, (_, i) => `line ${i + 1}${i === 4 ? ' edited' : ''}\n`).join('');

	const renameOldToNew = (): void => {
		git(repo, 'mv', 'old.txt', 'new.txt');
		writeFileSync(join(repo, 'new.txt'), renamedContent);
		git(repo, 'add', '-A');
	};

	async function composeAndApply(excludedFiles?: string[]): Promise<void> {
		const svc = {
			path: repo,
			branches: { getBranch: () => Promise.resolve({ name: 'main', detached: false, remote: false }) },
			commits: { getCommit: () => Promise.resolve({ sha: git(repo, 'rev-parse', 'HEAD').trim() }) },
		} as unknown as GitRepositoryService;
		const sut = new TestGraphComposeIntegration(repo);

		const { cacheKey } = await sut.generatePlanForGraphDetails({
			svc: svc,
			scope: { type: 'wip', includeStaged: true, includeUnstaged: true, includeShas: [] },
			excludedFiles: excludedFiles,
			telemetrySource: { source: 'graph' },
			conversationId: 'test-conversation',
			suppressLargePromptWarning: true,
		});
		// Rejects with SAFETY_CHECK_FAILED if the apply-time filter doesn't match the generation-time one.
		await sut.applyPlanForGraphDetails({ svc: svc, cacheKey: cacheKey, telemetrySource: { source: 'graph' } });
	}

	const treeEntry = (path: string): string => git(repo, 'ls-tree', 'HEAD', '--', path).trim();
	const status = (): string[] =>
		git(repo, 'status', '--porcelain', '--untracked-files=normal')
			.split('\n')
			.filter(l => l.length > 0)
			.sort();

	test('commits an included untracked nested repository as a gitlink', async () => {
		modifyA();
		addNestedRepository();

		await composeAndApply();

		assert.match(treeEntry('nested-repo'), /^160000 commit [0-9a-f]+\tnested-repo$/);
		assert.strictEqual(git(repo, 'show', 'HEAD:a.txt'), 'a1\na2 changed\na3\n');
		assert.deepStrictEqual(status(), []);
	});

	test('leaves an excluded untracked nested repository in the working tree, despite the trailing slash', async () => {
		modifyA();
		addNestedRepository();

		// The working-tree status lists an untracked repository with a trailing slash; its hunk has none.
		await composeAndApply(['nested-repo/']);

		assert.strictEqual(treeEntry('nested-repo'), '');
		assert.strictEqual(git(repo, 'show', 'HEAD:a.txt'), 'a1\na2 changed\na3\n');
		assert.deepStrictEqual(status(), ['?? nested-repo/']);
	});

	test('leaves every excluded file in the working tree and commits the rest', async () => {
		modifyA();
		addNestedRepository();
		writeFileSync(join(repo, 'b.txt'), 'b1 changed\n');

		await composeAndApply(['nested-repo/', 'b.txt']);

		assert.strictEqual(treeEntry('nested-repo'), '');
		assert.strictEqual(git(repo, 'show', 'HEAD:b.txt'), 'b1\n');
		assert.strictEqual(git(repo, 'show', 'HEAD:a.txt'), 'a1\na2 changed\na3\n');
		assert.deepStrictEqual(status(), [' M b.txt', '?? nested-repo/']);
	});

	test('commits an included rename', async () => {
		modifyA();
		renameOldToNew();

		await composeAndApply();

		assert.strictEqual(treeEntry('old.txt'), '');
		assert.strictEqual(git(repo, 'show', 'HEAD:new.txt'), renamedContent);
		assert.deepStrictEqual(status(), []);
	});

	async function assertExcludedRenameLeftUncommitted(excluded: string): Promise<void> {
		modifyA();
		renameOldToNew();

		await composeAndApply([excluded]);

		assert.notStrictEqual(treeEntry('old.txt'), '', 'the rename source should still be in HEAD');
		assert.strictEqual(treeEntry('new.txt'), '', 'the rename target should not be committed');
		assert.strictEqual(git(repo, 'show', 'HEAD:a.txt'), 'a1\na2 changed\na3\n');
		// The rename survives in the working tree, edit included.
		assert.strictEqual(readFileSync(join(repo, 'new.txt'), 'utf8'), renamedContent);
		assert.ok(!existsSync(join(repo, 'old.txt')));
		assert.deepStrictEqual(status(), [' D old.txt', '?? new.txt']);
	}

	test('leaves a rename excluded by its original path uncommitted', () =>
		assertExcludedRenameLeftUncommitted('old.txt'));

	test('leaves a rename excluded by its new path uncommitted', () => assertExcludedRenameLeftUncommitted('new.txt'));
});
