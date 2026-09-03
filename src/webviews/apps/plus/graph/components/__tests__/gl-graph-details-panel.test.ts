import * as assert from 'assert';
import type { TemplateResult } from 'lit';
import type {
	AgentSessionState,
	PastAgentSessionDetail,
	PastAgentSessionState,
} from '../../../../../../agents/models/agentSessionState.js';
import type { Wip } from '../../../../../plus/graph/detailsProtocol.js';
import { getNextPastAgentSessionsLimit, shouldShowPastSessions } from '../gl-details-agent-status.js';
import { GlGraphDetailsPanel } from '../gl-graph-details-panel.js';
import type { SheetDescriptor } from '../sheetStack.js';

/** Minimal `this` for {@link GlGraphDetailsPanel.renderSheet}'s `agentSession`/`pastAgentSession`
 *  case — only the members that case reads. */
type RenderSheetHarness = {
	getAgentSessionCycleEntries(): SheetDescriptor[];
	findAgentSessionCycleIndex(entries: readonly SheetDescriptor[], top: SheetDescriptor): number;
	_graphState?: { agentSessions?: AgentSessionState[] };
	_pastSessionDetail?: PastAgentSessionDetail;
	handleAgentSessionCycle(e: CustomEvent<{ direction: -1 | 1 }>): void;
	handleCloseAgentSheet(): void;
};

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

suite('GlGraphDetailsPanel agent sheet cycling', () => {
	test('renders live and past agent sessions from the same template literal', () => {
		// This Node test host has no real DOM (Lit's tests run against `@lit-labs/ssr-dom-shim`,
		// which stubs `customElements`/`HTMLElement` but not lit-html's client renderer — no other
		// test in this suite calls `document.body.append` or `shadowRoot.querySelector`, and
		// `globalThis.document` is undefined here), so a rendered instance isn't available to drive
		// through `gl-detail-sheet-close`/cycle events and read back `shadowRoot`. `renderSheet` is
		// called directly instead, and the invariant is checked at the level that actually decides
		// remount vs. patch: lit-html keys DOM on the tagged template's `strings`
		// (`TemplateStringsArray`) identity, not on the tag name, so `live.strings === past.strings`
		// proves a live→past cycle patches the existing element instead of remounting it — the same
		// thing `after === before` would prove on a rendered element.
		const renderSheet = Reflect.get(GlGraphDetailsPanel.prototype, 'renderSheet') as (
			this: RenderSheetHarness,
			d: SheetDescriptor,
			isTop: boolean,
		) => TemplateResult;

		const liveSession = makeSession('session-1', 'idle');
		const pastSession: PastAgentSessionState = {
			id: 'session-2',
			providerId: 'claudeCode',
			disposition: 'ended',
			actions: {},
			worktreePath: '/repo/worktree',
			displayName: 'session-2',
			lastActivity: Date.now(),
		};
		const harness: RenderSheetHarness = {
			getAgentSessionCycleEntries: () => [],
			findAgentSessionCycleIndex: () => -1,
			_graphState: { agentSessions: [liveSession] },
			_pastSessionDetail: undefined,
			handleAgentSessionCycle: () => {},
			handleCloseAgentSheet: () => {},
		};

		const live = renderSheet.call(
			harness,
			{ kind: 'agentSession', sessionId: 'session-1', providerId: 'claudeCode' },
			true,
		);
		const past = renderSheet.call(harness, { kind: 'pastAgentSession', session: pastSession }, true);

		assert.strictEqual(
			live.strings,
			past.strings,
			'agentSession and pastAgentSession must render from the same <gl-graph-agent-sheet> template literal',
		);

		const strings = [...live.strings];
		const sessionIndex = strings.findIndex(s => s.trimEnd().endsWith('.session='));
		const pastSessionIndex = strings.findIndex(s => s.trimEnd().endsWith('.pastSession='));

		assert.notStrictEqual(sessionIndex, -1, 'template must bind .session');
		assert.notStrictEqual(pastSessionIndex, -1, 'template must bind .pastSession');
		assert.strictEqual(live.values[sessionIndex], liveSession);
		assert.strictEqual(live.values[pastSessionIndex], undefined);
		assert.strictEqual(past.values[sessionIndex], undefined);
		assert.strictEqual(past.values[pastSessionIndex], pastSession);
	});
});
