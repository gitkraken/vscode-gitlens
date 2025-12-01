import type { CancellationToken, Disposable } from 'vscode';
import { commands, chat, version, Uri } from 'vscode';
import type { Container } from '../../container';
import { debug } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import type {
	ChatAction,
	ChatIssueContext,
	ChatIntegrationCommandArgs,
	ChatPromptConfig,
	SendToChatCommandArgs,
	GitLensChatResult,
} from './types';
import { ChatPromptBuilder } from './promptBuilder';

// Check if VS Code version supports Chat API (introduced in 1.99.0)
function supportsChatAPI(): boolean {
	const [major, minor] = version.split('.').map(Number);
	return major > 1 || (major === 1 && minor >= 99);
}

/**
 * Service for managing AI chat integration in GitLens
 */
export class ChatService implements Disposable {
	private readonly _disposable: Disposable;
	private readonly _promptBuilder: ChatPromptBuilder;

	constructor(private readonly container: Container) {
		this._promptBuilder = new ChatPromptBuilder(container);

		// Only register chat participant if VS Code version supports it
		if (supportsChatAPI()) {
			this._disposable = this.registerChatParticipant();
		} else {
			// For older VS Code versions, just register a dummy disposable
			this._disposable = { dispose: () => {} };
			Logger.warn('ChatService: VS Code version does not support Chat API (requires 1.99.0+)');
		}
	}

	dispose(): void {
		this._disposable.dispose();
	}

	/**
	 * Send a prompt to the AI chat
	 */
	@debug()
	async sendToChat(args: SendToChatCommandArgs): Promise<void> {
		if (!supportsChatAPI()) {
			Logger.warn('ChatService: Cannot send to chat - VS Code version does not support Chat API');
			return;
		}

		try {
			if (args.participant) {
				// Send to specific participant
				await commands.executeCommand('workbench.action.chat.open', {
					query: `@${args.participant} ${args.prompt}`,
				});
			} else {
				// Send to general chat
				await commands.executeCommand('workbench.action.chat.open', args.prompt);
			}
		} catch (error) {
			Logger.error('ChatService.sendToChat', error);
			throw error;
		}
	}

	/**
	 * Generate and send a contextual prompt for an issue/PR
	 */
	@debug()
	async sendContextualPrompt(args: ChatIntegrationCommandArgs): Promise<void> {
		if (!supportsChatAPI()) {
			Logger.warn('ChatService: Cannot send contextual prompt - VS Code version does not support Chat API');
			return;
		}

		try {
			const config: ChatPromptConfig = {
				action: args.action,
				includeMcpTools: true,
				includeRepoContext: true,
				includeFileContext: false,
				...args.config,
			};

			const result = await this._promptBuilder.generatePrompt(args.context, args.action, config);

			await this.sendToChat({
				prompt: result.prompt,
				source: args.source,
				participant: 'gitlens',
			});
		} catch (error) {
			Logger.error('ChatService.sendContextualPrompt', error);
			throw error;
		}
	}

	/**
	 * Register the GitLens chat participant
	 */
	private registerChatParticipant(): Disposable {
		if (!chat?.createChatParticipant) {
			Logger.warn('ChatService: chat.createChatParticipant is not available');
			return { dispose: () => {} };
		}

		const participant = chat.createChatParticipant('gitlens', async (request, context, stream, token) => {
			return this.handleChatRequest(request, context, stream, token);
		});

		participant.iconPath = Uri.file(this.container.context.asAbsolutePath('images/gitlens-icon.png'));
		participant.followupProvider = {
			provideFollowups: async (result, context, token) => {
				// Return basic follow-up suggestions
				return [
					{
						prompt: 'Create a branch for this issue',
						label: 'Create Branch',
						command: 'gitlens.createBranchAndChat',
					},
					{
						prompt: 'Create a worktree for this issue',
						label: 'Create Worktree',
						command: 'gitlens.createWorktreeAndChat',
					},
				];
			},
		};

		// Note: Slash commands are defined in package.json contributions

		return participant;
	}

	/**
	 * Handle chat requests to the GitLens participant
	 */
	private async handleChatRequest(
		request: any,
		context: any,
		stream: any,
		token: CancellationToken,
	): Promise<GitLensChatResult> {
		try {
			stream.progress('Processing your GitLens request...');

			const prompt = request.prompt.trim();
			const command = request.command;

			// Handle slash commands
			if (command) {
				return this.handleSlashCommand(command, prompt, stream, token);
			}

			// Handle general queries
			return this.handleGeneralQuery(prompt, stream, token);
		} catch (error) {
			Logger.error('ChatService.handleChatRequest', error);
			stream.markdown(`❌ **Error:** ${error.message}`);
			return {
				metadata: {
					command: request.command,
					source: 'chat-participant',
				},
			};
		}
	}

