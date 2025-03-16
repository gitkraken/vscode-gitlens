import type {
	CancellationToken,
	ChatContext,
	ChatParticipant,
	ChatRequest,
	ChatResponseStream,
	ChatResult,
	ChatResultFeedback,
	Event,
} from 'vscode';
import { chat, Disposable, EventEmitter, ThemeIcon, window } from 'vscode';
import type { Container } from '../../../container';
import { log } from '../../../system/decorators/log';
import { join, map } from '../../../system/iterable';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { ChatParticipantCommandHandler } from './commands/chatParticipantCommands';
import { GlChatParticipantCommands } from './commands/chatParticipantCommands';

export class GlChatParticipant implements ChatParticipant {
	readonly id = 'gitlens';
	readonly iconPath = new ThemeIcon('gitlens-gitlens');

	private readonly _onDidReceiveFeedback = new EventEmitter<ChatResultFeedback>();
	get onDidReceiveFeedback(): Event<ChatResultFeedback> {
		return this._onDidReceiveFeedback.event;
	}

	private readonly _commands: GlChatParticipantCommands;
	private readonly _disposable: Disposable;
	private readonly _handlers = new Map<string, { fn: ChatParticipantCommandHandler; thisArg: unknown }>();

	constructor(private readonly container: Container) {
		this._commands = new GlChatParticipantCommands(container, this);

		this._disposable = Disposable.from(
			this._onDidReceiveFeedback,
			chat.createChatParticipant(this.id, this.requestHandler.bind(this)),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	registerCommand(command: string, handler: ChatParticipantCommandHandler, thisArg?: unknown): void {
		this._handlers.set(command, { fn: handler, thisArg: thisArg });
	}

	@log({ args: false })
	async requestHandler(
		request: ChatRequest,
		context: ChatContext,
		stream: ChatResponseStream,
		token: CancellationToken,
	): Promise<GlChatResult> {
		const scope = getLogScope();

		try {
			Logger.log(scope, `Handling request: '${request.prompt}'`);
			if (request.command) {
				const handler = this._handlers.get(request.command);
				if (handler) {
					return await handler.fn.call(handler.thisArg, request, context, stream, token);
				}

				stream.markdown('I am not sure how to handle that command.');
				return { errorDetails: { message: 'Command not found' } };
			}

			// If no specific handler matched, provide general git information
			return this.handleGeneralGitRequest(request, context, stream, token);
		} catch (ex) {
			Logger.error(ex, scope);

			stream.markdown(`I encountered an error while processing your request: ${ex.message}`);
			return { errorDetails: { message: ex.message } };
		}
	}

	private handleGeneralGitRequest(
		_request: ChatRequest,
		_context: ChatContext,
		stream: ChatResponseStream,
		_token: CancellationToken,
	): GlChatResult {
		const repo = this.container.git.getBestRepositoryOrFirst(window.activeTextEditor);

		// TODO
		// Handle general git-related questions
		stream.markdown(`I'm GitLens, and I can help you with Git operations and repository information.

Here are some things you can ask me:
- Show commits from [author]
- Show recent commit history
- Compare branches
- Show blame information for current file
- Show repository statistics
- Help with git commands

You can also use these commands:
${join(
	map(this._commands.getCommands(), cmd => `- \`${cmd.command}\` - ${cmd.description}`),
	'\n',
)}

I'm currently working with repository: **${repo?.name}**`);

		return {};
	}
}

export interface GlChatResult extends ChatResult {}
