import { truncate } from '@gitlens/utils/string.js';

const maxStoredPromptLength = 500;

// Marker blocks GitLens itself embeds when dispatching Start Work / Start Review prompts to an
// agent (see `start-work-issue` / `start-review-pullRequest` templates in
// `packages/plus/ai/src/prompts.ts`). The surrounding template begins with a long
// "You are an advanced AI programming assistant…" preamble that would otherwise become the
// session's display name; matching on the block delimiters lets us pull the issue/PR title out
// of the embedded JSON instead.
const dispatchBlockRegex = /<(issue|prData)>([\s\S]*?)<\/\1>/;

// Wrappers the Claude Code harness or its VS Code extension prepend to the `prompt` field of
// `UserPromptSubmit` hook events. These are synthetic context blocks, not user-typed content,
// and shouldn't appear verbatim in GitLens agent status UI.
const harnessBlockPatterns: readonly RegExp[] = [
	// VS Code extension: any current or future IDE-context tag (e.g. <ide_opened_file>,
	// <ide_selection>). Prefix-matched so newly-added ones are handled automatically.
	/<(ide_[a-zA-Z0-9_]+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g,
	// VS Code extension: @terminal:<name> mention expansion. Gated on the `name` attribute so we
	// don't strip a bare <terminal> a user pasted as code.
	/<terminal\s+name="[^"]*"[^>]*>[\s\S]*?<\/terminal>/g,
	// VS Code extension: @browser mention expansion. Gated on tabGroupId/tabId for the same reason.
	/<browser\s+[^>]*\b(?:tabGroupId|tabId)="[^"]*"[^>]*>[\s\S]*?<\/browser>/g,
	// VS Code extension: one-shot system instruction prepended whenever any @browser is present.
	/<browser_instruction>[\s\S]*?<\/browser_instruction>/g,
	// CLI harness: background-bash task lifecycle event (status, summary, output-file, etc.).
	/<task-notification>[\s\S]*?<\/task-notification>/g,
	// CLI harness: built-in slash-command stdout/stderr echo and caveat note.
	/<(local-command-(?:stdout|stderr|caveat))>[\s\S]*?<\/\1>/g,
	// CLI harness: bang-prefix bash invocation echo (input/stdout/stderr).
	/<(bash-(?:input|stdout|stderr))>[\s\S]*?<\/\1>/g,
	// CLI harness: tool-permission response wrapper.
	/<permissionresponse>[\s\S]*?<\/permissionresponse>/g,
	// Anthropic shared-context blocks (claude.ai web-app feature; defensive).
	/<shared-context(?:\s[^>]*)?>[\s\S]*?<\/shared-context>/g,
];

/**
 * Normalizes a Claude Code `UserPromptSubmit` event prompt into something fit for display in
 * GitLens (agent status pill, sidebar tooltip, etc.) by stripping harness-injected wrappers.
 *
 * Returns `undefined` for empty input or when the prompt was nothing but harness context, so the
 * caller can skip overwriting the previously-captured user prompt.
 */
export function sanitizeAgentPrompt(prompt: string | undefined): string | undefined {
	if (!prompt) return undefined;

	// Normalize CRLF up-front so the harness-block and whitespace-collapse regexes (which target
	// `\n`) behave identically for Windows-originated prompts.
	let result = prompt.replace(/\r\n/g, '\n');

	let stripped = false;
	for (const pattern of harnessBlockPatterns) {
		const next = result.replace(pattern, '');
		if (next !== result) {
			stripped = true;
			result = next;
		}
	}

	// GitLens-dispatched Start Work / Start Review prompts: replace the template body with just
	// the issue/PR title so the session name doesn't surface the "You are an advanced AI…"
	// preamble. Runs AFTER harness stripping so that an `<ide_selection>` (or other wrapper)
	// containing an `<issue>…</issue>` block doesn't get rewritten to the embedded title — the
	// wrapper is stripped first and only a genuine dispatch template body triggers the rewrite.
	// Anything that doesn't yield a usable title falls through to normal sanitization.
	const dispatchTitle = extractDispatchTitle(result);
	if (dispatchTitle != null) return dispatchTitle;

	// Only collapse the whitespace runs around stripped blocks. Untouched user prompts pass
	// through with their internal whitespace intact (the final trim still removes the outer
	// padding either way).
	if (stripped) {
		result = result.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
	}
	result = result.trim();
	return result || undefined;
}

/**
 * Sanitizes and truncates a raw prompt for storage on an `AgentSession`. Use this everywhere a
 * session's `lastPrompt` / `firstPrompt` is populated so the sanitize+truncate pipeline can't be
 * applied inconsistently across capture paths (hook events, CLI session-state syncs, etc.).
 */
export function prepareStoredPrompt(prompt: string | undefined): string | undefined {
	const cleaned = sanitizeAgentPrompt(prompt);
	return cleaned ? truncate(cleaned, maxStoredPromptLength) : undefined;
}

/**
 * Looks for a GitLens-dispatch marker block (`<issue>…</issue>` or `<prData>…</prData>`) and
 * returns the embedded `title` field. Both `IssueShape` and `PullRequestShape` carry `title`, so
 * a single accessor covers Start Work and Start Review. Returns `undefined` when the block is
 * absent, the JSON fails to parse, or `title` is missing/empty — those cases fall through to the
 * regular sanitization path.
 */
function extractDispatchTitle(prompt: string): string | undefined {
	const match = dispatchBlockRegex.exec(prompt);
	if (match == null) return undefined;

	try {
		const parsed = JSON.parse(match[2]) as { title?: unknown };
		const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
		return title.length > 0 ? title : undefined;
	} catch {
		return undefined;
	}
}
