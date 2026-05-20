import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { Logger } from '@gitlens/utils/logger.js';

interface ClaudeSessionFile {
	pid: number;
	sessionId: string;
	cwd?: string;
	entrypoint?: string;
}

function defaultSessionsDir(): string {
	return join(homedir(), '.claude', 'sessions');
}

/**
 * Reads the Claude session metadata file written by the agent process at
 * `<sessionsDir>/<pid>.json` (default `~/.claude/sessions/`). Returns `undefined` when the
 * file is missing, unreadable, malformed, or claims a different pid than the filename —
 * all of which are normal (older Claude versions, already-exited sessions, transient FS
 * races, PID reuse after a stale file was left behind).
 */
async function readClaudeSessionFile(pid: number, sessionsDir: string): Promise<ClaudeSessionFile | undefined> {
	const path = join(sessionsDir, `${pid}.json`);
	try {
		const raw = await readFile(path, 'utf8');
		const data = JSON.parse(raw) as ClaudeSessionFile;
		if (data.pid !== pid) return undefined;
		return data;
	} catch (ex) {
		if ((ex as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			Logger.debug(`readClaudeSessionFile(${pid}): ${ex instanceof Error ? ex.message : String(ex)}`);
		}
		return undefined;
	}
}

/**
 * Classifies the host of a Claude Code session by reading its per-pid metadata file.
 * - `'extension'` — `entrypoint === 'claude-vscode'` (Claude Code VS Code extension)
 * - `'cli'` — any other known entrypoint (`'cli'`, `'sdk-ts'`, etc.)
 * - `undefined` — file missing / unreadable / no entrypoint field; caller applies its fallback.
 *
 * `sessionsDir` is overridable for tests; production callers omit it.
 */
export async function classifyClaudeSessionHost(
	pid: number,
	sessionsDir: string = defaultSessionsDir(),
): Promise<'extension' | 'cli' | undefined> {
	const data = await readClaudeSessionFile(pid, sessionsDir);
	if (data?.entrypoint == null) return undefined;
	return data.entrypoint === 'claude-vscode' ? 'extension' : 'cli';
}
