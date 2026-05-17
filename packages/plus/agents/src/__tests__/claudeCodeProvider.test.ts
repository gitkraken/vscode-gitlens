import * as assert from 'assert';
import type { IpcHandler } from '@gitlens/ipc/ipcServer.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { ClaudeCodeProvider } from '../providers/claudeCodeProvider.js';
import type { AgentProviderCallbacks, IpcRegistrar } from '../types.js';

interface MockCallbacks {
	callbacks: AgentProviderCallbacks;
	handlers: Map<string, IpcHandler>;
	publishedPaths: string[][];
}

function createMockCallbacks(options?: { resolveGitInfo?: AgentProviderCallbacks['resolveGitInfo'] }): MockCallbacks {
	const handlers = new Map<string, IpcHandler>();
	const publishedPaths: string[][] = [];

	const ipc: IpcRegistrar = {
		port: 1234,
		registerHandler: <Request, Response>(name: string, handler: IpcHandler<Request, Response>) => {
			handlers.set(name, handler as unknown as IpcHandler);
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
		runCLICommand: () => Promise.resolve('[]'),
		resolveGitInfo: options?.resolveGitInfo,
	};

	return { callbacks: callbacks, handlers: handlers, publishedPaths: publishedPaths };
}

function sessionStart(sessionId: string, cwd: string): Record<string, unknown> {
	return { event: 'SessionStart', sessionId: sessionId, cwd: cwd, pid: process.pid };
}

/** Yield to the microtask queue so `void this.ensureIpcServer()` can finish its awaits
 *  (publishAgents / syncSessions) and `publishedPaths` is populated. */
function flushMicrotasks(): Promise<void> {
	return new Promise(resolve => setImmediate(resolve));
}

suite('ClaudeCodeProvider', () => {
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
});
