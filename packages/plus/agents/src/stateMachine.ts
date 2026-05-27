import { kill } from 'process';
import type { AgentSession, AgentSessionStatus, PendingPermissionKind } from './types.js';

/** Cap for derived plan / question summaries — short enough to clamp into a card row without
 *  truncation eating the leading content, long enough to convey what the prompt is about. */
const summaryMaxLength = 120;

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
		case 'MultiEdit':
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
		case 'ExitPlanMode':
			detail = extractPlanSummary(toolInput);
			break;
		case 'AskUserQuestion':
			detail = extractQuestionDetails(toolInput)?.text;
			break;
	}

	return detail != null ? `${toolName}(${detail})` : toolName;
}

/** Maps a Claude Code tool name to its UX-relevant prompt kind. `ExitPlanMode` and
 *  `AskUserQuestion` are the two tools whose semantics differ from a regular permission
 *  request — everything else falls through to the generic tool kind. */
export function classifyPermissionKind(toolName: string): PendingPermissionKind {
	switch (toolName) {
		case 'ExitPlanMode':
			return 'plan';
		case 'AskUserQuestion':
			return 'question';
		default:
			return 'tool';
	}
}

/** Extracts a short, scannable summary from an ExitPlanMode plan body. Prefers the first
 *  Markdown heading (stripped of leading `#`s) so the plan's title surfaces; falls back to
 *  the first non-empty line if no heading appears. Capped at {@link summaryMaxLength} with an
 *  ellipsis. */
export function extractPlanSummary(toolInput: Record<string, unknown>): string | undefined {
	const plan = toolInput.plan as string | undefined;
	if (!plan) return undefined;

	let heading: string | undefined;
	let firstNonEmpty: string | undefined;
	for (const line of plan.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (trimmed.startsWith('#')) {
			const stripped = trimmed.replace(/^#+\s*/, '').trim();
			if (stripped) {
				heading = stripped;
				break;
			}
		}

		firstNonEmpty ??= trimmed;
	}

	const summary = heading ?? firstNonEmpty;
	if (!summary) return undefined;

	return summary.length > summaryMaxLength ? `${summary.slice(0, summaryMaxLength).trimEnd()}…` : summary;
}

/** Extracts the leading question text + total question count from an AskUserQuestion call.
 *  Returns undefined if the input doesn't carry a recognisable `questions` array. */
export function extractQuestionDetails(
	toolInput: Record<string, unknown>,
): { text: string; count: number } | undefined {
	const questions = toolInput.questions as ReadonlyArray<Record<string, unknown>> | undefined;
	if (!Array.isArray(questions) || questions.length === 0) return undefined;

	const first = questions[0]?.question;
	if (typeof first !== 'string') return undefined;

	const trimmed = first.trim();
	if (!trimmed) return undefined;

	const text = trimmed.length > summaryMaxLength ? `${trimmed.slice(0, summaryMaxLength).trimEnd()}…` : trimmed;
	return { text: text, count: questions.length };
}

/** Returns the file path a file-mutating tool is targeting, or `undefined` for non-mutating /
 *  non-file tools. `Read` is intentionally excluded — "working on a file" means writing to it.
 *  Reads are surfaced separately via {@link getToolReadPath} so consumers (e.g. the treemap
 *  activity overlay) can render reads with a distinct visual treatment. */
export function getToolFilePath(toolName: string, toolInput: Record<string, unknown> | undefined): string | undefined {
	if (toolInput == null) return undefined;

	switch (toolName) {
		case 'Edit':
		case 'MultiEdit':
		case 'Write':
			return toolInput.file_path as string | undefined;
		case 'NotebookEdit':
			return toolInput.notebook_path as string | undefined;
		default:
			return undefined;
	}
}

/** Returns the file path a read-only file tool is targeting, or `undefined` for non-read /
 *  non-file tools. Mirrors {@link getToolFilePath} but for `Read`/`NotebookRead`. */
export function getToolReadPath(toolName: string, toolInput: Record<string, unknown> | undefined): string | undefined {
	if (toolInput == null) return undefined;

	switch (toolName) {
		case 'Read':
			return toolInput.file_path as string | undefined;
		case 'NotebookRead':
			return toolInput.notebook_path as string | undefined;
		default:
			return undefined;
	}
}
