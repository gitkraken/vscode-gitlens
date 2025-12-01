import type { LaunchpadItem } from '../../plus/launchpad/launchpadProvider';
import type { IssueOrPullRequest } from '../../git/models/issueOrPullRequest';
import type { PullRequest } from '../../git/models/pullRequest';
import type { Repository } from '../../git/models/repository';
import type { Sources } from '../../constants.telemetry';

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
	| 'estimate-effort';

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
export interface SendToChatCommandArgs {
	/**
	 * The prompt to send
	 */
	prompt: string;

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
export interface GitLensChatResult {
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
 * Available MCP tools for different contexts
 */
export const MCP_TOOLS: Record<string, McpToolReference> = {
	git_branch: {
		name: 'git_branch',
		description: 'Create, list, or manage Git branches',
		usage: 'When creating new branches for issues or PRs',
		example: 'Use git_branch to create a new branch for this issue',
	},
	git_worktree: {
		name: 'git_worktree',
		description: 'Create and manage Git worktrees',
		usage: 'When creating isolated workspaces for features',
		example: 'Use git_worktree to create a new worktree for this feature',
	},
	issues_get_detail: {
		name: 'issues_get_detail',
		description: 'Get detailed information about an issue',
		usage: 'When analyzing issue requirements and context',
		example: 'Use issues_get_detail to get more context about this issue',
	},
	pull_request_get_detail: {
		name: 'pull_request_get_detail',
		description: 'Get detailed information about a pull request',
		usage: 'When reviewing PR changes and requirements',
		example: 'Use pull_request_get_detail to analyze the PR changes',
	},
	pull_request_get_comments: {
		name: 'pull_request_get_comments',
		description: 'Get comments and reviews for a pull request',
		usage: 'When understanding feedback and review status',
		example: 'Use pull_request_get_comments to see reviewer feedback',
	},
	repository_get_file_content: {
		name: 'repository_get_file_content',
		description: 'Get file content from the repository',
		usage: 'When analyzing existing code or documentation',
		example: 'Use repository_get_file_content to examine related files',
	},
};

/**
 * Template for generating chat prompts
 */
export interface ChatPromptTemplate {
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
