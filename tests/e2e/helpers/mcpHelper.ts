import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as process from 'node:process';
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

export type IpcDiscoveryData = {
	token: string;
	address: string;
	port: number;
	pid: number;
	workspacePaths?: string[];
	ideName?: string;
	ideDisplayName?: string;
	scheme?: string;
	createdAt?: string;
};

/** Directory where GitLens writes IPC discovery files. */
const ipcDiscoveryDir = path.join(os.tmpdir(), 'gitkraken', 'gitlens');

/**
 * Reads and parses the IPC discovery JSON file.
 * Returns `undefined` if the file doesn't exist or can't be parsed.
 */
export function readIpcDiscoveryFile(filePath: string): IpcDiscoveryData | undefined {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as IpcDiscoveryData;
	} catch {
		return undefined;
	}
}

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
 * Finds the IPC discovery file whose `workspacePaths` contains the given path.
 *
 * GitLens names discovery files with `process.ppid` (the extension host's parent),
 * which differs from the Electron main PID exposed by Playwright. Matching by
 * workspace path sidesteps this mismatch. Each E2E worker creates a unique temp
 * git repo, so the match is unambiguous even under parallel execution.
 */
export function findIpcFileByWorkspace(workspacePath: string): string | undefined {
	if (!existsSync(ipcDiscoveryDir)) return undefined;

	const normalizedTarget = workspacePath.replace(/\\/g, '/').toLowerCase();

	for (const f of readdirSync(ipcDiscoveryDir)) {
		if (!f.startsWith('gitlens-ipc-server-') || !f.endsWith('.json')) continue;

		const fullPath = path.join(ipcDiscoveryDir, f);
		const data = readIpcDiscoveryFile(fullPath);
		if (data == null) continue;

		const match = data.workspacePaths?.some(p => p.replace(/\\/g, '/').toLowerCase() === normalizedTarget);
		if (match) return fullPath;
	}

	return undefined;
}

/**
 * Finds the newest live IPC discovery file, optionally filtered by PID.
 * Used as a fallback when workspace-based lookup is not available.
 */
export function findLatestIpcFile(vscodePid?: number): string | undefined {
	if (!existsSync(ipcDiscoveryDir)) return undefined;

	const candidates = readdirSync(ipcDiscoveryDir)
		.filter(f => {
			if (!f.startsWith('gitlens-ipc-server-') || !f.endsWith('.json')) return false;
			if (vscodePid != null) {
				return f.startsWith(`gitlens-ipc-server-${vscodePid}-`);
			}
			return true;
		})
		.map(f => {
			const fullPath = path.join(ipcDiscoveryDir, f);
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
			try {
				process.kill(data.pid, 0);
				return fullPath;
			} catch (killErr) {
				const code = (killErr as { code?: string }).code;
				// EPERM means the process exists but we can't signal it — still valid
				if (code === 'EPERM') return fullPath;
				// ESRCH means the process is gone — skip
			}
		} catch {
			// unreadable or invalid file — skip
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
		return this.sendRequests(
			[
				this.initMsg(),
				this.notificationMsg(),
				{ jsonrpc: '2.0' as const, id: 3, method: 'tools/call', params: { name: toolName, arguments: args } },
			],
			3,
		);
	}

	/**
	 * Calls `gk mcp config <host>` and returns the parsed McpConfiguration.
	 * Useful for smoke-testing the config output format.
	 */
	async getMcpConfig(
		options?: { experimental?: boolean; insiders?: boolean },
		timeoutMs = 30_000,
	): Promise<McpConfigResult> {
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

			let settled = false;
			let stdout = '';
			let stderr = '';
			proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
			proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

			const timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					proc.kill();
					reject(
						new Error(`gk mcp config timed out after ${timeoutMs}ms${stderr ? `\nstderr: ${stderr}` : ''}`),
					);
				}
			}, timeoutMs);

			proc.on('close', (code: number | null) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				// Strip "checking for updates..." noise before parsing
				const clean = stdout.replace(/checking for updates.../gi, '').trim();
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
			proc.on('error', (err: Error) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(err);
				}
			});
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
	private sendRequests(messages: object[], targetId: number, timeoutMs = 30_000): Promise<McpMessage> {
		return new Promise((resolve, reject) => {
			const proc = spawn(
				this.gkPath,
				['mcp', `--host=${this.host}`, '--source=gitlens', `--scheme=${this.host}`],
				{ env: this.buildEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
			);

			let settled = false;
			let stderr = '';
			proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

			const timer = setTimeout(() => {
				if (!settled) {
					settled = true;
					proc.stdin.end();
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
				if (settled) return;

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

				if (msg.id === targetId) {
					settled = true;
					clearTimeout(timer);
					rl.close();
					proc.stdin.end();
					proc.kill();
					resolve(msg);
				}
			});

			proc.on('close', (code, signal) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					const exitInfo = code != null ? `code=${code}` : signal != null ? `signal=${signal}` : 'unknown';
					reject(
						new Error(
							`McpClient: process exited (${exitInfo}) before response id=${targetId} was received${stderr ? `\nstderr: ${stderr}` : ''}`,
						),
					);
				}
			});

			proc.on('error', (err: Error) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(err);
				}
			});

			// Keep stdin open after writing so elicitation/create responses can be sent.
			// stdin is closed in the resolve/timeout/close paths above.
			const payload = `${messages.map(m => JSON.stringify(m)).join('\n')}\n`;
			proc.stdin.write(payload);
		});
	}
}
