import { ThemeIcon, window, workspace } from 'vscode';
import { isCliExecutableAvailable } from '@env/gk/agentFetcher.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { AgentSession } from '../../provider.js';

/** Phases for which `claude --resume <id>` is safe to invoke. Idle is the strict baseline — the
 *  session has no in-flight work, so a fresh terminal-hosted process can pick up the transcript
 *  without colliding with a live one. `waiting` is also included since the agent is parked on
 *  user input (a pending tool/plan/question) — the existing host can't act on it without the
 *  user, so resuming in a terminal is a non-destructive alternative. Active work phases
 *  (`working` — covers thinking/tool_use/responding/compacting per `getPhaseForStatus`) are
 *  excluded: spawning a duplicate against a live process risks parallel writes. */
export function canResumeSession(session: AgentSession): boolean {
	return session.phase === 'idle' || session.phase === 'waiting';
}

/** The minimum needed to resume a session: its id and the directory to resume it from. Past sessions
 *  read out of the transcript store are not `AgentSession`s (no process, no phase), so the resume
 *  path takes this instead — use {@link toResumableSessionRef} to derive one from a live session. */
export interface ResumableSessionRef {
	readonly id: string;
	readonly cwd: string | undefined;
	readonly name?: string;
}

/** Picks the directory a live session must be resumed from.
 *
 *  The live `cwd` wins over `initialCwd`: Claude homes a transcript under the directory encoding the
 *  session's *current* cwd and migrates the file when the session `cd`s, so a drifted session's
 *  transcript no longer lives under its launch directory — resuming from `initialCwd` would search a
 *  directory the transcript has already left. (This inverts the original ordering, which assumed the
 *  store was keyed on the launch cwd; observed behavior says otherwise.) */
export function toResumableSessionRef(session: AgentSession): ResumableSessionRef {
	return {
		id: session.id,
		cwd: session.cwd ?? session.initialCwd ?? session.worktreePath ?? session.workspacePath,
		name: session.name,
	};
}

/** Spawns a new VS Code terminal in the session's working directory and runs `claude --resume
 *  <sessionId>` to reattach to the transcript. Serves both the live-session dead-end fallback
 *  (extension uninstalled, open commands throw, CLI terminal closed, peer window unreachable) and
 *  resuming a past session out of the transcript store.
 *
 *  `claude --resume <id>` only finds a session when invoked from the directory its transcript is
 *  homed under, so `cwd` is load-bearing — see {@link toResumableSessionRef}. Falls back to the first
 *  workspace folder when the ref carries none.
 *
 *  Prefers gkcli's detected `claude-cli` executable (same source the agent picker uses — see
 *  `agentRegistry.ts`) so users with a non-PATH install (Homebrew under `/opt/homebrew/bin`,
 *  Volta shim, custom prefix) get the right binary. Falls back to bare `claude` when gkcli has
 *  no detected entry or its reported path no longer exists on disk. */
export async function resumeClaudeSessionInTerminal(session: ResumableSessionRef, container: Container): Promise<void> {
	const cwd = session.cwd ?? workspace.workspaceFolders?.[0]?.uri.fsPath;

	const executable = await resolveClaudeExecutable(container);

	const terminal = window.createTerminal({
		name: `Claude (${session.name ?? session.id})`,
		cwd: cwd,
		iconPath: new ThemeIcon('claude'),
	});
	terminal.show();
	terminal.sendText(`${quoteForShell(executable)} --resume ${session.id}`, true);

	Logger.info(
		`claudeResume.resumeClaudeSessionInTerminal: spawned terminal for session ${session.id} (cwd=${cwd ?? 'none'}, executable=${executable})`,
	);
}

async function resolveClaudeExecutable(container: Container): Promise<string> {
	try {
		const agent = await container.agents.getClaude();
		if (agent?.detected && isCliExecutableAvailable(agent.executable)) {
			return agent.executable!;
		}
	} catch (ex) {
		Logger.warn(
			`claudeResume.resolveClaudeExecutable: gkcli agent lookup failed (${ex instanceof Error ? ex.message : String(ex)}); falling back to PATH`,
		);
	}
	return 'claude';
}

/** Wraps the path in double quotes only when it contains a space — keeps the typed command tidy
 *  for the common single-token `claude` case while staying safe for `/opt/Homebrew Cellar/...`
 *  style paths. Escapes embedded double quotes; backslashes pass through as Windows paths use
 *  them as separators. */
function quoteForShell(path: string): string {
	if (!path.includes(' ')) return path;
	return `"${path.replace(/"/g, '\\"')}"`;
}
