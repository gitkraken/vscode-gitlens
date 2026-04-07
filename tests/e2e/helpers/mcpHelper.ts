import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as readline from 'node:readline';

export type McpMessage = {
	jsonrpc: '2.0';
	id?: number | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string };
};

export type McpConfigResult = {
	name: string;
	type: string;
	command: string;
	args: string[];
	version?: string;
};

/**
 * Derives the path to the gk CLI executable from VS Code launch arguments.
 * In E2E tests, gk is installed into the temp user-data-dir, not the real AppData.
 */
export function findGkCliFromArgs(electronArgs: string[]): string {
	const userDataDirArg = electronArgs.find(a => a.startsWith('--user-data-dir='));
	if (userDataDirArg == null) throw new Error('--user-data-dir not found in electron args');

	const userDataDir = userDataDirArg.replace('--user-data-dir=', '');
	const bin = process.platform === 'win32' ? 'gk.exe' : 'gk';
	return path.join(userDataDir, 'User', 'globalStorage', 'eamodio.gitlens', bin);
}

/**
 * Finds the IPC discovery file for a specific VS Code process.
 * GitLens writes one file per session to %TEMP%/gitkraken/gitlens/
 * with format: gitlens-ipc-server-{pid}-{port}.json.
 *
 * When `vscodePid` is provided, only files belonging to that process are considered,
 * preventing cross-worker contamination in parallel Playwright runs.
 * Falls back to the newest live file when no pid is given.
 */
export function findLatestIpcFile(vscodePid?: number): string | undefined {
	const tmpDir = path.join(os.tmpdir(), 'gitkraken', 'gitlens');
	if (!existsSync(tmpDir)) return undefined;

	const candidates = readdirSync(tmpDir)
		.filter(f => {
			if (!f.startsWith('gitlens-ipc-server-') || !f.endsWith('.json')) return false;
			if (vscodePid != null) {
				// File format: gitlens-ipc-server-{pid}-{port}.json
				return f.startsWith(`gitlens-ipc-server-${vscodePid}-`);
			}
			return true;
		})
		.map(f => {
			const fullPath = path.join(tmpDir, f);
			try {
				return { fullPath: fullPath, mtime: statSync(fullPath).mtime };
			} catch {
				return null;
			}
		})
		.filter((x): x is { fullPath: string; mtime: Date } => x != null)
		.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

	for (const { fullPath } of candidates) {
		try {
			const data = JSON.parse(readFileSync(fullPath, 'utf8')) as { pid: number };
			process.kill(data.pid, 0); // throws if process is dead
			return fullPath;
		} catch {
			// dead process or unreadable file — skip
		}
	}
	return undefined;
}

/**
 * Waits for the gk CLI proxy binary to appear on disk.
 * GitLens auto-installs it on first activation (~5–6 s).
 */
export async function waitForCliInstall(gkPath: string, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(gkPath)) return;
		await new Promise(r => setTimeout(r, 500));
	}
	throw new Error(`GK CLI not found at "${gkPath}" after ${timeoutMs}ms`);
}

/**
 * Minimal stdio MCP client for E2E testing.
 * Spawns gk.exe as a fresh process for each call.
 */
export class McpClient {
	constructor(
		readonly gkPath: string,
		readonly ipcFilePath: string | undefined,
		private readonly host: 'vscode' | 'cursor' = 'vscode',
	) {}

	/** Returns names of all tools exposed by the MCP server. */
	async listTools(): Promise<string[]> {
		const msg = await this.sendRequests(
			[
				this.initMsg(),
				this.notificationMsg(),
				{ jsonrpc: '2.0' as const, id: 2, method: 'tools/list', params: {} },
			],
			2,
		);
		if (msg?.error) {
			throw new Error(`MCP tools/list failed: [${msg.error.code}] ${msg.error.message}`);
		}
		return ((msg?.result as { tools?: { name: string }[] })?.tools ?? []).map(t => t.name);
	}

	/** Calls a single MCP tool and returns the tool-response message. */
	async callTool(toolName: string, args: Record<string, unknown>): Promise<McpMessage> {
		const msg = await this.sendRequests(
			[
				this.initMsg(),
				this.notificationMsg(),
				{ jsonrpc: '2.0' as const, id: 3, method: 'tools/call', params: { name: toolName, arguments: args } },
			],
			3,
		);
		return msg ?? { jsonrpc: '2.0', id: 3, error: { code: -1, message: 'No response received' } };
	}

