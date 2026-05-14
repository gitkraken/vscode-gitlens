import { wait } from '@gitlens/utils/promise.js';
import type { ChatViewOpenOptions } from '../../../../@types/vscode.chat.js';
import { callUsingClipboard } from '../../../../system/-webview/clipboard.js';
import { executeCoreCommand } from '../../../../system/-webview/command.js';
import { getHostAppName } from '../../../../system/-webview/vscode.js';

export async function openChat(
	args: string,
	options?: {
		execute?: boolean;
		/**
		 * Chat mode to request. Honored by Copilot Chat (`workbench.action.chat.open`); the
		 * other hosts already open their dedicated agent-mode chat command, so this is a no-op
		 * for them.
		 */
		mode?: 'agent' | 'edit' | 'ask';
	},
): Promise<void> {
	const appName = await getHostAppName();
	if ((await supportsChat(appName)) === false) return;

	switch (appName) {
		case 'cursor':
			return openCursorChat(args);
		case 'windsurf':
			return openWindsurfChat(args);
		case 'kiro':
			return openKiroChat(args);
		case 'trae':
			return openTraeChat(args);
	}

	return openCopilotChat({
		query: args,
		isPartialQuery: options?.execute != null ? !options.execute : true,
		mode: options?.mode,
	});
}

export function openCopilotChat(args: string | ChatViewOpenOptions): Thenable<void> {
	return executeCoreCommand('workbench.action.chat.open', args);
}

export function openCursorChat(args: string): Thenable<void> {
	// return executeCoreCommand('composer.newAgentChat', args);
	return callUsingClipboard(args, async () => {
		await wait(1000);
		await executeCoreCommand('composer.newAgentChat');
		await wait(500);
		await executeCoreCommand('editor.action.clipboardPasteAction');
		await wait(100);
	});
}

export function openWindsurfChat(args: string): Thenable<void> {
	return callUsingClipboard(args, async () => {
		await wait(1000);
		await executeCoreCommand('windsurf.prioritized.chat.openNewConversation');
		await wait(1500);
		await executeCoreCommand('editor.action.clipboardPasteAction');
		await wait(100);
	});
}

export function openKiroChat(args: string): Thenable<void> {
	return callUsingClipboard(args, async () => {
		await wait(1000);
		await executeCoreCommand('kiroAgent.focusContinueInputWithoutClear');
		await wait(100);
		await executeCoreCommand('kiroAgent.newSession');
		await wait(500);
		await executeCoreCommand('editor.action.clipboardPasteAction');
		await wait(100);
	});
}

export function openTraeChat(args: string): Thenable<void> {
	return callUsingClipboard(args, async () => {
		await wait(1000);
		await executeCoreCommand('workbench.action.icube.aiChatSidebar.createNewSession', args);
		await wait(500);
		await executeCoreCommand('editor.action.clipboardPasteAction');
		await wait(100);
	});
}

const supportedChatHosts = ['code', 'code-insiders', 'code-exploration', 'cursor', 'windsurf', 'kiro', 'trae'];
export async function supportsChat(appName?: string): Promise<boolean> {
	appName ??= await getHostAppName();
	if (appName == null) return false;

	return supportedChatHosts.includes(appName);
}
