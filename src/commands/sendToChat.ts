import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { openChat } from '../plus/chat/utils/-webview/chat.utils.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface SendToChatCommandArgs {
	/**
	 * The query for chat.
	 */
	query: string;

	/**
	 * Source of the request
	 */
	source?: Sources;

	/**
	 * Whether the chat will await more input from the user.
	 */
	execute?: boolean;

	/**
	 * Chat mode to request (Copilot Chat). Other hosts ignore this — Cursor/Windsurf/Kiro/Trae
	 * already open agent-mode sessions via their dedicated commands.
	 */
	mode?: 'agent' | 'edit' | 'ask';
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

		const options =
			args.execute != null || args.mode != null ? { execute: args.execute, mode: args.mode } : undefined;
		return openChat(args.query, options);
	}
}
