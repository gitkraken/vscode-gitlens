import * as assert from 'assert';
import type { IpcHandler } from '@gitlens/ipc/ipcServer.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type {
	EndedTranscriptDetails,
	ResumableTranscriptSessionListing,
	TranscriptSessionListing,
	TranscriptTitles,
} from '../providers/claudeCodeTranscript.js';
import { ClaudeCodeTranscriptReader } from '../providers/claudeCodeTranscript.js';
import { GkAgentProvider } from '../providers/gkAgentProvider.js';
import type { AgentProviderCallbacks, AgentSession, IpcRegistrar } from '../types.js';

type SyncDiscrepancy = { provider: string; discovered: number; missing: number; polled: number; tracked: number };

interface MockCallbacks {
	callbacks: AgentProviderCallbacks;
	handlers: Map<string, IpcHandler<unknown, unknown>>;
	publishedPaths: string[][];
	/** Every `runCLICommand` invocation's args, in order. Use {@link listSessionsCalls} to count
	 *  the `list-sessions` reconciliation calls specifically. */
	cliCalls: string[][];
	/** Every `onSyncDiscrepancy` report, in order. */
	syncDiscrepancies: SyncDiscrepancy[];
}

function createMockCallbacks(options?: {
	resolveGitInfo?: AgentProviderCallbacks['resolveGitInfo'];
	revealSession?: AgentProviderCallbacks['revealSession'];
	resumeSession?: AgentProviderCallbacks['resumeSession'];
	getActivityDecayMs?: AgentProviderCallbacks['getActivityDecayMs'];
	port?: number;
	address?: string;
	cliResponse?: string;
	archivedCliResponse?: string;
	liveAgentSessions?: {
		sessionId: string;
		pid?: number;
		cwd?: string;
		kind?: string;
		status?: string;
		state?: string;
		waitingFor?: string;
	}[];
}): MockCallbacks {
	const handlers = new Map<string, IpcHandler<unknown, unknown>>();
	const publishedPaths: string[][] = [];
	const cliCalls: string[][] = [];
	const syncDiscrepancies: SyncDiscrepancy[] = [];

	const ipc: IpcRegistrar = {
		port: options?.port ?? 1234,
		address: options?.address,
		registerHandler: <Request, Response>(name: string, handler: IpcHandler<Request, Response>) => {
			handlers.set(name, handler as unknown as IpcHandler<unknown, unknown>);
			return createDisposable(() => {
				handlers.delete(name);
			});
		},
		publishAgents: workspacePaths => {
			publishedPaths.push([...workspacePaths]);
			return Promise.resolve();
		},
		unpublishAgents: () => Promise.resolve(),
	};

	const callbacks: AgentProviderCallbacks = {
		ipc: ipc,
		runCLICommand: (args: string[]) => {
			cliCalls.push([...args]);
			if (args.includes('archived')) return Promise.resolve(options?.archivedCliResponse ?? '[]');
			return Promise.resolve(options?.cliResponse ?? '[]');
		},
		resolveGitInfo: options?.resolveGitInfo,
		revealSession: options?.revealSession,
		resumeSession: options?.resumeSession,
		onSyncDiscrepancy: info => {
			syncDiscrepancies.push(info);
		},
		getActivityDecayMs: options?.getActivityDecayMs,
		getLiveAgentSessions: async () => new Map((options?.liveAgentSessions ?? []).map(e => [e.sessionId, e])),
	};

	return {
		callbacks: callbacks,
		handlers: handlers,
		publishedPaths: publishedPaths,
		cliCalls: cliCalls,
		syncDiscrepancies: syncDiscrepancies,
	};
}

/** Counts the `list-sessions` reconciliation calls within recorded CLI invocations. */
function listSessionsCalls(cliCalls: string[][]): number {
	return cliCalls.filter(args => args.includes('list-sessions')).length;
}

/** Omit `providerId` to emulate an older CLI, which doesn't stamp it. */
function sessionStart(sessionId: string, cwd: string, providerId?: string): Record<string, unknown> {
	return {
		event: 'SessionStart',
		sessionId: sessionId,
		cwd: cwd,
		pid: process.pid,
		...(providerId != null ? { providerId: providerId } : undefined),
	};
}

/** A `list-sessions` poll entry (SessionFileData shape) for an alive session, used to exercise
 *  the reconciliation poll / discrepancy detection. `pid: process.pid` so it passes `isProcessAlive`. */
function sessionFileData(sessionId: string, cwd: string, providerId?: string): Record<string, unknown> {
	return {
		sessionId: sessionId,
		event: 'UserPromptSubmit',
		cwd: cwd,
		pid: process.pid,
		updatedAt: '2024-01-01T00:00:00.000Z',
		...(providerId != null ? { providerId: providerId } : undefined),
	};
}

/** Yield to the microtask queue so `void this.ensureIpcServer()` can finish its awaits
 *  (publishAgents / syncSessions) and `publishedPaths` is populated. */
