import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately: `system/-webview/command.ts` (pulled in by
// the service) imports `container.ts` as a value, and container's own import fan-out reaches the
// command classes whose `@command()` decorator reads a registry that module is still initializing.
// Letting container initialize first breaks the cycle; without it the bundle throws on load.
import '../../container.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Container } from '../../container.js';
import { AgentStatusService } from '../agentStatusService.js';
import type { AgentSession, AgentSessionProvider } from '../provider.js';

/**
 * Minimal stand-in for the provider contract — only the members {@link AgentStatusService}
 * actually touches. `sessions` is a plain array the test mutates, then `fire()` drives the same
 * `onDidChangeSessions` path the real provider uses.
 */
class TestProvider implements AgentSessionProvider {
	readonly id = 'claudeCode';
	readonly name = 'Claude Code';
	readonly icon = 'robot';

	private readonly _onDidChangeSessions = new Emitter<void>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	sessions: AgentSession[] = [];

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
function setup() {
	const provider = new TestProvider();
	const service = new AgentStatusService(makeContainer(), [provider], { registerCommands: false });
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
			provider.sessions = [{ ...session, status: 'completed', phase: 'completed' }];
			provider.fire();
			assert.strictEqual(published.length, 2);
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
});
