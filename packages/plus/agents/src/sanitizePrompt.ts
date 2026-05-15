import { truncate } from '@gitlens/utils/string.js';

const maxStoredPromptLength = 500;

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
