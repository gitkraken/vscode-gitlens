import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import * as process from 'process';
import type { ProcessSpawner } from '@gitlens/utils/env/node/exec.js';
import { findExecutable, runSpawn, spawnProcess } from '@gitlens/utils/env/node/exec.js';
import { isWindows } from '@gitlens/utils/env/node/platform.js';
import { Logger } from '@gitlens/utils/logger.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';

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

/** One entry of Claude's own `claude agents --json` output. Verified fields — no others are
 *  present. `kind: 'interactive'` entries carry `pid`/`status`; `kind: 'background'` entries carry
 *  `state` instead and have no `pid`. */
interface ClaudeAgentsListEntry {
	cwd?: string;
	id?: string;
	kind?: string;
	name?: string;
	pid?: number;
	sessionId?: string;
	startedAt?: string;
	state?: string;
	status?: string;
	/** Only present when `status` is `waiting` — what the session is blocked on (`permission prompt`,
	 *  `input needed`, `sandbox request`, `worker request`, `dialog open`). */
	waitingFor?: string;
}

/** A session entry reported by `claude agents --json`, interactive or background. The listing is
 *  current enough to reconcile stale durable records, but can retain terminal background entries;
 *  consumers must interpret `state` before treating an entry as live. */
export interface LiveClaudeSession {
	sessionId: string;
	pid?: number;
	cwd?: string;
	kind?: string;
	status?: string;
	state?: string;
	/** Only set when `status` is `waiting` — distinguishes a permission prompt from an ordinary
	 *  question, which map to different statuses on our side. */
	waitingFor?: string;
}

/** `claude agents --json` measured at ~0.29s per invocation — too expensive to pay on every
 *  reconciliation poll, so results are reused for this long before the command is re-run. */
const liveSessionsCacheTtlMs = 5000;
/** Kills the spawned `claude` process if it hasn't answered within this long, so a hung or
 *  misbehaving CLI can never stall a reconciliation poll. */
const liveSessionsSpawnTimeoutMs = 5000;

const liveSessionsCache = new PromiseCache<string, ReadonlyMap<string, LiveClaudeSession>>({
	createTTL: liveSessionsCacheTtlMs,
});

/**
 * Lists Claude's current interactive/background session entries by spawning `claude agents
 * --json`, keyed by `sessionId`. The result can include terminal background entries; consumers
 * decide whether each entry proves liveness. Deliberately omits `--cwd`: the provider needs a
 * session-id-keyed map spanning every worktree, not just the current one. Also omits `--all`,
 * which would additionally include durable ended-session history we don't want here.
 *
 * Fails soft, always: `claude` missing from PATH, a non-zero exit, a timed-out spawn, or
 * unparseable stdout all yield an empty map rather than throwing — a failure here must never
 * turn an actually-live session into an error, it just falls back to trusting the CLI's durable
 * record as-is.
 *
 * Cached for {@link liveSessionsCacheTtlMs} so a reconciliation burst doesn't re-spawn the process
 * per session. `command` and `timeoutMs` are overridable for tests (point `command` at a fixture
 * script; shrink `timeoutMs` to keep a timeout test fast).
 */
export function getLiveClaudeSessions(
	command = 'claude',
	timeoutMs = liveSessionsSpawnTimeoutMs,
): Promise<ReadonlyMap<string, LiveClaudeSession>> {
	return liveSessionsCache.getOrCreate(`${command} ${timeoutMs}`, () => queryLiveClaudeSessions(command, timeoutMs));
}

/**
 * A {@link ProcessSpawner} whose timeout kills the whole process tree on Windows. There, Node's own
 * timeout kill terminates only the direct child — and when `claude` resolves to npm's `claude.cmd`
 * shim, that child is `cmd.exe`, so the real `claude.exe` beneath it would be orphaned on every
 * timed-out poll (#6146). `taskkill /T` finds descendants by parent pid, so it must run while the
 * root is still alive; the trailing `kill()` only marks the process killed if anything survived.
 */
function spawnKillingTreeOnTimeout(onTimeout: () => void): ProcessSpawner {
	return (command, args, { timeout, ...options }) => {
		const child = spawnProcess(command, args, options);
		if (timeout == null) return child;

		const timer = setTimeout(() => {
			onTimeout();
			if (!isWindows || child.pid == null) {
				child.kill();
				return;
			}

			execFile(
				join(process.env.SYSTEMROOT ?? 'C:\\WINDOWS', 'System32', 'taskkill.exe'),
				['/T', '/F', '/PID', String(child.pid)],
				{ windowsHide: true },
				() => child.kill(),
			);
		}, timeout);
		child.once('close', () => clearTimeout(timer));
		return child;
	};
}

async function queryLiveClaudeSessions(
	command: string,
	timeoutMs: number,
): Promise<ReadonlyMap<string, LiveClaudeSession>> {
	let output: string;
	let timedOut = false;
	try {
		const resolved = await findExecutable(command, ['agents', '--json']);
		({ stdout: output } = await runSpawn<string>(resolved.cmd, resolved.args, 'utf8', {
			timeout: timeoutMs,
			quiet: true,
			spawn: spawnKillingTreeOnTimeout(() => (timedOut = true)),
		}));
	} catch (ex) {
		if (timedOut) {
			// Warn, not debug: a CLI that hangs every time silently disables live reconciliation
			Logger.warn(`getLiveClaudeSessions: '${command} agents --json' did not answer within ${timeoutMs}ms`);
		} else {
			Logger.debug(`getLiveClaudeSessions: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
		return new Map();
	}

	let entries: unknown;
	try {
		entries = JSON.parse(output);
	} catch (ex) {
		Logger.debug(`getLiveClaudeSessions: unparseable output: ${ex instanceof Error ? ex.message : String(ex)}`);
		return new Map();
	}
	if (!Array.isArray(entries)) return new Map();

	const result = new Map<string, LiveClaudeSession>();
	for (const entry of entries as ClaudeAgentsListEntry[]) {
		if (entry?.sessionId == null) continue;

		result.set(entry.sessionId, {
			sessionId: entry.sessionId,
			pid: entry.pid,
			cwd: entry.cwd,
			kind: entry.kind,
			status: entry.status,
			state: entry.state,
			waitingFor: entry.waitingFor,
		});
	}
	return result;
}
