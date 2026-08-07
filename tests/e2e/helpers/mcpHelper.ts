import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
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

/**
 * Mode the `gk mcp` server is started in, which decides the published tool surface.
 *
 * `readonly` drops the mutating tools, `experimental` adds the experimental ones — both are
 * process arguments, so every call spawns its own server (see `McpClient.sendRequests`).
 */
export type McpServerMode = { readonly?: boolean; experimental?: boolean };

/** A tool as published by `tools/list`, including the schema clients validate arguments against. */
export type McpToolDefinition = {
	name: string;
	description?: string;
	inputSchema?: { type?: string; required?: string[]; properties?: Record<string, unknown> };
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

/**
 * Directory where GitLens writes IPC discovery files.
 *
 * This is an assumption about the *editor's* environment, not just ours: GitLens resolves it from
 * whatever `os.tmpdir()` reports inside the extension host. The harness launches the editor as a
 * child of this process, so the two agree — but only while that holds. The two ways it breaks are
 * platform-specific and both surface here as "no discovery file", which is why
 * {@link describeIpcDiscovery} reports the resolved directory rather than leaving a failure to
 * name nothing:
 * - **macOS**: `TMPDIR` is per-user and per-session (`/var/folders/<hash>/…`, itself a symlink to
 *   `/private/var/…`). A differently-launched editor gets a different one. Reads work through
 *   either form, so the diagnosis reports both when they differ.
 * - **Windows**: `%TEMP%` is per-user, and a redirected or roamed profile puts the file somewhere
 *   this process cannot see.
 *
 * (Linux is the boring case: `TMPDIR` is usually unset and both sides land in a shared `/tmp`.)
 *
 * A `readdir` that fails outright — a permission-restricted or vanished directory — is carried out
 * of the sweep rather than swallowed, and reported by {@link describeIpcDiscovery}. The poll loop
 * itself keeps retrying: it cannot tell a permanent refusal from a directory being recreated
 * underneath it, and the wait has a deadline anyway.
 */
const ipcDiscoveryDir = path.join(os.tmpdir(), 'gitkraken', 'gitlens');

/** Prefix + extension GitLens names its discovery files with. */
const ipcDiscoveryFilePrefix = 'gitlens-ipc-server-';

/**
 * Sleeps between polls with exponential backoff and jitter, never overshooting `deadline`.
 *
 * Backoff keeps a long, contended wait from spinning on the filesystem hundreds of times, while the
 * low starting delay keeps the fast path fast (a first-attempt hit never sleeps at all). Jitter
 * matters under parallel workers: without it, N workers that started together stay in lockstep and
 * hit the same directory on the same tick for the whole wait.
 *
 * Returns the delay actually slept, or `undefined` when the deadline has passed and the caller
 * should give up.
 */
async function backoffDelay(attempt: number, deadline: number): Promise<number | undefined> {
	const remaining = deadline - Date.now();
	if (remaining <= 0) return undefined;

	// 250ms doubling to a 2s ceiling: worst-case added latency on a hit is one ceiling-length sleep,
	// which is negligible against the multi-second waits this exists for.
	const base = Math.min(250 * 2 ** Math.min(attempt, 3), 2000);
	const delay = Math.min(base + Math.floor(Math.random() * 250), remaining);
	await new Promise(r => setTimeout(r, delay));
	return delay;
}

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
 *
 * Polls with retries because the IPC file may not yet exist when the fixture
 * runs (GitLens writes it asynchronously after activation).
 */
export async function findIpcFileByWorkspace(workspacePath: string, timeoutMs = 30_000): Promise<string | undefined> {
	const deadline = Date.now() + timeoutMs;

	for (let attempt = 0; ; attempt++) {
		const match = findIpcFileNow(workspacePath).filePath;
		if (match != null) return match;

		if ((await backoffDelay(attempt, deadline)) == null) return undefined;
	}
}

/** One non-blocking sweep of the discovery directory, plus what it saw — the raw material for both
 *  the poll loop and {@link describeIpcDiscovery}. */
function findIpcFileNow(workspacePath: string): {
	filePath?: string;
	candidates: { file: string; workspaces: string[] }[];
	/** Files named like discovery files that could not be read or parsed. */
	unreadable: string[];
	readError?: string;
} {
	const normalizedTarget = normalizeWorkspacePath(workspacePath);
	const candidates: { file: string; workspaces: string[] }[] = [];
	const unreadable: string[] = [];

	if (!existsSync(ipcDiscoveryDir)) return { candidates: candidates, unreadable: unreadable };

	let files: string[];
	try {
		files = readdirSync(ipcDiscoveryDir);
	} catch (ex) {
		// A directory we cannot enumerate (permissions, a redirected profile) is a different failure
		// from an empty one, and the caller must be able to say which.
		return {
			candidates: candidates,
			unreadable: unreadable,
			readError: ex instanceof Error ? ex.message : String(ex),
		};
	}

	for (const file of files) {
		if (!file.startsWith(ipcDiscoveryFilePrefix) || !file.endsWith('.json')) continue;

		const fullPath = path.join(ipcDiscoveryDir, file);
		const data = readIpcDiscoveryFile(fullPath);
		if (data == null) {
			// Locked, truncated or corrupt: `readIpcDiscoveryFile` collapses I/O and parse failures
			// alike into `undefined`, so without tracking it here the file would vanish from the
			// diagnosis and read as "nothing was published" — the opposite of what happened.
			unreadable.push(file);
			continue;
		}

		const workspaces = data.workspacePaths ?? [];
		candidates.push({ file: file, workspaces: workspaces });
		if (workspaces.some(p => normalizeWorkspacePath(p) === normalizedTarget)) {
			return { filePath: fullPath, candidates: candidates, unreadable: unreadable };
		}
	}

	return { candidates: candidates, unreadable: unreadable };
}

/** Windows paths differ in separator and case between what GitLens writes and what Playwright reports. */
function normalizeWorkspacePath(workspacePath: string): string {
	return workspacePath.replace(/\\/g, '/').toLowerCase();
}

/**
 * Explains why {@link findIpcFileByWorkspace} came back empty, in terms of the assumption that broke.
 *
 * Without this a missing discovery file reads as a bare `undefined`: the IPC specs skip, the round-trip
 * specs fall back to the CLI's own discovery, and the run stays green while proving nothing. The report
 * distinguishes the cases that need different fixes — directory missing (GitLens never published, e.g.
 * AI features disabled), directory unreadable (permissions), no files (published elsewhere — a different
 * `TMPDIR`/`%TEMP%` than this process sees), or files present for other workspaces (a stale instance, or
 * the wrong one matched).
 */
export function describeIpcDiscovery(workspacePath: string): string {
	const realDir = safeRealPath(ipcDiscoveryDir);
	const where =
		realDir != null && realDir !== ipcDiscoveryDir
			? `${ipcDiscoveryDir} (resolves to ${realDir})`
			: ipcDiscoveryDir;
	const preamble = `no IPC discovery file for workspace "${workspacePath}" in ${where}`;

	if (!existsSync(ipcDiscoveryDir)) {
		return `${preamble} — the directory does not exist, so GitLens never published one here. Either it did not reach \`startIpc\` (AI features disabled turn the whole publish path off), or the editor resolved a different temp directory than this process did (${process.platform === 'win32' ? '%TEMP%' : 'TMPDIR'} need not agree across launch contexts).`;
	}

	const { candidates, unreadable, readError } = findIpcFileNow(workspacePath);
	if (readError != null) {
		return `${preamble} — the directory exists but could not be read: ${readError}`;
	}

	// Unreadable files are reported alongside whatever else was found: a locked or half-written
	// discovery file is a different problem from an absent one, and it is invisible in the counts.
	const spoiled = unreadable.length
		? ` ${unreadable.length} file(s) matched the naming pattern but could not be read or parsed (locked, truncated or corrupt): ${unreadable.join(', ')}.`
		: '';

	if (!candidates.length) {
		return `${preamble} — the directory exists but holds no readable \`${ipcDiscoveryFilePrefix}*.json\` files, so nothing usable published into the temp directory this process sees.${spoiled}`;
	}

	const listed = candidates.map(c => `${c.file} → [${c.workspaces.join(', ')}]`).join('; ');
	return `${preamble} — ${candidates.length} discovery file(s) present, none carrying this workspace: ${listed}.${spoiled}`;
}

/** `realpathSync` that reports failure as absent rather than throwing — used for diagnosis only. */
function safeRealPath(target: string): string | undefined {
	try {
		return realpathSync(target);
	} catch {
		return undefined;
	}
}

/**
 * Waits for the gk CLI proxy binary to appear on disk. GitLens auto-installs it on first activation.
 * Timing is editor- and load-dependent: VS Code lands it in ~5–6s, but a heavy fork like Positron takes
 * ~26s launched alone and ~44s when several instances start at once (measured on Linux — the download +
 * extract slides later under launch contention). So the 30s default was too tight and produced transient
 * `mcp*` failures on Positron under parallel CI workers. Polls and returns the instant the binary appears,
 * so fast editors pay nothing; the generous cap only affects the slow/contended path.
 *
 * Prefer {@link waitForMcpReady} over calling this directly: it shares one budget with the
 * IPC-discovery wait, so the two cannot add up past the per-test timeout.
 */
export async function waitForCliInstall(gkPath: string, timeoutMs = 50_000): Promise<void> {
	const started = Date.now();
	const deadline = started + timeoutMs;

	for (let attempt = 0; ; attempt++) {
		if (existsSync(gkPath)) return;

		if ((await backoffDelay(attempt, deadline)) == null) {
			// Name what was checked and what is actually there, without claiming which cause it was:
			// an absent binary is equally consistent with GitLens never reaching the installer and
			// with the installer running and failing — `CliBinaryInstaller` catches its download and
			// extraction errors and reports `attempted`, leaving exactly this filesystem state.
			const dir = path.dirname(gkPath);
			let contents: string;
			try {
				contents = existsSync(dir) ? `contains [${readdirSync(dir).join(', ')}]` : 'does not exist';
			} catch (ex) {
				contents = `could not be read: ${ex instanceof Error ? ex.message : String(ex)}`;
			}

			throw new Error(
				`GK CLI never appeared at "${gkPath}" — gave up after ${attempt + 1} attempts over ${Date.now() - started}ms (budget ${timeoutMs}ms). Its directory ${contents}. GitLens installs it during activation, so waiting longer will not help: either activation never reached the installer, or the install itself failed (offline, download or extraction) and was swallowed. Check the extension host log for the install attempt.`,
			);
		}
	}
}

/** What the `mcpClient` fixture needs before it can talk to the bundled server. */
export interface McpReadiness {
	/** The gk binary GitLens installed, confirmed present. */
	gkPath: string;
	/** Discovery file pinning the live instance, or `undefined` when none was published for it. */
	ipcFilePath: string | undefined;
	/** Set only when `ipcFilePath` is `undefined` — why, in terms of the assumption that broke. */
	ipcDiagnosis: string | undefined;
}

/**
 * Waits for both preconditions of an MCP call — the installed CLI, then the discovery file that pins
 * the running instance — under a **single** budget.
 *
 * Sequencing them with independent timeouts is what used to make a slow, contended run fail
 * anonymously: 50s of install wait followed by 30s of discovery wait can only end in the 60s per-test
 * timeout, which names neither. Sharing one budget means the second wait gets whatever the first left,
 * and whichever precondition is actually missing is the one that reports.
 *
 * A missing discovery file is deliberately not fatal: the CLI can still find the instance itself, and
 * `mcp.test.ts` covers that unpinned path on purpose. It comes back as a diagnosis the caller can
 * surface instead of a silent `undefined`.
 */
export async function waitForMcpReady(gkPath: string, workspacePath: string, budgetMs = 55_000): Promise<McpReadiness> {
	const deadline = Date.now() + budgetMs;

	await waitForCliInstall(gkPath, budgetMs);

	const ipcFilePath = await findIpcFileByWorkspace(workspacePath, Math.max(deadline - Date.now(), 0));

	return {
		gkPath: gkPath,
		ipcFilePath: ipcFilePath,
		ipcDiagnosis: ipcFilePath == null ? describeIpcDiscovery(workspacePath) : undefined,
	};
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
		/** Why {@link ipcFilePath} is absent, when it is — so a skip or failure can name the cause. */
		readonly ipcDiagnosis?: string,
	) {}

	/** Returns names of all tools exposed by the MCP server, optionally started in a specific mode. */
	async listTools(mode?: McpServerMode): Promise<string[]> {
		return (await this.listToolDefinitions(mode)).map(t => t.name);
	}

	/**
	 * Returns the full tool definitions from `tools/list`, optionally starting the server in a
	 * specific mode. Callers that only need names should use `listTools`; this exists for assertions
	 * about the published contract itself (declared parameters, descriptions).
	 */
	async listToolDefinitions(mode?: McpServerMode): Promise<McpToolDefinition[]> {
		const msg = await this.sendRequests(
			[
				this.initMsg(),
				this.notificationMsg(),
				{ jsonrpc: '2.0' as const, id: 2, method: 'tools/list', params: {} },
			],
			2,
			mode,
		);
		if (msg?.error) {
			throw new Error(`MCP tools/list failed: [${msg.error.code}] ${msg.error.message}`);
		}
		return (msg?.result as { tools?: McpToolDefinition[] })?.tools ?? [];
	}

	/** Calls a single MCP tool and returns the tool-response message. */
	async callTool(toolName: string, args: Record<string, unknown>, mode?: McpServerMode): Promise<McpMessage> {
		return this.sendRequests(
			[
				this.initMsg(),
				this.notificationMsg(),
				{ jsonrpc: '2.0' as const, id: 3, method: 'tools/call', params: { name: toolName, arguments: args } },
			],
			3,
			mode,
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
	 * Builds the `gk mcp` arguments for a server mode.
	 *
	 * Flags are passed bare, never as `--flag=false`. That is mandatory for `--readonly`, which the
	 * CLI derives from the flag being *present* (`cmd.Flags().Changed`), so `--readonly=false` would
	 * still start a read-only server — omitting it is the only way to express "not read-only".
	 * `--experimental` is read by value, but is passed the same way for consistency.
	 */
	private serverArgs(mode: McpServerMode | undefined): string[] {
		const args = ['mcp', `--host=${this.host}`, '--source=gitlens', `--scheme=${this.host}`];
		if (mode?.readonly) {
			args.push('--readonly');
		}
		if (mode?.experimental) {
			args.push('--experimental');
		}
		return args;
	}

	/**
	 * Spawns gk mcp, sends all messages, waits for the response with `targetId`,
	 * and handles elicitation/create by auto-cancelling (safe default for tests).
	 */
	private sendRequests(
		messages: object[],
		targetId: number,
		mode?: McpServerMode,
		timeoutMs = 30_000,
	): Promise<McpMessage> {
		return new Promise((resolve, reject) => {
			const proc = spawn(this.gkPath, this.serverArgs(mode), {
				env: this.buildEnv(),
				stdio: ['pipe', 'pipe', 'pipe'],
			});

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
