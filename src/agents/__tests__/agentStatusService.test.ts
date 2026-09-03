import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately: `system/-webview/command.ts` (pulled in by
// the service) imports `container.ts` as a value, and container's own import fan-out reaches the
// command classes whose `@command()` decorator reads a registry that module is still initializing.
// Letting container initialize first breaks the cycle; without it the bundle throws on load.
import '../../container.js';
import * as sinon from 'sinon';
import { commands, ConfigurationTarget, extensions, window } from 'vscode';
import { getAgentCapabilitiesByProviderId } from '@gitlens/agents/agentCapabilities.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { GkAgent } from '../agentService.js';
import { AgentStatusService } from '../agentStatusService.js';
import type {
	AgentSession,
	AgentSessionHistoryItem,
	AgentSessionHistoryOptions,
	AgentSessionHistoryResult,
	AgentSessionProvider,
	AgentSessionResumeOutcome,
	AgentSessionResumeTarget,
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
	/** Every `resumeSession` invocation's args, in order. Only populated once {@link enableResumeSession}
	 *  has been called — mirroring a provider that doesn't wire the operation, `resumeSession` stays
	 *  `undefined` (not merely a no-op) until then, matching the optional-method contract other
	 *  tests rely on (e.g. the history normalizer stripping a phantom `resume` action). */
	readonly resumeSessionCalls: {
		providerId: string;
		sessionId: string;
		cwd: string;
		target: AgentSessionResumeTarget;
		name?: string;
	}[] = [];
	/** Outcome the next `resumeSession` call resolves to — set per test. */
	resumeSessionOutcome: AgentSessionResumeOutcome | false = 'terminal';
	resumeSession?: (
		providerId: string,
		sessionId: string,
		cwd: string,
		target: AgentSessionResumeTarget,
		name?: string,
	) => Promise<AgentSessionResumeOutcome | false>;
	/** Unset by default (mirrors a provider that doesn't wire the CLI relay); a test assigns a stub
	 *  directly, the same way {@link resumeSession} is wired via {@link enableResumeSession}. */
	relayOpenSession?: (sessionId: string, path: string) => Promise<boolean>;

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

	/** Wires {@link resumeSession} — see the property's doc comment for why it isn't present by default. */
	enableResumeSession(): void {
		this.resumeSession = (providerId, sessionId, cwd, target, name) => {
			this.resumeSessionCalls.push({
				providerId: providerId,
				sessionId: sessionId,
				cwd: cwd,
				target: target,
				name: name,
			});
			return Promise.resolve(this.resumeSessionOutcome);
		};
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
		agents: { getAll: () => Promise.resolve([]), invalidateCache: () => {} },
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
					providerId: 'beta',
					disposition: 'ended',
					actions: { resume: { cwd: '/repo/worktree', targets: ['terminal'] }, archive: true },
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
				'the item carries its own agent identity, and the host removes actions with no matching provider operation',
			);
		} finally {
			service.dispose();
		}
	});

	test('drops a session that went live mid-query without retrying', async () => {
		const provider = new RaceTestProvider();
		provider.sessions = [makeSession({ id: 'x', status: 'ended' })];
		provider.history = [
			{ id: 'x', providerId: 'claudeCode', disposition: 'ended', actions: {}, lastActivity: new Date(1000) },
		];
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
		provider.history = [
			{ id: 'y', providerId: 'claudeCode', disposition: 'ended', actions: {}, lastActivity: new Date(2000) },
		];
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
			{ id: 'a', providerId: 'claudeCode', disposition: 'ended', actions: {}, lastActivity: new Date(5000) },
			{ id: 'b', providerId: 'claudeCode', disposition: 'ended', actions: {}, lastActivity: new Date(4000) },
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
		provider.history = [
			{ id: 'r', providerId: 'claudeCode', disposition: 'ended', actions: {}, lastActivity: new Date(7000) },
		];
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
				provider.history = [
					{
						id: 's',
						providerId: 'claudeCode',
						disposition: 'ended',
						actions: {},
						lastActivity: new Date(6000),
					},
				];
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
				provider.history = [
					{
						id: 't',
						providerId: 'claudeCode',
						disposition: 'ended',
						actions: {},
						lastActivity: new Date(8000),
					},
				];
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
		provider.history = [
			{ id: 'z', providerId: 'claudeCode', disposition: 'ended', actions: {}, lastActivity: new Date(3000) },
		];
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

function makeGkAgent(overrides: Partial<GkAgent> & { name: string }): GkAgent {
	return {
		displayName: overrides.name,
		detected: true,
		executable: '/usr/bin/agent',
		mcpSupported: true,
		mcpInstalled: false,
		hooksSupported: true,
		hooksInstalled: false,
		...overrides,
	};
}

/** `runHooksOperation` is private; every public entry into it needs either command registration or
 *  a real `gk` CLI (via `@env/agents/agentHooks.js`), so the tests drive it directly the same way
 *  `dispatchSessionAction` does, and inject a fake `hooksInstaller` in place of the CLI. */
function callRunHooksOperation(
	service: AgentStatusService,
	agents: readonly GkAgent[],
	op: 'install' | 'uninstall',
): Promise<void> {
	return (
		service as unknown as {
			runHooksOperation: (
				agents: readonly GkAgent[],
				op: 'install' | 'uninstall',
				source: string,
			) => Promise<void>;
		}
	).runHooksOperation(agents, op, 'commandPalette');
}

function setupHooksOperation() {
	const provider = new TestProvider();
	const hooksInstaller = { installAgentHook: sinon.stub().resolves(), uninstallAgentHook: sinon.stub().resolves() };
	const service = new AgentStatusService(makeContainer(), [provider], {
		registerCommands: false,
		hooksInstaller: hooksInstaller,
	});
	return { service: service, hooksInstaller: hooksInstaller, dispose: () => service.dispose() };
}

suite('AgentStatusService runHooksOperation manual-activation hint', () => {
	test('installing codex appends its manual-activation hint to the toast', async () => {
		const sandbox = sinon.createSandbox();
		const showInformationMessage = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const { service, dispose } = setupHooksOperation();
		try {
			await callRunHooksOperation(service, [makeGkAgent({ name: 'codex', displayName: 'Codex' })], 'install');

			assert.strictEqual(showInformationMessage.callCount, 1);
			const message = showInformationMessage.firstCall.args[0];
			assert.match(message, /^GitKraken Hooks: Installed for Codex\./);
			assert.match(message, /trust them/, 'the codex manual-activation hint must be appended');
		} finally {
			dispose();
			sandbox.restore();
		}
	});

	test('installing claude-code alone carries no hint', async () => {
		const sandbox = sinon.createSandbox();
		const showInformationMessage = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const { service, dispose } = setupHooksOperation();
		try {
			await callRunHooksOperation(
				service,
				[makeGkAgent({ name: 'claude-cli', displayName: 'Claude Code' })],
				'install',
			);

			assert.strictEqual(showInformationMessage.callCount, 1);
			assert.strictEqual(showInformationMessage.firstCall.args[0], 'GitKraken Hooks: Installed for Claude Code.');
		} finally {
			dispose();
			sandbox.restore();
		}
	});

	test('uninstalling codex carries no hint, even though its descriptor has one', async () => {
		const sandbox = sinon.createSandbox();
		const showInformationMessage = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const { service, dispose } = setupHooksOperation();
		try {
			await callRunHooksOperation(
				service,
				[makeGkAgent({ name: 'codex', displayName: 'Codex', hooksInstalled: true })],
				'uninstall',
			);

			assert.strictEqual(showInformationMessage.callCount, 1);
			assert.strictEqual(showInformationMessage.firstCall.args[0], 'GitKraken Hooks: Uninstalled for Codex.');
		} finally {
			dispose();
			sandbox.restore();
		}
	});
});

suite('AgentStatusService runHooksOperation start-session action', () => {
	test('a single hinted agent offers a "Start … Session" action that dispatches startAgentSession', async () => {
		const sandbox = sinon.createSandbox();
		// Resolves with whatever action the toast was actually shown (there is exactly one), the same
		// way a user clicking that one button would — the real action object is created fresh inside
		// `runHooksOperation`, so the test can't pre-construct it to hand back.
		const showInformationMessage = sandbox
			.stub(window, 'showInformationMessage')
			.callsFake((_message: any, ...actions: any[]) => Promise.resolve(actions[0]));
		const executeCommand = sandbox.stub(commands, 'executeCommand').resolves(undefined);
		const { service, dispose } = setupHooksOperation();
		try {
			await callRunHooksOperation(service, [makeGkAgent({ name: 'codex', displayName: 'Codex' })], 'install');

			assert.strictEqual(showInformationMessage.callCount, 1);
			const [message, action] = showInformationMessage.firstCall.args;
			assert.match(message, /^GitKraken Hooks: Installed for Codex\./);
			assert.deepStrictEqual(action, { title: 'Start Codex Session' });

			assert.ok(
				executeCommand.calledWith('gitlens.startAgentSession', { agentId: 'cli:codex' }),
				'expected gitlens.startAgentSession to be dispatched for the codex CLI descriptor',
			);
		} finally {
			dispose();
			sandbox.restore();
		}
	});

	test('two hinted agents omit the action button — a single button cannot target two agents', async () => {
		const sandbox = sinon.createSandbox();
		const showInformationMessage = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const executeCommand = sandbox.stub(commands, 'executeCommand').resolves(undefined);
		const { service, dispose } = setupHooksOperation();
		try {
			// Both named `codex` so each independently carries the real codex manual-activation hint —
			// today only one capability descriptor has a hint at all, so this is the only way to exercise
			// the ">1 hinted agent" branch without inventing a second hint that doesn't exist yet.
			await callRunHooksOperation(
				service,
				[
					makeGkAgent({ name: 'codex', displayName: 'Codex' }),
					makeGkAgent({ name: 'codex', displayName: 'Codex 2' }),
				],
				'install',
			);

			assert.strictEqual(showInformationMessage.callCount, 1);
			assert.strictEqual(
				showInformationMessage.firstCall.args.length,
				1,
				'no action should be passed alongside the message',
			);
			assert.strictEqual(executeCommand.called, false);
		} finally {
			dispose();
			sandbox.restore();
		}
	});
});

/** Stubs the three vscode surfaces the dispatcher can reach, and returns them alongside a restore.
 *  Mocha's tdd `setup` hook is shadowed by this file's own `setup()` helper, so each dispatch test
 *  installs and restores its own sandbox instead. */
function stubDispatchSurfaces() {
	const sandbox = sinon.createSandbox();
	return {
		// Dismissed by default — every assertion here is about which prompt was raised, not what the
		// user picked, and a resolved `undefined` keeps the resume path from spawning a terminal.
		showWarningMessage: sandbox.stub(window, 'showWarningMessage').resolves(undefined),
		// `isClaudeExtensionAvailable`'s first probe. Stubbing it both keeps the real extension out of
		// the result AND makes "was the Claude path entered at all?" observable.
		getExtension: sandbox.stub(extensions, 'getExtension').returns(undefined),
		executeCommand: sandbox.stub(commands, 'executeCommand').resolves(undefined),
		restore: () => sandbox.restore(),
	};
}

/** `dispatchSessionAction` is private, and both public entries into it (`openSession`, the resume
 *  picker) need command registration or a quickpick, so the tests drive it directly. */
function dispatchSessionAction(service: AgentStatusService, session: AgentSession): Promise<void> {
	return (
		service as unknown as { dispatchSessionAction: (session: AgentSession) => Promise<void> }
	).dispatchSessionAction(session);
}

function setupDispatch(session: AgentSession, options?: { revealTerminal?: (pid: number) => Promise<boolean> }) {
	const provider = new TestProvider('gkAgents');
	provider.sessions = [session];
	const service = new AgentStatusService(makeContainer(), [provider], {
		registerCommands: false,
		revealTerminal: options?.revealTerminal,
	});
	return { provider: provider, service: service, dispose: () => service.dispose() };
}

suite('AgentStatusService session dispatch', () => {
	test('a live, actively-working non-Claude session never reaches the Claude extension and is not offered a terminal resume', async () => {
		// No pid, so there is no terminal to focus either — the dead-end warning is the whole outcome.
		// Codex declares a CLI resume command, so `phase: 'working'` is the only reason no resume is
		// offered here.
		const session = makeSession({ id: 'codex-1', providerId: 'codex', providerName: 'Codex', phase: 'working' });
		const stubs = stubDispatchSurfaces();
		const { service, dispose } = setupDispatch(session);
		// The service's own resume-target availability cache probes the Claude extension once on
		// construction, independent of any session — only a probe ADDED by this dispatch would
		// mean the non-Claude path wrongly reached it.
		const extensionProbesBeforeDispatch = stubs.getExtension.callCount;
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(
				stubs.getExtension.callCount,
				extensionProbesBeforeDispatch,
				'dispatching a non-Claude session must not probe the Claude extension',
			);
			assert.strictEqual(stubs.executeCommand.called, false, 'no Claude open command may be dispatched');
			assert.deepStrictEqual(
				stubs.showWarningMessage.args,
				[['Unable to open agent session.']],
				'a single-argument warning proves no "Resume in Terminal" action was offered',
			);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('an ended non-Claude session is offered a terminal resume', async () => {
		// Codex declares its own resume command, so the ended-session dead end offers the same
		// terminal resume Claude gets.
		const session = makeSession({
			id: 'codex-2',
			providerId: 'codex',
			providerName: 'Codex',
			status: 'ended',
			phase: 'ended',
		});
		const stubs = stubDispatchSurfaces();
		const { service, dispose } = setupDispatch(session);
		try {
			await dispatchSessionAction(service, session);

			assert.deepStrictEqual(stubs.showWarningMessage.args, [
				['This agent session has ended. Resume it in a terminal?', 'Resume in Terminal'],
			]);
			assert.strictEqual(stubs.executeCommand.called, false);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('an ended Claude session still gets the resume offer', async () => {
		const session = makeSession({ id: 'claude-1', status: 'ended', phase: 'ended' });
		const stubs = stubDispatchSurfaces();
		const { service, dispose } = setupDispatch(session);
		try {
			await dispatchSessionAction(service, session);

			assert.deepStrictEqual(stubs.showWarningMessage.args, [
				['This agent session has ended. Resume it in a terminal?', 'Resume in Terminal'],
			]);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('a live Claude session still probes the Claude extension', async () => {
		// The regression guard for the descriptor fork: pid-less and in-workspace, so the Claude chain
		// falls through to `isClaudeExtensionAvailable` (stubbed unavailable) and then the resume offer.
		const session = makeSession({ id: 'claude-2' });
		const stubs = stubDispatchSurfaces();
		const { service, dispose } = setupDispatch(session);
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(stubs.getExtension.called, true, 'the Claude path must still probe the extension');
			assert.deepStrictEqual(stubs.showWarningMessage.args, [
				['Unable to open agent session. Resume it in a terminal?', 'Resume in Terminal'],
			]);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('a live in-workspace Claude session reveals its integrated terminal when the extension is unavailable', async () => {
		const session = makeSession({ id: 'claude-3', pid: 4242 });
		const stubs = stubDispatchSurfaces();
		const revealTerminal = sinon.stub().resolves(true);
		const { service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(stubs.showWarningMessage.called, false, 'a successful terminal reveal needs no warning');
			assert.strictEqual(revealTerminal.calledOnceWith(4242), true);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('a live in-workspace Claude session falls back to the resume offer when the terminal reveal misses', async () => {
		const session = makeSession({ id: 'claude-4', pid: 4243 });
		const stubs = stubDispatchSurfaces();
		const revealTerminal = sinon.stub().resolves(false);
		const { service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		try {
			await dispatchSessionAction(service, session);

			assert.deepStrictEqual(stubs.showWarningMessage.args, [
				['Unable to open agent session. Resume it in a terminal?', 'Resume in Terminal'],
			]);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('a live non-Claude session reveals its integrated terminal without probing the Claude extension', async () => {
		const session = makeSession({ id: 'codex-3', providerId: 'codex', providerName: 'Codex', pid: 5551 });
		const stubs = stubDispatchSurfaces();
		const revealTerminal = sinon.stub().resolves(true);
		const { service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		// The service's own resume-target availability cache probes the Claude extension once on
		// construction, independent of any session — only a probe ADDED by this dispatch would
		// mean the non-Claude path wrongly reached it.
		const extensionProbesBeforeDispatch = stubs.getExtension.callCount;
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(stubs.showWarningMessage.called, false);
			assert.strictEqual(
				stubs.getExtension.callCount,
				extensionProbesBeforeDispatch,
				'dispatching a non-Claude session must not probe the Claude extension',
			);
			assert.strictEqual(revealTerminal.calledOnceWith(5551), true);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('revealSession resolves false for an unknown session id', async () => {
		const session = makeSession({ id: 'claude-5' });
		const revealTerminal = sinon.stub().resolves(true);
		const { service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		try {
			const revealed = await service.revealSession('does-not-exist');

			assert.strictEqual(revealed, false);
			assert.strictEqual(revealTerminal.called, false);
		} finally {
			dispose();
		}
	});

	test('revealSession resolves false for an ended session without attempting a terminal reveal', async () => {
		const session = makeSession({ id: 'claude-6', pid: 4244, status: 'ended', phase: 'ended' });
		const revealTerminal = sinon.stub().resolves(true);
		const { service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		try {
			const revealed = await service.revealSession(session.id);

			assert.strictEqual(revealed, false);
			assert.strictEqual(revealTerminal.called, false);
		} finally {
			dispose();
		}
	});

	test("a CLI-hosted out-of-workspace Claude session opens the owning window's folder when the relay is delivered", async () => {
		// No `~/.claude/sessions/<pid>.json` exists in the test environment, so `classifyClaudeSessionHost`
		// answers `undefined` (host unknown) — the same fallback path a CLI-hosted session takes.
		const session = makeSession({
			id: 'claude-7',
			pid: 4245,
			isInWorkspace: false,
			worktreePath: '/repo/worktree',
		});
		const stubs = stubDispatchSurfaces();
		const revealTerminal = sinon.stub().resolves(false);
		const { provider, service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		provider.relayOpenSession = sinon.stub().resolves(true);
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(stubs.showWarningMessage.called, false, 'a delivered relay needs no warning');
			assert.strictEqual(stubs.executeCommand.calledOnce, true);
			const [command, uri, options] = stubs.executeCommand.firstCall.args;
			assert.strictEqual(command, 'vscode.openFolder');
			assert.strictEqual((uri as { fsPath: string }).fsPath, '/repo/worktree');
			assert.deepStrictEqual(options, { forceNewWindow: false });
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test('a CLI-hosted out-of-workspace Claude session falls through to the existing warning when the relay is not delivered', async () => {
		const session = makeSession({
			id: 'claude-8',
			pid: 4246,
			isInWorkspace: false,
			worktreePath: '/repo/worktree',
		});
		const stubs = stubDispatchSurfaces();
		const revealTerminal = sinon.stub().resolves(false);
		const { provider, service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		provider.relayOpenSession = sinon.stub().resolves(false);
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(stubs.executeCommand.called, false, 'openFolder must not run without a delivered relay');
			assert.deepStrictEqual(stubs.showWarningMessage.args, [
				['Unable to open agent session. Resume it in a terminal?', 'Resume in Terminal'],
			]);
		} finally {
			dispose();
			stubs.restore();
		}
	});

	test("a non-Claude out-of-workspace session opens the owning window's folder when the relay is delivered", async () => {
		const session = makeSession({
			id: 'codex-4',
			providerId: 'codex',
			providerName: 'Codex',
			pid: 5552,
			isInWorkspace: false,
			worktreePath: '/repo/other-worktree',
		});
		const stubs = stubDispatchSurfaces();
		const revealTerminal = sinon.stub().resolves(false);
		const { provider, service, dispose } = setupDispatch(session, { revealTerminal: revealTerminal });
		provider.relayOpenSession = sinon.stub().resolves(true);
		try {
			await dispatchSessionAction(service, session);

			assert.strictEqual(stubs.showWarningMessage.called, false, 'a delivered relay needs no warning');
			assert.strictEqual(stubs.executeCommand.calledOnce, true);
			const [command, uri, options] = stubs.executeCommand.firstCall.args;
			assert.strictEqual(command, 'vscode.openFolder');
			assert.strictEqual((uri as { fsPath: string }).fsPath, '/repo/other-worktree');
			assert.deepStrictEqual(options, { forceNewWindow: false });
		} finally {
			dispose();
			stubs.restore();
		}
	});
});

/** `openSession` is private and its command entry needs registration, so the test drives it
 *  directly, the same way {@link dispatchSessionAction} does. */
function callOpenSession(service: AgentStatusService): Promise<void> {
	return (service as unknown as { openSession: () => Promise<void> }).openSession();
}

suite('AgentStatusService openSession row marks', () => {
	test('every row carries its own agent mark, across both row loops', async () => {
		const sandbox = sinon.createSandbox();
		const showQuickPick = sandbox.stub(window, 'showQuickPick').resolves(undefined);
		const provider = new TestProvider();
		// Two or more sessions are required to reach the picker at all — a single one dispatches
		// directly. `opencode` sits out-of-workspace so the "Other workspaces" loop builds too, and the
		// descriptor-less id proves the robot fallback survives.
		const sessions = [
			makeSession({ id: 'claude', providerId: 'claudeCode' }),
			makeSession({ id: 'codex', providerId: 'codex' }),
			makeSession({ id: 'copilot', providerId: 'copilot' }),
			makeSession({ id: 'opencode', providerId: 'opencode', isInWorkspace: false }),
			makeSession({ id: 'unknown', providerId: 'not-a-real-agent' }),
		];
		provider.sessions = sessions;
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		try {
			await callOpenSession(service);

			assert.strictEqual(showQuickPick.callCount, 1);
			const items = showQuickPick.firstCall.args[0] as readonly { label?: string; session?: AgentSession }[];
			for (const session of sessions) {
				// Matched by session, not index — the interleaved separator rows carry no `session`.
				const item = items.find(i => i.session === session);
				assert.ok(item, `expected a row for session ${session.id}`);
				// Read from the capability table, not from the resolver under test, so a resolver that
				// answered `robot` for everything would still fail here.
				const icon = getAgentCapabilitiesByProviderId(session.providerId)?.icon ?? 'robot';
				assert.ok(
					item.label?.startsWith(`$(${icon}) `),
					`expected session ${session.id}'s row to start with $(${icon}), got "${item.label}"`,
				);
			}
		} finally {
			service.dispose();
			sandbox.restore();
		}
	});
});

/** `resumeSession` is private — every public entry into it (command, picker) needs command
 *  registration or a quickpick, so the tests drive it directly. */
function resumeSession(
	service: AgentStatusService,
	providerId: string | undefined,
	sessionId: string,
	cwd: string,
	target: AgentSessionResumeTarget | undefined,
	name?: string,
): Promise<void> {
	return (
		service as unknown as {
			resumeSession: (
				providerId: string | undefined,
				sessionId: string,
				cwd: string,
				target: AgentSessionResumeTarget | undefined,
				source: 'webview' | 'quickpick',
				name?: string,
			) => Promise<void>;
		}
	).resumeSession(providerId, sessionId, cwd, target, 'quickpick', name);
}

/** Fakes `showResumeTargetPicker`'s underlying `window.createQuickPick` seam: `respond` decides
 *  the outcome as soon as `.show()` is called — mirrors {@link makeCancelledQuickPick} in
 *  `startAgentSession.test.ts`. `remember: true` drives the pin item button; otherwise Enter. */
function stubResumeTargetPicker(
	sandbox: sinon.SinonSandbox,
	respond: () => { target: AgentSessionResumeTarget; remember: boolean } | undefined,
): void {
	sandbox.stub(window, 'createQuickPick').callsFake(() => {
		let onAccept: (() => void) | undefined;
		let onButton: ((e: { item: { target: AgentSessionResumeTarget } }) => void) | undefined;
		let onHide: (() => void) | undefined;
		const noopDisposable = { dispose: () => {} };
		const qp = {
			title: '',
			placeholder: '',
			items: [] as { target: AgentSessionResumeTarget }[],
			activeItems: [] as { target: AgentSessionResumeTarget }[],
			onDidAccept: (cb: () => void) => {
				onAccept = cb;
				return noopDisposable;
			},
			onDidTriggerItemButton: (cb: (e: { item: { target: AgentSessionResumeTarget } }) => void) => {
				onButton = cb;
				return noopDisposable;
			},
			onDidHide: (cb: () => void) => {
				onHide = cb;
				return noopDisposable;
			},
			show: () => {
				const pick = respond();
				if (pick == null) {
					onHide?.();
					return;
				}

				const item = qp.items.find(i => i.target === pick.target) ?? { target: pick.target };
				if (pick.remember) {
					onButton?.({ item: item });
				} else {
					qp.activeItems = [item];
					onAccept?.();
				}
			},
			hide: () => {},
			dispose: () => {},
		};
		return qp as unknown as ReturnType<typeof window.createQuickPick>;
	});
}

suite('AgentStatusService resume target resolution', () => {
	test('a single-target row resumes in a terminal without asking', async () => {
		const sandbox = sinon.createSandbox();
		const provider = new TestProvider('claudeCode');
		provider.enableResumeSession();
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		sandbox.stub(service, 'getResumeTargets').returns(['terminal']);
		const createQuickPick = sandbox.stub(window, 'createQuickPick');
		try {
			await resumeSession(service, 'claudeCode', 'sess-1', '/w', undefined, 'Session');

			assert.deepStrictEqual(provider.resumeSessionCalls, [
				{ providerId: 'claudeCode', sessionId: 'sess-1', cwd: '/w', target: 'terminal', name: 'Session' },
			]);
			assert.strictEqual(createQuickPick.called, false, 'no ask for a single-target row');
		} finally {
			service.dispose();
			sandbox.restore();
		}
	});

	test('a two-target row honors a setting naming one of its targets', async () => {
		const sandbox = sinon.createSandbox();
		const provider = new TestProvider('claudeCode');
		provider.enableResumeSession();
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		sandbox.stub(service, 'getResumeTargets').returns(['extension', 'terminal']);
		(sandbox.stub(configuration, 'get') as sinon.SinonStub).withArgs('agents.resumeTarget').returns('extension');
		try {
			await resumeSession(service, 'claudeCode', 'sess-1', '/w', undefined, 'Session');

			assert.strictEqual(provider.resumeSessionCalls[0]?.target, 'extension');
		} finally {
			service.dispose();
			sandbox.restore();
		}
	});

	test('a setting naming a target absent from this row falls back to terminal', async () => {
		const sandbox = sinon.createSandbox();
		const provider = new TestProvider('claudeCode');
		provider.enableResumeSession();
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		sandbox.stub(service, 'getResumeTargets').returns(['terminal']);
		(sandbox.stub(configuration, 'get') as sinon.SinonStub).withArgs('agents.resumeTarget').returns('extension');
		try {
			await resumeSession(service, 'claudeCode', 'sess-1', '/w', undefined, 'Session');

			assert.strictEqual(provider.resumeSessionCalls[0]?.target, 'terminal');
		} finally {
			service.dispose();
			sandbox.restore();
		}
	});

	test('an unset setting asks, and the pin button persists the pick', async () => {
		const sandbox = sinon.createSandbox();
		const provider = new TestProvider('claudeCode');
		provider.enableResumeSession();
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		sandbox.stub(service, 'getResumeTargets').returns(['extension', 'terminal']);
		(sandbox.stub(configuration, 'get') as sinon.SinonStub).withArgs('agents.resumeTarget').returns(null);
		const update = sandbox.stub(configuration, 'update').resolves();
		stubResumeTargetPicker(sandbox, () => ({ target: 'extension', remember: true }));
		try {
			await resumeSession(service, 'claudeCode', 'sess-1', '/w', undefined, 'Session');

			assert.strictEqual(provider.resumeSessionCalls[0]?.target, 'extension');
			assert.deepStrictEqual(update.args, [['agents.resumeTarget', 'extension', ConfigurationTarget.Global]]);
		} finally {
			service.dispose();
			sandbox.restore();
		}
	});

	test('dismissing the ask leaves the provider untouched', async () => {
		const sandbox = sinon.createSandbox();
		const provider = new TestProvider('claudeCode');
		provider.enableResumeSession();
		const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
		sandbox.stub(service, 'getResumeTargets').returns(['extension', 'terminal']);
		(sandbox.stub(configuration, 'get') as sinon.SinonStub).withArgs('agents.resumeTarget').returns(null);
		stubResumeTargetPicker(sandbox, () => undefined);
		try {
			await resumeSession(service, 'claudeCode', 'sess-1', '/w', undefined, 'Session');

			assert.strictEqual(provider.resumeSessionCalls.length, 0);
		} finally {
			service.dispose();
			sandbox.restore();
		}
	});
});
