import type { ChatViewOpenOptions } from '../@types/vscode.chat.js';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { openChat } from '../plus/chat/utils/-webview/chat.utils.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface SendToChatCommandArgs extends ChatViewOpenOptions {
	/**
	 * Source of the request
	 */
	source?: Sources;

	/**
	 * Whether to use a specific chat participant
	 */
	participant?: string;
}

/**
 * Command to send a prompt to AI chat
 */
@command()
export class SendToChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.sendToChat');
	}

	async execute(args?: SendToChatCommandArgs): Promise<void> {
		if (!args?.query) {
			throw new Error('Prompt is required for sendToChat command');
		}

		return openChat(args.query, args.isPartialQuery != null ? { execute: !args.isPartialQuery } : undefined);
	}
}
