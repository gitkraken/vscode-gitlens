import { version } from 'vscode';
import type { ChatViewOpenOptions } from '../../../../@types/vscode.chat';
import { executeCoreCommand } from '../../../../system/-webview/command';
import { satisfies } from '../../../../system/version';

export function openChat(args: string | ChatViewOpenOptions): Thenable<void> {
	return executeCoreCommand('workbench.action.chat.open', args);
}

// Check if VS Code version supports Chat API (introduced in 1.99.0)
export function supportsChatAPI(): boolean {
	return satisfies(version, '>= 1.99.0');
}
