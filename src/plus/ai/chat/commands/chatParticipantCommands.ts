import type { CancellationToken, ChatContext, ChatRequest, ChatResponseStream, Disposable } from 'vscode';
import type { Container } from '../../../../container';
import { createCommandDecorator } from '../../../../system/decorators/command';
import { log } from '../../../../system/decorators/log';
import { map } from '../../../../system/iterable';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { GlChatParticipant, GlChatResult } from '../chatParticipant';

export type ChatParticipantCommandHandler = (
	request: ChatRequest,
	context: ChatContext,
	stream: ChatResponseStream,
	token: CancellationToken,
) => Promise<GlChatResult>;

const { command, getCommands } = createCommandDecorator<
	ChatParticipantCommandHandler,
	string,
	{ description: string }
>();

export class GlChatParticipantCommands implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly provider: GlChatParticipant,
	) {
		for (const { command, handler } of getCommands()) {
			this.provider.registerCommand(command, handler, this);
		}
	}

	dispose(): void {
		// Dispose of any resources if needed
	}

	getCommands(): Iterable<{ command: string; description: string }> {
		return map(getCommands(), cmd => ({ command: cmd.command, description: cmd.options?.description ?? '' }));
	}

	@command('explain', { description: 'Explain the changes in a commit' })
	@log({ args: false })
	private async handleExplainCommand(
		request: ChatRequest,
		_context: ChatContext,
		stream: ChatResponseStream,
		_token: CancellationToken,
	): Promise<GlChatResult> {
		const scope = getLogScope();

		// find the <commit>JSON of GitRevisionReference</commit>
		const match = request.prompt.match(/<commit>[\\\s]*(.*?)[\\\s]*<\/commit>/m);
		let commit;
		try {
			commit = match ? JSON.parse(match[1]) : undefined;
		} catch {}

		if (!commit) {
			stream.markdown('Please provide a commit hash in the format: /explain <commit>your_commit_hash</commit>');
			return { errorDetails: { message: 'Unable to find the commit hash' } };
		}

		try {
			const result = await this.container.ai.explainCommit(commit, {
				source: 'ai:chat',
				type: 'commit',
			});

			if (!result) {
				stream.markdown('Unable to explain the provided commit.');
				return { errorDetails: { message: 'Unable to explain the provided commit' } };
			}

			stream.markdown(`${result.parsed.summary}\n\n${result.parsed.body}`);
			return {};
		} catch (ex) {
			Logger.error(ex, scope);
			stream.markdown(`I encountered an error while processing your request: ${ex.message}`);
			return { errorDetails: { message: ex.message } };
		}
	}
}
