import * as assert from 'assert';
import type { AgentSessionState } from '../../../../agents/models/agentSessionState.js';
import type { OverviewBranch } from '../../../shared/overviewBranches.js';
import {
	canResolvePermission,
	createPastAgentSessionsResolver,
	findOverviewBranchForSession,
	formatAgentElapsed,
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

	suite('formatAgentElapsed', () => {
		const s = 1000;
		const m = 60 * s;
		const h = 60 * m;
		const d = 24 * h;
		const w = 7 * d;
		// `now` is pinned and passed through, so each span is exact. Reading the clock twice (once for the
		// input, once inside the formatter) leaves the boundary cases one tick from the next bucket.
		const now = Date.now();
		const elapsed = (ms: number) => formatAgentElapsed(now - ms, now);

		test('returns undefined for undefined', () => {
			assert.strictEqual(formatAgentElapsed(undefined), undefined);
		});

		test('rolls seconds → minutes → hours', () => {
			assert.strictEqual(elapsed(5 * s), '5s');
			assert.strictEqual(elapsed(5 * m), '5m');
			assert.strictEqual(elapsed(3 * h + 20 * m), '3h 20m');
			assert.strictEqual(elapsed(3 * h), '3h');
		});

		test('rolls hours → days past 24h', () => {
			assert.strictEqual(elapsed(26 * h), '1d 2h');
			assert.strictEqual(elapsed(3 * d), '3d');
		});

		test('rolls days → weeks past 7d', () => {
			assert.strictEqual(elapsed(9 * d), '1w 2d');
			assert.strictEqual(elapsed(2 * w), '2w');
		});
	});
});

suite('createPastAgentSessionsResolver', () => {
	function pastResult(ids: string[], total?: number) {
		return {
			sessions: ids.map(id => ({
				id: id,
				cwd: wtA,
				worktreePath: wtA,
				displayName: id,
				lastActivity: 0,
			})),
			total: total ?? ids.length,
		};
	}

	test('drops rows for sessions that are currently tracked', () => {
		const resolver = createPastAgentSessionsResolver();
		const resolved = resolver.resolve(pastResult(['s1', 's2']), [makeSession({ id: 's1' })]);
		assert.deepStrictEqual(
			resolved?.sessions.map(s => s.id),
			['s2'],
		);
	});

	test('keeps suppressing a session after it departs the tracked set', () => {
		// The archive case: the row leaves the live list, so the tracked-id filter alone would stop
		// masking it and the cached past list would paint it as "Past".
		const resolver = createPastAgentSessionsResolver();
		const past = pastResult(['s1', 's2']);

		resolver.resolve(past, [makeSession({ id: 's1' })]);
		const resolved = resolver.resolve(past, []);

		assert.deepStrictEqual(
			resolved?.sessions.map(s => s.id),
			['s2'],
			'the departed session must not reappear under Past',
		);
	});

	test('reduces total by what it dropped so the footer stays honest', () => {
		const resolver = createPastAgentSessionsResolver();
		const past = pastResult(['s1', 's2'], 7);

		resolver.resolve(past, [makeSession({ id: 's1' })]);
		const resolved = resolver.resolve(past, []);

		assert.strictEqual(resolved?.total, 6);
	});

	test('a freshly delivered result retires the suppressions', () => {
		// The host filters archived ids at fetch time, so a new result is authoritative.
		const resolver = createPastAgentSessionsResolver();
		resolver.resolve(pastResult(['s1']), [makeSession({ id: 's1' })]);
		resolver.resolve(pastResult(['s1']), []);

		const resolved = resolver.resolve(pastResult(['s1']), []);
		assert.deepStrictEqual(
			resolved?.sessions.map(s => s.id),
			['s1'],
		);
	});

	test('an unloaded (undefined) live list is not treated as a mass departure', () => {
		// `agentSessions` is undefined until the context/state lands (and again across a graph-state
		// reset). Reading that as "every session left" would suppress the matching Past rows for the
		// component's lifetime, so the prior snapshot must be held instead.
		const resolver = createPastAgentSessionsResolver();
		const past = pastResult(['s1', 's2']);

		resolver.resolve(past, [makeSession({ id: 's1' })]);
		resolver.resolve(past, undefined);
		const resolved = resolver.resolve(past, [makeSession({ id: 's1' })]);

		assert.deepStrictEqual(
			resolved?.sessions.map(s => s.id),
			['s2'],
			's1 is still merely deduped as live, not suppressed as departed',
		);
	});

	test('preserves reference identity when nothing is dropped', () => {
		const resolver = createPastAgentSessionsResolver();
		const past = pastResult(['s1']);
		assert.strictEqual(resolver.resolve(past, []), past);
	});

	test('returns undefined when there is no past result', () => {
		const resolver = createPastAgentSessionsResolver();
		assert.strictEqual(resolver.resolve(undefined, [makeSession({ id: 's1' })]), undefined);
	});
});

suite('canResolvePermission', () => {
	const tool = { kind: 'tool', toolName: 'Bash', toolDescription: 'git push' } as const;

	test('an ask with no `resolvable` flag is resolvable — the common case', () => {
		assert.strictEqual(canResolvePermission('needs-input', tool), true);
	});

	test('an explicitly resolvable ask is resolvable', () => {
		assert.strictEqual(canResolvePermission('needs-input', { ...tool, resolvable: true }), true);
	});

	test('an ask this window holds no hook entry for offers no actions', () => {
		assert.strictEqual(canResolvePermission('needs-input', { ...tool, resolvable: false }), false);
	});

	test('needs-input with no ask offers no actions', () => {
		assert.strictEqual(canResolvePermission('needs-input', undefined), false);
	});

	test('a session that is not awaiting input offers no actions', () => {
		assert.strictEqual(canResolvePermission('working', tool), false);
		assert.strictEqual(canResolvePermission('idle', tool), false);
		assert.strictEqual(canResolvePermission('completed', tool), false);
	});
});
