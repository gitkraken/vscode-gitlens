import type { ChatResult } from 'vscode';
import type { ChatViewOpenOptions } from '../../../@types/vscode.chat';
import type { Sources } from '../../../constants.telemetry';
import type { IssueOrPullRequest } from '../../../git/models/issueOrPullRequest';
import type { PullRequest } from '../../../git/models/pullRequest';
import type { Repository } from '../../../git/models/repository';
import type { LaunchpadItem } from '../../launchpad/launchpadProvider';

/**
 * Represents the context for an AI chat prompt related to issues or PRs
 */
export interface ChatIssueContext {
	/**
	 * The issue or PR data
	 */
	item: IssueOrPullRequest | PullRequest | LaunchpadItem;

	/**
	 * The repository context
	 */
	repository?: Repository;

	/**
	 * Source of the chat request
	 */
	source: ChatSource;

	/**
	 * Additional context data
	 */
	metadata?: {
		branch?: string;
		worktree?: boolean;
		integration?: string;
		[key: string]: any;
	};
}

/**
 * Available actions that can be performed on issues/PRs
 */
export type ChatAction =
	| 'create-branch'
	| 'create-worktree'
	| 'switch-to-branch'
	| 'review-changes'
	| 'explain-issue'
	| 'suggest-implementation'
	| 'create-tests'
	| 'update-documentation'
	| 'analyze-dependencies'
	| 'estimate-effort'
	| 'start-work';

/**
 * Source of the chat integration request
 */
export type ChatSource = 'start-work' | 'launchpad' | 'chat-participant' | 'command-palette' | 'context-menu';

/**
 * Configuration for generating AI chat prompts
 */
export interface ChatPromptConfig {
	/**
	 * The primary action to perform
	 */
	action?: ChatAction;

	/**
	 * Whether to include MCP tool references
	 */
	includeMcpTools?: boolean;

	/**
	 * Whether to include repository context
	 */
	includeRepoContext?: boolean;

	/**
	 * Whether to include related files/changes
	 */
	includeFileContext?: boolean;

	/**
	 * Custom instructions to add to the prompt
	 */
	customInstructions?: string;

	/**
	 * Template variables to replace in the prompt
	 */
	variables?: Record<string, string>;
}

/**
 * Result of generating a chat prompt
 */
export interface ChatPromptResult {
	/**
	 * The generated prompt text
	 */
	prompt: string;

	/**
	 * Suggested follow-up actions
	 */
	followUps?: string[];

	/**
	 * MCP tools that should be available
	 */
	mcpTools?: string[];

	/**
	 * Context that was used to generate the prompt
	 */
	context: ChatIssueContext;
}

/**
 * Arguments for chat integration commands
 */
export interface ChatIntegrationCommandArgs {
	/**
	 * The issue/PR context
	 */
	context: ChatIssueContext;

	/**
	 * The action to perform
	 */
	action: ChatAction;

	/**
	 * Prompt configuration
	 */
	config?: Partial<ChatPromptConfig>;

	/**
	 * Source of the command
	 */
	source?: Sources;
}

/**
 * Arguments for sending content to chat
 */
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
 * GitLens chat participant result metadata
 */
export interface GitLensChatResult extends ChatResult {
	metadata: {
		command?: string;
		action?: ChatAction;
		source?: ChatSource;
		context?: ChatIssueContext;
		mcpToolsUsed?: string[];
	};
}

/**
 * MCP tool reference for chat prompts
 */
export interface McpToolReference {
	/**
	 * Name of the MCP tool
	 */
	name: string;

	/**
	 * Description of what the tool does
	 */
	description: string;

	/**
	 * When this tool should be used
	 */
	usage: string;

	/**
	 * Example of how to reference the tool
	 */
	example?: string;
}

/**
 * Template for generating chat prompts
 */
export interface ChatPromptTemplate {
	/**
	 * Unique identifier for the template
	 */
	id: ChatAction;

	/**
	 * The base prompt template
	 */
	template: string;

	/**
	 * Required variables for the template
	 */
	requiredVariables: string[];

	/**
	 * Optional variables for the template
	 */
	optionalVariables?: string[];

	/**
	 * MCP tools that should be available for this template
	 */
	mcpTools?: string[];

	/**
	 * Follow-up suggestions for this template
	 */
	followUps?: string[];
}
