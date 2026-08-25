import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately: `system/-webview/command.ts` (pulled in by
// the service) imports `container.ts` as a value, and container's own import fan-out reaches the
// command classes whose `@command()` decorator reads a registry that module is still initializing.
// Letting container initialize first breaks the cycle; without it the bundle throws on load.
import '../../container.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Container } from '../../container.js';
import { AgentStatusService } from '../agentStatusService.js';
import type {
	AgentSession,
	AgentSessionHistoryItem,
	AgentSessionHistoryOptions,
	AgentSessionHistoryResult,
	AgentSessionProvider,
} from '../provider.js';

/**
 * Minimal stand-in for the provider contract — only the members {@link AgentStatusService}
 * actually touches. `sessions` is a plain array the test mutates, then `fire()` drives the same
 * `onDidChangeSessions` path the real provider uses.
 */
class TestProvider implements AgentSessionProvider {
	readonly name: string;
	readonly icon = 'robot';

	private readonly _onDidChangeSessions = new Emitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	sessions: AgentSession[] = [];
	terminalGeneration = 0;
	history: AgentSessionHistoryResult = { sessions: [], total: 0 };
	readonly historyExclusions: string[][] = [];
	archivedSessionIds: string[] = [];

	constructor(readonly id = 'claudeCode') {
		this.name = id;
	}

	start(): void {}
	stop(): void {}
	dispose(): void {
		this._onDidChangeSessions.dispose();
	}
	[Symbol.dispose](): void {
		this.dispose();
	}

	fire(): void {
		this._onDidChangeSessions.fire();
	}

	archiveSession(sessionId: string): Promise<boolean> {
		this.archivedSessionIds.push(sessionId);
		return Promise.resolve(true);
	}

	listSessionHistory(_cwd: string, options?: AgentSessionHistoryOptions): Promise<AgentSessionHistoryResult> {
		this.historyExclusions.push([...(options?.excludeSessionIds ?? [])]);
		return Promise.resolve(this.history);
	}
}

/** A provider whose `listSessionHistory` can mutate `sessions` mid-query (after the exclusion
 *  snapshot is captured, before the listing resolves) and optionally honors `excludeSessionIds` —
 *  used to drive the post-settlement live-recheck races in {@link AgentStatusService.getPastSessions}.
 *  Terminal mutations in `onQuery` must bump {@link terminalGeneration}, per the provider contract. */
class RaceTestProvider implements AgentSessionProvider {
	readonly name: string;
	readonly icon = 'robot';

	private readonly _onDidChangeSessions = new Emitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	sessions: AgentSession[] = [];
	terminalGeneration = 0;
	history: AgentSessionHistoryItem[] = [];
	readonly historyExclusions: string[][] = [];
	/** When true, filters `excludeSessionIds` out of the returned rows like a real provider would.
	 *  When false, returns every row regardless — exercises the host's own safety-net filter. */
	excludeAware = false;
	/** Invoked once per `listSessionHistory` call, after the exclusion set is recorded but before
	 *  the listing resolves — the hook point for mutating `sessions` mid-query. */
	onQuery?: () => void;

	constructor(readonly id = 'claudeCode') {
		this.name = id;
	}

	start(): void {}
	stop(): void {}
	dispose(): void {
		this._onDidChangeSessions.dispose();
	}
	[Symbol.dispose](): void {
		this.dispose();
	}

	async listSessionHistory(_cwd: string, options?: AgentSessionHistoryOptions): Promise<AgentSessionHistoryResult> {
		this.historyExclusions.push([...(options?.excludeSessionIds ?? [])]);
		await Promise.resolve();
		this.onQuery?.();

		const excluded = options?.excludeSessionIds;
		const sessions =
			this.excludeAware && excluded != null ? this.history.filter(item => !excluded.has(item.id)) : this.history;
		return { sessions: sessions, total: this.history.length };
	}
}

/** Container fake covering only the surfaces the service reaches for (git/telemetry/agents/onReady). */
function makeContainer(options?: { worktrees?: unknown[]; onGetWorktrees?: () => Promise<unknown[]> }): Container {
	const noopDisposable = { dispose: () => {} };
	return {
		git: {
			openRepositories: [],
			getRepositoryService: () => ({
				worktrees: {
					getWorktrees: options?.onGetWorktrees ?? (() => Promise.resolve(options?.worktrees ?? [])),
				},
			}),
			onDidChangeRepository: () => noopDisposable,
			onDidChangeRepositories: () => noopDisposable,
		},
		telemetry: { sendEvent: () => {} },
		agents: { getClaude: () => undefined, invalidateCache: () => {} },
		onReady: () => noopDisposable,
	} as unknown as Container;
}

function makeSession(overrides: Partial<AgentSession> & { id: string }): AgentSession {
	return {
		providerId: 'claudeCode',
		providerName: 'Claude Code',
		status: 'idle',
		phase: 'idle',
		phaseSince: new Date(0),
		lastActivity: new Date(0),
		isSubagent: false,
		isInWorkspace: true,
		...overrides,
	};
}

/** Builds the service around a {@link TestProvider} and records every published snapshot. */
function setup(containerOptions?: Parameters<typeof makeContainer>[0]) {
	const provider = new TestProvider();
	const service = new AgentStatusService(makeContainer(containerOptions), [provider], { registerCommands: false });
	const published: number[] = [];
	const subscription = service.onDidChangeSessions(sessions => published.push(sessions.length));
	return {
		provider: provider,
		service: service,
		published: published,
		dispose: () => {
			subscription.dispose();
			service.dispose();
		},
	};
}

suite('AgentStatusService session snapshot publishing', () => {
	test('publishes once for a new session, then stays quiet while nothing changes', () => {
		const { provider, published, dispose } = setup();
		try {
			provider.sessions = [makeSession({ id: 's1' })];
			provider.fire();
			assert.strictEqual(published.length, 1, 'the new session publishes');

			// Same objects, so every memo entry hits and the change-detect finds nothing.
			provider.fire();
			provider.fire();
			assert.strictEqual(published.length, 1, 'repeat events with unchanged sessions must not publish');
		} finally {
			dispose();
		}
	});

	test('publishes when a tracked session changes', () => {
		const { provider, published, dispose } = setup();
		try {
			const session = makeSession({ id: 's1' });
			provider.sessions = [session];
			provider.fire();

			// Providers replace immutably — that identity change is what invalidates the memo entry.
			provider.sessions = [{ ...session, status: 'ended', phase: 'ended' }];
			provider.fire();
			assert.strictEqual(published.length, 2);
		} finally {
			dispose();
		}
	});

	test('a change while a worktree refresh is starved by a wedged getWorktrees() still publishes', () => {
		const { provider, published, dispose } = setup({ onGetWorktrees: () => new Promise(() => {}) });
		try {
			// commonPath (not just worktreePath) is required — it's what seeds refreshWorktreeNameCache's
			// repoPaths set, which is what actually triggers the (never-settling) getWorktrees() call.
			const session = makeSession({ id: 's1', worktreePath: '/repo/wt1', commonPath: '/repo' });
			provider.sessions = [session];
			provider.fire();
			// The worktree path is unresolved, so this tick STARTS the refresh and defers its publish
			// to the refresh's completion — which never comes, since getWorktrees() is wedged.
			assert.strictEqual(published.length, 0, 'first tick defers to the still-pending refresh');

			provider.sessions = [{ ...session, status: 'ended', phase: 'ended' }];
			provider.fire();
			// A refresh is already in flight, so this tick must publish immediately instead of only
			// attaching to the same stuck promise — otherwise a wedged getWorktrees() would starve
			// every subsequent session change forever.
			assert.strictEqual(published.length, 1, 'a tick during an in-flight refresh still publishes');
		} finally {
			dispose();
		}
	});

	test('publishes when a session is removed', () => {
		const { provider, published, dispose } = setup();
		try {
			provider.sessions = [makeSession({ id: 's1' }), makeSession({ id: 's2' })];
			provider.fire();
			assert.strictEqual(published.length, 1);

			provider.sessions = provider.sessions.filter(s => s.id === 's1');
			provider.fire();
			assert.strictEqual(published.length, 2, 'a removal must publish — nothing else would catch it');
		} finally {
			dispose();
		}
	});

	test('does not publish for a reorder alone', () => {
		const { provider, published, dispose } = setup();
		try {
			const a = makeSession({ id: 's1' });
			const b = makeSession({ id: 's2' });
			provider.sessions = [a, b];
			provider.fire();
			assert.strictEqual(published.length, 1);

			// Consumers sort for themselves, so order is deliberately not part of the comparison.
			provider.sessions = [b, a];
			provider.fire();
			assert.strictEqual(published.length, 1);
		} finally {
			dispose();
		}
	});

	test('a within-the-minute activity tick alone does not publish', () => {
		const { provider, published, dispose } = setup();
		try {
			const session = makeSession({ id: 's1', lastActivity: new Date(60_000) });
			provider.sessions = [session];
			provider.fire();
			assert.strictEqual(published.length, 1);

			// New object identity (so the memo misses and re-serializes) but the same minute bucket —
			// the coarsening is what keeps a ticking session from storming every webview.
			provider.sessions = [{ ...session, lastActivity: new Date(60_999) }];
			provider.fire();
			assert.strictEqual(published.length, 1, 'sub-minute drift must not publish');

			provider.sessions = [{ ...session, lastActivity: new Date(180_000) }];
			provider.fire();
			assert.strictEqual(published.length, 2, 'crossing the bucket does publish');
		} finally {
			dispose();
		}
	});

	test('getSerializedSessions reflects the current sessions', () => {
		const { provider, service, dispose } = setup();
		try {
			provider.sessions = [makeSession({ id: 's1' }), makeSession({ id: 's2' })];
			provider.fire();

			const states = service.getSerializedSessions();
			assert.deepStrictEqual(
				states.map(s => s.id),
				['s1', 's2'],
			);
			// Served from the same memo the publish path uses, so a repeat read is identical.
			assert.deepStrictEqual(
				service.getSerializedSessions().map(s => s.id),
				['s1', 's2'],
			);
		} finally {
			dispose();
		}
	});

	test('does not treat equal ids from different providers as the same snapshot entry', () => {
		const alpha = new TestProvider('alpha');
		const beta = new TestProvider('beta');
		alpha.sessions = [makeSession({ id: 'same', providerId: 'alpha', providerName: 'Alpha' })];
		beta.sessions = [makeSession({ id: 'same', providerId: 'beta', providerName: 'Beta' })];
		const service = new AgentStatusService(makeContainer(), [alpha, beta], { registerCommands: false });
		let publishes = 0;
		const subscription = service.onDidChangeSessions(() => publishes++);
		try {
			alpha.fire();
			alpha.fire();
			assert.strictEqual(publishes, 1, 'an unchanged second provider-scoped snapshot stays quiet');
		} finally {
			subscription.dispose();
			service.dispose();
		}
	});
});

suite('AgentStatusService history aggregation', () => {
	test('scopes live exclusions and equal session ids to their provider', async () => {
		const alpha = new TestProvider('alpha');
		const beta = new TestProvider('beta');
		alpha.sessions = [makeSession({ id: 'same', providerId: 'alpha', providerName: 'Alpha' })];
		beta.history = {
			sessions: [
				{
					id: 'same',
					disposition: 'ended',
					actions: { resume: { cwd: '/repo/worktree' }, archive: true },
					lastActivity: new Date(1234),
					lastPrompt: 'beta history',
				},
			],
			total: 1,
		};
		const service = new AgentStatusService(makeContainer(), [alpha, beta], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.deepStrictEqual(alpha.historyExclusions, [['same']]);
			assert.deepStrictEqual(beta.historyExclusions, [[]]);
			assert.deepStrictEqual(
				result.sessions.map(session => ({
					providerId: session.providerId,
					id: session.id,
					actions: session.actions,
				})),
				[{ providerId: 'beta', id: 'same', actions: { archive: true } }],
				'the host stamps provider identity and removes actions with no matching provider operation',
			);
		} finally {
			service.dispose();
		}
	});

	test('drops a session that went live mid-query without retrying', async () => {
		const provider = new RaceTestProvider();
		provider.sessions = [makeSession({ id: 'x', status: 'ended' })];
		provider.history = [{ id: 'x', disposition: 'ended', actions: {}, lastActivity: new Date(1000) }];
		// Went live while the listing was in flight — the record still describes it as ended.
		provider.onQuery = () => {
			provider.sessions = [{ ...provider.sessions[0], status: 'idle' }];
		};
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				[],
				'a session that went live mid-query must not surface as past',
			);
			assert.strictEqual(
				provider.historyExclusions.length,
				1,
				'went-live is reconciled by the post-settlement drop — no retry needed',
			);
		} finally {
			service.dispose();
		}
	});

	test('recovers a session that ended mid-query on the retry', async () => {
		const provider = new RaceTestProvider();
		provider.excludeAware = true;
		provider.sessions = [makeSession({ id: 'y', status: 'idle' })];
		provider.history = [{ id: 'y', disposition: 'ended', actions: {}, lastActivity: new Date(2000) }];
		// Live at query start (excluded from the first pass), ends while the listing is in flight.
		provider.onQuery = () => {
			if (provider.sessions[0].status !== 'ended') {
				provider.sessions = [{ ...provider.sessions[0], status: 'ended' }];
				provider.terminalGeneration++;
			}
		};
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				['y'],
				"the retry's fresh exclusions must seat the now-ended session as past",
			);
			assert.strictEqual(provider.historyExclusions.length, 2, 'the changed live set triggers one retry');
		} finally {
			service.dispose();
		}
	});

	test('retries until quiescent when sessions keep ending across attempts', async () => {
		const provider = new RaceTestProvider();
		provider.excludeAware = true;
		provider.sessions = [makeSession({ id: 'a', status: 'idle' }), makeSession({ id: 'b', status: 'idle' })];
		provider.history = [
			{ id: 'a', disposition: 'ended', actions: {}, lastActivity: new Date(5000) },
			{ id: 'b', disposition: 'ended', actions: {}, lastActivity: new Date(4000) },
		];
		// One session ends during each of the first two attempts — only the third sees quiescence.
		let queries = 0;
		provider.onQuery = () => {
			queries++;
			if (queries === 1) {
				provider.sessions = provider.sessions.map(s => (s.id === 'a' ? { ...s, status: 'ended' } : s));
				provider.terminalGeneration++;
			} else if (queries === 2) {
				provider.sessions = provider.sessions.map(s => (s.id === 'b' ? { ...s, status: 'ended' } : s));
				provider.terminalGeneration++;
			}
		};
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.strictEqual(
				provider.historyExclusions.length,
				3,
				'each mid-query ending earns another pass until an attempt sees none',
			);
			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				['a', 'b'],
				'the quiescent attempt must seat every ended session as past',
			);
		} finally {
			service.dispose();
		}
	});

	test('recovers a session removed (not retained as ended) mid-query', async () => {
		const provider = new RaceTestProvider();
		provider.excludeAware = true;
		// A legacy-path provider drops terminal rows instead of keeping an `ended` one — the only
		// trace is the initially-live id vanishing from the live set.
		provider.sessions = [makeSession({ id: 'r', status: 'idle' })];
		provider.history = [{ id: 'r', disposition: 'ended', actions: {}, lastActivity: new Date(7000) }];
		provider.onQuery = () => {
			if (provider.sessions.length > 0) {
				provider.sessions = [];
				provider.terminalGeneration++;
			}
		};
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.strictEqual(provider.historyExclusions.length, 2, 'the terminal transition must trigger a retry');
			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				['r'],
				'the retry must surface the removed session as past',
			);
		} finally {
			service.dispose();
		}
	});

	test('recovers a session born and ended entirely inside the query window', async () => {
		const provider = new RaceTestProvider();
		provider.excludeAware = true;
		// Not tracked at the snapshot — starts AND ends while the listing is in flight, so it is in
		// neither the exclusion set nor the final live set; only the ended-set diff can see it.
		provider.sessions = [];
		provider.onQuery = () => {
			if (provider.sessions.length === 0) {
				provider.sessions = [makeSession({ id: 's', status: 'ended' })];
				provider.history = [{ id: 's', disposition: 'ended', actions: {}, lastActivity: new Date(6000) }];
				provider.terminalGeneration++;
			}
		};
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.strictEqual(provider.historyExclusions.length, 2, 'the new ended id must trigger a retry');
			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				['s'],
				'the retry must surface the born-and-ended session as past',
			);
		} finally {
			service.dispose();
		}
	});

	test('recovers a session born and removed entirely inside the query window', async () => {
		const provider = new RaceTestProvider();
		provider.excludeAware = true;
		// A legacy-path session that started AND was removed mid-query leaves no row at either
		// endpoint — only the generation bump (and the transcript it left behind) betray it.
		provider.sessions = [];
		provider.onQuery = () => {
			if (provider.history.length === 0) {
				provider.history = [{ id: 't', disposition: 'ended', actions: {}, lastActivity: new Date(8000) }];
				provider.terminalGeneration++;
			}
		};
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			const result = await service.getPastSessions('/repo/worktree');

			assert.strictEqual(provider.historyExclusions.length, 2, 'the generation bump must trigger a retry');
			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				['t'],
				'the retry must surface the transcript the removed session left behind',
			);
		} finally {
			service.dispose();
		}
	});

	test('does not retry when the live set is stable across the query', async () => {
		const provider = new RaceTestProvider();
		provider.excludeAware = true;
		provider.sessions = [makeSession({ id: 'z', status: 'idle' })];
		provider.history = [{ id: 'z', disposition: 'ended', actions: {}, lastActivity: new Date(3000) }];
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			await service.getPastSessions('/repo/worktree');

			assert.strictEqual(provider.historyExclusions.length, 1, 'a stable live set must not trigger a retry');
		} finally {
			service.dispose();
		}
	});
});

suite('AgentStatusService archiveSession', () => {
	test('routes an untracked past session by provider id', async () => {
		const { provider, service, dispose } = setup();
		try {
			assert.strictEqual(await service.archiveSession('past-session', 'claudeCode'), true);
			assert.deepStrictEqual(provider.archivedSessionIds, ['past-session']);
		} finally {
			dispose();
		}
	});
});
