import * as assert from 'assert';
import type { AgentSessionState } from '../../../../agents/models/agentSessionState.js';
import type { OverviewBranch } from '../../../shared/overviewBranches.js';
import {
	findOverviewBranchForSession,
	indexAgentSessionsByRepoAndWorktree,
	matchAgentSessionsForWorktree,
} from '../agentUtils.js';

const repo = '/repo/main';
const wtA = '/repo.worktrees/feature-a';
const wtB = '/repo.worktrees/feature-b';

function makeSession(overrides: Partial<AgentSessionState> & { id: string }): AgentSessionState {
	return {
		providerId: 'claudeCode',
		providerName: 'Claude Code',
		status: 'idle',
		phase: 'idle',
		phaseSince: new Date(),
		lastActivity: new Date(),
		isSubagent: false,
		isInWorkspace: true,
		displayName: overrides.id,
		subagentCount: 0,
		...overrides,
	};
}

function makeBranch(overrides: { repoPath: string; worktreePath?: string; name: string }): OverviewBranch {
	return {
		id: `${overrides.repoPath}::${overrides.name}`,
		name: overrides.name,
		repoPath: overrides.repoPath,
		current: false,
		opened: false,
		status: undefined,
		upstream: undefined,
		reference: undefined,
		worktree: overrides.worktreePath != null ? ({ path: overrides.worktreePath } as any) : undefined,
	} as unknown as OverviewBranch;
}

suite('agentUtils', () => {
	suite('matchAgentSessionsForWorktree', () => {
		test('matches a session by worktreePath regardless of workspacePath', () => {
			// Two sessions in the SAME worktree but with different workspacePaths — one launched
			// from main (workspacePath = repo), one launched from inside the worktree itself
			// (workspacePath = wtA). Both should match a target for that worktree.
			const s1 = makeSession({
				id: 's1',
				workspacePath: repo,
				worktreePath: wtA,
				worktree: { path: wtA },
			});
			const s2 = makeSession({
				id: 's2',
				workspacePath: wtA,
				worktreePath: wtA,
				worktree: { path: wtA },
			});

			const matches = matchAgentSessionsForWorktree([s1, s2], { repoPath: repo, worktreePath: wtA });
			assert.deepStrictEqual(matches?.map(s => s.id).sort(), ['s1', 's2']);
		});

		test('default-worktree session matches default-worktree target with undefined worktreePath', () => {
			// Home view passes explicit worktreePath; Graph leaves it undefined for the default
			// worktree. The matcher must coalesce both forms to the same key (= repoPath).
			const s = makeSession({
				id: 's',
				workspacePath: repo,
				worktreePath: repo,
				worktree: { path: repo },
			});

			const explicit = matchAgentSessionsForWorktree([s], { repoPath: repo, worktreePath: repo });
			const absent = matchAgentSessionsForWorktree([s], { repoPath: repo });
			assert.deepStrictEqual(
				explicit?.map(x => x.id),
				['s'],
			);
			assert.deepStrictEqual(
				absent?.map(x => x.id),
				['s'],
			);
		});

		test('does not match sessions in a different worktree of the same repo', () => {
			const sA = makeSession({ id: 'sA', workspacePath: repo, worktreePath: wtA, worktree: { path: wtA } });
			const sB = makeSession({ id: 'sB', workspacePath: repo, worktreePath: wtB, worktree: { path: wtB } });

			const targetA = matchAgentSessionsForWorktree([sA, sB], { repoPath: repo, worktreePath: wtA });
			assert.deepStrictEqual(
				targetA?.map(s => s.id),
				['sA'],
			);
		});

		test('does not match cold-cache sessions (worktreePath unresolved)', () => {
			// resolveGitInfo hasn't completed — worktreePath is undefined. Honest: no match.
			const s = makeSession({ id: 's', workspacePath: repo });
			const matches = matchAgentSessionsForWorktree([s], { repoPath: repo, worktreePath: wtA });
			assert.strictEqual(matches, undefined);
		});

		test('returns undefined when source is empty or undefined', () => {
			assert.strictEqual(matchAgentSessionsForWorktree(undefined, { repoPath: repo }), undefined);
			assert.strictEqual(matchAgentSessionsForWorktree([], { repoPath: repo }), undefined);
		});

		test('flat-array and indexed lookups return the same matches', () => {
			const sessions: AgentSessionState[] = [
				makeSession({ id: 's1', workspacePath: repo, worktreePath: wtA, worktree: { path: wtA } }),
				makeSession({ id: 's2', workspacePath: wtA, worktreePath: wtA, worktree: { path: wtA } }),
				makeSession({ id: 's3', workspacePath: repo, worktreePath: wtB, worktree: { path: wtB } }),
			];
			const index = indexAgentSessionsByRepoAndWorktree(sessions);

			const flat = matchAgentSessionsForWorktree(sessions, { repoPath: repo, worktreePath: wtA });
			const indexed = matchAgentSessionsForWorktree(index, { repoPath: repo, worktreePath: wtA });
			assert.deepStrictEqual(flat?.map(s => s.id).sort(), indexed?.map(s => s.id).sort());
		});
	});

	suite('findOverviewBranchForSession', () => {
		test('finds a branch by worktreePath match', () => {
			const session = makeSession({
				id: 's',
				workspacePath: repo,
				worktreePath: wtA,
				worktree: { path: wtA },
			});
			const branchA = makeBranch({ repoPath: repo, worktreePath: wtA, name: 'feature-a' });
			const branchB = makeBranch({ repoPath: repo, worktreePath: wtB, name: 'feature-b' });

			const found = findOverviewBranchForSession({ active: [branchA], recent: [branchB] }, session);
			assert.strictEqual(found?.name, 'feature-a');
		});

		test('falls through active to recent when not found in active', () => {
			const session = makeSession({
				id: 's',
				workspacePath: repo,
				worktreePath: wtB,
				worktree: { path: wtB },
			});
			const branchA = makeBranch({ repoPath: repo, worktreePath: wtA, name: 'feature-a' });
			const branchB = makeBranch({ repoPath: repo, worktreePath: wtB, name: 'feature-b' });

			const found = findOverviewBranchForSession({ active: [branchA], recent: [branchB] }, session);
			assert.strictEqual(found?.name, 'feature-b');
		});

		test('returns undefined when session has no worktree', () => {
			const session = makeSession({ id: 's', workspacePath: repo });
			const branchA = makeBranch({ repoPath: repo, worktreePath: wtA, name: 'feature-a' });

			const found = findOverviewBranchForSession({ active: [branchA], recent: [] }, session);
			assert.strictEqual(found, undefined);
		});

		test('matches default-worktree branch with target.worktreePath equal to repoPath', () => {
			const session = makeSession({
				id: 's',
				workspacePath: repo,
				worktreePath: repo,
				worktree: { path: repo },
			});
			const defaultBranch = makeBranch({ repoPath: repo, worktreePath: repo, name: 'main' });

			const found = findOverviewBranchForSession({ active: [defaultBranch], recent: [] }, session);
			assert.strictEqual(found?.name, 'main');
		});
	});
});
