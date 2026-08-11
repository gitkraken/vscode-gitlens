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

		test('SessionEnd completes the session and hard-wipes its file activity', async () => {
			const { callbacks, handlers } = createMockCallbacks({ getActivityDecayMs: () => 10000 });
			const provider = new ClaudeCodeProvider(callbacks);
			try {
				const send = await startSession(provider, handlers, 'sess');
				await send(preToolUse('sess', 'Edit', FILE));
				await send(postToolUse('sess', 'Edit', FILE));
				await send(sessionEnd('sess'));

				const session = provider.sessions.find(s => s.id === 'sess');
				assert.ok(session != null, 'SessionEnd keeps the session as a terminal completed row');
				assert.strictEqual(session.status, 'completed');
				assert.strictEqual(
					fileActivityOf(provider, 'sess').length,
					0,
					'SessionEnd should wipe the live file-activity heatmap',
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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

/** Provider variant that lets tests swap the transcript reader and drive a gated poll tick. */
class TestProvider extends ClaudeCodeProvider {
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

	test('keeps polling for completed-only state, but at the idle cadence', async () => {
		// The poll is the only thing that drops a completed row the CLI stopped listing (archived
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
			provider.setClaudeHooksInstalled(false);
			assert.ok(
				provider.sessions.some(s => s.status === 'completed'),
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
				'once the idle window passes, completed-only state still reconciles',
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

suite('ClaudeCodeProvider completed sessions', () => {
	const REPO = '/home/user/projectA';
	const ENDED_AT = '2026-07-10T00:00:00.000Z';

	/** A `list-sessions` poll entry for a durable `ended` (completed) session. */
	function endedRecord(sessionId: string, overrides?: Record<string, unknown>): Record<string, unknown> {
		return {
			sessionId: sessionId,
			event: 'Stop',
			cwd: REPO,
			pid: 999999, // not a live process — completed classification ignores pid anyway
			status: 'ended',
			endReason: 'session-end',
			endedAt: ENDED_AT,
			updatedAt: '2026-07-09T00:00:00.000Z',
			...overrides,
		};
	}

	test('SessionEnd transitions the session to completed instead of removing it', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new ClaudeCodeProvider(callbacks);
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
			assert.strictEqual(s.status, 'completed');
			assert.strictEqual(s.phase, 'completed');
			assert.strictEqual(s.subagents, undefined, 'subagents are dropped on completion');
			assert.strictEqual(s.pendingPermission, undefined);
		} finally {
			provider.dispose();
		}
	});

	test('a completed session takes worktreePath from the CLI record without a git probe', async () => {
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
		const provider = new ClaudeCodeProvider(callbacks);
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

	test('poll surfaces an ended record as a completed session even with a dead pid', async () => {
		const { callbacks } = createMockCallbacks({ cliResponse: JSON.stringify([endedRecord('gone')]) });
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			const s = provider.sessions.find(x => x.id === 'gone');
			assert.ok(s != null, 'an ended record should surface as a completed session');
			assert.strictEqual(s.status, 'completed');
			assert.strictEqual(s.phase, 'completed');
			assert.strictEqual(s.lastActivity.toISOString(), ENDED_AT, 'lastActivity comes from endedAt');
		} finally {
			provider.dispose();
		}
	});

	test('an ended record with a live pid is completed, never re-added as a live session', async () => {
		// The `/clear` case: SessionEnd fired but the process continues under a new id, so the old
		// ended record still carries a live pid. Classification must key off status, not pid liveness.
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('cleared', { pid: process.pid, event: 'UserPromptSubmit' })]),
		});
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			assert.strictEqual(
				provider.sessions.find(x => x.id === 'cleared')?.status,
				'completed',
				'a live pid must not resurrect an ended session as live',
			);
		} finally {
			provider.dispose();
		}
	});

	test('poll transitions a tracked live session to completed when the CLI reports it ended', async () => {
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
				'completed',
				'the poll must reap a live-pid zombie the live path missed',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a completed session is removed once a later poll omits it', async () => {
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // poll #1 discovers 'done' as completed, sets polledAtLeastOnce
			assert.ok(
				provider.sessions.some(s => s.id === 'done'),
				'completed session discovered',
			);

			options.cliResponse = '[]';
			await provider.runGatedSync(); // poll #2 omits it (archived/purged) → removed
			assert.strictEqual(
				provider.sessions.some(s => s.id === 'done'),
				false,
				'omitted completed session removed',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a freshly completed session is not reconcile-removed before its first poll confirmation', async () => {
		const options: { cliResponse?: string } = { cliResponse: '[]' };
		const { callbacks, handlers } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams()); // → completed, no polledAtLeastOnce yet

			// Age it a few seconds — inside the grace, but NOT the same millisecond as the poll. Without
			// this the assertion would hold even with the grace removed, since `phaseSince < pollStartedAt`
			// is false only at identical timestamps. Paired with the after-the-grace test below, this pins
			// both sides of the boundary.
			const completed = provider.sessions.find(x => x.id === 's1')!;
			(completed as { phaseSince: Date }).phaseSince = new Date(Date.now() - 5 * 1000);

			await provider.runGatedSync(); // an in-flight poll that raced before the CLI file was visible

			const s = provider.sessions.find(x => x.id === 's1');
			assert.ok(s != null, 'must survive an in-flight empty poll it legitimately predates');
			assert.strictEqual(s.status, 'completed');
		} finally {
			provider.dispose();
		}
	});

	test('an unconfirmed completed row is reconciled away once the grace elapses', async () => {
		// The ghost case: the record was archived from another window (or purged) before any poll
		// observed it, so `polledAtLeastOnce` can never be set and the row would otherwise be pinned
		// for the window's lifetime. Absence becomes authoritative once the row is older than the
		// grace that protects a just-completed session from a not-yet-visible record.
		const { callbacks, handlers } = createMockCallbacks({ cliResponse: '[]' });
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'completed');

			// Age the completion past the grace rather than sleeping through it.
			const completed = provider.sessions.find(s => s.id === 's1')!;
			(completed as { phaseSince: Date }).phaseSince = new Date(Date.now() - 5 * 60 * 1000);

			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.some(s => s.id === 's1'),
				false,
				'an aged, never-confirmed completed row must not survive the poll that omits it',
			);
		} finally {
			provider.dispose();
		}
	});

	test('poll does not eagerly resolve git info for completed sessions', async () => {
		let gitInfoCalls = 0;
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('done')]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve(undefined);
			},
		});
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();

			assert.strictEqual(provider.sessions.find(s => s.id === 'done')?.status, 'completed');
			assert.strictEqual(gitInfoCalls, 0, 'completed sessions must defer git resolution');
		} finally {
			provider.dispose();
		}
	});

	test('resolveCompletedSessionDetails resolves git info on demand', async () => {
		let gitInfoCalls = 0;
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('done')]),
			resolveGitInfo: () => {
				gitInfoCalls++;
				return Promise.resolve(undefined);
			},
		});
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks();
			assert.strictEqual(gitInfoCalls, 0, 'not resolved eagerly');

			provider.resolveCompletedSessionDetails('done');
			await flushMicrotasks();

			assert.strictEqual(gitInfoCalls, 1, 'lazy resolution fires on demand');
		} finally {
			provider.dispose();
		}
	});

	test('archiveSession calls the CLI and removes the session', async () => {
		const { callbacks, cliCalls } = createMockCallbacks({ cliResponse: JSON.stringify([endedRecord('done')]) });
		const provider = new ClaudeCodeProvider(callbacks);
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

	test('SessionStart on a completed session revives it to a live idle row', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.start([REPO]);
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'completed');

			// Resuming reuses the id, so a SessionStart on a completed row is the resume signal.
			await handler(sessionStart('s1', REPO), new URLSearchParams());

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'idle', 'a resumed session must leave the completed/archivable state');
			assert.strictEqual(s?.phase, 'idle');
		} finally {
			provider.dispose();
		}
	});

	test('poll revives a completed session the CLI reports as a live process', async () => {
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers 'done' as completed
			assert.strictEqual(provider.sessions.find(s => s.id === 'done')?.status, 'completed');

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
				'a revived completed row must take the CLI event-derived status, not idle',
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
			const completed = provider.sessions.find(s => s.id === 'moved');
			assert.strictEqual(completed?.status, 'completed');
			assert.strictEqual(completed?.endReason, 'session-end');
			assert.strictEqual(completed?.workspacePath, undefined, 'it ended outside this workspace');

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
			const completed = provider.sessions.find(s => s.id === 'older');
			assert.strictEqual(completed?.status, 'completed');
			assert.strictEqual(completed?.worktreePath, REPO, 'the completed row is attributed from its record');

			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('older', OUTSIDE), updatedAt: '2026-07-10T00:05:00.000Z' },
			]);
			await provider.runGatedSync();

			const s = provider.sessions.find(x => x.id === 'older');
			assert.notStrictEqual(s?.status, 'completed', 'the row is live again');
			assert.strictEqual(s?.cwd, OUTSIDE, 'cwd still follows the record');
			assert.strictEqual(s?.worktreePath, REPO, 'the worktree attribution is kept');
		} finally {
			provider.dispose();
		}
	});

	test('poll does not revive a completed session off a snapshot older than the completion', async () => {
		// `SessionEnd` fires while the process is still winding down, so a poll whose `list-sessions`
		// call started BEFORE it comes back with a snapshot that still says "active" with a live pid.
		// Reviving off that stale record resurrects the row, and `pruneDeadSessions` then deletes it
		// outright once the process exits — the completed row would vanish moments after it appeared.
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers 'done' as completed
			assert.strictEqual(provider.sessions.find(s => s.id === 'done')?.status, 'completed');

			// Stale snapshot: live pid, but `updatedAt` predates `endedAt`.
			options.cliResponse = JSON.stringify([
				{ ...sessionFileData('done', REPO), updatedAt: '2026-07-09T23:59:00.000Z' },
			]);
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.find(s => s.id === 'done')?.status,
				'completed',
				'a stale pre-completion snapshot must not resurrect the terminal row',
			);
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
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'completed');

			await wait(900); // let the (now-cancelled) Stop→idle window elapse

			assert.strictEqual(
				provider.sessions.find(s => s.id === 's1')?.status,
				'completed',
				'a completed row must not be revived to idle by a stale Stop→idle timer',
			);
		} finally {
			provider.dispose();
		}
	});

	test('archiveSession refuses to archive a non-completed (live) session', async () => {
		const { callbacks, handlers, cliCalls } = createMockCallbacks();
		const provider = new ClaudeCodeProvider(callbacks);
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
			cliResponse: JSON.stringify([endedRecord('archived-1'), endedRecord('archived-2')]),
		});
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			const ids = await provider.getArchivedSessionIds();
			assert.deepStrictEqual(ids, []);
		} finally {
			provider.dispose();
		}
	});

	test('getArchivedSessionIds caches the archived query across concurrent and repeated calls', async () => {
		const { callbacks, cliCalls } = createMockCallbacks({
			cliResponse: JSON.stringify([endedRecord('archived-1')]),
		});
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks(); // the bootstrap poll's fallback marks the CLI legacy
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());

			assert.strictEqual(
				provider.sessions.some(s => s.id === 's1'),
				false,
				'without a durable store a completed row could never be confirmed or archived — remove on end',
			);
		} finally {
			provider.dispose();
		}
	});

	test('a legacy poll reconciles away a completed row it can never confirm', async () => {
		// Models SessionEnd landing before the poll has discovered the CLI is legacy: the row
		// completes (optimistic default), then the first legacy poll — which can never list it —
		// must drop it rather than let the polledAtLeastOnce guard pin it forever.
		const { callbacks, handlers } = createMockCallbacks({ cliResponse: '[]' });
		const provider = new GateTestProvider(callbacks);
		try {
			provider.start([REPO]);
			await flushMicrotasks(); // bootstrap poll succeeds with --status → completed support assumed
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			await handler(sessionEnd('s1'), new URLSearchParams());
			assert.strictEqual(provider.sessions.find(s => s.id === 's1')?.status, 'completed');

			callbacks.runCLICommand = (args: string[]) => {
				if (args.includes('--status')) return Promise.reject(new Error('unknown flag: --status'));
				return Promise.resolve('[]');
			};
			await provider.runGatedSync();

			assert.strictEqual(
				provider.sessions.some(s => s.id === 's1'),
				false,
				'the legacy poll is authoritative — an unconfirmable completed row must not linger',
			);
		} finally {
			provider.dispose();
		}
	});

	test('drift telemetry ignores completed sessions', async () => {
		const options: { cliResponse?: string } = { cliResponse: JSON.stringify([endedRecord('done')]) };
		const { callbacks, syncDiscrepancies } = createMockCallbacks(options);
		const provider = new GateTestProvider(callbacks);
		try {
			await provider.runGatedSync(); // discovers completed 'done'
			syncDiscrepancies.length = 0;

			await provider.runGatedSync(); // still lists 'done' as ended → no live drift

			assert.strictEqual(syncDiscrepancies.length, 0, 'a completed session absent from polledAlive is not drift');
		} finally {
			provider.dispose();
		}
	});
});