function flushMicrotasks(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

/** Wait for a real timer to elapse — needed when exercising debounced state transitions. */
function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function preToolUse(sessionId: string, tool: string, filePath: string): Record<string, unknown> {
	return { event: 'PreToolUse', sessionId: sessionId, toolName: tool, toolInput: { file_path: filePath } };
}

function postToolUse(sessionId: string, tool: string, filePath: string): Record<string, unknown> {
	return { event: 'PostToolUse', sessionId: sessionId, toolName: tool, toolInput: { file_path: filePath } };
}

function stop(sessionId: string): Record<string, unknown> {
	return { event: 'Stop', sessionId: sessionId };
}

function sessionEnd(sessionId: string): Record<string, unknown> {
	return { event: 'SessionEnd', sessionId: sessionId };
}

function subagentStart(parentId: string, agentId: string): Record<string, unknown> {
	return { event: 'SubagentStart', sessionId: parentId, agentId: agentId, agentType: 'Task' };
}

function subagentStop(parentId: string, agentId: string): Record<string, unknown> {
	return { event: 'SubagentStop', sessionId: parentId, agentId: agentId };
}

/** Returns a session's `fileActivity` (or `[]` when the session/array is absent). */
function fileActivityOf(provider: GkAgentProvider, sessionId: string): NonNullable<AgentSession['fileActivity']> {
	return provider.sessions.find(s => s.id === sessionId)?.fileActivity ?? [];
}

suite('GkAgentProvider', () => {
	suite('initialCwd from the CLI', () => {
		test('uses the CLI-provided initialCwd and keeps it stable across cwd drift', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				const handler = handlers.get('agents/session')!;
				// SessionStart where the launch dir differs from the live cwd (e.g. the window
				// cold-joined after the agent had already drifted into a subdir).
				await handler(
					{ event: 'SessionStart', sessionId: 's', cwd: '/repo/sub', initialCwd: '/repo', pid: process.pid },
					new URLSearchParams(),
				);
				let session = provider.sessions.find(x => x.id === 's');
				assert.strictEqual(
					session?.initialCwd,
					'/repo',
					'initialCwd should come from the CLI field, not the live cwd',
				);
				assert.strictEqual(session?.cwd, '/repo/sub');

				// A later event with yet another cwd must not move the (authoritative, stable) initialCwd.
				await handler(
					{ event: 'PreToolUse', sessionId: 's', cwd: '/repo/other', initialCwd: '/repo', toolName: 'Read' },
					new URLSearchParams(),
				);
				session = provider.sessions.find(x => x.id === 's');
				assert.strictEqual(session?.initialCwd, '/repo', 'initialCwd stays stable as the agent drifts');
				assert.strictEqual(session?.cwd, '/repo/other', 'cwd tracks the live value');
			} finally {
				provider.dispose();
			}
		});

		test('falls back to the first-seen cwd when the CLI omits initialCwd (older CLI)', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				const handler = handlers.get('agents/session')!;
				// No initialCwd field at all — graceful degradation to the prior behavior.
				await handler(
					{ event: 'SessionStart', sessionId: 's', cwd: '/repo', pid: process.pid },
					new URLSearchParams(),
				);
				const session = provider.sessions.find(x => x.id === 's');
				assert.strictEqual(
					session?.initialCwd,
					'/repo',
					'initialCwd backfills from the first-seen cwd when absent',
				);
			} finally {
				provider.dispose();
			}
		});
	});

	suite('fileActivity & decay tail', () => {
		const REPO = '/repo';
		const FILE = '/repo/src/foo.ts';

		/** Drives a started provider with the `agents/session` IPC handler bound. */
		async function startSession(
			provider: GkAgentProvider,
			handlers: MockCallbacks['handlers'],
			sessionId: string,
		): Promise<(body: Record<string, unknown>) => Promise<void>> {
			provider.start([REPO]);
			const handler = handlers.get('agents/session');
			assert.ok(handler != null, 'agents/session handler should be registered');
			const send = async (body: Record<string, unknown>): Promise<void> => {
				await handler(body, new URLSearchParams());
			};
			await send(sessionStart(sessionId, REPO));
			return send;
		}

		test('PreToolUse on an edit tool marks the file editing with a fresh editedAt', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));

				const entry = fileActivityOf(provider, 'sess').find(e => e.path === FILE);
				assert.ok(entry != null, 'edited file should appear in fileActivity');
				assert.strictEqual(entry.editing, true, 'in-flight edit should set editing=true');
				assert.strictEqual(entry.reading, undefined, 'a pure edit should not set reading');
				assert.ok(
					typeof entry.editedAt === 'number' && entry.editedAt >= 0,
					'editedAt should be a non-negative delta',
				);
			} finally {
				provider.dispose();
			}
		});

		test('PostToolUse flips editing off but retains the file as a cooling tail', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));

				const entry = fileActivityOf(provider, 'sess').find(e => e.path === FILE);
				assert.ok(entry != null, 'cooling file should still be present after PostToolUse');
				assert.strictEqual(entry.editing, undefined, 'editing flag should drop the moment the tool finishes');
				assert.ok(typeof entry.editedAt === 'number', 'editedAt should remain so the file can fade');
			} finally {
				provider.dispose();
			}
		});

		test('a read+edit on the same file carries both kinds', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Read', FILE));
				await send(preToolUse('sess', 'Edit', FILE));

				const entry = fileActivityOf(provider, 'sess').find(e => e.path === FILE);
				assert.ok(entry != null, 'read+edit file should be present');
				assert.strictEqual(entry.reading, true, 'reading should be set while the read tool is in flight');
				assert.strictEqual(entry.editing, true, 'editing should be set while the edit tool is in flight');
				assert.ok(
					typeof entry.readAt === 'number' && typeof entry.editedAt === 'number',
					'both timestamps present',
				);
			} finally {
				provider.dispose();
			}
		});

		test('Stop preserves the cooling decay tail rather than wiping it', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				await send(stop('sess'));

				const entry = fileActivityOf(provider, 'sess').find(e => e.path === FILE);
				assert.ok(entry != null, 'the decay tail must survive the turn-end Stop');
				assert.strictEqual(entry.editing, undefined, 'Stop should leave the file cooling, not live');
			} finally {
				provider.dispose();
			}
		});

		test('Stop force-finishes an in-flight file: drops the live flag, keeps the fading tail', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				// PreToolUse with no matching PostToolUse before Stop (turn ended mid-tool).
				await send(preToolUse('sess', 'Edit', FILE));
				await send(stop('sess'));

				const entry = fileActivityOf(provider, 'sess').find(e => e.path === FILE);
				assert.ok(entry != null, 'an in-flight file should remain as a fading tail after Stop');
				assert.strictEqual(
					entry.editing,
					undefined,
					'Stop must clear the stuck live flag (no permanent pulse)',
				);
			} finally {
				provider.dispose();
			}
		});

		test('a cooling file is evicted once the decay window elapses', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 50 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				await wait(200);

				assert.strictEqual(
					fileActivityOf(provider, 'sess').find(e => e.path === FILE),
					undefined,
					'file should be dropped after the decay window',
				);
			} finally {
				provider.dispose();
			}
		});

		test('the tail survives Stop and still evicts after the window', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 50 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				await send(stop('sess'));
				// Immediately after Stop the tail is still present...
				assert.ok(
					fileActivityOf(provider, 'sess').some(e => e.path === FILE),
					'tail present right after Stop',
				);
				// ...and the per-file cooldown (unaffected by Stop) still evicts it.
				await wait(200);
				assert.strictEqual(
					fileActivityOf(provider, 'sess').find(e => e.path === FILE),
					undefined,
					'tail should fade out after the window even though Stop fired',
				);
			} finally {
				provider.dispose();
			}
		});

		test('SessionEnd completes the session and freezes its file activity instead of wiping it', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				await send(sessionEnd('sess'));

				const session = provider.sessions.find(s => s.id === 'sess');
				assert.ok(session != null, 'SessionEnd keeps the session as a terminal ended row');
				assert.strictEqual(session.status, 'ended');
				assert.ok(
					fileActivityOf(provider, 'sess').some(e => e.path === FILE),
					'a finished session must keep its last file-activity snapshot, not wipe it',
				);
			} finally {
				provider.dispose();
			}
		});

		test('a pending decay timer that fires after SessionEnd does not clear the frozen file activity', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 50 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				// The decay timer (50ms) is still pending when the session ends.
				await send(sessionEnd('sess'));

				// Let the decay window elapse — if the timer still fires and re-syncs, it would
				// either wipe the entry or resurrect bookkeeping for an ended session.
				await wait(200);

				const session = provider.sessions.find(s => s.id === 'sess');
				assert.strictEqual(session?.status, 'ended');
				assert.ok(
					fileActivityOf(provider, 'sess').some(e => e.path === FILE),
					'a decay timer firing after SessionEnd must not mutate the frozen file activity',
				);
			} finally {
				provider.dispose();
			}
		});

		test('SubagentStop removes the sub-agent without disturbing the parent decay tail', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new GkAgentProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'parent');
				await send(preToolUse('parent', 'Edit', FILE));
				await send(postToolUse('parent', 'Edit', FILE));
				await send(subagentStart('parent', 'sub'));
				assert.ok(
					provider.sessions.find(s => s.id === 'parent')?.subagents?.some(a => a.id === 'sub'),
					'sub-agent should be attached to the parent',
				);

				await send(subagentStop('parent', 'sub'));

				const parent = provider.sessions.find(s => s.id === 'parent');
				assert.ok(parent != null, 'parent session should remain after SubagentStop');
				assert.ok(
					(parent.subagents ?? []).every(a => a.id !== 'sub'),
					'the stopped sub-agent should be removed from the parent',
				);
				assert.ok(
					parent.fileActivity?.some(e => e.path === FILE),
					"the parent's decay tail must be untouched by SubagentStop",
				);
			} finally {
				provider.dispose();
			}
		});
	});

	suite('workspace path normalization', () => {
		test('start() forwards normalized paths to publishAgents', async () => {
			const { callbacks, publishedPaths } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['d:\\PROJ\\GKGL\\vscode-gitlens']);
				await flushMicrotasks();

				assert.deepStrictEqual(publishedPaths[0], ['d:/PROJ/GKGL/vscode-gitlens']);
			} finally {
				provider.dispose();
			}
		});

		test('SessionStart with backslash cwd inside a backslash workspace yields a normalized session.workspacePath', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['d:\\PROJ\\GKGL\\vscode-gitlens']);

				const handler = handlers.get('agents/session');
				assert.ok(handler != null, 'agents/session handler should be registered');

				await handler(sessionStart('sess-1', 'd:\\PROJ\\GKGL\\vscode-gitlens\\src'), new URLSearchParams());

				assert.strictEqual(provider.sessions.length, 1);
				assert.strictEqual(provider.sessions[0].workspacePath, 'd:/PROJ/GKGL/vscode-gitlens');
				assert.strictEqual(provider.sessions[0].isInWorkspace, true);
			} finally {
				provider.dispose();
			}
		});

		test('SessionStart with backslash cwd matches a forward-slash workspace path', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['d:/PROJ/GKGL/vscode-gitlens']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('sess-1', 'd:\\PROJ\\GKGL\\vscode-gitlens\\src'), new URLSearchParams());

				assert.strictEqual(provider.sessions[0].workspacePath, 'd:/PROJ/GKGL/vscode-gitlens');
				assert.strictEqual(provider.sessions[0].isInWorkspace, true);
			} finally {
				provider.dispose();
			}
		});

		test('SessionStart with cwd outside any workspace path yields isInWorkspace=false', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/home/user/projectA']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('sess-1', '/home/user/projectB'), new URLSearchParams());

				assert.strictEqual(provider.sessions[0].workspacePath, undefined);
				assert.strictEqual(provider.sessions[0].isInWorkspace, false);
			} finally {
				provider.dispose();
			}
		});

		test('an ordinary event carrying a new cwd re-resolves the worktree', async () => {
			// An agent that moves into another worktree keeps sending its live cwd on every event,
			// but the CLI does not always announce the move with `CwdChanged` — and a window that
			// started after the move never saw one at all. Resolving git info only when it is
			// missing pins the session to its launch repo, so its real worktree's WIP row shows no
			// agents.
			const repo = '/repo';
			const worktree = '/repo.worktrees/feature';
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: (cwd: string) =>
					Promise.resolve(
						cwd === worktree
							? { repoRoot: repo, worktreePath: worktree, isWorktree: true }
							: { repoRoot: repo, worktreePath: repo, isWorktree: false },
					),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([repo]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', repo), new URLSearchParams());
				await flushMicrotasks();
				assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.worktreePath, repo);

				// No CwdChanged — just a normal tool event that happens to carry the new cwd.
				await handler(
					{ event: 'PreToolUse', sessionId: 's1', cwd: worktree, toolName: 'Read' },
					new URLSearchParams(),
				);
				await flushMicrotasks();
				await flushMicrotasks();

				const s = provider.sessions.find(x => x.id === 's1')!;
				assert.strictEqual(s.cwd, worktree, 'the live cwd tracks the move');
				assert.strictEqual(s.worktreePath, worktree, 'the worktree must follow the cwd, not the launch dir');
			} finally {
				provider.dispose();
			}
		});

		test('an event carrying a cwdTimeline entry seats worktreePath synchronously, ahead of the git probe', async () => {
			const repo = '/repo';
			const { callbacks, handlers } = createMockCallbacks({
				// Never resolves — proves the assertion below doesn't depend on the probe completing.
				resolveGitInfo: () => new Promise(() => {}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([repo]);
				const handler = handlers.get('agents/session')!;
				await handler(
					{
						event: 'SessionStart',
						sessionId: 's1',
						cwd: repo,
						pid: process.pid,
						cwdTimeline: [{ cwd: repo, worktree: repo }],
					},
					new URLSearchParams(),
				);

				const s = provider.sessions.find(x => x.id === 's1');
				assert.strictEqual(
					s?.worktreePath,
					repo,
					'worktreePath comes from the event, not the (still-pending) probe',
				);
			} finally {
				provider.dispose();
			}
		});

		test('a cwd-move event carrying a timeline entry for the new cwd updates worktreePath without waiting for the probe', async () => {
			const repo = '/repo';
			const worktree = '/repo.worktrees/feature';
			const { callbacks, handlers } = createMockCallbacks({
				// Never resolves — proves the update below doesn't depend on the probe completing.
				resolveGitInfo: () => new Promise(() => {}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([repo]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', repo), new URLSearchParams());

				// No CwdChanged — an ordinary event carries the new cwd, with the CLI's own resolution
				// for it already attached.
				await handler(
					{
						event: 'PreToolUse',
						sessionId: 's1',
						cwd: worktree,
						toolName: 'Read',
						cwdTimeline: [
							{ cwd: repo, worktree: repo },
							{ cwd: worktree, worktree: worktree },
						],
					},
					new URLSearchParams(),
				);

				const s = provider.sessions.find(x => x.id === 's1');
				assert.strictEqual(s?.cwd, worktree, 'the live cwd tracks the move');
				assert.strictEqual(
					s?.worktreePath,
					worktree,
					'worktreePath follows the event timeline, not a pending probe',
				);
			} finally {
				provider.dispose();
			}
		});

		test('an event carrying a cwdTimeline with two distinct worktrees records both as visited', async () => {
			const repo = '/repo';
			const worktree = '/repo.worktrees/feature';
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () => new Promise(() => {}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([repo]);
				const handler = handlers.get('agents/session')!;
				await handler(
					{
						event: 'SessionStart',
						sessionId: 's1',
						cwd: worktree,
						pid: process.pid,
						cwdTimeline: [
							{ cwd: repo, worktree: repo },
							{ cwd: worktree, worktree: worktree },
						],
					},
					new URLSearchParams(),
				);

				const s = provider.sessions.find(x => x.id === 's1');
				assert.strictEqual(s?.worktreePath, worktree, 'worktreePath matches the timeline entry for event.cwd');
				assert.deepStrictEqual(
					[...(s?.visitedWorktreePaths ?? [])].sort(),
					[repo, worktree].sort(),
					'both worktrees from the timeline are recorded as visited',
				);
			} finally {
				provider.dispose();
			}
		});

		test('two events carrying the same cwdTimeline do not reallocate visitedWorktreePaths', async () => {
			const repo = '/repo';
			const worktree = '/repo.worktrees/feature';
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () => new Promise(() => {}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([repo]);
				const handler = handlers.get('agents/session')!;
				const timeline = [
					{ cwd: repo, worktree: repo },
					{ cwd: worktree, worktree: worktree },
				];
				await handler(
					{ event: 'SessionStart', sessionId: 's1', cwd: worktree, pid: process.pid, cwdTimeline: timeline },
					new URLSearchParams(),
				);
				const afterFirst = provider.sessions.find(x => x.id === 's1')?.visitedWorktreePaths;

				await handler(
					{ event: 'PreToolUse', sessionId: 's1', cwd: worktree, toolName: 'Read', cwdTimeline: timeline },
					new URLSearchParams(),
				);
				const afterSecond = provider.sessions.find(x => x.id === 's1')?.visitedWorktreePaths;

				assert.ok(
					Object.is(afterFirst, afterSecond),
					'visitedWorktreePaths reference is unchanged when nothing new was visited',
				);
			} finally {
				provider.dispose();
			}
		});

		test('a revisit reorders visitedWorktreePaths to recency, and a repeat of the same timeline does not reallocate', async () => {
			const a = '/repo';
			const b = '/repo.worktrees/feature';
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () => new Promise(() => {}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([a]);
				const handler = handlers.get('agents/session')!;
				// A → B → A within a single timeline: A is revisited last, so it ends up most recent.
				const timeline = [
					{ cwd: a, worktree: a },
					{ cwd: b, worktree: b },
					{ cwd: a, worktree: a },
				];
				await handler(
					{ event: 'SessionStart', sessionId: 's1', cwd: a, pid: process.pid, cwdTimeline: timeline },
					new URLSearchParams(),
				);

				const afterFirst = provider.sessions.find(x => x.id === 's1')?.visitedWorktreePaths;
				assert.deepStrictEqual(
					afterFirst,
					[b, a],
					'the revisited worktree (A) sorts last as the most recently observed',
				);

				await handler(
					{ event: 'PreToolUse', sessionId: 's1', cwd: a, toolName: 'Read', cwdTimeline: timeline },
					new URLSearchParams(),
				);
				const afterSecond = provider.sessions.find(x => x.id === 's1')?.visitedWorktreePaths;

				assert.ok(
					Object.is(afterFirst, afterSecond),
					'visitedWorktreePaths reference is unchanged when the repeated timeline reproduces the same order',
				);
			} finally {
				provider.dispose();
			}
		});

		test('a cwd move keeps both the old and new worktree in visitedWorktreePaths while worktreePath reflects only the new one', async () => {
			const repo = '/repo';
			const worktree = '/repo.worktrees/feature';
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () => new Promise(() => {}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([repo]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', repo), new URLSearchParams());

				await handler(
					{
						event: 'PreToolUse',
						sessionId: 's1',
						cwd: worktree,
						toolName: 'Read',
						cwdTimeline: [
							{ cwd: repo, worktree: repo },
							{ cwd: worktree, worktree: worktree },
						],
					},
					new URLSearchParams(),
				);

				const s = provider.sessions.find(x => x.id === 's1');
				assert.strictEqual(s?.worktreePath, worktree, 'worktreePath (current) reflects only the new worktree');
				assert.deepStrictEqual(
					[...(s?.visitedWorktreePaths ?? [])].sort(),
					[repo, worktree].sort(),
					'visitedWorktreePaths retains both the old and new worktree after the move',
				);
			} finally {
				provider.dispose();
			}
		});

		test('a git probe superseded by a newer cwd does not overwrite the newer location', async () => {
			// The in-flight guard dedupes by session, so a probe started for the OLD cwd is still
			// running when a correction for a NEW one arrives (e.g. the durable ended record fixing a
			// missed CwdChanged). Its answer describes a directory the session has left, so it must be
			// discarded — and the newer cwd must still get resolved rather than swallowed by the dedupe.
			const oldCwd = '/repo/old';
			const newCwd = '/repo/new';
			type GitInfo = Awaited<ReturnType<NonNullable<AgentProviderCallbacks['resolveGitInfo']>>>;
			const settle = new Map<string, (info: GitInfo) => void>();
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: (cwd: string) =>
					new Promise<GitInfo>(resolve => {
						settle.set(cwd, resolve);
					}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([oldCwd]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', oldCwd), new URLSearchParams());
				await flushMicrotasks();
				assert.ok(settle.has(oldCwd), 'the first probe should be in flight');

				// Correction arrives while the first probe is still outstanding.
				const internals = provider as unknown as { resolveGitInfo(id: string, cwd: string): Promise<void> };
				void internals.resolveGitInfo('s1', newCwd);

				// The stale probe lands first, then the queued one.
				settle.get(oldCwd)!({ repoRoot: '/repo/old', worktreePath: oldCwd, isWorktree: false });
				await flushMicrotasks();
				await flushMicrotasks();
				assert.ok(settle.has(newCwd), 'the superseding cwd must actually be probed, not dropped');
				settle.get(newCwd)!({ repoRoot: '/repo/new', worktreePath: newCwd, isWorktree: false });
				await flushMicrotasks();

				const s = provider.sessions.find(x => x.id === 's1')!;
				assert.strictEqual(s.cwd, newCwd, 'the newer cwd must win');
				assert.strictEqual(s.commonPath, '/repo/new', 'the stale probe must not restore the old repo');
			} finally {
				provider.dispose();
			}
		});

		test('resolveGitInfo sets commonPath when cwd is outside any workspace folder', async () => {
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () =>
					Promise.resolve({
						branch: 'main',
						repoRoot: 'd:/PROJ/GKGL/vscode-gitlens',
						isWorktree: false,
					}),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/home/user/projectA']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('sess-1', 'd:\\PROJ\\GKGL\\vscode-gitlens\\src'), new URLSearchParams());
				await flushMicrotasks();

				// `workspacePath` stays undefined — no workspace folder matched the cwd. The
				// session's repo identity flows through `commonPath` (= info.repoRoot), so
				// downstream consumers can still associate the session with its repo.
				assert.strictEqual(provider.sessions[0].workspacePath, undefined);
				assert.strictEqual(provider.sessions[0].isInWorkspace, false);
				assert.strictEqual(provider.sessions[0].commonPath, 'd:/PROJ/GKGL/vscode-gitlens');
			} finally {
				provider.dispose();
			}
		});

		test('a scratch cwd with a CLI-seated worktree resolves commonPath from the worktree root', async () => {
			// The cwd itself (e.g. /tmp/x) isn't a repo, but the CLI attributed the session to a real
			// worktree via cwdTimeline. Without a fallback probe of that worktree, commonPath would
			// stay permanently unresolved even though the session's repo identity is knowable.
			const worktree = '/repo/main';
			const scratch = '/tmp/scratch';
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: (cwd: string) =>
					Promise.resolve(
						cwd === worktree
							? { repoRoot: worktree, worktreePath: worktree, isWorktree: false }
							: undefined,
					),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([worktree]);
				const handler = handlers.get('agents/session')!;
				await handler(
					{
						event: 'SessionStart',
						sessionId: 's1',
						cwd: scratch,
						pid: process.pid,
						cwdTimeline: [{ cwd: scratch, worktree: worktree }],
					},
					new URLSearchParams(),
				);
				await flushMicrotasks();
				await flushMicrotasks();

				const s = provider.sessions.find(x => x.id === 's1');
				assert.strictEqual(s?.worktreePath, worktree, 'the CLI-seated worktree is kept, not overwritten');
				assert.strictEqual(s?.commonPath, worktree, 'commonPath comes from probing the worktree root');
				assert.strictEqual(s?.initialCommonPath, worktree);
				assert.strictEqual(s?.cwd, scratch, 'cwd stays the live scratch dir');
			} finally {
				provider.dispose();
			}
		});

		test('a transient git probe failure does not latch gitInfoUnresolvable, so the next event retries', async () => {
			let calls = 0;
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () => {
					calls++;
					if (calls === 1) return Promise.reject(new Error('git not available'));

					return Promise.resolve({ repoRoot: '/repo', worktreePath: '/repo', isWorktree: false });
				},
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/repo'), new URLSearchParams());
				await flushMicrotasks();
				assert.strictEqual(
					provider.sessions.find(x => x.id === 's1')?.commonPath,
					undefined,
					'the transient failure resolves nothing yet',
				);

				// A follow-up hook event, same cwd — must retry rather than staying stuck.
				await handler(
					{ event: 'PreToolUse', sessionId: 's1', cwd: '/repo', toolName: 'Read' },
					new URLSearchParams(),
				);
				await flushMicrotasks();
				await flushMicrotasks();

				assert.ok(calls >= 2, 'the follow-up event must retry the probe');
				assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.commonPath, '/repo');
			} finally {
				provider.dispose();
			}
		});

		test('a confirmed non-repo cwd with no worktree attribution latches gitInfoUnresolvable after one probe', async () => {
			let calls = 0;
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () => {
					calls++;
					return Promise.resolve(undefined);
				},
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/tmp/nogit'), new URLSearchParams());
				await flushMicrotasks();

				await handler(
					{ event: 'PreToolUse', sessionId: 's1', cwd: '/tmp/nogit', toolName: 'Read' },
					new URLSearchParams(),
				);
				await flushMicrotasks();
				await handler(
					{ event: 'PostToolUse', sessionId: 's1', cwd: '/tmp/nogit', toolName: 'Read' },
					new URLSearchParams(),
				);
				await flushMicrotasks();

				assert.strictEqual(calls, 1, 'no retry storm for a confirmed non-repo cwd');
				assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.commonPath, undefined);
			} finally {
				provider.dispose();
			}
		});

		test('updateWorkspacePaths normalizes and re-publishes', async () => {
			const { callbacks, publishedPaths } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/home/user/projectA']);
				await flushMicrotasks();

				provider.updateWorkspacePaths(['d:\\PROJ\\GKGL\\vscode-gitlens']);
				await flushMicrotasks();

				assert.deepStrictEqual(publishedPaths.at(-1), ['d:/PROJ/GKGL/vscode-gitlens']);
			} finally {
				provider.dispose();
			}
		});
	});

	suite('transcript titles', () => {
		test('SessionStart triggers a transcript read and titles land on the session', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const reader = new StubTranscriptReader({ ai: 'AI-derived title' });
			const provider = new TestProvider(callbacks, reader);
			try {
				provider.start(['/repo']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s-trans-1', '/repo'), new URLSearchParams());
				await flushMicrotasks();

				assert.strictEqual(provider.sessions[0].transcriptTitles?.ai, 'AI-derived title');
				assert.strictEqual(provider.sessions[0].transcriptTitles?.custom, undefined);
				assert.strictEqual(provider.sessions[0].transcriptTitles?.agent, undefined);
				assert.ok(
					reader.calls.some(c => c.sessionId === 's-trans-1'),
					'reader should be called for the new session',
				);
			} finally {
				provider.dispose();
			}
		});

		test('idle transition (e.g. Stop) triggers a re-check', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const reader = new StubTranscriptReader({});
			const provider = new TestProvider(callbacks, reader);
			try {
				provider.start(['/repo']);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s-trans-2', '/repo'), new URLSearchParams());
				await flushMicrotasks();
				const initialCalls = reader.calls.filter(c => c.sessionId === 's-trans-2').length;

				// Move to a non-idle state.
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's-trans-2',
						cwd: '/repo',
						pid: process.pid,
						prompt: 'hello',
						firstPrompt: 'hello',
					},
					new URLSearchParams(),
				);
				await flushMicrotasks();

				// Reader should NOT have been invoked again (still non-idle).
				const afterPromptCalls = reader.calls.filter(c => c.sessionId === 's-trans-2').length;
				assert.strictEqual(
					afterPromptCalls,
					initialCalls,
					'non-idle status changes should not re-read transcript',
				);

				// Now Stop the session — schedules a debounced transition back to idle.
				reader.titles = { ai: 'After-stop title' };
				await handler(
					{ event: 'Stop', sessionId: 's-trans-2', cwd: '/repo', pid: process.pid },
					new URLSearchParams(),
				);
				// The Stop → idle transition is debounced (stopToIdleDebounceMs). Wait past the
				// debounce window plus a microtask flush for the resolveTranscriptTitles promise.
				await wait(900);
				await flushMicrotasks();

				const afterStopCalls = reader.calls.filter(c => c.sessionId === 's-trans-2').length;
				assert.strictEqual(afterStopCalls, initialCalls + 1, 'idle transition should re-read transcript');
				assert.strictEqual(provider.sessions[0].transcriptTitles?.ai, 'After-stop title');
			} finally {
				provider.dispose();
			}
		});

		test('SessionEnd calls forget on the reader', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const reader = new StubTranscriptReader({});
			const provider = new TestProvider(callbacks, reader);
			try {
				provider.start(['/repo']);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s-trans-3', '/repo'), new URLSearchParams());
				await flushMicrotasks();

				await handler(
					{ event: 'SessionEnd', sessionId: 's-trans-3', cwd: '/repo', pid: process.pid },
					new URLSearchParams(),
				);

				assert.deepStrictEqual(reader.forgotten, ['s-trans-3']);
			} finally {
				provider.dispose();
			}
		});
	});

	suite('firstPrompt propagation', () => {
		test('first non-empty UserPromptSubmit populates firstPrompt', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/repo'), new URLSearchParams());
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt: 'what is 2+2?',
						firstPrompt: 'what is 2+2?',
					},
					new URLSearchParams(),
				);

				assert.strictEqual(provider.sessions[0].firstPrompt, 'what is 2+2?');
				assert.strictEqual(provider.sessions[0].lastPrompt, 'what is 2+2?');
			} finally {
				provider.dispose();
			}
		});

		test('IDE-prefixed prompts are stripped before storing as lastPrompt', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/repo'), new URLSearchParams());
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt:
							'<ide_opened_file>The user opened the file /repo/foo.ts in the IDE. ' +
							'This may or may not be related to the current task.</ide_opened_file>\n' +
							'/investigate sky color',
					},
					new URLSearchParams(),
				);

				assert.strictEqual(provider.sessions[0].lastPrompt, '/investigate sky color');
			} finally {
				provider.dispose();
			}
		});

		test('rehydrated sessions from syncSessions have prompts sanitized', async () => {
			const sessionPayload = [
				{
					sessionId: 'sync-1',
					cwd: '/repo',
					pid: process.pid,
					event: 'UserPromptSubmit',
					updatedAt: new Date().toISOString(),
					prompt: '<task-notification><status>completed</status><summary>done</summary></task-notification>',
					firstPrompt:
						'<ide_opened_file>The user opened /repo/foo.ts</ide_opened_file>\n' +
						'investigate the failing test',
				},
			];
			const { callbacks } = createMockCallbacks();
			const provider = new GkAgentProvider({
				...callbacks,
				runCLICommand: () => Promise.resolve(JSON.stringify(sessionPayload)),
			});
			try {
				provider.start(['/repo']);
				await flushMicrotasks();
				await flushMicrotasks();

				const session = provider.sessions.find(s => s.id === 'sync-1');
				assert.ok(session, 'session sync-1 should be rehydrated');
				assert.strictEqual(
					session.lastPrompt,
					undefined,
					'pure task-notification payload must not surface as lastPrompt',
				);
				assert.strictEqual(
					session.firstPrompt,
					'investigate the failing test',
					'IDE wrapper must be stripped from rehydrated firstPrompt',
				);
			} finally {
				provider.dispose();
			}
		});

		test('background-bash task-notification prompts do not overwrite the previous lastPrompt', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/repo'), new URLSearchParams());
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt: 'Run a background bash command that prints the date every 5 seconds',
						firstPrompt: 'Run a background bash command that prints the date every 5 seconds',
					},
					new URLSearchParams(),
				);
				const statusBefore = provider.sessions[0].status;
				const statusDetailBefore = provider.sessions[0].statusDetail;
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt:
							'<task-notification>\n' +
							'<task-id>b3b6icuho</task-id>\n' +
							'<tool-use-id>toolu_01FEnSf5</tool-use-id>\n' +
							'<output-file>/tmp/.../b3b6icuho.output</output-file>\n' +
							'<status>completed</status>\n' +
							'<summary>Background command completed (exit code 0)</summary>\n' +
							'</task-notification>',
					},
					new URLSearchParams(),
				);

				assert.strictEqual(
					provider.sessions[0].status,
					statusBefore,
					'synthetic task-notification must not transition session status',
				);
				assert.strictEqual(
					provider.sessions[0].statusDetail,
					statusDetailBefore,
					'synthetic task-notification must not change statusDetail',
				);
				assert.strictEqual(
					provider.sessions[0].lastPrompt,
					'Run a background bash command that prints the date every 5 seconds',
					'task-notification synthetic prompt must not overwrite real lastPrompt',
				);
			} finally {
				provider.dispose();
			}
		});

		test('prompts that are nothing but IDE context do not overwrite the previous lastPrompt', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/repo'), new URLSearchParams());
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt: 'what is 2+2?',
						firstPrompt: 'what is 2+2?',
					},
					new URLSearchParams(),
				);
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt: '<ide_opened_file>just context, no prompt</ide_opened_file>',
					},
					new URLSearchParams(),
				);

				assert.strictEqual(provider.sessions[0].firstPrompt, 'what is 2+2?');
				assert.strictEqual(
					provider.sessions[0].lastPrompt,
					'what is 2+2?',
					'IDE-context-only prompt must not overwrite real lastPrompt',
				);
			} finally {
				provider.dispose();
			}
		});

		test('subsequent UserPromptSubmit preserves firstPrompt and updates lastPrompt', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);

				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('s1', '/repo'), new URLSearchParams());
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt: 'what is 2+2?',
						firstPrompt: 'what is 2+2?',
					},
					new URLSearchParams(),
				);
				await handler(
					{
						event: 'UserPromptSubmit',
						sessionId: 's1',
						cwd: '/repo',
						pid: process.pid,
						prompt: 'now do logging',
						firstPrompt: 'what is 2+2?',
					},
					new URLSearchParams(),
				);

				assert.strictEqual(
					provider.sessions[0].firstPrompt,
					'what is 2+2?',
					'firstPrompt must remain the first value',
				);
				assert.strictEqual(provider.sessions[0].lastPrompt, 'now do logging');
			} finally {
				provider.dispose();
			}
		});
	});

	suite('agents/sessions/open IPC handler', () => {
		test('invokes the host callback with the requested sessionId and reports opened: true', async () => {
			const calls: string[] = [];
			const { callbacks, handlers } = createMockCallbacks({
				revealSession: sessionId => {
					calls.push(sessionId);
					return Promise.resolve(true);
				},
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				await flushMicrotasks();

				const handler = handlers.get('agents/sessions/open');
				assert.ok(handler != null, 'agents/sessions/open handler should be registered');

				const response = await handler({ sessionId: 'sess-1' }, new URLSearchParams());
				assert.deepStrictEqual(calls, ['sess-1']);
				assert.deepStrictEqual(response, { opened: true });
			} finally {
				provider.dispose();
			}
		});

		test('returns { opened: false } when the callback resolves false', async () => {
			const { callbacks, handlers } = createMockCallbacks({
				revealSession: () => Promise.resolve(false),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				await flushMicrotasks();

				const handler = handlers.get('agents/sessions/open')!;
				const response = await handler({ sessionId: 'sess-1' }, new URLSearchParams());
				assert.deepStrictEqual(response, { opened: false });
			} finally {
				provider.dispose();
			}
		});

		test('returns { opened: false } without invoking the callback when sessionId is missing', async () => {
			let called = false;
			const { callbacks, handlers } = createMockCallbacks({
				revealSession: () => {
					called = true;
					return Promise.resolve(true);
				},
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				await flushMicrotasks();

				const handler = handlers.get('agents/sessions/open')!;
				const response = await handler({}, new URLSearchParams());
				assert.strictEqual(called, false, 'callback must not run when sessionId is absent');
				assert.deepStrictEqual(response, { opened: false });
			} finally {
				provider.dispose();
			}
		});

		test('returns { opened: false } when the host did not wire revealSession', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				await flushMicrotasks();

				const handler = handlers.get('agents/sessions/open')!;
				const response = await handler({ sessionId: 'sess-1' }, new URLSearchParams());
				assert.deepStrictEqual(response, { opened: false });
			} finally {
				provider.dispose();
			}
		});

		test('returns { opened: false } when the callback throws (peer never sees a 500)', async () => {
			const { callbacks, handlers } = createMockCallbacks({
				revealSession: () => Promise.reject(new Error('extension not installed')),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start(['/repo']);
				await flushMicrotasks();

				const handler = handlers.get('agents/sessions/open')!;
				const response = await handler({ sessionId: 'sess-1' }, new URLSearchParams());
				assert.deepStrictEqual(response, { opened: false });
			} finally {
				provider.dispose();
			}
		});
	});

	suite('relayOpenSession', () => {
		test('spawns the CLI with sessionId, path, exclude-address, and --json', async () => {
			const { callbacks, cliCalls } = createMockCallbacks({
				address: 'http://127.0.0.1:9999',
				cliResponse: JSON.stringify({ delivered: true }),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				const delivered = await provider.relayOpenSession('sess-1', '/repo');
				assert.deepStrictEqual(cliCalls, [
					[
						'ai',
						'hook',
						'open-session',
						'sess-1',
						'--path',
						'/repo',
						'--exclude-address',
						'http://127.0.0.1:9999',
						'--json',
					],
				]);
				assert.strictEqual(delivered, true);
			} finally {
				provider.dispose();
			}
		});

		test('omits --exclude-address when the own address is unavailable', async () => {
			const { callbacks, cliCalls } = createMockCallbacks({
				cliResponse: JSON.stringify({ delivered: true }),
			});
			const provider = new GkAgentProvider(callbacks);
			try {
				await provider.relayOpenSession('sess-2', '/repo');
				assert.deepStrictEqual(cliCalls, [
					['ai', 'hook', 'open-session', 'sess-2', '--path', '/repo', '--json'],
				]);
			} finally {
				provider.dispose();
			}
		});

		test('parses { delivered: false } from the CLI as false', async () => {
			const { callbacks } = createMockCallbacks({ cliResponse: JSON.stringify({ delivered: false }) });
			const provider = new GkAgentProvider(callbacks);
			try {
				const delivered = await provider.relayOpenSession('sess-3', '/repo');
				assert.strictEqual(delivered, false);
			} finally {
				provider.dispose();
			}
		});

		test('returns false without throwing when the CLI predates the open-session command', async () => {
			const { callbacks } = createMockCallbacks();
			callbacks.runCLICommand = () => Promise.reject(new Error('unknown command: open-session'));
			const provider = new GkAgentProvider(callbacks);
			try {
				const delivered = await provider.relayOpenSession('sess-4', '/repo');
				assert.strictEqual(delivered, false);
			} finally {
				provider.dispose();
			}
		});

		test('returns false, not a rejection, when the CLI spawn fails for another reason', async () => {
			const { callbacks } = createMockCallbacks();
			callbacks.runCLICommand = () => Promise.reject(new Error('gk not found'));
			const provider = new GkAgentProvider(callbacks);
			try {
				const delivered = await provider.relayOpenSession('sess-5', '/repo');
				assert.strictEqual(delivered, false);
			} finally {
				provider.dispose();
			}
		});

		test('returns false when the CLI response is not valid JSON', async () => {
			const { callbacks } = createMockCallbacks({ cliResponse: 'not json' });
			const provider = new GkAgentProvider(callbacks);
			try {
				const delivered = await provider.relayOpenSession('sess-6', '/repo');
				assert.strictEqual(delivered, false);
			} finally {
				provider.dispose();
			}
		});
	});
});

/** Drop-in transcript reader for provider tests — records calls and returns canned titles. */
class StubTranscriptReader extends ClaudeCodeTranscriptReader {
	titles: TranscriptTitles;
	readonly calls: { sessionId: string; cwd: string | undefined }[] = [];
	readonly forgotten: string[] = [];

	constructor(titles: TranscriptTitles) {
		super();
		this.titles = titles;
	}

	override resolve(sessionId: string, cwd: string | undefined): Promise<TranscriptTitles | undefined> {
		this.calls.push({ sessionId: sessionId, cwd: cwd });
		return Promise.resolve(this.titles);
	}

	override forget(sessionId: string): void {
		this.forgotten.push(sessionId);
	}

	readonly endedDetailCalls: { sessionId: string; cwd: string | undefined }[] = [];

	override resolveEndedDetails(
		sessionId: string,
		cwd: string | undefined,
	): Promise<EndedTranscriptDetails | undefined> {
		this.endedDetailCalls.push({ sessionId: sessionId, cwd: cwd });
		return Promise.resolve({ titles: this.titles, firstPrompt: undefined, lastPrompt: undefined });
	}
}

/** Listing stub for exercising the provider's merge of exact-directory and CLI-attributed history. */
class StubListingTranscriptReader extends ClaudeCodeTranscriptReader {
	direct: TranscriptSessionListing = { sessions: [], total: 0 };
	recovered: ResumableTranscriptSessionListing = { sessions: [], total: 0 };
	readonly listCalls: {
		cwd: string;
		options?: { limit?: number; excludeSessionIds?: ReadonlySet<string> };
	}[] = [];
	readonly listByIdsCalls: {
		sessionIds: Set<string>;
		options?: { limit?: number; excludeCwd?: string };
	}[] = [];

	override listSessions(
		cwd: string,
		options?: { limit?: number; excludeSessionIds?: ReadonlySet<string> },
	): Promise<TranscriptSessionListing> {
		this.listCalls.push({ cwd: cwd, options: options });
		return Promise.resolve(this.direct);
	}

	override listSessionsByIds(
		sessionIds: ReadonlySet<string>,
		options?: { limit?: number; excludeCwd?: string },
	): Promise<ResumableTranscriptSessionListing> {
		this.listByIdsCalls.push({ sessionIds: new Set(sessionIds), options: options });
		return Promise.resolve(this.recovered);
	}
}

/** Provider variant that lets tests swap the transcript reader and drive a gated poll tick. */
class TestProvider extends GkAgentProvider {
	constructor(callbacks: AgentProviderCallbacks, reader: ClaudeCodeTranscriptReader) {
		super(callbacks);
		this._transcriptReader = reader;
	}
	runGatedSync(): Promise<void> {
		return this.syncSessions({ gate: true });
	}
}

/** Provider variant that lets tests drive a gated reconciliation tick deterministically, instead
 *  of waiting for the real 15-minute `staleCheckTimer` interval. */
class GateTestProvider extends GkAgentProvider {
	runGatedSync(): Promise<void> {
		return this.syncSessions({ gate: true });
	}
}

suite('GkAgentProvider reconciliation poll gating (list-sessions)', () => {
	const workspace = '/home/user/projectA';

	test('skips the CLI on a gated tick when there are no sessions and hooks are not installed', async () => {
		const { callbacks, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setHooksInstalled(false);
			cliCalls.length = 0; // ignore the ungated bootstrap call

			await provider.runGatedSync();
			await provider.runGatedSync();

			assert.strictEqual(listSessionsCalls(cliCalls), 0);
		} finally {
			provider.dispose();
		}
	});

	test('still polls when hooks are installed even with no sessions', async () => {
		const { callbacks, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setHooksInstalled(true);
			cliCalls.length = 0;

			await provider.runGatedSync();

			assert.ok(listSessionsCalls(cliCalls) >= 1, 'a window with installed hooks must keep polling');
		} finally {
			provider.dispose();
		}
	});

	test('still polls when sessions exist even if hooks are reported as not installed', async () => {
		const { callbacks, handlers, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setHooksInstalled(false);

			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('sess-1', workspace), new URLSearchParams());
			assert.strictEqual(provider.sessions.length, 1);
			cliCalls.length = 0;

			await provider.runGatedSync();

			assert.ok(
				listSessionsCalls(cliCalls) >= 1,
				'a non-empty session list must keep polling (prune backstop + robustness to stale hook detection)',
			);
		} finally {
			provider.dispose();
		}
	});

	test('keeps polling for ended-only state, but at the idle cadence', async () => {
		// The poll is the only thing that drops an ended row the CLI stopped listing (archived
		// elsewhere, or aged out) AND the only trigger for the CLI's own retention sweep — so it must
		// not gate out. With nothing live it just runs less often.
		const { callbacks, cliCalls } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{
					sessionId: 'done',
					event: 'Stop',
					cwd: workspace,
					pid: 999999,
					status: 'ended',
					endReason: 'session-end',
					endedAt: '2026-07-09T00:00:00.000Z',
					updatedAt: '2026-07-09T00:00:00.000Z',
				},
			]),
		});
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setHooksInstalled(false);
			assert.ok(
				provider.sessions.some(s => s.status === 'ended'),
				'bootstrap should have ingested the ended record',
			);
			cliCalls.length = 0;

			await provider.runGatedSync();
			assert.strictEqual(
				listSessionsCalls(cliCalls),
				0,
				'a tick inside the idle window is skipped — the bootstrap poll just ran',
			);

			// Pretend the idle window elapsed.
			(provider as unknown as { _lastSyncAt: number })._lastSyncAt = 0;
			await provider.runGatedSync();
			assert.strictEqual(
				listSessionsCalls(cliCalls),
				1,
				'once the idle window passes, ended-only state still reconciles',
			);
		} finally {
			provider.dispose();
		}
	});

	test('resumes polling on the next gated tick once a session is pushed', async () => {
		const { callbacks, handlers, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setHooksInstalled(false);
			cliCalls.length = 0;

			// Empty + hooks-off → skipped.
			await provider.runGatedSync();
			assert.strictEqual(listSessionsCalls(cliCalls), 0);

			// A push makes the list non-empty → the next tick polls again, with no timer rebuild.
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('sess-1', workspace), new URLSearchParams());
			cliCalls.length = 0;
			await provider.runGatedSync();

			assert.ok(listSessionsCalls(cliCalls) >= 1, 'polling must resume once a session exists');
		} finally {
			provider.dispose();
		}
	});

	test('defaults to fail-open (polls) before the host pushes any hooks state', async () => {
		const { callbacks, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			cliCalls.length = 0; // never call setHooksInstalled — exercise the default

			await provider.runGatedSync();

			assert.ok(
				listSessionsCalls(cliCalls) >= 1,
				'before the first host push the provider must assume hooks may be installed',
			);
		} finally {
			provider.dispose();
		}
	});

	test('an off→on hooks transition reconciles immediately without waiting for the interval', async () => {
		const { callbacks, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setHooksInstalled(false);
			cliCalls.length = 0;

			provider.setHooksInstalled(true); // eager resync fires an ungated syncSessions() (polls, reports no drift)
			await flushMicrotasks();

			assert.ok(listSessionsCalls(cliCalls) >= 1, 'installing hooks must trigger an immediate reconciliation');
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider live/poll sync discrepancy telemetry', () => {
	const workspace = '/home/user/projectA';

	test('reports discovered drift when a gated poll finds a session the live path never tracked', async () => {
		const { callbacks, syncDiscrepancies } = createMockCallbacks({
			cliResponse: JSON.stringify([sessionFileData('poll-only', workspace)]),
		});
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync();

			assert.strictEqual(provider.sessions.length, 1);
			assert.strictEqual(syncDiscrepancies.length, 1);
			assert.deepStrictEqual(syncDiscrepancies[0], {
				provider: 'claudeCode',
				discovered: 1,
				missing: 0,
				polled: 1,
				tracked: 0,
			});
		} finally {
			provider.dispose();
		}
	});

	test('does not report drift once the discovered session is tracked', async () => {
		const { callbacks, syncDiscrepancies } = createMockCallbacks({
			cliResponse: JSON.stringify([sessionFileData('poll-only', workspace)]),
		});
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers + reports
			syncDiscrepancies.length = 0;

			await provider.runGatedSync(); // already tracked → no drift

			assert.strictEqual(syncDiscrepancies.length, 0);
		} finally {
			provider.dispose();
		}
	});

	test('reports missing drift when a live-tracked session is absent from the poll', async () => {
		const { callbacks, handlers, syncDiscrepancies } = createMockCallbacks(); // poll returns '[]'
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('live-1', workspace), new URLSearchParams());
			assert.strictEqual(provider.sessions.length, 1);
			syncDiscrepancies.length = 0;

			await provider.runGatedSync();

			assert.strictEqual(syncDiscrepancies.length, 1);
			assert.deepStrictEqual(syncDiscrepancies[0], {
				provider: 'claudeCode',
				discovered: 0,
				missing: 1,
				polled: 0,
				tracked: 1,
			});
		} finally {
			provider.dispose();
		}
	});

	test('does not report drift on the ungated bootstrap discovery', async () => {
		const { callbacks, syncDiscrepancies } = createMockCallbacks({
			cliResponse: JSON.stringify([sessionFileData('boot', workspace)]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();

			assert.strictEqual(provider.sessions.length, 1);
			assert.strictEqual(syncDiscrepancies.length, 0, 'cold-start discovery is expected, not drift');
		} finally {
			provider.dispose();
		}
	});

	test('the off→on eager resync discovers pre-existing sessions without reporting drift', async () => {
		const { callbacks, syncDiscrepancies } = createMockCallbacks({
			cliResponse: JSON.stringify([sessionFileData('preexisting', workspace)]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.setHooksInstalled(false); // true(default)→false: no resync
			provider.setHooksInstalled(true); // false→true: eager resync polls (ungated)
			await flushMicrotasks();

			assert.strictEqual(provider.sessions.length, 1, 'eager resync should pick up the already-running session');
			assert.strictEqual(
				syncDiscrepancies.length,
				0,
				'installing hooks mid-session is expected discovery, not drift',
			);
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider ended sessions', () => {
	const REPO = '/home/user/projectA';
	const ENDED_AT = '2026-07-10T00:00:00.000Z';

	/** A `list-sessions` poll entry for a durable `ended` session. */
	function endedRecord(sessionId: string, overrides?: Record<string, unknown>): Record<string, unknown> {
		return {
			sessionId: sessionId,
			event: 'Stop',
			cwd: REPO,
			pid: 999999, // not a live process — ended classification ignores pid anyway
			status: 'ended',
			endReason: 'session-end',
			endedAt: ENDED_AT,
			updatedAt: '2026-07-09T00:00:00.000Z',
			...overrides,
		};
	}

	test('SessionEnd transitions the session to ended instead of removing it', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(subagentStart('s1', 'a1'), new URLSearchParams());
			assert.ok(
				provider.sessions.some(s => s.id === 's1'),
				'session should be tracked while live',
			);

			await handler(sessionEnd('s1'), new URLSearchParams());

			const s = provider.sessions.find(x => x.id === 's1');
			assert.ok(s != null, 'session should remain after SessionEnd, not be removed');
			assert.strictEqual(s.status, 'ended');
			assert.strictEqual(s.phase, 'ended');
			assert.strictEqual(s.subagents, undefined, 'subagents are dropped on completion');
			assert.strictEqual(s.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('SessionEnd bumps terminalGeneration even for an untracked session', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			const before = provider.terminalGeneration;

			// Never tracked (no SessionStart) — pruned/removed, or ended before this window saw it.
			// The session still finalized a transcript, so an in-flight history query must retry.
			await handler(sessionEnd('never-tracked'), new URLSearchParams());

			assert.ok(provider.terminalGeneration > before, 'an untracked SessionEnd is still a terminal transition');
		} finally {
			provider.dispose();
		}
	});

	test('an ended session takes worktreePath from the CLI record without a git probe', async () => {
		let gitInfoCalls = 0;
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				endedRecord('wt', {
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: ENDED_AT }],
				}),
			]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve(undefined);
			},
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'wt');
			assert.strictEqual(s?.worktreePath, REPO, 'worktreePath comes straight from the record');
			assert.strictEqual(gitInfoCalls, 0, 'no git probe when the record already carries the worktree');
		} finally {
			provider.dispose();
		}
	});

	test('a poll backfills a missing lastPrompt from the ended record, but never overwrites a hook-set one', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				endedRecord('backfill', {
					prompt: 'record prompt',
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: ENDED_AT }],
				}),
			]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'backfill');
			assert.strictEqual(s?.status, 'ended');
			assert.strictEqual(s?.lastPrompt, 'record prompt', 'a missing lastPrompt is backfilled from the record');
		} finally {
			provider.dispose();
		}
	});

	test("a poll never overwrites an existing lastPrompt with the ended record's prompt", async () => {
		const options: { cliResponse?: string } = { cliResponse: '[]' };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('live', REPO), new URLSearchParams());
			await handler(
				{
					event: 'UserPromptSubmit',
					sessionId: 'live',
					cwd: REPO,
					pid: process.pid,
					prompt: 'hook-set prompt',
					firstPrompt: 'hook-set prompt',
				},
				new URLSearchParams(),
			);
			assert.strictEqual(provider.sessions.find(s => s.id === 'live')?.lastPrompt, 'hook-set prompt');

			// The live path missed SessionEnd; the CLI now reports it ended with a DIFFERENT prompt.
			options.cliResponse = JSON.stringify([
				endedRecord('live', { pid: process.pid, event: 'UserPromptSubmit', prompt: 'record prompt' }),
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'live');
			assert.strictEqual(s?.status, 'ended');
			assert.strictEqual(
				s?.lastPrompt,
				'hook-set prompt',
				'a hook-set lastPrompt must survive the ended-record poll backfill',
			);
		} finally {
			provider.dispose();
		}
	});

	test('merges CLI-attributed transcripts left in another project directory with the correct resume cwd', async () => {
		const otherWorktree = '/home/user/projectA.worktrees/other';
		const transcriptCwd = '/home/user/projectA.worktrees/origin';
		const excludedIds = new Set(['hidden']);
		const reader = new StubListingTranscriptReader();
		reader.direct = {
			sessions: [
				{
					sessionId: 'legacy',
					path: '/transcripts/current/legacy.jsonl',
					lastActivityMs: 1000,
					size: 10,
					titles: { ai: 'Legacy' },
				},
			],
			total: 2,
		};
		reader.recovered = {
			sessions: [
				{
					sessionId: 'moved',
					path: '/transcripts/origin/moved.jsonl',
					cwd: transcriptCwd,
					lastActivityMs: 2000,
					size: 10,
					titles: { ai: 'Moved' },
				},
			],
			total: 1,
		};

		const { callbacks } = createMockCallbacks({
			resumeSession: () => Promise.resolve('terminal'),
			cliResponse: JSON.stringify([
				endedRecord('moved', {
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: ENDED_AT }],
				}),
				endedRecord('hidden', {
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: ENDED_AT }],
				}),
				endedRecord('other', {
					cwd: otherWorktree,
					cwdTimeline: [{ cwd: otherWorktree, worktree: otherWorktree, at: ENDED_AT }],
				}),
			]),
		});
		const provider = new TestProvider(callbacks, reader);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const result = await provider.listSessionHistory(REPO, {
				limit: 1,
				excludeSessionIds: excludedIds,
			});

			assert.deepStrictEqual(
				[...reader.listByIdsCalls[0].sessionIds],
				['moved'],
				'only non-excluded ended sessions attributed to this worktree are globally recovered',
			);
			assert.deepStrictEqual(reader.listByIdsCalls[0].options, { limit: 1, excludeCwd: REPO });
			assert.strictEqual(result.total, 3, 'direct and recovered transcript totals are combined');
			assert.deepStrictEqual(
				result.sessions.map(session => ({ id: session.id, cwd: session.actions.resume?.cwd })),
				[{ id: 'moved', cwd: transcriptCwd }],
				'the merged limit is applied by recency and preserves the transcript project cwd',
			);
		} finally {
			provider.dispose();
		}
	});

	test('keeps a tracked ended record manageable when no transcript can be summarized', async () => {
		const reader = new StubListingTranscriptReader();
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				endedRecord('missing-transcript', {
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: ENDED_AT }],
				}),
			]),
		});
		const provider = new TestProvider(callbacks, reader);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const result = await provider.listSessionHistory(REPO);

			assert.strictEqual(result.total, 1);
			assert.deepStrictEqual(
				result.sessions.map(session => session.id),
				['missing-transcript'],
			);
			assert.deepStrictEqual(
				result.sessions[0].actions,
				{ archive: true },
				'a missing transcript removes Resume without hiding the terminal record or Archive',
			);
		} finally {
			provider.dispose();
		}
	});

	test('owns archive filtering and capability discovery inside the provider', async () => {
		const reader = new StubListingTranscriptReader();
		reader.direct = {
			sessions: [
				{
					sessionId: 'archived',
					path: '/transcripts/current/archived.jsonl',
					lastActivityMs: 1000,
					size: 10,
					titles: { ai: 'Archived' },
				},
			],
			total: 1,
		};
		const { callbacks } = createMockCallbacks({
			archivedCliResponse: JSON.stringify([endedRecord('archived')]),
		});
		const provider = new TestProvider(callbacks, reader);
		try {
			const result = await provider.listSessionHistory(REPO);

			assert.ok(reader.listCalls[0].options?.excludeSessionIds?.has('archived'));
			assert.deepStrictEqual(result.sessions, [], 'archived history stays out of the ordinary Past list');
		} finally {
			provider.dispose();
		}
	});

	test('poll surfaces an ended record as an ended session even with a dead pid', async () => {
		const { callbacks } = createMockCallbacks({ cliResponse: JSON.stringify([endedRecord('gone')]) });
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'gone');
			assert.ok(s != null, 'an ended record should surface as an ended session');
			assert.strictEqual(s.status, 'ended');
			assert.strictEqual(s.phase, 'ended');
			assert.strictEqual(s.lastActivity.toISOString(), ENDED_AT, 'lastActivity comes from endedAt');
		} finally {
			provider.dispose();
		}
	});

	test('an ended record with a live pid is ended, never re-added as a live session', async () => {
		// The `/clear` case: SessionEnd fired but the process continues under a new id, so the old
		// ended record still carries a live pid. Classification must key off status, not pid liveness.
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('cleared', { pid: process.pid, event: 'UserPromptSubmit' })]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			assert.strictEqual(
				provider.sessions.find(x => x.id === 'cleared')?.status,
				'ended',
				'a live pid must not resurrect an ended session as live',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a live listing cwd re-seats a stale ended record on discovery and later polls', async () => {
		const oldWorktree = `${REPO}.worktrees/old`;
		const liveWorktree = `${REPO}.worktrees/live`;
		const resolvedCwds: string[] = [];
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				endedRecord('resumed', {
					cwd: oldWorktree,
					cwdTimeline: [{ cwd: oldWorktree, worktree: oldWorktree, at: ENDED_AT }],
				}),
			]),
			liveAgentSessions: [
				{
					sessionId: 'resumed',
					pid: process.pid,
					cwd: liveWorktree,
					kind: 'interactive',
				},
			],
			resolveGitInfo: cwd => {
				resolvedCwds.push(cwd);
				return Promise.resolve({ repoRoot: REPO, worktreePath: liveWorktree, isWorktree: true });
			},
		});
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([liveWorktree]);
			await flushMicrotasks();

			let session = provider.sessions.find(s => s.id === 'resumed');
			assert.notStrictEqual(session?.status, 'ended', "Claude's live listing revives the session");
			assert.strictEqual(session?.cwd, liveWorktree, "the listing's current cwd wins over stale history");
			assert.strictEqual(session?.worktreePath, liveWorktree, 'git resolves the current worktree');
			assert.strictEqual(session?.workspacePath, liveWorktree);
			assert.deepStrictEqual(resolvedCwds, [liveWorktree], 'only the live cwd is probed');

			await provider.runGatedSync();
			await flushMicrotasks();

			session = provider.sessions.find(s => s.id === 'resumed');
			assert.strictEqual(session?.cwd, liveWorktree, 'a later stale-record poll cannot move the row back');
			assert.strictEqual(session?.worktreePath, liveWorktree);
		} finally {
			provider.dispose();
		}
	});

	test('poll transitions a tracked live session to ended when the CLI reports it ended', async () => {
		const options: { cliResponse?: string } = { cliResponse: '[]' };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('live', REPO), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 'live')?.status, 'idle');

			// The live path missed SessionEnd; the CLI now reports it ended with a still-live pid.
			options.cliResponse = JSON.stringify([
				endedRecord('live', { pid: process.pid, event: 'UserPromptSubmit' }),
			]);
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.find(s => s.id === 'live')?.status,
				'ended',
				'the poll must reap a live-pid zombie the live path missed',
			);
		} finally {
			provider.dispose();
		}
	});

	test('poll never moves lastActivity backward when ending off a stale durable record', async () => {
		// The CLI's `ended` record can predate activity this window already observed — a same-cwd
		// resume the CLI hasn't rewritten the record for yet. The transition must clock off whichever
		// is later, not blindly trust the record's `endedAt`.
		const options: { cliResponse?: string } = { cliResponse: '[]' };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('live', REPO), new URLSearchParams());

			// Advance the tracked row's clock past the record's endedAt.
			const laterActivity = new Date(new Date(ENDED_AT).getTime() + 60_000);
			const tracked = provider.sessions.find(s => s.id === 'live')!;
			(tracked as { lastActivity: Date }).lastActivity = laterActivity;

			// The live path missed SessionEnd; the CLI now reports it ended off the stale (earlier) record.
			options.cliResponse = JSON.stringify([
				endedRecord('live', { pid: process.pid, event: 'UserPromptSubmit' }),
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'live');
			assert.ok(s != null, 'the session must survive the transition');
			assert.strictEqual(s.status, 'ended');
			assert.strictEqual(
				s.lastActivity.getTime(),
				laterActivity.getTime(),
				"the record's endedAt must never move the row's clock backward",
			);
			assert.strictEqual(s.phaseSince.getTime(), laterActivity.getTime());
		} finally {
			provider.dispose();
		}
	});

	test('an ended session is removed once a later poll omits it', async () => {
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // poll #1 discovers 'done' as ended, sets polledAtLeastOnce
			assert.ok(
				provider.sessions.some(s => s.id === 'done'),
				'ended session discovered',
			);

			options.cliResponse = '[]';
			await provider.runGatedSync(); // poll #2 omits it (archived/purged) → removed
			assert.strictEqual(
				provider.sessions.some(s => s.id === 'done'),
				false,
				'omitted ended session removed',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a freshly ended session is not reconcile-removed before its first poll confirmation', async () => {
		const options: { cliResponse?: string } = { cliResponse: '[]' };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams()); // → ended, no polledAtLeastOnce yet

			// Age it a few seconds — inside the grace, but NOT the same millisecond as the poll. Without
			// this the assertion would hold even with the grace removed, since `phaseSince < pollStartedAt`
			// is false only at identical timestamps. Paired with the after-the-grace test below, this pins
			// both sides of the boundary.
			const ended = provider.sessions.find(x => x.id === 's1')!;
			(ended as { phaseSince: Date }).phaseSince = new Date(Date.now() - 5 * 1000);

			await provider.runGatedSync(); // an in-flight poll that raced before the CLI file was visible

			const s = provider.sessions.find(x => x.id === 's1');
			assert.ok(s != null, 'must survive an in-flight empty poll it legitimately predates');
			assert.strictEqual(s.status, 'ended');
		} finally {
			provider.dispose();
		}
	});

	test('an unconfirmed ended row is reconciled away once the grace elapses', async () => {
		// The ghost case: the record was archived from another window (or purged) before any poll
		// observed it, so `polledAtLeastOnce` can never be set and the row would otherwise be pinned
		// for the window's lifetime. Absence becomes authoritative once the row is older than the
		// grace that protects a just-ended session from a not-yet-visible record.
		const { callbacks, handlers } = createMockCallbacks({ cliResponse: '[]' });
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'ended');

			// Age the completion past the grace rather than sleeping through it.
			const ended = provider.sessions.find(s => s.id === 's1')!;
			(ended as { phaseSince: Date }).phaseSince = new Date(Date.now() - 5 * 60 * 1000);

			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.some(s => s.id === 's1'),
				false,
				'an aged, never-confirmed ended row must not survive the poll that omits it',
			);
		} finally {
			provider.dispose();
		}
	});

	test('poll does not eagerly resolve git info for ended sessions', async () => {
		let gitInfoCalls = 0;
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('done')]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve(undefined);
			},
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			assert.strictEqual(provider.sessions.find(s => s.id === 'done')?.status, 'ended');
			assert.strictEqual(gitInfoCalls, 0, 'ended sessions must defer git resolution');
		} finally {
			provider.dispose();
		}
	});

	test('resolveEndedSessionDetails resolves git info on demand', async () => {
		let gitInfoCalls = 0;
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('done')]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve(undefined);
			},
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.strictEqual(gitInfoCalls, 0, 'not resolved eagerly');

			provider.resolveEndedSessionDetails('done');
			await flushMicrotasks();

			assert.strictEqual(gitInfoCalls, 1, 'lazy resolution fires on demand');
		} finally {
			provider.dispose();
		}
	});

	test('archiveSession calls the CLI and removes the session', async () => {
		const { callbacks, cliCalls } = createMockCallbacks({ cliResponse: JSON.stringify([endedRecord('done')]) });
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.ok(provider.sessions.some(s => s.id === 'done'));
			cliCalls.length = 0;

			const archived = await provider.archiveSession('done');

			assert.strictEqual(archived, true, 'a real archive reports success so the host records telemetry');
			assert.ok(
				cliCalls.some(a => a.join(' ') === 'ai hook archive-session done --json'),
				'archive-session CLI command should be issued',
			);
			assert.strictEqual(
				provider.sessions.some(s => s.id === 'done'),
				false,
				'archived session removed locally',
			);
		} finally {
			provider.dispose();
		}
	});

	test('SessionStart on an ended session revives it to a live idle row', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'ended');

			// Resuming reuses the id, so a SessionStart on an ended row is the resume signal.
			await handler(sessionStart('s1', REPO), new URLSearchParams());

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'idle', 'a resumed session must leave the ended/archivable state');
			assert.strictEqual(s?.phase, 'idle');
		} finally {
			provider.dispose();
		}
	});

	test('poll revives an ended session the CLI reports as a live process', async () => {
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers 'done' as ended
			assert.strictEqual(provider.sessions.find(s => s.id === 'done')?.status, 'ended');

			// Resumed out-of-band: the CLI now lists it active with a live pid and an `updatedAt` past
			// the end (a real resume always advances it). `sessionFileData` uses a `UserPromptSubmit`
			// event → the revived row must derive `thinking`, not a hardcoded `idle` (mislabeling
			// active work as idle would offer an unsafe concurrent-write resume).
			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('done', REPO), updatedAt: '2026-07-10T00:05:00.000Z' },
			]);
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.find(s => s.id === 'done')?.status,
				'thinking',
				'a revived ended row must take the CLI event-derived status, not idle',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a poll-revived session takes the record’s location and sheds its terminal fields', async () => {
		// The resume can happen anywhere — another worktree, another window. A row revived in place
		// keeps whatever directory it ended in, so it attaches to the wrong WIP row and "Open Session"
		// resumes from a stale path; and leaving `endReason`/`endedAt` set makes a live row read as
		// terminal to every consumer that keys off them.
		const MOVED = '/home/user/projectA-elsewhere';
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('moved')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([MOVED]);
			await flushMicrotasks();
			const ended = provider.sessions.find(s => s.id === 'moved');
			assert.strictEqual(ended?.status, 'ended');
			assert.strictEqual(ended?.endReason, 'session-end');
			assert.strictEqual(ended?.workspacePath, undefined, 'it ended outside this workspace');

			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('moved', MOVED), updatedAt: '2026-07-10T00:05:00.000Z' },
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'moved');
			assert.strictEqual(s?.status, 'thinking', 'the row is live again');
			assert.strictEqual(s?.cwd, MOVED, 'cwd follows the record');
			assert.strictEqual(s?.workspacePath, MOVED, 'workspacePath is re-derived from the new cwd');
			assert.strictEqual(s?.isInWorkspace, true);
			assert.strictEqual(s?.endReason, undefined, 'a revived row is no longer terminal');
			assert.strictEqual(s?.endedAt, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('a revival at a non-repo cwd keeps the session’s worktree attribution', async () => {
		// Design invariant: attribution persists until git affirmatively resolves a NEW worktree. A
		// resume whose cwd is scratch space (e.g. /tmp) — or an older-CLI record with no worktree data
		// — must not strand the session rootless; the cwd alone is never the re-rooting signal.
		const OUTSIDE = '/tmp/scratch';
		const options: { cliResponse?: string; resolveGitInfo?: () => Promise<undefined> } = {
			cliResponse: JSON.stringify([
				endedRecord('older', { cwdTimeline: [{ cwd: REPO, worktree: REPO, at: '2026-07-08T00:00:00.000Z' }] }),
			]),
			resolveGitInfo: () => Promise.resolve(undefined),
		};
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const ended = provider.sessions.find(s => s.id === 'older');
			assert.strictEqual(ended?.status, 'ended');
			assert.strictEqual(ended?.worktreePath, REPO, 'the ended row is attributed from its record');

			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('older', OUTSIDE), updatedAt: '2026-07-10T00:05:00.000Z' },
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'older');
			assert.notStrictEqual(s?.status, 'ended', 'the row is live again');
			assert.strictEqual(s?.cwd, OUTSIDE, 'cwd still follows the record');
			assert.strictEqual(s?.worktreePath, REPO, 'the worktree attribution is kept');
		} finally {
			provider.dispose();
		}
	});

	test('poll does not revive an ended session off a snapshot older than the completion', async () => {
		// `SessionEnd` fires while the process is still winding down, so a poll whose `list-sessions`
		// call started BEFORE it comes back with a snapshot that still says "active" with a live pid.
		// Reviving off that stale record resurrects the row, and `pruneDeadSessions` then deletes it
		// outright once the process exits — the ended row would vanish moments after it appeared.
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers 'done' as ended
			assert.strictEqual(provider.sessions.find(s => s.id === 'done')?.status, 'ended');

			// Stale snapshot: live pid, but `updatedAt` predates `endedAt`.
			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('done', REPO), updatedAt: '2026-07-09T23:59:00.000Z' },
			]);
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.find(s => s.id === 'done')?.status,
				'ended',
				'a stale pre-completion snapshot must not resurrect the terminal row',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a poll revive whose worktree moved re-probes even when cwd stays the same', async () => {
		// The revive branch drops `commonPath` whenever the record's worktree differs from the
		// held one (`worktreeMoved ? undefined : existing.commonPath`), but the follow-up probe
		// used to fire only on a cwd change — a move where cwd stays put left commonPath
		// undefined forever.
		const WORKTREE = `${REPO}.worktrees/feature`;
		let gitInfoCalls = 0;
		const options: {
			cliResponse?: string;
			resolveGitInfo?: () => Promise<{ repoRoot: string; worktreePath: string; isWorktree: boolean }>;
		} = {
			cliResponse: JSON.stringify([
				endedRecord('moved-wt', {
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: '2026-07-08T00:00:00.000Z' }],
				}),
			]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve({ repoRoot: WORKTREE, worktreePath: WORKTREE, isWorktree: true });
			},
		};
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const ended = provider.sessions.find(s => s.id === 'moved-wt');
			assert.strictEqual(ended?.status, 'ended');
			assert.strictEqual(ended?.worktreePath, REPO);

			// Revive with the SAME cwd but a NEW worktree in the timeline — no cwd change to key
			// off, so only the widened worktree-moved check can trigger the probe.
			options.cliResponse = JSON.stringify([
				{
					...sessionFileData('moved-wt', REPO),
					updatedAt: '2026-07-10T00:05:00.000Z',
					cwdTimeline: [{ cwd: REPO, worktree: WORKTREE, at: '2026-07-10T00:05:00.000Z' }],
				},
			]);
			await provider.runGatedSync();
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'moved-wt');
			assert.notStrictEqual(s?.status, 'ended', 'the row is live again');
			assert.strictEqual(s?.cwd, REPO);
			assert.strictEqual(s?.worktreePath, WORKTREE, 'the record’s new worktree wins');
			assert.ok(gitInfoCalls >= 1, 'the moved worktree must still trigger the commonPath probe');
			assert.strictEqual(s?.commonPath, WORKTREE, 'commonPath is refilled by the probe');
		} finally {
			provider.dispose();
		}
	});

	test('an ended row re-seated onto a new worktree still refills commonPath', async () => {
		// The still-ended re-seat branch (record keeps reporting `ended`, just onto a different
		// worktree) always drops `commonPath` when the worktree moves, but the follow-up probe used
		// to fire only when the record left `worktreePath` empty (`nextWorktreePath == null`) — a
		// record that DOES name a worktree, just a different one, dropped commonPath and never
		// refilled it. Distinct from the revive-branch test above: this record stays `ended` the
		// whole time, never reporting `active`.
		const WORKTREE = `${REPO}.worktrees/feature`;
		let gitInfoCalls = 0;
		const options: {
			cliResponse?: string;
			resolveGitInfo?: () => Promise<{ repoRoot: string; worktreePath: string; isWorktree: boolean }>;
		} = {
			cliResponse: JSON.stringify([
				endedRecord('ended-wt', { cwdTimeline: [{ cwd: REPO, worktree: REPO, at: ENDED_AT }] }),
			]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve({ repoRoot: WORKTREE, worktreePath: WORKTREE, isWorktree: true });
			},
		};
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			let s = provider.sessions.find(x => x.id === 'ended-wt');
			assert.strictEqual(s?.status, 'ended');
			assert.strictEqual(s?.worktreePath, REPO);
			assert.strictEqual(gitInfoCalls, 0, 'no probe while the record already names the worktree');

			// A later poll re-seats the SAME (still-ended) record onto a different worktree.
			options.cliResponse = JSON.stringify([
				endedRecord('ended-wt', {
					cwd: WORKTREE,
					cwdTimeline: [{ cwd: WORKTREE, worktree: WORKTREE, at: '2026-07-10T00:05:00.000Z' }],
					updatedAt: '2026-07-10T00:05:00.000Z',
				}),
			]);
			await provider.runGatedSync();
			await flushMicrotasks();

			s = provider.sessions.find(x => x.id === 'ended-wt');
			assert.strictEqual(s?.status, 'ended', 'the record still reports ended — no revive');
			assert.strictEqual(s?.worktreePath, WORKTREE, 'the record’s new worktree wins');
			assert.ok(gitInfoCalls >= 1, 'the new worktree must still trigger the commonPath probe');
			assert.strictEqual(s?.commonPath, WORKTREE, 'commonPath is refilled by the probe');
		} finally {
			provider.dispose();
		}
	});

	test('poll re-resolves the transcript title for a tracked live session that still lacks one', async () => {
		// A poll-discovered session (another worktree/window owns its hooks) gets no idle-transition
		// re-resolve, so one discovered before Claude wrote its ai-title would show the repo slug
		// forever. A later poll must re-check the transcript until a real title lands.
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([sessionFileData('s1', REPO)]) };
		const { callbacks } = createMockCallbacks(options);
		const reader = new StubTranscriptReader({}); // no title yet
		const provider = new TestProvider(callbacks, reader);
		try {
			await provider.runGatedSync(); // discovers s1, resolves (empty)
			await flushMicrotasks();
			assert.ok(
				reader.calls.some(c => c.sessionId === 's1'),
				'title resolved on first discovery',
			);
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.transcriptTitles?.ai, undefined);

			// Claude writes the ai-title; the next poll must re-resolve the still-untitled row.
			reader.titles = { ai: 'Investigate the thing' };
			reader.calls.length = 0;
			await provider.runGatedSync();
			await flushMicrotasks();

			assert.ok(
				reader.calls.some(c => c.sessionId === 's1'),
				'a still-untitled tracked session is re-resolved on a later poll',
			);
			assert.strictEqual(
				provider.sessions.find(s => s.id === 's1')?.transcriptTitles?.ai,
				'Investigate the thing',
				'the freshly-written title is picked up',
			);
		} finally {
			provider.dispose();
		}
	});

	test('completing a session cancels its pending Stop→idle timer so it is not revived to a zombie', async () => {
		const options: { cliResponse?: string } = { cliResponse: '[]' };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(preToolUse('s1', 'Bash', '/f'), new URLSearchParams());
			await handler(stop('s1'), new URLSearchParams()); // schedules a ~750ms Stop→idle timer

			// The CLI reports it ended before that timer fires; completeSession must cancel the timer.
			options.cliResponse = JSON.stringify([endedRecord('s1', { pid: process.pid, event: 'UserPromptSubmit' })]);
			await provider.runGatedSync();
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'ended');

			await wait(900); // let the (now-cancelled) Stop→idle window elapse

			assert.strictEqual(
				provider.sessions.find(s => s.id === 's1')?.status,
				'ended',
				'an ended row must not be revived to idle by a stale Stop→idle timer',
			);
		} finally {
			provider.dispose();
		}
	});

	test('archiveSession refuses to archive a non-ended (live) session', async () => {
		const { callbacks, handlers, cliCalls } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('live', REPO), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 'live')?.status, 'idle');
			cliCalls.length = 0;

			const archived = await provider.archiveSession('live');

			assert.strictEqual(archived, false, 'a refused archive must report failure so no success telemetry fires');
			assert.ok(
				!cliCalls.some(a => a.join(' ').includes('archive-session')),
				'archive must never reach the CLI for a live session — it would terminate it',
			);
			assert.ok(
				provider.sessions.some(s => s.id === 'live'),
				'the live session must remain',
			);
		} finally {
			provider.dispose();
		}
	});

	test('the reconciliation poll requests --status active,ended', async () => {
		const { callbacks, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync();

			const poll = cliCalls.find(a => a.includes('list-sessions'));
			assert.deepStrictEqual(poll, ['ai', 'hook', 'list-sessions', '--status', 'active,ended', '--json']);
		} finally {
			provider.dispose();
		}
	});

	test('getArchivedSessionIds issues the archived status query and returns session ids', async () => {
		const { callbacks, cliCalls } = createMockCallbacks({
			archivedCliResponse: JSON.stringify([endedRecord('archived-1'), endedRecord('archived-2')]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			cliCalls.length = 0; // ignore the bootstrap poll

			const ids = await provider.getArchivedSessionIds();

			assert.ok(
				cliCalls.some(a => a.join(' ') === 'ai hook list-sessions --status archived --json'),
				'getArchivedSessionIds should query the archived status filter',
			);
			assert.deepStrictEqual(ids, ['archived-1', 'archived-2']);
		} finally {
			provider.dispose();
		}
	});

	test('getArchivedSessionIds returns an empty array when the CLI call fails', async () => {
		const { callbacks } = createMockCallbacks();
		callbacks.runCLICommand = () => Promise.reject(new Error('gk not found'));
		const provider = new GkAgentProvider(callbacks);
		try {
			const ids = await provider.getArchivedSessionIds();
			assert.deepStrictEqual(ids, []);
		} finally {
			provider.dispose();
		}
	});

	test('getArchivedSessionIds caches the archived query across concurrent and repeated calls', async () => {
		const { callbacks, cliCalls } = createMockCallbacks({
			archivedCliResponse: JSON.stringify([endedRecord('archived-1')]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			cliCalls.length = 0; // ignore the bootstrap poll

			// Concurrent callers (one getPastSessions per worktree on panel open) share one CLI spawn...
			const [a, b] = await Promise.all([provider.getArchivedSessionIds(), provider.getArchivedSessionIds()]);
			// ...and a follow-up call within the TTL is served from cache.
			const c = await provider.getArchivedSessionIds();

			const archivedQueries = cliCalls.filter(
				x => x.join(' ') === 'ai hook list-sessions --status archived --json',
			).length;
			assert.strictEqual(archivedQueries, 1, 'concurrent + repeated calls within the TTL share one CLI spawn');
			assert.deepStrictEqual(a, ['archived-1']);
			assert.deepStrictEqual(b, ['archived-1']);
			assert.deepStrictEqual(c, ['archived-1']);
		} finally {
			provider.dispose();
		}
	});

	test('archiveSession invalidates the archived-id cache so the next query re-fetches', async () => {
		const cliCalls: string[][] = [];
		const { callbacks } = createMockCallbacks();
		callbacks.runCLICommand = (args: string[]) => {
			cliCalls.push([...args]);
			if (args.join(' ') === 'ai hook list-sessions --status active,ended --json') {
				return Promise.resolve(JSON.stringify([endedRecord('done')]));
			}
			return Promise.resolve('[]');
		};
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.ok(provider.sessions.some(s => s.id === 'done'));

			await provider.getArchivedSessionIds(); // primes the cache
			await provider.archiveSession('done'); // must invalidate it
			await provider.getArchivedSessionIds(); // should re-fetch, not serve the stale set

			const archivedQueries = cliCalls.filter(
				x => x.join(' ') === 'ai hook list-sessions --status archived --json',
			).length;
			assert.strictEqual(
				archivedQueries,
				2,
				'archive invalidates the cache so the just-archived id is picked up',
			);
		} finally {
			provider.dispose();
		}
	});

	test('falls back to a flagless poll when the CLI rejects --status', async () => {
		const { callbacks } = createMockCallbacks();
		const recorded: string[][] = [];
		callbacks.runCLICommand = (args: string[]) => {
			recorded.push([...args]);
			if (args.includes('--status')) return Promise.reject(new Error('unknown flag: --status'));
			return Promise.resolve('[]');
		};
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync();

			assert.strictEqual(recorded.length, 2, 'should retry once without --status');
			assert.deepStrictEqual(recorded[0], ['ai', 'hook', 'list-sessions', '--status', 'active,ended', '--json']);
			assert.deepStrictEqual(recorded[1], ['ai', 'hook', 'list-sessions', '--json']);
		} finally {
			provider.dispose();
		}
	});

	test('a legacy CLI (no --status) keeps remove-on-SessionEnd behavior', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		callbacks.runCLICommand = (args: string[]) => {
			if (args.includes('--status')) return Promise.reject(new Error('unknown flag: --status'));
			return Promise.resolve('[]');
		};
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks(); // the bootstrap poll's fallback marks the CLI legacy
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());

			assert.strictEqual(
				provider.sessions.some(s => s.id === 's1'),
				false,
				'without a durable store an ended row could never be confirmed or archived — remove on end',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a legacy poll reconciles away an ended row it can never confirm', async () => {
		// Models SessionEnd landing before the poll has discovered the CLI is legacy: the row
		// completes (optimistic default), then the first legacy poll — which can never list it —
		// must drop it rather than let the polledAtLeastOnce guard pin it forever.
		const { callbacks, handlers } = createMockCallbacks({ cliResponse: '[]' });
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks(); // bootstrap poll succeeds with --status → ended support assumed
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'ended');

			callbacks.runCLICommand = (args: string[]) => {
				if (args.includes('--status')) return Promise.reject(new Error('unknown flag: --status'));
				return Promise.resolve('[]');
			};
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.some(s => s.id === 's1'),
				false,
				'the legacy poll is authoritative — an unconfirmable ended row must not linger',
			);
		} finally {
			provider.dispose();
		}
	});

	test('drift telemetry ignores ended sessions', async () => {
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks, syncDiscrepancies } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers ended 'done'
			syncDiscrepancies.length = 0;

			await provider.runGatedSync(); // still lists 'done' as ended → no live drift

			assert.strictEqual(syncDiscrepancies.length, 0, 'an ended session absent from polledAlive is not drift');
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider unresolvable permission asks', () => {
	test('Notification(permission_prompt) synthesizes an unresolvable ask', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			await handler(
				{
					event: 'Notification',
					sessionId: 's1',
					cwd: '/repo',
					notificationType: 'permission_prompt',
					toolName: 'Bash',
				},
				new URLSearchParams(),
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
			assert.strictEqual(s?.pendingPermission?.toolName, 'Bash');
		} finally {
			provider.dispose();
		}
	});

	test('a non-blocking PermissionRequest synthesizes an unresolvable ask shaped like the blocking payload', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			await handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: '/repo',
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
				},
				new URLSearchParams(), // no `blocking=true` — the non-blocking tail
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
			assert.strictEqual(s?.pendingPermission?.toolName, 'Bash');
			// Mirrors the blocking payload's shape: `toolDescription` carries the described input.
			assert.strictEqual(s?.pendingPermission?.toolDescription, 'Bash(ls -la)');
		} finally {
			provider.dispose();
		}
	});

	test('a non-blocking question ask carries the question text and count', async () => {
		// Surfaces render `questionText` in place of the tool description — without it a question
		// ask reads as a generic "awaiting" card.
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			await handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: '/repo',
					toolName: 'AskUserQuestion',
					toolInput: { questions: [{ question: 'Which branch?' }, { question: 'Force push?' }] },
				},
				new URLSearchParams(), // no `blocking=true` — the non-blocking tail
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.pendingPermission?.kind, 'question');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
			assert.strictEqual(s?.pendingPermission?.questionText, 'Which branch?');
			assert.strictEqual(s?.pendingPermission?.questionCount, 2);
		} finally {
			provider.dispose();
		}
	});

	test('a routable blocking permission survives a subsequent Notification(permission_prompt)', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			// The Promise executor sets `bk.pendingPermission` synchronously, before this call
			// returns — no need to await it (it stays pending until resolvePermission/dispose).
			const blocking = handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: '/repo',
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
				},
				new URLSearchParams('blocking=true'),
			);
			blocking.catch(() => {});

			await handler(
				{
					event: 'Notification',
					sessionId: 's1',
					cwd: '/repo',
					notificationType: 'permission_prompt',
					toolName: 'Bash',
				},
				new URLSearchParams(),
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.notStrictEqual(
				s?.pendingPermission?.resolvable,
				false,
				'the routable ask must not be replaced by a synthesized unresolvable one',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a second non-blocking PermissionRequest replaces the published ask', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			await handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: '/repo',
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
				},
				new URLSearchParams(),
			);
			// Same status AND same `statusDetail` (`Bash` both times) — only the ask itself differs, so
			// a status-only short-circuit would leave the first command on the card while the agent
			// waits on the second.
			await handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: '/repo',
					toolName: 'Bash',
					toolInput: { command: 'rm -rf build' },
				},
				new URLSearchParams(),
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.pendingPermission?.toolDescription, 'Bash(rm -rf build)');
		} finally {
			provider.dispose();
		}
	});

	test('Notification(elicitation_dialog) publishes an elicitation ask, not a tool ask', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			// `toolName` names the elicitation, not a tool — classifying it as one would label the card
			// with tool-permission wording for something only answerable in-session.
			await handler(
				{
					event: 'Notification',
					sessionId: 's1',
					cwd: '/repo',
					notificationType: 'elicitation_dialog',
					toolName: 'Bash',
				},
				new URLSearchParams(),
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.pendingPermission?.kind, 'elicitation');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
		} finally {
			provider.dispose();
		}
	});

	test('a non-blocking plan ask carries the session planFile', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(
				{
					event: 'SessionStart',
					sessionId: 's1',
					cwd: '/repo',
					pid: process.pid,
					planFile: '/repo/.claude/plan.md',
				},
				new URLSearchParams(),
			);
			await handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: '/repo',
					toolName: 'ExitPlanMode',
					toolInput: { plan: '# Do the thing' },
				},
				new URLSearchParams(),
			);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.pendingPermission?.kind, 'plan');
			assert.strictEqual(
				s?.pendingPermission?.planFilePath,
				'/repo/.claude/plan.md',
				'an unroutable plan ask still links the plan so the card can offer View Plan',
			);
		} finally {
			provider.dispose();
		}
	});

	// Regression guard: `settleBookkeeping` (called from the `Stop`/`StopFailure` handler) already
	// clears `bk.pendingPermission`, so an unresolved `Elicitation` doesn't latch the session at
	// `permission_requested` forever. Passes with or without the rest of this changeset — kept to
	// catch a future regression in that clear.
	test('Elicitation with no ElicitationResult does not pin the session at permission_requested after Stop', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			await handler(
				{ event: 'Elicitation', sessionId: 's1', cwd: '/repo', toolName: 'ask_permission' },
				new URLSearchParams(),
			);
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.status, 'permission_requested');

			await handler(stop('s1'), new URLSearchParams());
			// Stop → idle is debounced (stopToIdleDebounceMs = 750ms).
			await wait(900);

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(
				s?.status,
				'idle',
				'the session must settle to idle instead of staying latched at permission_requested',
			);
			assert.strictEqual(s?.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider permission ask identity gating', () => {
	// Guards the deny-storm bug: a pending blocking ask must only be settled by an event that
	// refers to the SAME ask (matching `tool_use_id`, or matching toolName + canonical `tool_input`
	// when neither side has one) — not by any `PostToolUse`/`PermissionDenied` sharing the session
	// id. Payload shapes below mirror the installed CLI: `PermissionRequest` hook input carries
	// `tool_name`/`tool_input` but NEVER `tool_use_id`; `PostToolUse`/`PermissionDenied` carry both.
	type PermissionResponseLike = { hookSpecificOutput: { decision: { behavior: string } } };

	function permissionRequest(
		sessionId: string,
		toolName: string,
		toolInput: Record<string, unknown>,
	): Record<string, unknown> {
		return {
			event: 'PermissionRequest',
			sessionId: sessionId,
			cwd: '/repo',
			toolName: toolName,
			toolInput: toolInput,
			hookInput: { tool_name: toolName, tool_input: toolInput },
		};
	}

	function postToolUseWithId(
		sessionId: string,
		toolUseId: string,
		toolName: string,
		toolInput: Record<string, unknown>,
	): Record<string, unknown> {
		return {
			event: 'PostToolUse',
			sessionId: sessionId,
			toolName: toolName,
			toolInput: toolInput,
			hookInput: { tool_use_id: toolUseId, tool_name: toolName, tool_input: toolInput },
		};
	}

	function permissionDenied(
		sessionId: string,
		toolUseId: string,
		toolName: string,
		toolInput: Record<string, unknown>,
	): Record<string, unknown> {
		return {
			event: 'PermissionDenied',
			sessionId: sessionId,
			toolName: toolName,
			toolInput: toolInput,
			hookInput: { tool_use_id: toolUseId, tool_name: toolName, tool_input: toolInput },
		};
	}

	test('PostToolUse with the same toolName but different tool_input does not deny the pending ask', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			const blocking = handler(
				permissionRequest('s1', 'Bash', { command: 'ls -la' }),
				new URLSearchParams('blocking=true'),
			);
			let settled = false;
			blocking.then(
				() => (settled = true),
				() => (settled = true),
			);

			// A different invocation of the same tool completing elsewhere — must not touch this ask.
			await handler(postToolUseWithId('s1', 'tu-2', 'Bash', { command: 'git status' }), new URLSearchParams());
			await flushMicrotasks();

			assert.strictEqual(settled, false, 'the live ask must still be pending');
			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.toolName, 'Bash');
		} finally {
			provider.dispose();
		}
	});

	test('PostToolUse with the same toolName and canonically-equal tool_input denies the pending ask', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			const blocking = handler(
				permissionRequest('s1', 'Bash', { command: 'ls -la', description: 'list files' }),
				new URLSearchParams('blocking=true'),
			);

			// Same input, keys reordered — canonicalization must still equate them.
			await handler(
				postToolUseWithId('s1', 'tu-1', 'Bash', { description: 'list files', command: 'ls -la' }),
				new URLSearchParams(),
			);

			const response = (await blocking) as PermissionResponseLike;
			assert.strictEqual(response.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('a stray PermissionDenied naming an evicted ask does not deny the ask that replaced it', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			// Ask N: evicted-denied below by ask N+1 — a genuinely different ask (different input),
			// which is the only way an ask lacking `tool_use_id` ever settles via eviction.
			const askN = handler(
				permissionRequest('s1', 'Bash', { command: 'ls -la' }),
				new URLSearchParams('blocking=true'),
			);

			// Ask N+1 replaces N.
			const askNPlus1 = handler(
				permissionRequest('s1', 'Bash', { command: 'rm -rf build' }),
				new URLSearchParams('blocking=true'),
			);

			const evicted = (await askN) as PermissionResponseLike;
			assert.strictEqual(evicted.hookSpecificOutput.decision.behavior, 'deny', 'ask N is evicted by ask N+1');

			let settled = false;
			askNPlus1.then(
				() => (settled = true),
				() => (settled = true),
			);

			// A stray PermissionDenied for ask N surfaces late, naming N's tool + input (and some
			// tool_use_id the CLI attaches) — it must not be mistaken for settling N+1: the input
			// mismatches N+1's, so the identity gate leaves N+1 untouched.
			await handler(permissionDenied('s1', 'tu-stray', 'Bash', { command: 'ls -la' }), new URLSearchParams());
			await flushMicrotasks();

			assert.strictEqual(settled, false, 'ask N+1 must survive the stray PermissionDenied');
			assert.strictEqual(
				provider.sessions.find(x => x.id === 's1')?.pendingPermission?.toolDescription,
				'Bash(rm -rf build)',
			);
		} finally {
			provider.dispose();
		}
	});

	test("a PermissionDenied matching the pending ask's name and input settles it", async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			const toolInput = { command: 'rm -rf build' };

			// Production shape: `PermissionRequest` carries no `tool_use_id`.
			const ask = handler(permissionRequest('s1', 'Bash', toolInput), new URLSearchParams('blocking=true'));

			// Auto-mode classifier denies the tool call — same tool_name, canonically-equal
			// tool_input (keys reordered), some tool_use_id the CLI attaches.
			await handler(
				permissionDenied('s1', 'tu-1', 'Bash', { command: toolInput.command }),
				new URLSearchParams(),
			);

			const response = (await ask) as PermissionResponseLike;
			assert.strictEqual(response.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('consecutive identical asks are each settled by their own PermissionDenied, nothing is left stuck', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());
			const toolInput = { command: 'rm -rf build' };

			// Ask N settles via its own genuine PermissionDenied.
			const askN = handler(permissionRequest('s1', 'Bash', toolInput), new URLSearchParams('blocking=true'));
			await handler(permissionDenied('s1', 'tu-1', 'Bash', toolInput), new URLSearchParams());
			const deniedN = (await askN) as PermissionResponseLike;
			assert.strictEqual(deniedN.hookSpecificOutput.decision.behavior, 'deny');

			// Ask N+1: the agent retries with the SAME input — identical identity to N, since
			// `PermissionRequest` carries no `tool_use_id` for either. It must settle on its own
			// genuine PermissionDenied too, not get stuck at `permission_requested` forever.
			const askNPlus1 = handler(permissionRequest('s1', 'Bash', toolInput), new URLSearchParams('blocking=true'));
			await handler(permissionDenied('s1', 'tu-2', 'Bash', toolInput), new URLSearchParams());
			const deniedNPlus1 = (await askNPlus1) as PermissionResponseLike;

			assert.strictEqual(deniedNPlus1.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('a duplicate blocking delivery (same name+input, no ids) attaches instead of evicting the first', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			const first = handler(
				permissionRequest('s1', 'Bash', { command: 'ls -la', description: 'list files' }),
				new URLSearchParams('blocking=true'),
			);
			// CLI retry after its 60s response-header timeout — same ask, keys reordered.
			const second = handler(
				permissionRequest('s1', 'Bash', { description: 'list files', command: 'ls -la' }),
				new URLSearchParams('blocking=true'),
			);

			let firstSettled = false;
			first.then(
				() => (firstSettled = true),
				() => (firstSettled = true),
			);
			await flushMicrotasks();
			assert.strictEqual(firstSettled, false, 'the duplicate delivery must attach, not evict, the first');

			assert.strictEqual(provider.resolvePermission('s1', 'allow'), true);

			const [firstResponse, secondResponse] = (await Promise.all([first, second])) as [
				PermissionResponseLike,
				PermissionResponseLike,
			];
			assert.strictEqual(firstResponse.hookSpecificOutput.decision.behavior, 'allow');
			assert.strictEqual(secondResponse.hookSpecificOutput.decision.behavior, 'allow');
		} finally {
			provider.dispose();
		}
	});

	test('a second blocking request with the same name but different input evicts and denies every resolver on the first', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			const firstRequest = () =>
				handler(permissionRequest('s1', 'Bash', { command: 'ls -la' }), new URLSearchParams('blocking=true'));

			// Two attached resolvers on the same ask (duplicate delivery) — both must be denied together.
			const firstA = firstRequest();
			const firstB = firstRequest();

			// Stays pending until dispose — hold the rejection so it doesn't go unhandled.
			const second = handler(
				permissionRequest('s1', 'Bash', { command: 'rm -rf build' }),
				new URLSearchParams('blocking=true'),
			);
			second.catch(() => {});

			const [responseA, responseB] = (await Promise.all([firstA, firstB])) as [
				PermissionResponseLike,
				PermissionResponseLike,
			];
			assert.strictEqual(responseA.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(responseB.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(
				provider.sessions.find(x => x.id === 's1')?.pendingPermission?.toolDescription,
				'Bash(rm -rf build)',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a PostToolUse with a real tool name clears an empty-name pending ask (legacy degraded payload)', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			// No `tool_name` anywhere in the payload — registers with an empty identity.
			const blocking = handler(
				{ event: 'PermissionRequest', sessionId: 's1', cwd: '/repo', toolInput: { command: 'ls -la' } },
				new URLSearchParams('blocking=true'),
			);

			await handler(postToolUseWithId('s1', 'tu-1', 'Bash', { command: 'ls -la' }), new URLSearchParams());

			const response = (await blocking) as PermissionResponseLike;
			assert.strictEqual(response.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});

	// `bk.pendingPermission` (the field `clearStalePermission`'s display-only branch gates on) is
	// only ever populated two ways: the blocking-routable path (which also has a `_pendingPermissions`
	// map entry, so it's settled through the FIRST branch, not this one) and `Elicitation`. A
	// non-blocking `PermissionRequest`'s synthesized ask lives solely in the session's own
	// `pendingPermission` field and isn't gated at all — any later non-`permission_requested` status
	// update clears it regardless of tool name (unchanged HEAD behavior, not under test here).
	// `Elicitation` is therefore the only live path that exercises the display-only branch.
	test('the display-only branch (Elicitation ask) is gated by toolName alone', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			await handler(
				{ event: 'Elicitation', sessionId: 's1', cwd: '/repo', toolName: 'ask_permission' },
				new URLSearchParams(),
			);
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.status, 'permission_requested');

			// A different tool completing elsewhere must not touch the elicitation ask.
			await handler(
				postToolUseWithId('s1', 'tu-1', 'Edit', { file_path: '/repo/file.ts' }),
				new URLSearchParams(),
			);
			assert.strictEqual(
				provider.sessions.find(x => x.id === 's1')?.status,
				'permission_requested',
				'a different tool must not clear the elicitation ask',
			);

			// The matching tool name clears it.
			await handler(postToolUseWithId('s1', 'tu-2', 'ask_permission', {}), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.status, 'thinking');
		} finally {
			provider.dispose();
		}
	});

	test('UserPromptSubmit still clears a pending ask unconditionally', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start(['/repo']);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', '/repo'), new URLSearchParams());

			const blocking = handler(
				permissionRequest('s1', 'Bash', { command: 'ls -la' }),
				new URLSearchParams('blocking=true'),
			);

			await handler(
				{ event: 'UserPromptSubmit', sessionId: 's1', cwd: '/repo', prompt: 'continue please' },
				new URLSearchParams(),
			);

			const response = (await blocking) as PermissionResponseLike;
			assert.strictEqual(response.hookSpecificOutput.decision.behavior, 'deny');
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider poll-discovered live rows', () => {
	const REPO = '/home/user/projectB';

	test('a poll-discovered live row with a pending PermissionRequest gets a synthesized unresolvable ask', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-perm', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'polled-perm');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
			assert.strictEqual(s?.pendingPermission?.toolName, 'Bash');
		} finally {
			provider.dispose();
		}
	});

	test('a poll-discovered live row seats worktreePath from the CLI record', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{
					...sessionFileData('polled-wt', REPO),
					cwdTimeline: [{ cwd: REPO, worktree: REPO, at: '2026-07-10T00:00:00.000Z' }],
				},
			]),
			resolveGitInfo: () => Promise.resolve(undefined),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'polled-wt');
			assert.strictEqual(s?.worktreePath, REPO, 'worktreePath comes straight from the record');
		} finally {
			provider.dispose();
		}
	});

	test('the follow-up git probe does not overwrite a record-seated worktreePath', async () => {
		const worktree = `${REPO}.worktrees/feature`;
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{
					...sessionFileData('polled-nested', worktree),
					cwdTimeline: [{ cwd: worktree, worktree: worktree, at: '2026-07-10T00:00:00.000Z' }],
				},
			]),
			// The probe answers for the parent repo, as it does for a nested worktree cwd.
			resolveGitInfo: () => Promise.resolve({ repoRoot: REPO, worktreePath: REPO, isWorktree: false }),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'polled-nested');
			assert.strictEqual(s?.worktreePath, worktree, 'the record-seated worktree wins over the probe');
			assert.strictEqual(s?.commonPath, REPO, 'repo identity still comes from the probe');
		} finally {
			provider.dispose();
		}
	});

	test('a later poll clears a synthesized ask the record has moved past', async () => {
		const options: { cliResponse?: string } = {
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-stale', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
		};
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.strictEqual(
				provider.sessions.find(x => x.id === 'polled-stale')?.pendingPermission?.resolvable,
				false,
				'the first poll synthesizes the ask',
			);

			// The user answered in the agent's own session — this window never sees that, so only the
			// record's advance can retire the card.
			options.cliResponse = JSON.stringify([
				{
					...sessionFileData('polled-stale', REPO),
					event: 'PreToolUse',
					toolName: 'Edit',
					updatedAt: '2024-01-01T00:05:00.000Z',
				},
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'polled-stale');
			assert.strictEqual(s?.pendingPermission, undefined, 'the stale synthesized ask must be dropped');
			assert.strictEqual(s?.status, 'tool_use', 'the row takes the record’s newer status');
			assert.strictEqual(s?.statusDetail, 'Edit', 'the detail follows the record’s tool, not the answered ask’s');
		} finally {
			provider.dispose();
		}
	});

	test("a poll-discovered row seeds from Claude's live listing instead of the record's frozen last event", async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-frozen', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
			liveAgentSessions: [{ sessionId: 'polled-frozen', kind: 'interactive', status: 'idle' }],
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const sessions = provider.sessions.filter(x => x.id === 'polled-frozen');
			assert.strictEqual(sessions.length, 1);
			assert.strictEqual(sessions[0].status, 'idle', "the listing's now-status wins over the frozen record");
			assert.strictEqual(sessions[0].phase, 'idle');
			assert.strictEqual(sessions[0].pendingPermission, undefined, 'no ask when the listing reports none');
		} finally {
			provider.dispose();
		}
	});

	test('a genuine permission prompt in the listing still seeds needs input', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-perm-live', REPO), event: 'Stop', toolName: 'Bash' },
			]),
			liveAgentSessions: [
				{
					sessionId: 'polled-perm-live',
					kind: 'interactive',
					status: 'waiting',
					waitingFor: 'permission prompt',
				},
			],
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'polled-perm-live');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
			assert.strictEqual(s?.pendingPermission?.kind, 'tool');
		} finally {
			provider.dispose();
		}
	});

	test('an active record the listing reports finished is not seeded as live', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([sessionFileData('polled-done', REPO)]),
			liveAgentSessions: [{ sessionId: 'polled-done', kind: 'background', state: 'stopped' }],
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			assert.strictEqual(
				provider.sessions.length,
				0,
				'a terminal background state is not aliveness — the row must not be seeded',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a session absent from the listing falls back to the record-derived status', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-absent', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
			liveAgentSessions: [],
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'polled-absent');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.resolvable, false);
		} finally {
			provider.dispose();
		}
	});

	test('a later poll heals a row stuck on an unresolvable ask when the listing moves past it', async () => {
		const options: {
			cliResponse?: string;
			liveAgentSessions?: { sessionId: string; kind?: string; status?: string; waitingFor?: string }[];
		} = {
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-stuck', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
			liveAgentSessions: [
				{ sessionId: 'polled-stuck', kind: 'interactive', status: 'waiting', waitingFor: 'permission prompt' },
			],
		};
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.strictEqual(
				provider.sessions.find(x => x.id === 'polled-stuck')?.pendingPermission?.resolvable,
				false,
				'the first poll synthesizes the ask',
			);

			// The user answered natively and the session moved on, but the record never advanced —
			// only the listing's fresh sample can retire the stuck card.
			options.liveAgentSessions = [{ sessionId: 'polled-stuck', kind: 'interactive', status: 'busy' }];
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'polled-stuck');
			assert.strictEqual(s?.status, 'thinking', "the listing's moved-on status heals the row");
			assert.strictEqual(s?.pendingPermission, undefined, 'the stale synthesized ask must be dropped');
		} finally {
			provider.dispose();
		}
	});

	test('a later poll removes a synthesized ask when the listing reports a terminal state', async () => {
		const options: {
			cliResponse?: string;
			liveAgentSessions?: {
				sessionId: string;
				kind?: string;
				status?: string;
				state?: string;
				waitingFor?: string;
			}[];
		} = {
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-stopped', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
			liveAgentSessions: [
				{
					sessionId: 'polled-stopped',
					kind: 'interactive',
					status: 'waiting',
					waitingFor: 'permission prompt',
				},
			],
		};
		const { callbacks, syncDiscrepancies } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.strictEqual(
				provider.sessions.find(x => x.id === 'polled-stopped')?.pendingPermission?.resolvable,
				false,
				'the first poll synthesizes the ask',
			);

			// The active record is frozen on the ask, while Claude's listing says the background
			// session has stopped. Even if the durable record advanced in the meantime, the terminal
			// listing wins: otherwise the Stop-derived idle status would leave a false live row.
			options.cliResponse = JSON.stringify([
				{
					...sessionFileData('polled-stopped', REPO),
					event: 'Stop',
					updatedAt: '2024-01-02T00:00:00.000Z',
				},
			]);
			options.liveAgentSessions = [{ sessionId: 'polled-stopped', kind: 'background', state: 'stopped' }];
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.find(x => x.id === 'polled-stopped'),
				undefined,
				'the terminal listing must retire the stale needs-input row',
			);
			assert.deepStrictEqual(
				syncDiscrepancies,
				[{ provider: 'claudeCode', discovered: 0, missing: 1, polled: 0, tracked: 1 }],
				'terminal listing entries must not count as polled-alive sessions',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a routable ask is never corrected by the listing', async () => {
		const options: {
			cliResponse?: string;
			liveAgentSessions?: { sessionId: string; kind?: string; status?: string; state?: string }[];
		} = { liveAgentSessions: [{ sessionId: 'routable-1', kind: 'background', state: 'stopped' }] };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const handler = handlers.get('agents/session')!;
			const blocking = handler(
				{
					event: 'PermissionRequest',
					sessionId: 'routable-1',
					cwd: REPO,
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
				},
				new URLSearchParams('blocking=true'),
			);
			blocking.catch(() => {});

			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('routable-1', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'routable-1');
			assert.notStrictEqual(s?.pendingPermission, undefined, 'a routable ask is bookkeeping-owned');
			assert.notStrictEqual(s?.pendingPermission?.resolvable, false, 'the listing must not unresolvable it');
			assert.strictEqual(s?.status, 'permission_requested', 'the listing must not preempt a routable ask');
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider worktree attribution', () => {
	const REPO = '/repo';
	const WORKTREE = '/repo.worktrees/feature';

	test('a blocking PermissionRequest as the first event seats the session location', async () => {
		const { callbacks, handlers } = createMockCallbacks({
			// Never resolves — the row must be attributed from the event alone, for the whole time the
			// agent sits blocked on the ask.
			resolveGitInfo: () => new Promise(() => {}),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			// No SessionStart — this window cold-joined while the agent was already waiting, so the ask
			// itself creates the row.
			const blocking = handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: WORKTREE,
					pid: process.pid,
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
					cwdTimeline: [{ cwd: WORKTREE, worktree: WORKTREE }],
				},
				new URLSearchParams('blocking=true'),
			);
			blocking.catch(() => {});

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.cwd, WORKTREE);
			assert.strictEqual(s?.worktreePath, WORKTREE, 'the blocked row carries the CLI-resolved worktree');
		} finally {
			provider.dispose();
		}
	});

	test('a git probe does not overwrite a CLI-seated worktreePath', async () => {
		// The probe answers for whichever repo the host registry matches, which for a nested or
		// linked-worktree cwd can be the parent — filing the session under the wrong WIP row.
		const { callbacks, handlers } = createMockCallbacks({
			resolveGitInfo: () => Promise.resolve({ repoRoot: REPO, worktreePath: REPO, isWorktree: false }),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{
					event: 'SessionStart',
					sessionId: 's1',
					cwd: WORKTREE,
					pid: process.pid,
					cwdTimeline: [{ cwd: WORKTREE, worktree: WORKTREE }],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.worktreePath, WORKTREE, 'the CLI-seated worktree wins over the probe');
			assert.strictEqual(s?.commonPath, REPO, 'repo identity still comes from the probe');
			assert.strictEqual(s?.initialWorktreePath, WORKTREE);
		} finally {
			provider.dispose();
		}
	});

	test('a cd inside the CLI-seated worktree fires no git probe', async () => {
		let gitInfoCalls = 0;
		const { callbacks, handlers } = createMockCallbacks({
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve({ repoRoot: REPO, worktreePath: WORKTREE, isWorktree: true });
			},
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{
					event: 'SessionStart',
					sessionId: 's1',
					cwd: WORKTREE,
					pid: process.pid,
					cwdTimeline: [{ cwd: WORKTREE, worktree: WORKTREE }],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();
			assert.strictEqual(gitInfoCalls, 1, 'the creating event resolves repo identity once');

			// A cd into a subdir of the same worktree. The CLI already attributed it to the same
			// worktree, so there is nothing left to resolve — probing here means a git call per event.
			await handler(
				{
					event: 'PreToolUse',
					sessionId: 's1',
					cwd: `${WORKTREE}/src`,
					toolName: 'Read',
					cwdTimeline: [
						{ cwd: WORKTREE, worktree: WORKTREE },
						{ cwd: `${WORKTREE}/src`, worktree: WORKTREE },
					],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();
			await flushMicrotasks();

			assert.strictEqual(gitInfoCalls, 1, 'an intra-worktree cd must not re-probe');
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.worktreePath, WORKTREE);
		} finally {
			provider.dispose();
		}
	});

	test('CwdChanged hands attribution back to the probe when the CLI does not explain the move', async () => {
		// Writing `cwd` directly (the old handler) left `cliSeatedWorktree` set, so the probe's answer
		// for the new location could never replace the stale seated worktree.
		const ELSEWHERE = '/elsewhere/repo';
		const { callbacks, handlers } = createMockCallbacks({
			resolveGitInfo: (cwd: string) =>
				Promise.resolve(
					cwd === ELSEWHERE
						? { repoRoot: ELSEWHERE, worktreePath: ELSEWHERE, isWorktree: false }
						: { repoRoot: REPO, worktreePath: WORKTREE, isWorktree: true },
				),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{
					event: 'SessionStart',
					sessionId: 's1',
					cwd: WORKTREE,
					pid: process.pid,
					cwdTimeline: [{ cwd: WORKTREE, worktree: WORKTREE }],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.worktreePath, WORKTREE);

			await handler(
				{ event: 'CwdChanged', sessionId: 's1', cwd: ELSEWHERE, pid: process.pid },
				new URLSearchParams(),
			);
			await flushMicrotasks();
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.cwd, ELSEWHERE);
			assert.strictEqual(s?.worktreePath, ELSEWHERE, 'the probe re-owns attribution after the move');
			assert.strictEqual(s?.commonPath, ELSEWHERE);
		} finally {
			provider.dispose();
		}
	});

	test('workspace membership follows the attribution, not the raw cwd', async () => {
		// A scratch-dir excursion (cwd in /tmp, worktree kept) must stay in-workspace via its
		// worktree; a genuine re-root to a repo outside the workspace drops membership.
		const ELSEWHERE = '/elsewhere/repo';
		const { callbacks, handlers } = createMockCallbacks({
			resolveGitInfo: (cwd: string) =>
				Promise.resolve(
					cwd === ELSEWHERE
						? { repoRoot: ELSEWHERE, worktreePath: ELSEWHERE, isWorktree: false }
						: cwd.startsWith('/tmp')
							? undefined
							: { repoRoot: REPO, worktreePath: WORKTREE, isWorktree: true },
				),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([WORKTREE]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{
					event: 'SessionStart',
					sessionId: 's1',
					cwd: WORKTREE,
					pid: process.pid,
					cwdTimeline: [{ cwd: WORKTREE, worktree: WORKTREE }],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();

			// Excursion into scratch space: no timeline entry resolves it, the probe finds no repo.
			await handler(
				{ event: 'PreToolUse', sessionId: 's1', cwd: '/tmp/scratch', toolName: 'Bash' },
				new URLSearchParams(),
			);
			await flushMicrotasks();

			let s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.worktreePath, WORKTREE, 'attribution is kept');
			assert.strictEqual(s?.workspacePath, WORKTREE, 'membership rides on the kept worktree');
			assert.strictEqual(s?.isInWorkspace, true);

			// Genuine re-root: the probe resolves a different repo outside the workspace; the next
			// event's recompute sees the new attribution and drops membership.
			await handler(
				{ event: 'CwdChanged', sessionId: 's1', cwd: ELSEWHERE, pid: process.pid },
				new URLSearchParams(),
			);
			await flushMicrotasks();
			await flushMicrotasks();
			await handler(
				{ event: 'PreToolUse', sessionId: 's1', cwd: ELSEWHERE, toolName: 'Bash' },
				new URLSearchParams(),
			);
			await flushMicrotasks();

			s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.worktreePath, ELSEWHERE);
			assert.strictEqual(s?.workspacePath, undefined, 'membership honestly drops after a real re-root');
			assert.strictEqual(s?.isInWorkspace, false);
		} finally {
			provider.dispose();
		}
	});

	test('a worktree move with the SAME cwd still re-probes and refills commonPath', async () => {
		// `locationNeedsProbe` used to require `cwdMoved`, so a CLI-attributed worktree move that
		// arrives with the same cwd (cwdTimeline updated, cwd unchanged) never re-fired the probe.
		// The scratch-cwd fallback fills `commonPath` from the first worktree, latches
		// `gitInfoUnresolvable`, and nothing afterward could ever clear it to refill for the new one.
		const SCRATCH = '/tmp/scratch';
		const REPO_A = '/repoA';
		const REPO_B = '/repoB';
		const { callbacks, handlers } = createMockCallbacks({
			resolveGitInfo: (cwd: string) =>
				Promise.resolve(cwd === SCRATCH ? undefined : { repoRoot: cwd, worktreePath: cwd, isWorktree: false }),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO_A, REPO_B]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{
					event: 'SessionStart',
					sessionId: 's1',
					cwd: SCRATCH,
					pid: process.pid,
					cwdTimeline: [{ cwd: SCRATCH, worktree: REPO_A }],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();
			await flushMicrotasks();

			let s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.worktreePath, REPO_A);
			assert.strictEqual(s?.commonPath, REPO_A, 'the fallback probe fills commonPath from repoA');

			// Same cwd, but the CLI now attributes the session to a different worktree.
			await handler(
				{
					event: 'PreToolUse',
					sessionId: 's1',
					cwd: SCRATCH,
					toolName: 'Read',
					cwdTimeline: [{ cwd: SCRATCH, worktree: REPO_B }],
				},
				new URLSearchParams(),
			);
			await flushMicrotasks();
			await flushMicrotasks();

			s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.worktreePath, REPO_B, 'attribution follows the CLI-explained move');
			assert.strictEqual(s?.commonPath, REPO_B, 'commonPath is refilled for the new worktree');
		} finally {
			provider.dispose();
		}
	});
});

// Phase 5 extends this suite with real per-agent coverage (native event/tool vocabularies, the
// capability-flag degradations). What it pins today is only the admission boundary: which hook
// clients are accepted at all, and that the accepted ones land under their own agent identity.
suite('GkAgentProvider host filtering (providerId)', () => {
	const REPO = '/repo';

	suite('IPC events', () => {
		test('tracks an event from another supported AI host under that agent’s identity', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				// codex event names are identical to Claude's, so this is processed in full.
				await handler(sessionStart('codex-1', REPO, 'codex'), new URLSearchParams());

				assert.strictEqual(provider.sessions.length, 1, 'a supported host’s event must create a session');
				assert.strictEqual(provider.sessions[0].providerId, 'codex');
				assert.strictEqual(provider.sessions[0].providerName, 'Codex');
			} finally {
				provider.dispose();
			}
		});

		test('ignores an event from a hook client with no descriptor', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('cursor-1', REPO, 'cursor'), new URLSearchParams());

				assert.strictEqual(
					provider.sessions.length,
					0,
					'a client we cannot interpret must not create a session',
				);
			} finally {
				provider.dispose();
			}
		});

		test('ignores an event whose native name has no canonical equivalent', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				// `session.updated` is deliberately unmapped — see `openCodeCapabilities.eventMap`.
				await handler(
					{ event: 'session.updated', sessionId: 'opencode-1', providerId: 'opencode', cwd: REPO },
					new URLSearchParams(),
				);

				assert.strictEqual(
					provider.sessions.length,
					0,
					'an unresolvable event must not reach the status switch, nor create a row',
				);
			} finally {
				provider.dispose();
			}
		});

		test('resolves an opencode native event through the capability table', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				await handler(
					{ event: 'session.created', sessionId: 'opencode-1', providerId: 'opencode', cwd: REPO },
					new URLSearchParams(),
				);

				assert.strictEqual(provider.sessions.length, 1);
				assert.strictEqual(provider.sessions[0].providerId, 'opencode');
			} finally {
				provider.dispose();
			}
		});

		test('tracks an event explicitly stamped claude-code', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('claude-1', REPO, 'claude-code'), new URLSearchParams());

				assert.strictEqual(provider.sessions.length, 1);
				assert.strictEqual(provider.sessions[0].id, 'claude-1');
			} finally {
				provider.dispose();
			}
		});

		test('tracks an event with no providerId (older CLI fails open)', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				await handler(sessionStart('legacy-1', REPO), new URLSearchParams());

				assert.strictEqual(
					provider.sessions.length,
					1,
					'an older CLI stamps no providerId — dropping it would lose every session',
				);
			} finally {
				provider.dispose();
			}
		});

		test('surfaces a non-Claude blocking PermissionRequest observe-only, without answering it', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new GkAgentProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				const response = await handler(
					{
						event: 'PermissionRequest',
						sessionId: 'copilot-1',
						providerId: 'copilot',
						cwd: REPO,
						toolName: 'bash',
						toolInput: { command: 'rm -rf /' },
					},
					new URLSearchParams('blocking=true'),
				);

				// The response we build is Claude-shaped, so we must not answer for another agent —
				// the CLI waits out its own hook timeout. Per-agent response builders are phase 6.
				assert.strictEqual(response, undefined, 'no permission decision may be returned');
				assert.strictEqual(provider.sessions.length, 1);
				const ask = provider.sessions[0].pendingPermission;
				assert.strictEqual(ask?.resolvable, false, 'the ask must be surfaced as unanswerable');
				// `bash` → `Bash` via copilot's alias table, so the card reads like every other one.
				assert.strictEqual(ask?.toolName, 'Bash');
				assert.strictEqual(
					provider.resolvePermission('copilot-1', 'allow'),
					false,
					'resolvePermission must refuse an agent whose asks we cannot route',
				);
			} finally {
				provider.dispose();
			}
		});
	});

	suite('reconciliation poll', () => {
		test('imports every supported and unstamped record, and reports drift per agent', async () => {
			const { callbacks, syncDiscrepancies } = createMockCallbacks({
				cliResponse: JSON.stringify([
					sessionFileData('claude-1', REPO, 'claude-code'),
					sessionFileData('codex-1', REPO, 'codex'),
					sessionFileData('opencode-1', REPO, 'opencode'),
					sessionFileData('legacy-1', REPO),
					// No descriptor — the CLI supports more clients than the capability table does.
					sessionFileData('cursor-1', REPO, 'cursor'),
				]),
			});
			const provider = new GateTestProvider(callbacks);
			try {
				await provider.runGatedSync();

				assert.deepStrictEqual(
					provider.sessions.map(s => s.id).sort(),
					['claude-1', 'codex-1', 'legacy-1', 'opencode-1'],
					'every record from a client we have a descriptor for must be tracked',
				);
				assert.deepStrictEqual(
					provider.sessions.map(s => s.providerId).sort(),
					['claudeCode', 'claudeCode', 'codex', 'opencode'],
					'an unstamped record is Claude Code, matching the live path',
				);
				// One report per agent — pooling them would average away a per-agent reliability gap.
				// A client with no descriptor stays out of every count.
				assert.deepStrictEqual(
					[...syncDiscrepancies].sort((a, b) => a.provider.localeCompare(b.provider)),
					[
						{ provider: 'claudeCode', discovered: 2, missing: 0, polled: 2, tracked: 0 },
						{ provider: 'codex', discovered: 1, missing: 0, polled: 1, tracked: 0 },
						{ provider: 'opencode', discovered: 1, missing: 0, polled: 1, tracked: 0 },
					],
				);
			} finally {
				provider.dispose();
			}
		});

		test('creates an ended row for another supported host’s ended record', async () => {
			const { callbacks } = createMockCallbacks({
				cliResponse: JSON.stringify([
					{
						sessionId: 'opencode-ended',
						providerId: 'opencode',
						event: 'session.deleted',
						cwd: REPO,
						pid: 999999,
						status: 'ended',
						endReason: 'session-end',
						endedAt: '2026-07-10T00:00:00.000Z',
						updatedAt: '2026-07-10T00:00:00.000Z',
					},
				]),
			});
			const provider = new GateTestProvider(callbacks);
			try {
				await provider.runGatedSync();

				assert.strictEqual(provider.sessions.length, 1);
				assert.strictEqual(provider.sessions[0].status, 'ended');
				assert.strictEqual(provider.sessions[0].providerId, 'opencode');
			} finally {
				provider.dispose();
			}
		});

		test('does not create a row for a hook client with no descriptor', async () => {
			const { callbacks } = createMockCallbacks({
				cliResponse: JSON.stringify([
					{
						sessionId: 'cursor-ended',
						providerId: 'cursor',
						event: 'Stop',
						cwd: REPO,
						pid: 999999,
						status: 'ended',
						endReason: 'session-end',
						endedAt: '2026-07-10T00:00:00.000Z',
						updatedAt: '2026-07-10T00:00:00.000Z',
					},
				]),
			});
			const provider = new GateTestProvider(callbacks);
			try {
				await provider.runGatedSync();

				assert.strictEqual(
					provider.sessions.length,
					0,
					'a record we cannot interpret must not surface as ended',
				);
			} finally {
				provider.dispose();
			}
		});
	});
});

