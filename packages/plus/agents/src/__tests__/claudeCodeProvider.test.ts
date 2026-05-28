import * as assert from 'assert';
import type { IpcHandler } from '@gitlens/ipc/ipcServer.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { ClaudeCodeProvider } from '../providers/claudeCodeProvider.js';
import type { TranscriptTitles } from '../providers/claudeCodeTranscript.js';
import { ClaudeCodeTranscriptReader } from '../providers/claudeCodeTranscript.js';
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
	openSessionInClaudeExtension?: AgentProviderCallbacks['openSessionInClaudeExtension'];
	getActivityDecayMs?: AgentProviderCallbacks['getActivityDecayMs'];
	port?: number;
	agentDiscoveryDir?: string;
	cliResponse?: string;
}): MockCallbacks {
	const handlers = new Map<string, IpcHandler<unknown, unknown>>();
	const publishedPaths: string[][] = [];
	const cliCalls: string[][] = [];
	const syncDiscrepancies: SyncDiscrepancy[] = [];

	const ipc: IpcRegistrar = {
		port: options?.port ?? 1234,
		agentDiscoveryDir: options?.agentDiscoveryDir,
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
			return Promise.resolve(options?.cliResponse ?? '[]');
		},
		resolveGitInfo: options?.resolveGitInfo,
		openSessionInClaudeExtension: options?.openSessionInClaudeExtension,
		onSyncDiscrepancy: info => {
			syncDiscrepancies.push(info);
		},
		getActivityDecayMs: options?.getActivityDecayMs,
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

function sessionStart(sessionId: string, cwd: string): Record<string, unknown> {
	return { event: 'SessionStart', sessionId: sessionId, cwd: cwd, pid: process.pid };
}

/** A `list-sessions` poll entry (SessionFileData shape) for an alive session, used to exercise
 *  the reconciliation poll / discrepancy detection. `pid: process.pid` so it passes `isProcessAlive`. */
function sessionFileData(sessionId: string, cwd: string): Record<string, unknown> {
	return {
		sessionId: sessionId,
		event: 'UserPromptSubmit',
		cwd: cwd,
		pid: process.pid,
		updatedAt: '2024-01-01T00:00:00.000Z',
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
function fileActivityOf(provider: ClaudeCodeProvider, sessionId: string): NonNullable<AgentSession['fileActivity']> {
	return provider.sessions.find(s => s.id === sessionId)?.fileActivity ?? [];
}

suite('ClaudeCodeProvider', () => {
	suite('initialCwd from the CLI', () => {
		test('uses the CLI-provided initialCwd and keeps it stable across cwd drift', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			provider: ClaudeCodeProvider,
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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

		test('SessionEnd removes the session entirely (hard wipe)', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new ClaudeCodeProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				await send(sessionEnd('sess'));

				assert.strictEqual(
					provider.sessions.find(s => s.id === 'sess'),
					undefined,
					'SessionEnd should remove the whole session',
				);
			} finally {
				provider.dispose();
			}
		});

		test('SubagentStop removes the sub-agent without disturbing the parent decay tail', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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

		test('resolveGitInfo sets commonPath when cwd is outside any workspace folder', async () => {
			const { callbacks, handlers } = createMockCallbacks({
				resolveGitInfo: () =>
					Promise.resolve({
						branch: 'main',
						repoRoot: 'd:/PROJ/GKGL/vscode-gitlens',
						isWorktree: false,
					}),
			});
			const provider = new ClaudeCodeProvider(callbacks);
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

		test('updateWorkspacePaths normalizes and re-publishes', async () => {
			const { callbacks, publishedPaths } = createMockCallbacks();
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider({
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
				openSessionInClaudeExtension: sessionId => {
					calls.push(sessionId);
					return Promise.resolve();
				},
			});
			const provider = new ClaudeCodeProvider(callbacks);
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

		test('returns { opened: false } without invoking the callback when sessionId is missing', async () => {
			let called = false;
			const { callbacks, handlers } = createMockCallbacks({
				openSessionInClaudeExtension: () => {
					called = true;
					return Promise.resolve();
				},
			});
			const provider = new ClaudeCodeProvider(callbacks);
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

		test('returns { opened: false } when the host did not wire openSessionInClaudeExtension', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new ClaudeCodeProvider(callbacks);
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
				openSessionInClaudeExtension: () => Promise.reject(new Error('extension not installed')),
			});
			const provider = new ClaudeCodeProvider(callbacks);
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

	suite('notifyPeerOpenSession', () => {
		test("skips the discovery file matching this provider's own port and returns false", async () => {
			const { default: http } = await import('node:http');
			const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const dir = await mkdtemp(join(tmpdir(), 'gitlens-discovery-self-'));
			const hits: string[] = [];
			const server = http.createServer((req, res) => {
				hits.push(req.url ?? '');
				res.writeHead(200);
				res.end(JSON.stringify({ opened: true }));
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const port = (server.address() as { port: number }).port;
			try {
				await writeFile(
					join(dir, 'gitlens-ipc-server-self.json'),
					JSON.stringify({
						token: 't',
						address: `http://127.0.0.1:${port}`,
						port: port,
						workspacePaths: ['/repo'],
					}),
				);

				const { callbacks } = createMockCallbacks({ port: port, agentDiscoveryDir: dir });
				const provider = new ClaudeCodeProvider(callbacks);
				try {
					provider.start(['/repo']);
					await flushMicrotasks();
					hits.length = 0; // ignore any pre-existing list-route hits (there should be none)
					const opened = await provider.notifyPeerOpenSession('/repo', 'sess-1');
					assert.deepStrictEqual(
						hits.filter(u => u === '/agents/sessions/open'),
						[],
						'own-port discovery file must be skipped',
					);
					assert.strictEqual(opened, false, 'no peer should have been contacted');
				} finally {
					provider.dispose();
				}
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
				await rm(dir, { recursive: true, force: true });
			}
		});

		test('skips peers whose workspacePaths do not include the target and returns false', async () => {
			const { default: http } = await import('node:http');
			const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const dir = await mkdtemp(join(tmpdir(), 'gitlens-discovery-mismatch-'));
			const hits: string[] = [];
			const server = http.createServer((req, res) => {
				hits.push(req.url ?? '');
				res.writeHead(200);
				res.end(JSON.stringify({ opened: true }));
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const peerPort = (server.address() as { port: number }).port;
			try {
				await writeFile(
					join(dir, 'gitlens-ipc-server-other.json'),
					JSON.stringify({
						token: 't',
						address: `http://127.0.0.1:${peerPort}`,
						port: peerPort,
						workspacePaths: ['/other/workspace'],
					}),
				);

				const { callbacks } = createMockCallbacks({ port: peerPort + 1, agentDiscoveryDir: dir });
				const provider = new ClaudeCodeProvider(callbacks);
				try {
					provider.start(['/repo']);
					await flushMicrotasks();
					hits.length = 0; // ignore `/agents/sessions/list` from querySiblingWindowSessions
					const opened = await provider.notifyPeerOpenSession('/repo', 'sess-1');
					assert.deepStrictEqual(
						hits.filter(u => u === '/agents/sessions/open'),
						[],
						'mismatched-workspace peer must not be POSTed',
					);
					assert.strictEqual(opened, false, 'no matching peer should have been contacted');
				} finally {
					provider.dispose();
				}
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
				await rm(dir, { recursive: true, force: true });
			}
		});

		test('POSTs the sessionId to a matching peer and returns true when the peer is reachable', async () => {
			const { default: http } = await import('node:http');
			const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const dir = await mkdtemp(join(tmpdir(), 'gitlens-discovery-match-'));
			const requests: { url: string; auth: string | undefined; body: string }[] = [];
			const server = http.createServer((req, res) => {
				const chunks: Buffer[] = [];
				req.on('data', c => chunks.push(c as Buffer));
				req.on('end', () => {
					requests.push({
						url: req.url ?? '',
						auth: req.headers['authorization'],
						body: Buffer.concat(chunks).toString('utf8'),
					});
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ opened: true }));
				});
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const peerPort = (server.address() as { port: number }).port;
			try {
				await writeFile(
					join(dir, 'gitlens-ipc-server-peer.json'),
					JSON.stringify({
						token: 'peer-token',
						address: `http://127.0.0.1:${peerPort}`,
						port: peerPort,
						// Mixed-separator path on purpose — `notifyPeerOpenSession` normalizes both sides.
						workspacePaths: ['d:\\PROJ\\GKGL\\vscode-gitlens'],
					}),
				);

				const { callbacks } = createMockCallbacks({ port: peerPort + 1, agentDiscoveryDir: dir });
				const provider = new ClaudeCodeProvider(callbacks);
				try {
					provider.start(['/somewhere/else']);
					await flushMicrotasks();
					// Ignore the unrelated `/agents/sessions/list` POST that `querySiblingWindowSessions`
					// fires on start — we only care about what `notifyPeerOpenSession` does.
					requests.length = 0;
					const opened = await provider.notifyPeerOpenSession('d:/PROJ/GKGL/vscode-gitlens', 'sess-42');

					const openRequests = requests.filter(r => r.url === '/agents/sessions/open');
					assert.strictEqual(openRequests.length, 1, 'matching peer should receive exactly one open POST');
					assert.strictEqual(openRequests[0].auth, 'Bearer peer-token');
					assert.deepStrictEqual(JSON.parse(openRequests[0].body), { sessionId: 'sess-42' });
					assert.strictEqual(opened, true, 'reachable peer should resolve to true');
				} finally {
					provider.dispose();
				}
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
				await rm(dir, { recursive: true, force: true });
			}
		});

		test('returns true even when a matching peer responds with { opened: false } (peer is still the right window to focus)', async () => {
			const { default: http } = await import('node:http');
			const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const dir = await mkdtemp(join(tmpdir(), 'gitlens-discovery-not-opened-'));
			const server = http.createServer((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ opened: false }));
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const peerPort = (server.address() as { port: number }).port;
			try {
				await writeFile(
					join(dir, 'gitlens-ipc-server-peer.json'),
					JSON.stringify({
						token: 'peer-token',
						address: `http://127.0.0.1:${peerPort}`,
						port: peerPort,
						workspacePaths: ['/repo'],
					}),
				);

				const { callbacks } = createMockCallbacks({ port: peerPort + 1, agentDiscoveryDir: dir });
				const provider = new ClaudeCodeProvider(callbacks);
				try {
					provider.start(['/somewhere/else']);
					await flushMicrotasks();
					const opened = await provider.notifyPeerOpenSession('/repo', 'sess-99');
					// `opened: false` is logged for diagnostics but the peer was reachable, so the
					// caller still gets the signal it needs to focus that peer's window via
					// `vscode.openFolder` instead of opening a new window.
					assert.strictEqual(
						opened,
						true,
						'a reachable peer that failed to open the session is still the right window to focus',
					);
				} finally {
					provider.dispose();
				}
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
				await rm(dir, { recursive: true, force: true });
			}
		});

		test('matches a peer whose workspacePath *contains* the target (cwd is a subdir of the peer workspace)', async () => {
			const { default: http } = await import('node:http');
			const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const dir = await mkdtemp(join(tmpdir(), 'gitlens-discovery-containment-'));
			const requests: { url: string; body: string }[] = [];
			const server = http.createServer((req, res) => {
				const chunks: Buffer[] = [];
				req.on('data', c => chunks.push(c as Buffer));
				req.on('end', () => {
					requests.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ opened: true }));
				});
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const peerPort = (server.address() as { port: number }).port;
			try {
				await writeFile(
					join(dir, 'gitlens-ipc-server-peer.json'),
					JSON.stringify({
						token: 'peer-token',
						address: `http://127.0.0.1:${peerPort}`,
						port: peerPort,
						// Peer has the repo *root* open as workspace.
						workspacePaths: ['/repo'],
					}),
				);

				const { callbacks } = createMockCallbacks({ port: peerPort + 1, agentDiscoveryDir: dir });
				const provider = new ClaudeCodeProvider(callbacks);
				try {
					provider.start(['/somewhere/else']);
					await flushMicrotasks();
					requests.length = 0; // ignore startup `/agents/sessions/list` POSTs

					// Dispatcher passes a cwd inside the peer's workspace folder — strict equality
					// would miss this; containment matching catches it.
					const opened = await provider.notifyPeerOpenSession('/repo/src/foo', 'sess-contain');

					const openRequests = requests.filter(r => r.url === '/agents/sessions/open');
					assert.strictEqual(
						openRequests.length,
						1,
						'peer whose workspacePath is a parent of the target must still be POSTed',
					);
					assert.deepStrictEqual(JSON.parse(openRequests[0].body), { sessionId: 'sess-contain' });
					assert.strictEqual(opened, true, 'containment match must propagate as true');
				} finally {
					provider.dispose();
				}
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
				await rm(dir, { recursive: true, force: true });
			}
		});

		test('returns false when a matching peer is advertised but unreachable (refused/timeout)', async () => {
			const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');

			const dir = await mkdtemp(join(tmpdir(), 'gitlens-discovery-unreachable-'));
			try {
				// Use port 1 — guaranteed-closed on every platform; fetch will fail with
				// ECONNREFUSED quickly.
				await writeFile(
					join(dir, 'gitlens-ipc-server-dead.json'),
					JSON.stringify({
						token: 'dead-token',
						address: `http://127.0.0.1:1`,
						port: 1,
						workspacePaths: ['/repo'],
					}),
				);

				const { callbacks } = createMockCallbacks({ port: 50000, agentDiscoveryDir: dir });
				const provider = new ClaudeCodeProvider(callbacks);
				try {
					provider.start(['/somewhere/else']);
					await flushMicrotasks();
					const opened = await provider.notifyPeerOpenSession('/repo', 'sess-dead');
					assert.strictEqual(
						opened,
						false,
						'an advertised-but-unreachable peer must resolve to false so the caller opens a new window instead of trying to focus a dead window',
					);
				} finally {
					provider.dispose();
				}
			} finally {
				await rm(dir, { recursive: true, force: true });
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
}

/** Provider variant that lets tests swap the transcript reader. */
class TestProvider extends ClaudeCodeProvider {
	constructor(callbacks: AgentProviderCallbacks, reader: ClaudeCodeTranscriptReader) {
		super(callbacks);
		this._transcriptReader = reader;
	}
}

/** Provider variant that lets tests drive a gated reconciliation tick deterministically, instead
 *  of waiting for the real 15-minute `staleCheckTimer` interval. */
class GateTestProvider extends ClaudeCodeProvider {
	runGatedSync(): Promise<void> {
		return this.syncSessions({ gate: true });
	}
}

suite('ClaudeCodeProvider reconciliation poll gating (list-sessions)', () => {
	const workspace = '/home/user/projectA';

	test('skips the CLI on a gated tick when there are no sessions and hooks are not installed', async () => {
		const { callbacks, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setClaudeHooksInstalled(false);
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
			provider.setClaudeHooksInstalled(true);
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
			provider.setClaudeHooksInstalled(false);

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

	test('resumes polling on the next gated tick once a session is pushed', async () => {
		const { callbacks, handlers, cliCalls } = createMockCallbacks();
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([workspace]);
			await flushMicrotasks();
			provider.setClaudeHooksInstalled(false);
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
			cliCalls.length = 0; // never call setClaudeHooksInstalled — exercise the default

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
			provider.setClaudeHooksInstalled(false);
			cliCalls.length = 0;

			provider.setClaudeHooksInstalled(true); // eager resync fires an ungated syncSessions() (polls, reports no drift)
			await flushMicrotasks();

			assert.ok(listSessionsCalls(cliCalls) >= 1, 'installing hooks must trigger an immediate reconciliation');
		} finally {
			provider.dispose();
		}
	});
});

suite('ClaudeCodeProvider live/poll sync discrepancy telemetry', () => {
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.setClaudeHooksInstalled(false); // true(default)→false: no resync
			provider.setClaudeHooksInstalled(true); // false→true: eager resync polls (ungated)
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