	/**
	 * Handle slash commands
	 */
	private async handleSlashCommand(
		command: string,
		prompt: string,
		stream: any,
		token: CancellationToken,
	): Promise<GitLensChatResult> {
		const actionMap: Record<string, ChatAction> = {
			explain: 'explain-issue',
			branch: 'create-branch',
			worktree: 'create-worktree',
			review: 'review-changes',
			implement: 'suggest-implementation',
			test: 'create-tests',
		};

		const action = actionMap[command];
		if (!action) {
			stream.markdown(`❌ **Unknown command:** /${command}`);
			return {
				metadata: {
					command,
					source: 'chat-participant',
				},
			};
		}

		stream.markdown(`🔍 **GitLens ${command}** command detected.`);
		stream.markdown(
			`\nTo use this command effectively, please provide:\n- Issue or PR URL\n- Repository context\n- Specific requirements`,
		);

		// Add action buttons for common workflows
		stream.button({
			command: 'gitlens.showQuickRepoStatus',
			title: 'Show Repository Status',
			arguments: [],
		});

		stream.button({
			command: 'gitlens.gitCommands',
			title: 'Open Git Commands',
			arguments: [],
		});

		if (action === 'create-branch' || action === 'create-worktree') {
			stream.button({
				command: 'gitlens.startWork',
				title: 'Start Work on Issue',
				arguments: [],
			});
		}

		return {
			metadata: {
				command,
				action,
				source: 'chat-participant',
			},
		};
	}

	/**
	 * Handle general queries
	 */
	private async handleGeneralQuery(
		prompt: string,
		stream: any,
		token: CancellationToken,
	): Promise<GitLensChatResult> {
		stream.markdown('👋 **Welcome to GitLens Chat!**');
		stream.markdown('\nI can help you with Git and repository management tasks. Here are some things I can do:');

		stream.markdown('\n**Available Commands:**');
		stream.markdown('- `/explain` - Explain an issue or pull request');
		stream.markdown('- `/branch` - Create a branch for development');
		stream.markdown('- `/worktree` - Create a worktree for isolated work');
		stream.markdown('- `/review` - Review pull request changes');
		stream.markdown('- `/implement` - Get implementation suggestions');
		stream.markdown('- `/test` - Create tests for your code');

		stream.markdown('\n**Quick Actions:**');

		// Add buttons for common GitLens actions
		stream.button({
			command: 'gitlens.showQuickRepoStatus',
			title: '📊 Repository Status',
			arguments: [],
		});

		stream.button({
			command: 'gitlens.startWork',
			title: '🚀 Start Work',
			arguments: [],
		});

		stream.button({
			command: 'gitlens.gitCommands',
			title: '⚡ Git Commands',
			arguments: [],
		});

		stream.button({
			command: 'gitlens.showLaunchpad',
			title: '🚀 Launchpad',
			arguments: [],
		});

		return {
			metadata: {
				source: 'chat-participant',
			},
		};
	}

	/**
	 * Provide follow-up suggestions
	 */
	private async provideFollowups(result: GitLensChatResult, context: any, token: CancellationToken): Promise<any[]> {
		const followups: any[] = [];

		if (result.metadata.action) {
			switch (result.metadata.action) {
				case 'create-branch':
					followups.push({
						prompt: '/worktree Create a worktree for this branch',
						label: 'Create worktree',
						command: 'workbench.action.chat.open',
					});
					break;
				case 'explain-issue':
					followups.push({
						prompt: '/implement Get implementation suggestions',
						label: 'Get implementation plan',
						command: 'workbench.action.chat.open',
					});
					break;
				case 'review-changes':
					followups.push({
						prompt: '/test Create tests for these changes',
						label: 'Create tests',
						command: 'workbench.action.chat.open',
					});
					break;
			}
		}

		// Always suggest common actions
		followups.push(
			{
				prompt: 'Show me the current repository status',
				label: 'Repository status',
				command: 'gitlens.showQuickRepoStatus',
			},
			{
				prompt: '/branch Create a new branch',
				label: 'Create branch',
				command: 'workbench.action.chat.open',
			},
		);

		return followups;
	}
}
