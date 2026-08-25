import * as assert from 'assert';
import type { AgentSessionState } from '../../../../../../agents/models/agentSessionState.js';
import type { Wip } from '../../../../../plus/graph/detailsProtocol.js';
import { getNextPastAgentSessionsLimit, shouldShowPastSessions } from '../gl-details-agent-status.js';
import { GlGraphDetailsPanel } from '../gl-graph-details-panel.js';

type PastSessionsPanelHarness = {
	isWip: boolean;
	_state: { wip: { get(): Wip | undefined } };
	_actions?: {
		resources: {
			pastAgentSessions: {
				reset(): void;
				fetch(worktreePath: string, limit?: number): Promise<void>;
			};
		};
	};
	_lastPastSessionsFetch?: { worktreePath: string; endedSessionIds: string; limit: number };
	getWorktreeAgentSessions(wip: Wip): AgentSessionState[] | undefined;
	updateWipPastSessions?(): void;
};

function makeSession(id: string, phase: AgentSessionState['phase']): AgentSessionState {
	return {
		id: id,
		providerId: 'claudeCode',
		providerName: 'Claude Code',
		status: phase === 'ended' ? 'ended' : 'idle',
		phase: phase,
		phaseSince: Date.now(),
		lastActivity: Date.now(),
		isSubagent: false,
		isInWorkspace: true,
		displayName: id,
		subagentCount: 0,
	};
}

suite('GlGraphDetailsPanel agent history', () => {
	test('shows past rows only with the main section expanded', () => {
		assert.strictEqual(shouldShowPastSessions(true, 'collapsed'), false);
		assert.strictEqual(shouldShowPastSessions(true, 'partial'), false);
		assert.strictEqual(shouldShowPastSessions(true, 'expanded'), true);
	});

	test('renders no past-session surface when no resumable rows exist', () => {
		assert.strictEqual(shouldShowPastSessions(false, 'expanded'), false);
	});

	test('pages past sessions in cumulative groups of fifteen after the initial three', () => {
		assert.strictEqual(getNextPastAgentSessionsLimit(3, 937), 18);
		assert.strictEqual(getNextPastAgentSessionsLimit(18, 937), 33);
		assert.strictEqual(getNextPastAgentSessionsLimit(18, 25), 25);
		assert.strictEqual(getNextPastAgentSessionsLimit(25, 25), undefined);
	});

	test('refetches when a live session ends without refetching for live status churn', () => {
		const worktreePath = '/repo/worktree';
		const wip: Wip = {
			changes: undefined,
			repositoryCount: 1,
			repo: {
				uri: 'file:///repo/worktree',
				name: 'worktree',
				path: worktreePath,
				isWorktree: true,
			},
		};
		const fetched: { path: string; limit: number | undefined }[] = [];
		let resetCount = 0;
		let sessions = [makeSession('session-1', 'idle')];
		const panel: PastSessionsPanelHarness = {
			isWip: true,
			_state: { wip: { get: () => wip } },
			_actions: {
				resources: {
					pastAgentSessions: {
						reset: () => {
							resetCount++;
						},
						fetch: (path, limit) => {
							fetched.push({ path: path, limit: limit });
							return Promise.resolve();
						},
					},
				},
			},
			getWorktreeAgentSessions: () => sessions,
		};
		const updateWipPastSessions = Reflect.get(GlGraphDetailsPanel.prototype, 'updateWipPastSessions') as (
			this: PastSessionsPanelHarness,
		) => void;

		updateWipPastSessions.call(panel);
		sessions = [makeSession('session-1', 'working')];
		updateWipPastSessions.call(panel);

		assert.deepStrictEqual(
			fetched,
			[{ path: worktreePath, limit: 3 }],
			'live phase changes reuse the cached history',
		);

		sessions = [makeSession('session-1', 'ended')];
		updateWipPastSessions.call(panel);

		assert.deepStrictEqual(fetched, [
			{ path: worktreePath, limit: 3 },
			{ path: worktreePath, limit: 3 },
		]);
		assert.strictEqual(resetCount, 2);
	});

	test('explicit WIP refresh resets paged history to the initial three rows', () => {
		const worktreePath = '/repo/worktree';
		const wip: Wip = {
			changes: undefined,
			repositoryCount: 1,
			repo: {
				uri: 'file:///repo/worktree',
				name: 'worktree',
				path: worktreePath,
				isWorktree: true,
			},
		};
		const fetchedLimits: (number | undefined)[] = [];
		let resetCount = 0;
		const updateWipPastSessions = Reflect.get(GlGraphDetailsPanel.prototype, 'updateWipPastSessions') as (
			this: PastSessionsPanelHarness,
		) => void;
		const panel: PastSessionsPanelHarness = {
			isWip: true,
			_state: { wip: { get: () => wip } },
			_actions: {
				resources: {
					pastAgentSessions: {
						reset: () => {
							resetCount++;
						},
						fetch: (_path: string, limit?: number) => {
							fetchedLimits.push(limit);
							return Promise.resolve();
						},
					},
				},
			},
			_lastPastSessionsFetch: { worktreePath: worktreePath, endedSessionIds: '[]', limit: 18 },
			getWorktreeAgentSessions: () => [],
			updateWipPastSessions: updateWipPastSessions,
		};
		const refreshWipPastSessions = Reflect.get(GlGraphDetailsPanel.prototype, 'refreshWipPastSessions') as (
			this: PastSessionsPanelHarness,
		) => void;

		refreshWipPastSessions.call(panel);

		assert.deepStrictEqual(fetchedLimits, [3]);
		assert.strictEqual(resetCount, 1);
		assert.strictEqual(panel._lastPastSessionsFetch?.limit, 3);
	});
});
