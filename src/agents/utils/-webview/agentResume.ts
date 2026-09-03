import { workspace } from 'vscode';
import { isCliExecutableAvailable } from '@env/gk/agentFetcher.js';
import { getAgentCapabilitiesByProviderId } from '@gitlens/agents/agentCapabilities.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import { openTerminal } from '../../../system/-webview/terminal.js';
import type { AgentSession } from '../../provider.js';
import { getAgentTerminalIcon } from './agentIcon.js';

/** Phases for which a past session is safe to resume. Idle is the strict baseline — the
 *  session has no in-flight work, so a fresh terminal-hosted process can pick up the transcript
 *  without colliding with a live one. `waiting` is also included since the agent is parked on
 *  user input (a pending tool/plan/question) — the existing host can't act on it without the
 *  user, so resuming in a terminal is a non-destructive alternative. `ended` is the safest of
 *  all — the process is already gone, so a resume can never collide. Active work phases
 *  (`working` — covers thinking/tool_use/responding/compacting per `getPhaseForStatus`) are
 *  excluded: spawning a duplicate against a live process risks parallel writes. */
export function canResumeSession(session: AgentSession): boolean {
	return session.phase === 'idle' || session.phase === 'waiting' || session.phase === 'ended';
}

/** The minimum needed to resume a session: its provider, id, and the directory to resume it from.
 *  Past sessions read out of a transcript store are not `AgentSession`s (no process, no phase), so
 *  the resume path takes this instead — use {@link toResumableSessionRef} to derive one from a live
 *  session. */
export interface ResumableSessionRef {
	readonly providerId: string;
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
		providerId: session.providerId,
		id: session.id,
		cwd: session.cwd ?? session.initialCwd ?? session.worktreePath ?? session.workspacePath,
		name: session.name,
	};
}

/** Spawns a terminal in the session's directory and runs the agent's own resume command
 *  (`claude --resume <id>`, `codex resume <id>`, `opencode --session <id>`, `copilot --resume=<id>`).
 *  `cwd` is load-bearing: Claude homes transcripts under the cwd and OpenCode scopes sessions to the
 *  project directory, so both only find the session when launched from it. Serves both the
 *  live-session dead-end fallback (extension uninstalled, open commands throw, CLI terminal closed,
 *  peer window unreachable) and resuming a past session out of a transcript or durable store. Falls
 *  back to the first workspace folder when the ref carries no cwd. Returns `false` (after
 *  `Logger.warn`) when the agent declares no `cli` block.
 *
 *  Prefers gkcli's detected executable (same source the agent picker uses — see `agentRegistry.ts`)
 *  so users with a non-PATH install (Homebrew under `/opt/homebrew/bin`, Volta shim, custom prefix)
 *  get the right binary. Falls back to the descriptor's bare command when gkcli has no detected
 *  entry or its reported path no longer exists on disk. */
export async function resumeAgentSessionInTerminal(
	session: ResumableSessionRef,
	container: Container,
): Promise<boolean> {
	const capabilities = getAgentCapabilitiesByProviderId(session.providerId);
	const cli = capabilities?.cli;
	if (capabilities == null || cli == null) {
		Logger.warn(
			`agentResume.resumeAgentSessionInTerminal: no CLI for provider ${session.providerId}; session ${session.id} not resumed`,
		);
		return false;
	}

	const cwd = session.cwd ?? workspace.workspaceFolders?.[0]?.uri.fsPath;
	const executable = await resolveExecutable(cli.agentName, cli.command, container);

	const terminal = openTerminal({
		name: `${capabilities.displayName} (${session.name ?? session.id})`,
		cwd: cwd,
		iconPath: getAgentTerminalIcon(cli.agentName),
	});
	terminal.show();
	terminal.sendText(buildResumeCommandLine(executable, cli.resumeArgs(session.id)), true);

	Logger.info(
		`agentResume.resumeAgentSessionInTerminal: spawned terminal for ${session.providerId} session ${session.id} (cwd=${cwd ?? 'none'}, executable=${executable})`,
	);
	return true;
}

export function buildResumeCommandLine(executable: string, args: readonly string[]): string {
	return [executable, ...args].map(quoteForShell).join(' ');
}

async function resolveExecutable(agentName: string, fallback: string, container: Container): Promise<string> {
	try {
		const agent = await container.agents.getAgent(agentName);
		if (agent?.detected && isCliExecutableAvailable(agent.executable)) return agent.executable!;
	} catch (ex) {
		Logger.warn(
			`agentResume.resolveExecutable: gkcli agent lookup failed for ${agentName} (${ex instanceof Error ? ex.message : String(ex)}); falling back to PATH`,
		);
	}
	return fallback;
}

/** Wraps the token in double quotes only when it contains a space — keeps the typed command tidy
 *  for the common single-token case while staying safe for `/opt/Homebrew Cellar/...` style paths.
 *  Escapes embedded double quotes; backslashes pass through as Windows paths use them as
 *  separators. */
function quoteForShell(token: string): string {
	if (!token.includes(' ')) return token;
	return `"${token.replace(/"/g, '\\"')}"`;
}