suite('ClaudeCodeProvider unresolvable permission asks', () => {
	test('Notification(permission_prompt) synthesizes an unresolvable ask', async () => {
		const { callbacks, handlers } = createMockCallbacks();
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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

suite('ClaudeCodeProvider permission ask identity gating', () => {
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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

suite('ClaudeCodeProvider poll-discovered live rows', () => {
	const REPO = '/home/user/projectB';

	test('a poll-discovered live row with a pending PermissionRequest gets a synthesized unresolvable ask', async () => {
		const { callbacks } = createMockCallbacks({
			cliResponse: JSON.stringify([
				{ ...sessionFileData('polled-perm', REPO), event: 'PermissionRequest', toolName: 'Bash' },
			]),
		});
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
});

suite('ClaudeCodeProvider worktree attribution', () => {
	const REPO = '/repo';
	const WORKTREE = '/repo.worktrees/feature';

	test('a blocking PermissionRequest as the first event seats the session location', async () => {
		const { callbacks, handlers } = createMockCallbacks({
			// Never resolves — the row must be attributed from the event alone, for the whole time the
			// agent sits blocked on the ask.
			resolveGitInfo: () => new Promise(() => {}),
		});
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
		const provider = new ClaudeCodeProvider(callbacks);
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
});

class PeerTestProvider extends ClaudeCodeProvider {
	runPeerQuery(): Promise<void> {
		return this.querySiblingWindowSessions();
	}
}

suite('ClaudeCodeProvider peer session merge', () => {
	const REPO = '/repo';

	/** Stands up a peer window: a discovery file plus an `/agents/sessions/list` route serving
	 *  whatever `published.sessions` holds when the query runs. Starts empty so the start-time query
	 *  imports nothing and the test can seat local state first, then drive the merge explicitly. */
	async function withPeer(
		run: (
			provider: PeerTestProvider,
			handlers: MockCallbacks['handlers'],
			published: { sessions: Record<string, unknown>[] },
		) => Promise<void>,
	): Promise<void> {
		const { default: http } = await import('node:http');
		const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');

		const published: { sessions: Record<string, unknown>[] } = { sessions: [] };
		const dir = await mkdtemp(join(tmpdir(), 'gitlens-peer-merge-'));
		const server = http.createServer((req, res) => {
			const url = req.url ?? '';
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(url === '/agents/sessions/list' ? published.sessions : {}));
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
					workspacePaths: [REPO],
				}),
			);

			const { callbacks, handlers } = createMockCallbacks({ port: peerPort + 1, agentDiscoveryDir: dir });
			const provider = new PeerTestProvider(callbacks);
			try {
				provider.start([REPO]);
				await flushMicrotasks();
				await run(provider, handlers, published);
			} finally {
				provider.dispose();
			}
		} finally {
			await new Promise<void>(resolve => server.close(() => resolve()));
			await rm(dir, { recursive: true, force: true });
		}
	}

	/** A peer's published row for `sessionId`, always newer than anything the local window holds. */
	function peerRow(sessionId: string, overrides?: Record<string, unknown>): Record<string, unknown> {
		const at = new Date(Date.now() + 60_000).toISOString();
		return {
			id: sessionId,
			providerId: 'claudeCode',
			providerName: 'Claude Code',
			status: 'thinking',
			phase: 'working',
			phaseSince: at,
			lastActivity: at,
			isSubagent: false,
			isInWorkspace: true,
			cwd: REPO,
			...overrides,
		};
	}

	test('a merged peer ask is marked unresolvable', async () => {
		await withPeer(async (provider, handlers, published) => {
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());

			published.sessions = [
				peerRow('s1', {
					status: 'permission_requested',
					phase: 'waiting',
					pendingPermission: {
						kind: 'tool',
						toolName: 'Bash',
						toolDescription: 'Bash(ls -la)',
						resolvable: true,
					},
				}),
			];
			await provider.runPeerQuery();

			const s = provider.sessions.find(x => x.id === 's1');
			assert.strictEqual(s?.status, 'permission_requested');
			assert.strictEqual(s?.pendingPermission?.toolDescription, 'Bash(ls -la)', 'the ask is mirrored');
			assert.strictEqual(
				s?.pendingPermission?.resolvable,
				false,
				'we hold no hook entry for the peer’s ask, so it can never be routed from here',
			);
		});
	});

	test('a merge clears an ask the peer no longer reports', async () => {
		await withPeer(async (provider, handlers, published) => {
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			// Non-blocking, so the row carries a synthesized ask with no bookkeeping entry behind it.
			await handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: REPO,
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
				},
				new URLSearchParams(),
			);
			assert.strictEqual(provider.sessions.find(x => x.id === 's1')?.pendingPermission?.resolvable, false);

			published.sessions = [peerRow('s1')];
			await provider.runPeerQuery();

			assert.strictEqual(
				provider.sessions.find(x => x.id === 's1')?.pendingPermission,
				undefined,
				'the peer answered it — the card must not keep waiting',
			);
		});
	});

	test('a locally-routable ask survives a peer merge', async () => {
		await withPeer(async (provider, handlers, published) => {
			const handler = handlers.get('agents/session')!;
			await handler(sessionStart('s1', REPO), new URLSearchParams());
			// A blocking ask fans out to every window, so ours can hold the entry the peer lacks.
			const blocking = handler(
				{
					event: 'PermissionRequest',
					sessionId: 's1',
					cwd: REPO,
					toolName: 'Bash',
					toolInput: { command: 'ls -la' },
				},
				new URLSearchParams('blocking=true'),
			);
			blocking.catch(() => {});

			published.sessions = [peerRow('s1')];
			await provider.runPeerQuery();

			const s = provider.sessions.find(x => x.id === 's1');
			assert.notStrictEqual(
				s?.pendingPermission,
				undefined,
				'a routable ask must not be dropped by the peer’s view',
			);
			assert.notStrictEqual(s?.pendingPermission?.resolvable, false);
		});
	});
});

suite('ClaudeCodeProvider host filtering (providerId)', () => {
	const REPO = '/repo';

	suite('IPC events', () => {
		test('ignores an event from another AI host', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new ClaudeCodeProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				// codex event names are identical to Claude's, so this is processed in full without the filter.
				await handler(sessionStart('codex-1', REPO, 'codex'), new URLSearchParams());

				assert.strictEqual(provider.sessions.length, 0, 'a foreign host event must not create a session');
			} finally {
				provider.dispose();
			}
		});

		test('tracks an event explicitly stamped claude-code', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new ClaudeCodeProvider(callbacks);
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
			const provider = new ClaudeCodeProvider(callbacks);
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

		test('ignores a foreign blocking PermissionRequest without answering it', async () => {
			const { callbacks, handlers } = createMockCallbacks();
			const provider = new ClaudeCodeProvider(callbacks);
			try {
				provider.start([REPO]);
				const handler = handlers.get('agents/session')!;
				const response = await handler(
					{
						event: 'PermissionRequest',
						sessionId: 'copilot-1',
						providerId: 'copilot',
						cwd: REPO,
						toolName: 'Bash',
						toolInput: { command: 'rm -rf /' },
					},
					new URLSearchParams('blocking=true'),
				);

				assert.strictEqual(response, undefined, 'no permission decision may be returned');
				assert.strictEqual(provider.sessions.length, 0, 'no session or pending ask may be created');
			} finally {
				provider.dispose();
			}
		});
	});

	suite('reconciliation poll', () => {
		test('imports only our own and unstamped records, and keeps them out of the drift signal', async () => {
			const { callbacks, syncDiscrepancies } = createMockCallbacks({
				cliResponse: JSON.stringify([
					sessionFileData('claude-1', REPO, 'claude-code'),
					sessionFileData('codex-1', REPO, 'codex'),
					// opencode's event names never match the live switch — the poll is its only way in.
					sessionFileData('opencode-1', REPO, 'opencode'),
					sessionFileData('legacy-1', REPO),
				]),
			});
			const provider = new GateTestProvider(callbacks);
			try {
				await provider.runGatedSync();

				assert.deepStrictEqual(
					provider.sessions.map(s => s.id).sort(),
					['claude-1', 'legacy-1'],
					'only claude-code and unstamped records may be tracked',
				);
				// Drift counts must describe our own sessions only.
				assert.strictEqual(syncDiscrepancies.length, 1);
				assert.deepStrictEqual(syncDiscrepancies[0], {
					provider: 'claudeCode',
					discovered: 2,
					missing: 0,
					polled: 2,
					tracked: 0,
				});
			} finally {
				provider.dispose();
			}
		});

		test('does not create a completed row for another host’s ended record', async () => {
			const { callbacks } = createMockCallbacks({
				cliResponse: JSON.stringify([
					{
						sessionId: 'opencode-ended',
						providerId: 'opencode',
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

				assert.strictEqual(provider.sessions.length, 0, 'a foreign ended record must not surface as completed');
			} finally {
				provider.dispose();
			}
		});
	});
});
