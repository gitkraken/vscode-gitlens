import { kill } from 'process';
import type { AgentSession, AgentSessionStatus } from './types.js';

export function deriveStatusFromEvent(event: string): AgentSessionStatus {
	switch (event) {
		case 'SessionStart':
		case 'Stop':
		case 'StopFailure':
			return 'idle';
		case 'PreToolUse':
			return 'tool_use';
		case 'PreCompact':
			return 'compacting';
		case 'PermissionRequest':
		case 'Elicitation':
			return 'permission_requested';
		case 'UserPromptSubmit':
		case 'PostToolUse':
		case 'PostToolUseFailure':
		case 'PostCompact':
		case 'PermissionDenied':
		case 'ElicitationResult':
		case 'SubagentStart':
		case 'SubagentStop':
			return 'thinking';
		default:
			return 'idle';
	}
}

export function isProcessAlive(pid: number): boolean {
	// `kill(0, ...)` and `kill(<negative>, ...)` have process-group semantics on POSIX
	// (and target the current process under libuv on Windows), so they don't tell us
	// anything about a specific pid. Reject anything that isn't a real, positive pid.
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		kill(pid, 0);
		return true;
	} catch (ex) {
		// The process exists but we can't signal it: sandboxed/different uid (POSIX
		// EPERM) or `OpenProcess` access-denied (Windows EACCES). Treat as alive.
		// ESRCH and everything else mean dead.
		const code = (ex as NodeJS.ErrnoException)?.code;
		return code === 'EPERM' || code === 'EACCES';
	}
}

export function rehydrateSubagents(
	subagents:
		| (Omit<AgentSession, 'lastActivity' | 'phaseSince'> & { lastActivity: string; phaseSince: string })[]
		| undefined,
): AgentSession[] | undefined {
	if (subagents == null || subagents.length === 0) return undefined;
	return subagents.map(s => ({
		...s,
		lastActivity: new Date(s.lastActivity),
		phaseSince: new Date(s.phaseSince),
	}));
}

export function describeToolInput(toolName: string, toolInput: Record<string, unknown>): string {
	let detail: string | undefined;
	switch (toolName) {
		case 'Bash':
			detail = toolInput.command as string | undefined;
			break;
		case 'Edit':
		case 'Write':
		case 'Read':
			detail = toolInput.file_path as string | undefined;
			break;
		case 'Grep':
		case 'Glob':
			detail = toolInput.pattern as string | undefined;
			break;
		case 'WebFetch':
			detail = toolInput.url as string | undefined;
			break;
		case 'WebSearch':
			detail = toolInput.query as string | undefined;
			break;
		case 'NotebookEdit':
			detail = toolInput.notebook_path as string | undefined;
			break;
	}

	return detail != null ? `${toolName}(${detail})` : toolName;
}
