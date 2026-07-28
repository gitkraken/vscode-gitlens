import * as assert from 'assert';
import * as sinon from 'sinon';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../../container.js';
import { GraphInspectServices } from '../graphInspectServices.js';
import type { ScopeSelection } from '../graphService.js';

// `getDiffForScope` is private and only reaches `this.container.git.getRepositoryService(repoPath)` and
// `this.buildChangesContext(...)`, so we exercise it against a minimal fake `this` rather than constructing
// the full service. Fix under test (#5586): a WIP review must include untracked file contents by staging
// them intent-to-add around the unstaged diff, then unstaging in a `finally`.

type DiffForScopeResult = { diff: string; message: string; context: string } | undefined;
type GetDiffForScope = (repoPath: string, scope: ScopeSelection, signal?: AbortSignal) => Promise<DiffForScopeResult>;

function invoke(fakeThis: unknown, scope: ScopeSelection): Promise<DiffForScopeResult> {
	const fn = (GraphInspectServices.prototype as unknown as { getDiffForScope: GetDiffForScope }).getDiffForScope;
	return fn.call(fakeThis, '/repo', scope, undefined);
}

function wipScope(o: { includeUnstaged?: boolean; includeStaged?: boolean }): ScopeSelection {
	return {
		type: 'wip',
		includeUnstaged: o.includeUnstaged ?? false,
		includeStaged: o.includeStaged ?? false,
		includeShas: [],
	};
}

function createMocks(opts: {
	untracked?: string[];
	unstagedDiff?: string;
	unstagedError?: Error;
	stagedDiff?: string;
	noStaging?: boolean;
}) {
	// Shared, ordered log so tests can assert the exact stage → diff → unstage sequence.
	const order: string[] = [];

	const getUntrackedFiles = sinon.stub().callsFake(async () => {
		order.push('getUntracked');
		return (opts.untracked ?? []).map(p => ({ path: p }));
	});
	const stageFiles = sinon.stub().callsFake(async () => {
		order.push('stage');
	});
	const unstageFiles = sinon.stub().callsFake(async () => {
		order.push('unstage');
	});

	const getDiff = sinon.stub();
	getDiff.withArgs(uncommitted).callsFake(async () => {
		order.push('diff:unstaged');
		if (opts.unstagedError != null) throw opts.unstagedError;
		return opts.unstagedDiff != null ? { contents: opts.unstagedDiff } : undefined;
	});
	getDiff.withArgs(uncommittedStaged).callsFake(async () => {
		order.push('diff:staged');
		return opts.stagedDiff != null ? { contents: opts.stagedDiff } : undefined;
	});

	const svc = {
		diff: { getDiff: getDiff },
		status: { getUntrackedFiles: getUntrackedFiles },
		// `staging` is optional on the repo service (e.g. virtual repos lack it).
		staging: opts.noStaging ? undefined : { stageFiles: stageFiles, unstageFiles: unstageFiles },
		branches: { getBranch: sinon.stub().resolves(undefined) },
	};

	const container = {
		git: { getRepositoryService: sinon.stub().returns(svc) },
	} as unknown as Container;

	const fakeThis = { container: container, buildChangesContext: async () => '' };

	return {
		fakeThis: fakeThis,
		order: order,
		getUntrackedFiles: getUntrackedFiles,
		stageFiles: stageFiles,
		unstageFiles: unstageFiles,
	};
}

suite('graphInspectServices — getDiffForScope untracked handling (#5586)', () => {
	test('stages untracked files intent-to-add for the unstaged diff, then unstages', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			unstagedDiff:
				'diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+brand new\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.calledOnceWithExactly(m.stageFiles, ['new.txt'], { intentToAdd: true });
		sinon.assert.calledOnceWithExactly(m.unstageFiles, ['new.txt']);
		assert.deepStrictEqual(m.order, ['getUntracked', 'stage', 'diff:unstaged', 'unstage']);
		assert.ok(result?.diff.includes('new.txt'), 'reviewed diff should include the untracked file');
	});

	test('unstages untracked files even when the unstaged diff throws', async () => {
		const m = createMocks({ untracked: ['new.txt'], unstagedError: new Error('diff failed') });

		await assert.rejects(invoke(m.fakeThis, wipScope({ includeUnstaged: true })), /diff failed/);

		sinon.assert.calledOnceWithExactly(m.stageFiles, ['new.txt'], { intentToAdd: true });
		sinon.assert.calledOnceWithExactly(m.unstageFiles, ['new.txt']);
		assert.deepStrictEqual(m.order, ['getUntracked', 'stage', 'diff:unstaged', 'unstage']);
	});

	test('unstages untracked before the staged diff so they never leak into staged content', async () => {
		const m = createMocks({
			untracked: ['new.txt'],
			unstagedDiff: 'diff --git a/new.txt b/new.txt\n',
			stagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		await invoke(m.fakeThis, wipScope({ includeUnstaged: true, includeStaged: true }));

		assert.deepStrictEqual(m.order, ['getUntracked', 'stage', 'diff:unstaged', 'unstage', 'diff:staged']);
	});

	test('does not stage anything when there are no untracked files', async () => {
		const m = createMocks({ untracked: [], unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n' });

		await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.notCalled(m.stageFiles);
		sinon.assert.notCalled(m.unstageFiles);
		assert.deepStrictEqual(m.order, ['getUntracked', 'diff:unstaged']);
	});

	test('does not touch untracked files for a staged-only scope', async () => {
		const m = createMocks({ untracked: ['new.txt'], stagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n' });

		await invoke(m.fakeThis, wipScope({ includeStaged: true }));

		sinon.assert.notCalled(m.getUntrackedFiles);
		sinon.assert.notCalled(m.stageFiles);
		sinon.assert.notCalled(m.unstageFiles);
		assert.deepStrictEqual(m.order, ['diff:staged']);
	});

	test('skips the untracked query entirely when there is no staging provider', async () => {
		const m = createMocks({
			noStaging: true,
			untracked: ['new.txt'],
			unstagedDiff: 'diff --git a/tracked.txt b/tracked.txt\n',
		});

		const result = await invoke(m.fakeThis, wipScope({ includeUnstaged: true }));

		sinon.assert.notCalled(m.getUntrackedFiles);
		sinon.assert.notCalled(m.stageFiles);
		sinon.assert.notCalled(m.unstageFiles);
		assert.deepStrictEqual(m.order, ['diff:unstaged']);
		assert.ok(result?.diff.includes('tracked.txt'), 'the unstaged diff is still produced');
	});
});
