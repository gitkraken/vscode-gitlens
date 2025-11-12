import { commands } from 'vscode';
import type { ChatViewOpenOptions } from '../../../../@types/vscode.chat';
import { executeCoreCommand } from '../../../../system/-webview/command';

export function openChat(args: string | ChatViewOpenOptions): Thenable<void> {
	return executeCoreCommand('workbench.action.chat.open', args);
}

// Check if VS Code Chat API is enabled
export async function supportsChat(): Promise<boolean> {
	const cmds = await commands.getCommands(true);
	const hasChatCommand = cmds.includes('workbench.action.chat.open');
	return hasChatCommand;
}