suite('GkAgentProvider sharesPids pruning', () => {
	const REPO = '/repo';
	// Not a live process — same convention `endedRecord` uses above: pid liveness pruning must
	// see this as dead.
	const deadPid = 999999;

	test('a pid-sharing agent (codex) is never pid-pruned, unlike an agent that owns its pid (Claude)', async () => {
		const { callbacks, handlers } = createMockCallbacks({ cliResponse: '[]' });
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'SessionStart', sessionId: 'codex-dead', cwd: REPO, pid: deadPid, providerId: 'codex' },
				new URLSearchParams(),
			);
			await handler(
				{
					event: 'SessionStart',
					sessionId: 'claude-dead',
					cwd: REPO,
					pid: deadPid,
					providerId: 'claude-code',
				},
				new URLSearchParams(),
			);
			assert.strictEqual(provider.sessions.length, 2, 'both sessions tracked before the prune runs');

			// The gated poll's list-sessions response is empty, so this exercises pruneDeadSessions'
			// pid-liveness path in isolation from record-based (poll) reconciliation.
			await provider.runGatedSync();

			assert.ok(
				provider.sessions.some(s => s.id === 'codex-dead'),
				'a session whose agent multiplexes pids must survive pid pruning even with a dead pid — a shared ' +
					'pid only proves the host process state, not this session',
			);
			assert.strictEqual(
				provider.sessions.some(s => s.id === 'claude-dead'),
				false,
				'a Claude session with the SAME dead pid must be pruned — isolates the difference to the ' +
					'sharesPids flag, not some other condition',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a codex session still ends via a SessionEnd event despite sharesPids', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'SessionStart', sessionId: 'codex-1', cwd: REPO, pid: deadPid, providerId: 'codex' },
				new URLSearchParams(),
			);
			await handler({ event: 'SessionEnd', sessionId: 'codex-1' }, new URLSearchParams());

			const s = provider.sessions.find(x => x.id === 'codex-1');
			assert.ok(s != null, 'SessionEnd must still identify and terminate a pid-sharing session');
			assert.strictEqual(s.status, 'ended');
			assert.strictEqual(s.phase, 'ended');
		} finally {
			provider.dispose();
		}
	});

	test('a codex session still ends via the poll reporting a durable ended record despite sharesPids', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{
					sessionId: 'codex-ended',
					providerId: 'codex',
					event: 'Stop',
					cwd: REPO,
					pid: deadPid,
					status: 'ended',
					endReason: 'session-end',
					endedAt: '2026-07-10T00:00:00.000Z',
					updatedAt: '2026-07-10T00:00:00.000Z',
				},
			]),
		});
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'codex-ended');
			assert.ok(s != null, "the poll's durable ended record must still surface the session");
			assert.strictEqual(s.status, 'ended');
			assert.strictEqual(s.providerId, 'codex');
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider opencode session.status resolution', () => {
	const REPO = '/repo';

	/** A `session.status` event whose `hookInput` matches the CLI's generated OpenCode plugin
	 *  shape: `hook_payload.event.properties.status.type` from the hook-input root. */
	function sessionStatus(sessionId: string, statusType: string): Record<string, unknown> {
		return {
			event: 'session.status',
			sessionId: sessionId,
			providerId: 'opencode',
			cwd: REPO,
			hookInput: {
				hook_payload: { event: { type: 'session.status', properties: { status: { type: statusType } } } },
			},
		};
	}

	test('a busy session.status is deliberately unresolvable and never reaches the status switch', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'session.created', sessionId: 'oc-1', providerId: 'opencode', cwd: REPO },
				new URLSearchParams(),
			);
			const before = provider.sessions.find(s => s.id === 'oc-1');
			assert.strictEqual(before?.status, 'idle');

			await handler(sessionStatus('oc-1', 'busy'), new URLSearchParams());

			// `busy` maps to no canonical event on purpose. A canonical event brings its whole handler
			// with it, so naming `PostToolUse` here (as this once did) would clear a pending permission
			// ask while the agent is still blocked on it and desync the parallel-tool refcount — OpenCode
			// emits `session.status` independently of tool lifecycle. Do not "fix" this back: there is no
			// tool-free canonical event meaning "resumed working".
			assert.strictEqual(
				provider.sessions.find(x => x.id === 'oc-1'),
				before,
				'busy must never reach the status switch, so the row is untouched',
			);
		} finally {
			provider.dispose();
		}
	});

	test('an idle session.status resolves through the provider to the phase Stop produces, after the debounce', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'session.created', sessionId: 'oc-2', providerId: 'opencode', cwd: REPO },
				new URLSearchParams(),
			);
			// Move off idle first so the eventual Stop-phase transition is a real state change, not a
			// no-op. Uses a native tool event because `busy` is deliberately unresolvable (see above).
			await handler(
				{ event: 'tool.execute.before', sessionId: 'oc-2', providerId: 'opencode', cwd: REPO },
				new URLSearchParams(),
			);
			assert.strictEqual(provider.sessions.find(s => s.id === 'oc-2')?.status, 'tool_use');

			await handler(sessionStatus('oc-2', 'idle'), new URLSearchParams());
			// Stop defers its idle commit by `stopToIdleDebounceMs` (750ms).
			await wait(900);

			const s = provider.sessions.find(x => x.id === 'oc-2');
			assert.strictEqual(s?.status, 'idle', 'idle must resolve through the seam to the Stop-produced status');
			assert.strictEqual(s?.phase, 'idle');
		} finally {
			provider.dispose();
		}
	});

	test('a retry status, a malformed hook_payload, and an absent hookInput are all ignored', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'session.created', sessionId: 'oc-3', providerId: 'opencode', cwd: REPO },
				new URLSearchParams(),
			);
			const before = provider.sessions.find(s => s.id === 'oc-3');
			assert.ok(before != null);

			// `retry` carries no status change resolveEvent can canonicalize.
			await handler(sessionStatus('oc-3', 'retry'), new URLSearchParams());
			// `hook_payload` isn't the expected object shape at all.
			await handler(
				{
					event: 'session.status',
					sessionId: 'oc-3',
					providerId: 'opencode',
					cwd: REPO,
					hookInput: { hook_payload: 'not-an-object' },
				},
				new URLSearchParams(),
			);
			// No `hookInput` at all (older CLI, or a client that doesn't relay it for this event).
			await handler(
				{ event: 'session.status', sessionId: 'oc-3', providerId: 'opencode', cwd: REPO },
				new URLSearchParams(),
			);

			assert.strictEqual(provider.sessions.length, 1, 'no new session may be created by an ignored event');
			const after = provider.sessions.find(s => s.id === 'oc-3');
			assert.strictEqual(
				after,
				before,
				'an unresolvable session.status must never reach the status switch, so the row is untouched',
			);
		} finally {
			provider.dispose();
		}
	});

	test('the reconciliation poll resolves a session.status record from its relayed hookInput', async () => {
		// The poll is the only way a pre-existing session enters after a window reload, so it must hand
		// `hookInput` to the resolver too — without it, `session.status` is permanently unresolvable
		// there and the record's native name falls through untranslated.
		//
		// Note this pins the WIRING, not a status divergence: `deriveStatusFromEvent` returns `idle` for
		// `Stop` and also for its `default`, so an unresolved fallthrough happens to land on the same
		// status today. The assertion exists so the resolver stays reachable from this path — the moment
		// any resolvable native event derives something other than `idle`, this becomes load-bearing.
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{
					...sessionFileData('oc-polled', REPO, 'opencode'),
					event: 'session.status',
					hookInput: { hook_payload: { event: { properties: { status: { type: 'idle' } } } } },
				},
			]),
		});
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'oc-polled');
			assert.ok(s != null, 'the polled opencode record must surface a session');
			assert.strictEqual(s.providerId, 'opencode');
			assert.strictEqual(s.status, 'idle', "must be the status 'Stop' derives, not a raw native fallthrough");
			assert.strictEqual(s.phase, 'idle');
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider opencode native lifecycle', () => {
	const REPO = '/repo';

	test('a full opencode lifecycle through native dotted event names', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;

			await handler(
				{
					event: 'session.created',
					sessionId: 'oc-life',
					providerId: 'opencode',
					cwd: REPO,
					pid: process.pid,
				},
				new URLSearchParams(),
			);
			let s = provider.sessions.find(x => x.id === 'oc-life');
			assert.ok(s != null, 'session.created must surface the session');
			assert.strictEqual(s.providerId, 'opencode');
			assert.strictEqual(s.status, 'idle');

			await handler(
				{
					event: 'tool.execute.before',
					sessionId: 'oc-life',
					providerId: 'opencode',
					cwd: REPO,
					toolName: 'bash',
					toolInput: { command: 'ls' },
				},
				new URLSearchParams(),
			);
			s = provider.sessions.find(x => x.id === 'oc-life');
			assert.strictEqual(s?.status, 'tool_use', 'tool.execute.before must reach a working phase during the call');
			assert.strictEqual(s?.phase, 'working');

			await handler(
				{
					event: 'tool.execute.after',
					sessionId: 'oc-life',
					providerId: 'opencode',
					cwd: REPO,
					toolName: 'bash',
					toolInput: { command: 'ls' },
				},
				new URLSearchParams(),
			);
			s = provider.sessions.find(x => x.id === 'oc-life');
			assert.strictEqual(s?.phase, 'working', 'still working (thinking) immediately after the tool call ends');

			await handler(
				{
					event: 'session.status',
					sessionId: 'oc-life',
					providerId: 'opencode',
					cwd: REPO,
					hookInput: {
						hook_payload: { event: { type: 'session.status', properties: { status: { type: 'idle' } } } },
					},
				},
				new URLSearchParams(),
			);
			await wait(900); // Stop → idle debounce (stopToIdleDebounceMs = 750ms).
			s = provider.sessions.find(x => x.id === 'oc-life');
			assert.strictEqual(s?.status, 'idle', 'session.status idle must return the session to idle');
			assert.strictEqual(s?.phase, 'idle');

			await handler(
				{ event: 'session.deleted', sessionId: 'oc-life', providerId: 'opencode', cwd: REPO },
				new URLSearchParams(),
			);
			s = provider.sessions.find(x => x.id === 'oc-life');
			assert.strictEqual(s?.status, 'ended', 'session.deleted must end the session');
			assert.strictEqual(s?.phase, 'ended');
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider tool-name canonicalization reaches fileActivity', () => {
	const REPO = '/repo';
	const FILE = '/repo/src/foo.ts';

	// Both tests deliver tool data ONLY as the CLI actually relays it: verbatim inside `hookInput`.
	// The top-level `toolInput` field is legacy and no current CLI populates it for any agent, so a
	// test that fills it proves nothing about production.
	test("a codex apply_patch PreToolUse registers edit fileActivity through the agent's real payload", async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'SessionStart', sessionId: 'cdx-1', providerId: 'codex', cwd: REPO, pid: process.pid },
				new URLSearchParams(),
			);

			// Codex speaks snake_case, so its raw payload lands as `hookInput.tool_name` /
			// `hookInput.tool_input` — exactly the keys GitLens reads.
			await handler(
				{
					event: 'PreToolUse',
					sessionId: 'cdx-1',
					providerId: 'codex',
					hookInput: { tool_name: 'apply_patch', tool_input: { file_path: FILE } },
				},
				new URLSearchParams(),
			);

			const entry = fileActivityOf(provider, 'cdx-1').find(e => e.path === FILE);
			assert.ok(
				entry != null,
				"'apply_patch' → 'Edit' via codex's alias table must reach getToolFilePath and register edit activity",
			);
			assert.strictEqual(entry.editing, true);
			assert.strictEqual(entry.reading, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('a copilot create PreToolUse registers no fileActivity — a known, pinned limitation', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new GkAgentProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(
				{ event: 'SessionStart', sessionId: 'cop-1', providerId: 'copilot', cwd: REPO, pid: process.pid },
				new URLSearchParams(),
			);

			// Copilot speaks camelCase, so its raw payload lands as `hookInput.toolName` /
			// `hookInput.toolInput`. The CLI's `normalizeCopilotInput` copies the NAME up onto the record
			// (hence the top-level `toolName` here), but nothing surfaces the input under the
			// `hookInput.tool_input` key GitLens reads — so Copilot's tool inputs are invisible to us.
			await handler(
				{
					event: 'PreToolUse',
					sessionId: 'cop-1',
					providerId: 'copilot',
					toolName: 'create',
					hookInput: { toolName: 'create', toolInput: { file_path: FILE } },
				},
				new URLSearchParams(),
			);

			// This asserts a DOCUMENTED LIMITATION, not desired behavior: it is pinned so the gap is
			// discoverable and can't regress silently, and so that whoever makes Copilot's tool inputs
			// readable (the fix is in the CLI's normalization, or a camelCase fallback here) is forced to
			// come back and flip this assertion. The same gap applies to OpenCode, which nests its args
			// at `hookInput.hook_payload.input`.
			assert.deepStrictEqual(
				fileActivityOf(provider, 'cop-1'),
				[],
				"copilot's tool input arrives under a key GitLens does not read, so no file activity is registered",
			);
			// The NAME does arrive and canonicalize — proof the gap is specifically the input, not the
			// alias table or the event plumbing.
			assert.strictEqual(
				provider.sessions.find(s => s.id === 'cop-1')?.statusDetail,
				'Write',
				"'create' → 'Write' must still canonicalize off the record's top-level toolName",
			);
		} finally {
			provider.dispose();
		}
	});
});

