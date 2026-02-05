import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { ChatActions } from '../plus/chat/chatActions.js';
import { executeChatAction } from '../plus/chat/chatActions.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface OpenChatActionCommandArgs {
	chatAction: ChatActions;
	source?: Sources;
}

@command()
export class OpenChatActionCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openChatAction');
	}
	async execute(args: OpenChatActionCommandArgs): Promise<void> {
		return executeChatAction(this.container, args.chatAction, args.source);
	}
}
