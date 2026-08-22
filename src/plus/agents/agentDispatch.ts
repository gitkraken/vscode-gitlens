import { commands, env, ThemeIcon, workspace } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { openTerminal } from '../../system/-webview/terminal.js';
import type { ChatMode } from '../chat/utils/-webview/chat.utils.js';
import { openChat } from '../chat/utils/-webview/chat.utils.js';
import type { AgentDescriptor } from './agentDescriptor.js';
import { claudeExtensionOpenCommand, isAgentAvailable } from './agentRegistry.js';

const defaultBootDelayMs = 1500;

// VT bracketed-paste markers (xterm convention). Wrapping a payload between these tells the TUI
// "this is one paste block" so embedded CRs are content (soft newlines), not submissions.
const bpmStart = '\u001b[200~';
const bpmEnd = '\u001b[201~';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function getAgentTerminalIcon(agentName: string): ThemeIcon {
	switch (agentName) {
		case 'claude-cli':
			return new ThemeIcon('claude');
		case 'codex':
			return new ThemeIcon('openai');
		case 'copilot':
			return new ThemeIcon('copilot');
		default:
			return new ThemeIcon('robot');
	}
}

export interface RunAgentOptions {
	/** Working directory for the CLI dispatch path. Required for CLI; ignored by IDE chat / extension. */
	readonly cwd?: string;
	/** When true, request the host to auto-submit the prompt. Honored by Copilot Chat via
	 *  `isPartialQuery: false`; other hosts already paste-without-Enter (no-op). CLI always
	 *  auto-submits via paste+Enter and ignores this flag. */
	readonly autoExecute?: boolean;
	/** Chat mode hint for the IDE chat path. Honored by Copilot Chat; ignored by other hosts and
	 *  by CLI/extension dispatches. */
	readonly mode?: ChatMode;
}

export interface RunAgentResult {
	readonly success: boolean;
	/** Set when `success === false` and the prompt has been copied to the clipboard as a fallback. */
	readonly clipboardCopiedAsFallback?: boolean;
	readonly error?: Error;
}

/**
 * Dispatches a rendered prompt to the chosen agent. Re-validates the descriptor at dispatch time —
 * picker-time validation does not guarantee dispatch-time validity (different window / profile / env).
 *
 * On failure, copies the prompt to the system clipboard so the work isn't lost (unless `prompt` is
 * empty — nothing to preserve), and returns `success: false` so the caller can surface a toast with
 * retry / pick-another affordances.
 */
export async function runAgent(
	descriptor: AgentDescriptor,
	prompt: string,
	options?: RunAgentOptions,
): Promise<RunAgentResult> {
	// Re-validate before dispatch.
	if (!(await isAgentAvailable(descriptor))) {
		if (!prompt) {
			return { success: false, error: new Error(`Agent '${descriptor.label}' is no longer available`) };
		}

		await copyPromptAsFallback(prompt);
		return {
			success: false,
			clipboardCopiedAsFallback: true,
			error: new Error(`Agent '${descriptor.label}' is no longer available`),
		};
	}

	try {
		switch (descriptor.kind) {
			case 'ide-chat':
				await openChat(prompt, { execute: options?.autoExecute, mode: options?.mode });
				return { success: true };
			case 'claude-extension':
				await commands.executeCommand(claudeExtensionOpenCommand, undefined, prompt);
				return { success: true };
			case 'cli':
				await dispatchCli(descriptor, prompt, options);
				return { success: true };
		}
	} catch (ex) {
		Logger.error(ex, 'agentDispatch', 'runAgent');
		if (!prompt) {
			return { success: false, error: ex instanceof Error ? ex : new Error(String(ex)) };
		}

		await copyPromptAsFallback(prompt);
		return {
			success: false,
			clipboardCopiedAsFallback: true,
			error: ex instanceof Error ? ex : new Error(String(ex)),
		};
	}
}

async function dispatchCli(
	descriptor: AgentDescriptor & { kind: 'cli' },
	prompt: string,
	options?: RunAgentOptions,
): Promise<void> {
	const cwd = options?.cwd ?? workspace.workspaceFolders?.[0]?.uri.fsPath;
	const executable = descriptor.agent.executable;
	if (executable == null) throw new Error(`CLI agent '${descriptor.label}' has no executable path`);

	const terminal = openTerminal({
		name: descriptor.label,
		cwd: cwd,
		iconPath: getAgentTerminalIcon(descriptor.agent.name),
	});
	terminal.show();

	// Launch the CLI bare. Multi-line argv is unreliable across shells; deliver the prompt
	// via paste block once the TUI is ready.
	terminal.sendText(executable, true);
	if (!prompt) return;

	await wait(defaultBootDelayMs);
	terminal.show();

	// Use `sendSequence` with BPM markers instead of `terminal.paste` to avoid VS Code's paste warning
	// and clobbering the user's clipboard. Newlines are normalized to \r so the TUI sees one atomic paste.
	const payload = `${bpmStart}${prompt.replace(/\r?\n/g, '\r')}${bpmEnd}\r`;
	await executeCoreCommand('workbench.action.terminal.sendSequence', { text: payload });
}

async function copyPromptAsFallback(prompt: string): Promise<void> {
	try {
		await env.clipboard.writeText(prompt);
	} catch (ex) {
		Logger.error(ex, 'agentDispatch', 'copyPromptAsFallback');
	}
}
