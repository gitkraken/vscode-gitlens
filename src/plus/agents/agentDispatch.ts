import type { Terminal, TerminalShellExecution, TerminalShellIntegration } from 'vscode';
import { commands, Disposable, env, l10n, window, workspace } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { getAgentTerminalIcon } from '../../agents/utils/-webview/agentIcon.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { openTerminal } from '../../system/-webview/terminal.js';
import type { ChatMode } from '../chat/utils/-webview/chat.utils.js';
import { openChat } from '../chat/utils/-webview/chat.utils.js';
import type { AgentDescriptor } from './agentDescriptor.js';
import { claudeExtensionOpenCommand, isAgentAvailable } from './agentRegistry.js';

const defaultBootDelayMs = 1500;
/** A running TUI takes a paste at once; a short pause lets the terminal come to the front first */
const defaultReuseDelayMs = 300;
/** How long to wait for a new terminal's shell integration before launching the CLI without it */
const shellIntegrationWaitMs = 3000;

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
	/** CLI only: a key under which the CLI session is kept. A later dispatch with the same key goes into
	 *  the same terminal, as the next turn of the same conversation, as long as the CLI is still running
	 *  there — so a review that follows another carries what the agent already learned. Reuse needs the
	 *  terminal's shell integration, which tells when the CLI exits; without it every dispatch opens a
	 *  terminal of its own. */
	readonly session?: string;
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
			return {
				success: false,
				error: new Error(l10n.t("Agent '{0}' is no longer available", descriptor.label)),
			};
		}

		await copyPromptAsFallback(prompt);
		return {
			success: false,
			clipboardCopiedAsFallback: true,
			error: new Error(l10n.t("Agent '{0}' is no longer available", descriptor.label)),
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

/** The CLI sessions kept for reuse, by the caller's key, with the agent running in each. An entry lives
 *  while its terminal is open and the CLI command the shell integration started in it has not ended. */
const cliSessions = new Map<
	string,
	{ terminal: Terminal; execution: TerminalShellExecution; agent: AgentDescriptor & { kind: 'cli' } }
>();
let cliSessionWatcher: Disposable | undefined;

function watchCliSessions(): void {
	cliSessionWatcher ??= Disposable.from(
		window.onDidCloseTerminal(terminal => {
			for (const [key, session] of cliSessions) {
				if (session.terminal === terminal) {
					cliSessions.delete(key);
				}
			}
		}),
		// The CLI exited (the user left it, it crashed): the terminal is a plain shell now, and a prompt
		// pasted into it would run as commands — forget the session
		window.onDidEndTerminalShellExecution(e => {
			for (const [key, session] of cliSessions) {
				if (session.execution === e.execution) {
					cliSessions.delete(key);
				}
			}
		}),
	);
}

function getLiveCliSession(key: string): Terminal | undefined {
	const session = cliSessions.get(key);
	if (session == null) return undefined;

	if (session.terminal.exitStatus != null || !window.terminals.includes(session.terminal)) {
		cliSessions.delete(key);
		return undefined;
	}
	return session.terminal;
}

/** The agent running in the CLI session kept under `key`, while it still runs — a prompt for that session
 *  can go straight to it, with no agent to choose. */
export function getLiveCliSessionAgent(key: string): AgentDescriptor | undefined {
	return getLiveCliSession(key) != null ? cliSessions.get(key)?.agent : undefined;
}

/** Shell integration arrives a moment after the terminal does; wait for it, but not forever. */
function waitForShellIntegration(terminal: Terminal, timeoutMs: number): Promise<TerminalShellIntegration | undefined> {
	if (terminal.shellIntegration != null) return Promise.resolve(terminal.shellIntegration);

	return new Promise(resolve => {
		let listener: Disposable | undefined;
		const timer = setTimeout(() => {
			listener?.dispose();
			resolve(undefined);
		}, timeoutMs);
		listener = window.onDidChangeTerminalShellIntegration(e => {
			if (e.terminal !== terminal) return;

			clearTimeout(timer);
			listener?.dispose();
			resolve(e.shellIntegration);
		});
	});
}

async function pastePrompt(prompt: string): Promise<void> {
	// Use `sendSequence` with BPM markers instead of `terminal.paste` to avoid VS Code's paste warning
	// and clobbering the user's clipboard. Newlines are normalized to \r so the TUI sees one atomic paste.
	const payload = `${bpmStart}${prompt.replace(/\r?\n/g, '\r')}${bpmEnd}\r`;
	await executeCoreCommand('workbench.action.terminal.sendSequence', { text: payload });
}

async function dispatchCli(
	descriptor: AgentDescriptor & { kind: 'cli' },
	prompt: string,
	options?: RunAgentOptions,
): Promise<void> {
	const cwd = options?.cwd ?? workspace.workspaceFolders?.[0]?.uri.fsPath;
	const executable = descriptor.agent.executable;
	if (executable == null) {
		throw new Error(l10n.t("CLI agent '{0}' has no executable path", descriptor.label));
	}

	// The session's terminal, when the caller keeps one and this agent's CLI is still running in it: the prompt
	// goes in as the next turn of that conversation. Another agent asked for (picked after a failure, or named)
	// starts a session of its own, which takes the key over
	const sessionKey = options?.session;
	const existing =
		sessionKey != null && cliSessions.get(sessionKey)?.agent.id === descriptor.id
			? getLiveCliSession(sessionKey)
			: undefined;
	if (existing != null) {
		existing.show();
		if (!prompt) return;

		await wait(defaultReuseDelayMs);
		await pastePrompt(prompt);
		return;
	}

	const terminal = openTerminal({
		name: descriptor.label,
		cwd: cwd,
		iconPath: getAgentTerminalIcon(descriptor.agent.name),
	});
	terminal.show();

	// Launch the CLI bare. Multi-line argv is unreliable across shells; deliver the prompt
	// via paste block once the TUI is ready. A session to keep is started through the shell
	// integration, whose end event is how its exit is known; without that there is no telling a live
	// CLI from the shell it leaves behind, so the terminal is not kept.
	const integration =
		sessionKey != null ? await waitForShellIntegration(terminal, shellIntegrationWaitMs) : undefined;
	if (integration != null && sessionKey != null) {
		watchCliSessions();
		cliSessions.set(sessionKey, {
			terminal: terminal,
			execution: integration.executeCommand(executable),
			agent: descriptor,
		});
	} else {
		terminal.sendText(executable, true);
	}
	if (!prompt) return;

	await wait(defaultBootDelayMs);
	terminal.show();
	await pastePrompt(prompt);
}

async function copyPromptAsFallback(prompt: string): Promise<void> {
	try {
		await env.clipboard.writeText(prompt);
	} catch (ex) {
		Logger.error(ex, 'agentDispatch', 'copyPromptAsFallback');
	}
}
