import { commands, env, ThemeIcon, window, workspace } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
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
 * On failure, copies the prompt to the system clipboard so the work isn't lost, and returns
 * `success: false` so the caller can surface a toast with retry / pick-another affordances.
 */
export async function runAgent(
	descriptor: AgentDescriptor,
	prompt: string,
	options?: RunAgentOptions,
): Promise<RunAgentResult> {
	// Re-validate before dispatch.
	if (!(await isAgentAvailable(descriptor))) {
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

	const terminal = window.createTerminal({
		name: `GitLens · ${descriptor.label}`,
		cwd: cwd,
		iconPath: new ThemeIcon('gitlens-gitlens'),
	});
	terminal.show();

	// Launch the CLI bare. Multi-line argv is unreliable across shells; deliver the prompt
	// via paste block once the TUI is ready.
	terminal.sendText(executable, true);
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