	/**
	 * Calls `gk mcp config <host>` and returns the parsed McpConfiguration.
	 * Useful for smoke-testing the config output format.
	 */
	async getMcpConfig(options?: { experimental?: boolean; insiders?: boolean }): Promise<McpConfigResult> {
		const args = ['mcp', 'config', this.host, '--source=gitlens', `--scheme=${this.host}`];
		if (options?.experimental) {
			args.push('--experimental');
		}
		if (options?.insiders) {
			args.push('--insiders');
		}

		return new Promise((resolve, reject) => {
			const proc = spawn(this.gkPath, args, {
				env: this.buildEnv(),
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			let stdout = '';
			let stderr = '';
			proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
			proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
			proc.on('close', (code: number | null) => {
				// Strip "checking for updates..." noise before parsing
				const clean = stdout.replace(/checking for updates\.\.\./gi, '').trim();
				if (code != null && code !== 0) {
					reject(
						new Error(
							`gk mcp config exited with code ${code}: ${clean.slice(0, 200)}${stderr ? `\nstderr: ${stderr}` : ''}`,
						),
					);
					return;
				}
				try {
					resolve(JSON.parse(clean) as McpConfigResult);
				} catch {
					reject(
						new Error(
							`gk mcp config returned non-JSON: ${clean.slice(0, 200)}${stderr ? `\nstderr: ${stderr}` : ''}`,
						),
					);
				}
			});
			proc.on('error', reject);
		});
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	private buildEnv(): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (this.ipcFilePath != null) {
			env['GK_GL_PATH'] = this.ipcFilePath;
		}
		return env;
	}

	private initMsg() {
		return {
			jsonrpc: '2.0' as const,
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'gitlens-e2e-test', version: '1.0' },
			},
		};
	}

	private notificationMsg() {
		return { jsonrpc: '2.0' as const, method: 'notifications/initialized', params: {} };
	}

	/**
	 * Spawns gk mcp, sends all messages, waits for the response with `targetId`,
	 * and handles elicitation/create by auto-cancelling (safe default for tests).
	 */
	private sendRequests(messages: object[], targetId: number, timeoutMs = 30_000): Promise<McpMessage | undefined> {
		return new Promise((resolve, reject) => {
			const proc = spawn(
				this.gkPath,
				['mcp', `--host=${this.host}`, '--source=gitlens', `--scheme=${this.host}`],
				{ env: this.buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
			);

			let resolved = false;
			let stderr = '';
			proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

			const timer = setTimeout(() => {
				if (!resolved) {
					resolved = true;
					proc.kill();
					reject(
						new Error(
							`McpClient: timeout after ${timeoutMs}ms waiting for id=${targetId}${stderr ? `\nstderr: ${stderr}` : ''}`,
						),
					);
				}
			}, timeoutMs);

			const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });

			rl.on('line', (line: string) => {
				const trimmed = line.trim();
				if (!trimmed) return;
				let msg: McpMessage;
				try {
					msg = JSON.parse(trimmed) as McpMessage;
				} catch {
					return; // non-JSON line (e.g. CLI update check)
				}

				// Auto-cancel any elicitation requests so tests don't hang
				if (msg.method === 'elicitation/create') {
					proc.stdin.write(
						`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { action: 'cancel' } })}\n`,
					);
					return;
				}

				if (msg.id === targetId && !resolved) {
					resolved = true;
					clearTimeout(timer);
					proc.kill();
					resolve(msg);
				}
			});

			rl.on('close', () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					reject(
						new Error(
							`McpClient: process exited before response id=${targetId} was received${stderr ? `\nstderr: ${stderr}` : ''}`,
						),
					);
				}
			});

			proc.on('error', (err: Error) => {
				if (!resolved) {
					resolved = true;
					clearTimeout(timer);
					reject(err);
				}
			});

			const payload = `${messages.map(m => JSON.stringify(m)).join('\n')}\n`;
			proc.stdin.write(payload);
			proc.stdin.end();
		});
	}
}
