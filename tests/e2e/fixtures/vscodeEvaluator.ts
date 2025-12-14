/**
 * VS Code Evaluator - HTTP Client
 *
 * Connects to the VS Code test runner HTTP server and allows
 * executing functions with access to the VS Code API.
 *
 * Uses Playwright's internal API to access the Electron process, similar
 * to how vscode-test-playwright does it.
 */
import type { ChildProcess } from 'child_process';
import type { EventEmitter } from 'events';
import readline from 'readline';
import type { ElectronApplication } from '@playwright/test';

// Re-export vscode types for use in evaluate callbacks
export type VSCode = typeof import('vscode');

interface InvokeRequest {
	fn: string;
	params?: unknown[];
}

interface InvokeResponse {
	result?: unknown;
	error?: { message: string; stack?: string };
}

// Internal Playwright API types
interface ElectronAppImpl {
	_process: ChildProcess;
	_nodeConnection?: {
		_browserLogsCollector?: {
			recentLogs(): string[];
		};
	};
}

export class VSCodeEvaluator {
	private serverUrl: string;

	private constructor(serverUrl: string) {
		this.serverUrl = serverUrl;
	}

	/**
	 * Connect to the VS Code test server using Playwright's internal API.
	 * Uses the same approach as vscode-test-playwright to access the process.
	 *
	 * @param electronApp - The ElectronApplication from Playwright
	 * @param timeout - Connection timeout in ms
	 */
	static async connect(electronApp: ElectronApplication, timeout = 30000): Promise<VSCodeEvaluator> {
		// Access Playwright's internal implementation to get the process
		// The electronApp._connection.toImpl() method converts public API objects to internal implementations

		const connection = (electronApp as any)._connection;
		const electronAppImpl = connection.toImpl(electronApp) as ElectronAppImpl;
		const process = electronAppImpl._process;

		// Check recent logs first (in case server already started)
		const vscodeTestServerRegExp = /VSCodeTestServer listening on (http:\/\/[^\s]+)/;
		const recentLogs = electronAppImpl._nodeConnection?._browserLogsCollector?.recentLogs() ?? [];
		let match = recentLogs.map((s: string) => s.match(vscodeTestServerRegExp)).find(Boolean) as
			| RegExpMatchArray
			| undefined;

		// If not found in recent logs, wait for it
		if (!match) {
			match = await this.waitForLine(process, vscodeTestServerRegExp, timeout);
		}

		const serverUrl = match[1];
		return new VSCodeEvaluator(serverUrl);
	}

	/**
	 * Wait for a line matching the regex in the process stderr.
	 * Adapted from Playwright's electron.ts
	 */
	private static waitForLine(process: ChildProcess, regex: RegExp, timeout: number): Promise<RegExpMatchArray> {
		type Listener = { emitter: EventEmitter; eventName: string | symbol; handler: (...args: any[]) => void };

		function addEventListener(
			emitter: EventEmitter,
			eventName: string | symbol,
			handler: (...args: any[]) => void,
		): Listener {
			emitter.on(eventName, handler);
			return { emitter: emitter, eventName: eventName, handler: handler };
		}

		function removeEventListeners(listeners: Listener[]) {
			for (const listener of listeners) {
				listener.emitter.removeListener(listener.eventName, listener.handler);
			}
			listeners.splice(0, listeners.length);
		}

		return new Promise((resolve, reject) => {
			const rl = readline.createInterface({ input: process.stderr! });
			const failError = new Error('Process failed to launch!');
			const timeoutError = new Error(`Timeout waiting for VSCodeTestServer (${timeout}ms)`);

			const listeners = [
				addEventListener(rl, 'line', onLine),
				addEventListener(rl, 'close', () => reject(failError)),
				addEventListener(process, 'exit', () => reject(failError)),
				addEventListener(process, 'error', () => reject(failError)),
			];

			const timer = setTimeout(() => {
				cleanup();
				reject(timeoutError);
			}, timeout);

			function onLine(line: string) {
				const match = line.match(regex);
				if (!match) return;
				cleanup();
				resolve(match);
			}

			function cleanup() {
				clearTimeout(timer);
				removeEventListeners(listeners);
			}
		});
	}

	/**
	 * Evaluate a function in the VS Code Extension Host context.
	 * The function receives the `vscode` module as its first argument.
	 *
	 * @example
	 * ```ts
	 * await evaluator.evaluate(vscode => {
	 *   vscode.commands.executeCommand('gitlens.showCommitGraph');
	 * });
	 *
	 * const version = await evaluator.evaluate(vscode => vscode.version);
	 * ```
	 */
	evaluate<R>(fn: (vscode: VSCode) => R | Promise<R>): Promise<R>;
	evaluate<R, A extends any[]>(fn: (vscode: VSCode, ...args: A) => R | Promise<R>, ...args: A): Promise<R>;
	async evaluate<R, A extends any[]>(fn: (vscode: VSCode, ...args: A) => R | Promise<R>, ...args: A): Promise<R> {
		const params = args != null ? (Array.isArray(args) ? args : [args]) : [];

		const request: InvokeRequest = { fn: fn.toString(), params: params };

		const res = await fetch(`${this.serverUrl}/invoke`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(request),
		});

		const response = (await res.json()) as InvokeResponse;

		if (response.error) {
			const err = new Error(response.error.message);
			err.stack = response.error.stack;
			throw err;
		}

		return response.result as R;
	}

	/**
	 * Close the connection (no-op for HTTP, kept for API compatibility).
	 */
	close(): void {
		// No-op for HTTP - each request is independent
	}
}
