import { extensions } from 'vscode';
import type { ChatViewOpenOptions } from '../../../../@types/vscode.chat.js';
import { callUsingClipboard } from '../../../../system/-webview/clipboard.js';
import { executeCoreCommand } from '../../../../system/-webview/command.js';
import { getHostAppName, isHostVSCode } from '../../../../system/-webview/vscode.js';
import { wait } from '../../../../system/promise.js';

export async function openChat(
	args: string,
	options?: {
		execute?: boolean;
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

const copilotChatExtensionId = 'GitHub.copilot-chat';
export function isCopilotChatExtensionInstalled(): boolean {
	const ext = extensions.getExtension(copilotChatExtensionId);
	return ext != null;
}

export async function supportsChatParticipant(appName?: string): Promise<boolean> {
	appName ??= await getHostAppName();
	if (appName == null) return false;

	return isHostVSCode(appName) && isCopilotChatExtensionInstalled();
}

const supportedChatHosts = ['code', 'code-insiders', 'code-exploration', 'cursor', 'windsurf', 'kiro', 'trae'];
export async function supportsChat(appName?: string): Promise<boolean> {
	appName ??= await getHostAppName();
	if (appName == null) return false;

	return supportedChatHosts.includes(appName);
}
