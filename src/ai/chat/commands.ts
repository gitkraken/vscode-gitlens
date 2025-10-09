import { GlCommandBase } from '../../commands/commandBase';
import type { Container } from '../../container';
import { command } from '../../system/-webview/command';
import type { ChatIntegrationCommandArgs, SendToChatCommandArgs } from './types';

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

		return this.container.chatService.sendToChat(args);
	}
}

/**
 * Command to send a contextual prompt for an issue/PR to AI chat
 */
@command()
export class SendContextualPromptToChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.sendContextualPromptToChat');
	}

	async execute(args?: ChatIntegrationCommandArgs): Promise<void> {
		if (!args?.context || !args?.action) {
			throw new Error('Context and action are required for sendContextualPromptToChat command');
		}

		return this.container.chatService.sendContextualPrompt(args);
	}
}

/**
 * Command to create a branch and send prompt to chat
 */
@command()
export class CreateBranchAndChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.createBranchAndChat');
	}

	async execute(args?: ChatIntegrationCommandArgs): Promise<void> {
		if (!args?.context) {
			throw new Error('Context is required for createBranchAndChat command');
		}

		const chatArgs: ChatIntegrationCommandArgs = {
			...args,
			action: 'create-branch',
			config: {
				...args.config,
				includeMcpTools: true,
				includeRepoContext: true,
			},
		};

		return this.container.chatService.sendContextualPrompt(chatArgs);
	}
}

/**
 * Command to create a worktree and send prompt to chat
 */
@command()
export class CreateWorktreeAndChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.createWorktreeAndChat');
	}

	async execute(args?: ChatIntegrationCommandArgs): Promise<void> {
		if (!args?.context) {
			throw new Error('Context is required for createWorktreeAndChat command');
		}

		const chatArgs: ChatIntegrationCommandArgs = {
			...args,
			action: 'create-worktree',
			config: {
				...args.config,
				includeMcpTools: true,
				includeRepoContext: true,
			},
		};

		return this.container.chatService.sendContextualPrompt(chatArgs);
	}
}

/**
 * Command to explain an issue/PR and send prompt to chat
 */
@command()
export class ExplainIssueAndChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.explainIssueAndChat');
	}

	async execute(args?: ChatIntegrationCommandArgs): Promise<void> {
		if (!args?.context) {
			throw new Error('Context is required for explainIssueAndChat command');
		}

		const chatArgs: ChatIntegrationCommandArgs = {
			...args,
			action: 'explain-issue',
			config: {
				...args.config,
				includeMcpTools: true,
				includeRepoContext: true,
				includeFileContext: true,
			},
		};

		return this.container.chatService.sendContextualPrompt(chatArgs);
	}
}

/**
 * Command to get implementation suggestions and send prompt to chat
 */
@command()
export class SuggestImplementationAndChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.suggestImplementationAndChat');
	}

	async execute(args?: ChatIntegrationCommandArgs): Promise<void> {
		if (!args?.context) {
			throw new Error('Context is required for suggestImplementationAndChat command');
		}

		const chatArgs: ChatIntegrationCommandArgs = {
			...args,
			action: 'suggest-implementation',
			config: {
				...args.config,
				includeMcpTools: true,
				includeRepoContext: true,
				includeFileContext: true,
			},
		};

		return this.container.chatService.sendContextualPrompt(chatArgs);
	}
}

/**
 * Command to review changes and send prompt to chat
 */
@command()
export class ReviewChangesAndChatCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.reviewChangesAndChat');
	}

	async execute(args?: ChatIntegrationCommandArgs): Promise<void> {
		if (!args?.context) {
			throw new Error('Context is required for reviewChangesAndChat command');
		}

		const chatArgs: ChatIntegrationCommandArgs = {
			...args,
			action: 'review-changes',
			config: {
				...args.config,
				includeMcpTools: true,
				includeRepoContext: true,
				includeFileContext: true,
			},
		};

		return this.container.chatService.sendContextualPrompt(chatArgs);
	}
}
