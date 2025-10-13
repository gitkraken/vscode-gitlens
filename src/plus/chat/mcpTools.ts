import type { McpToolReference } from './models/chat';

/**
 * Available MCP tools for different contexts
 */
export const mcpTools: Record<string, McpToolReference> = {
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
