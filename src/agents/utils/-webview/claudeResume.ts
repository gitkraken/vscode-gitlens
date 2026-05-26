import { ThemeIcon, window, workspace } from 'vscode';
import { getClaudeAgent, isCliExecutableAvailable } from '@env/gk/cli/agents.js';
import { Logger } from '@gitlens/utils/logger.js';
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

/** Spawns a new VS Code terminal in the session's working directory and runs `claude --resume
 *  <sessionId>` to reattach to the transcript. Used as a fallback when the normal "open in
 *  extension / focus terminal" dispatch can't reach the session (extension uninstalled, open
 *  commands throw, CLI terminal closed, peer window unreachable).
 *
 *  cwd resolution order: session.cwd → worktreePath → workspacePath → first workspace folder.
 *  All paths come straight off the session shape (`AgentSession` in `provider.ts`); the first
 *  non-null wins.
 *
 *  Prefers gkcli's detected `claude-cli` executable (same source the agent picker uses — see
 *  `agentRegistry.ts`) so users with a non-PATH install (Homebrew under `/opt/homebrew/bin`,
 *  Volta shim, custom prefix) get the right binary. Falls back to bare `claude` when gkcli has
 *  no detected entry or its reported path no longer exists on disk. */
export async function resumeClaudeSessionInTerminal(session: AgentSession): Promise<void> {
	const cwd =
		session.cwd ?? session.worktreePath ?? session.workspacePath ?? workspace.workspaceFolders?.[0]?.uri.fsPath;

	const executable = await resolveClaudeExecutable();

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

async function resolveClaudeExecutable(): Promise<string> {
	try {
		const agent = await getClaudeAgent();
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