suite('GkAgentProvider supportsTranscripts gating', () => {
	const REPO = '/repo';

	test('a codex session never drives a transcript read, unlike a Claude session', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const reader = new StubTranscriptReader({ ai: 'must not be observed' });
		const provider = new TestProvider(callbacks, reader);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;

			await handler(sessionStart('codex-notrans', REPO, 'codex'), new URLSearchParams());
			await flushMicrotasks();
			assert.strictEqual(
				reader.calls.some(c => c.sessionId === 'codex-notrans'),
				false,
				'an agent whose capabilities say supportsTranscripts: false must never reach the reader',
			);
			assert.strictEqual(provider.sessions.find(s => s.id === 'codex-notrans')?.transcriptTitles, undefined);

			await handler(sessionStart('claude-trans', REPO, 'claude-code'), new URLSearchParams());
			await flushMicrotasks();
			assert.ok(
				reader.calls.some(c => c.sessionId === 'claude-trans'),
				'a Claude session must still drive the read the gate is protecting',
			);
		} finally {
			provider.dispose();
		}
	});

	test('resolveSessionDetails skips a tracked non-transcript agent but still serves an untracked id', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const reader = new StubTranscriptReader({ ai: 'title' });
		const provider = new TestProvider(callbacks, reader);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('codex-past', REPO, 'codex'), new URLSearchParams());
			await flushMicrotasks();
			reader.endedDetailCalls.length = 0;

			// Reachable, not theoretical: an ended session of ANY agent becomes a Past row, and opening
			// its sheet routes here by `providerId`. The reader only reads Claude's store, so this could
			// only ever miss — and would cost a read per row to find that out.
			assert.strictEqual(await provider.resolveSessionDetails('codex-past', REPO), undefined);
			// Asserted on `length` rather than against `[]`: `deepStrictEqual` is typed
			// `asserts actual is T`, so comparing to an empty literal narrows the array to `never[]`
			// for the rest of the block and breaks the `.map` below.
			assert.strictEqual(reader.endedDetailCalls.length, 0, 'a non-transcript agent must not reach the reader');

			// The gate fails open, so the transcript-only ids this method exists for — never tracked
			// live, therefore carrying no capabilities, and Claude's by construction since only its
			// store produces them — must still resolve. This is upstream's documented contract.
			const untracked = await provider.resolveSessionDetails('never-tracked-here', REPO);
			assert.ok(untracked != null, 'an untracked transcript-only id must still be served');
			assert.deepStrictEqual(
				reader.endedDetailCalls.map(c => c.sessionId),
				['never-tracked-here'],
			);
		} finally {
			provider.dispose();
		}
	});
});
