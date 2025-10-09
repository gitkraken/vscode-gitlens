import type { Container } from '../../container';
import { isIssue } from '../../git/models/issue';
import { isPullRequest } from '../../git/models/pullRequest';
import type { LaunchpadItem } from '../../plus/launchpad/launchpadProvider';
import type {
	ChatAction,
	ChatIssueContext,
	ChatPromptConfig,
	ChatPromptResult,
	ChatPromptTemplate,
	McpToolReference,
} from './types';
import { mcpTools } from './types';

/**
 * Type guard to check if an item is a LaunchpadItem
 */
function isLaunchpadItem(item: unknown): item is LaunchpadItem {
	return Boolean(item && typeof item === 'object' && 'underlyingPullRequest' in item);
}

/**
 * Service for building AI chat prompts with issue/PR context and MCP tool integration
 */
export class ChatPromptBuilder {
	constructor(private readonly container: Container) {}

	/**
	 * Generate a chat prompt for the given context and action
	 */
	generatePrompt(context: ChatIssueContext, action: ChatAction, config: ChatPromptConfig = {}): ChatPromptResult {
		const template = this.getTemplateForAction(action);
		const variables = this.buildTemplateVariables(context, config);
		const mcpTools = this.getMcpToolsForAction(action, config.includeMcpTools);

		let prompt = this.processTemplate(template.template, variables);

		// Add MCP tool references if requested
		if (config.includeMcpTools && mcpTools.length > 0) {
			prompt += `\n\n${this.buildMcpToolsSection(mcpTools)}`;
		}

		// Add custom instructions if provided
		if (config.customInstructions) {
			prompt += `\n\n${config.customInstructions}`;
		}

		return {
			prompt: prompt,
			followUps: template.followUps,
			mcpTools: mcpTools.map(tool => tool.name),
			context: context,
		};
	}

	/**
	 * Get the appropriate template for the given action
	 */
	private getTemplateForAction(action: ChatAction): ChatPromptTemplate {
		const templates: Record<ChatAction, ChatPromptTemplate> = {
			'create-branch': {
				template: `I need to create a new branch for working on this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}
{{#repository}}
- **Repository:** {{repository}}
{{/repository}}

**Requested Action:** Create a new Git branch{{#worktree}} in a worktree{{/worktree}} for this {{itemType}}.

Please help me:
1. Suggest an appropriate branch name following best practices
2. Create the branch{{#worktree}} and set up a worktree{{/worktree}}
3. Set up the development environment for this work

{{#mcpToolsAvailable}}
You have access to GitKraken MCP tools that can help with Git operations.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['description', 'repository', 'worktree', 'mcpToolsAvailable'],
				mcpTools: ['git_branch', 'git_worktree'],
				followUps: [
					'Set up development environment',
					'Create initial commit structure',
					'Configure branch protection rules',
				],
			},
			'create-worktree': {
				template: `I need to create a new worktree for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}

**Requested Action:** Create a new Git worktree for isolated development.

Please help me:
1. Create a new worktree with an appropriate name
2. Set up the branch for this {{itemType}}
3. Configure the workspace for development

{{#mcpToolsAvailable}}
You have access to GitKraken MCP tools for Git worktree management.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['description', 'mcpToolsAvailable'],
				mcpTools: ['git_worktree', 'git_branch'],
				followUps: [
					'Switch to the new worktree',
					'Set up development dependencies',
					'Create initial file structure',
				],
			},
			'explain-issue': {
				template: `Please help me understand this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}
{{#repository}}
- **Repository:** {{repository}}
{{/repository}}

**Requested Action:** Analyze and explain this {{itemType}} to help me understand:
1. The problem or feature being described
2. Potential implementation approaches
3. Areas of the codebase that might be affected
4. Any dependencies or prerequisites

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to gather additional context about the repository and related issues/PRs.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['description', 'repository', 'mcpToolsAvailable'],
				mcpTools: ['issues_get_detail', 'pull_request_get_detail', 'repository_get_file_content'],
				followUps: ['Create implementation plan', 'Identify related files', 'Estimate development effort'],
			},
			'suggest-implementation': {
				template: `I need implementation suggestions for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}

**Requested Action:** Provide implementation guidance including:
1. Suggested approach and architecture
2. Key files and components to modify
3. Step-by-step implementation plan
4. Testing strategy
5. Potential challenges and solutions

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to examine the current codebase and understand the context better.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['description', 'mcpToolsAvailable'],
				mcpTools: ['repository_get_file_content', 'issues_get_detail'],
				followUps: ['Create detailed task breakdown', 'Set up development branch', 'Write initial tests'],
			},
			'review-changes': {
				template: `I need help reviewing this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}
{{#description}}
- **Description:** {{description}}
{{/description}}

**Requested Action:** Review the changes and provide feedback on:
1. Code quality and best practices
2. Potential issues or improvements
3. Test coverage and completeness
4. Documentation updates needed
5. Security considerations

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to examine the PR details, comments, and file changes.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['description', 'mcpToolsAvailable'],
				mcpTools: ['pull_request_get_detail', 'pull_request_get_comments', 'repository_get_file_content'],
				followUps: ['Add review comments', 'Suggest improvements', 'Check test coverage'],
			},
			'switch-to-branch': {
				template: `I want to switch to work on this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me switch to the appropriate branch for this {{itemType}} and set up the development environment.

{{#mcpToolsAvailable}}
You can use GitKraken MCP tools to manage Git branches and worktrees.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['mcpToolsAvailable'],
				mcpTools: ['git_branch', 'git_worktree'],
				followUps: ['Update dependencies', 'Run tests', 'Check recent changes'],
			},
			'create-tests': {
				template: `I need to create tests for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me create comprehensive tests including unit tests, integration tests, and any necessary test fixtures.

{{#mcpToolsAvailable}}
You can examine the codebase to understand existing test patterns and structures.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['mcpToolsAvailable'],
				mcpTools: ['repository_get_file_content'],
				followUps: ['Run test suite', 'Check coverage', 'Add edge cases'],
			},
			'update-documentation': {
				template: `I need to update documentation for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me update relevant documentation including README files, API docs, and user guides.

{{#mcpToolsAvailable}}
You can examine existing documentation to maintain consistency.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['mcpToolsAvailable'],
				mcpTools: ['repository_get_file_content'],
				followUps: ['Review documentation', 'Update examples', 'Check links'],
			},
			'analyze-dependencies': {
				template: `I need to analyze dependencies for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me understand and analyze the dependencies, potential conflicts, and impact on the codebase.

{{#mcpToolsAvailable}}
You can examine package files and dependency configurations.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['mcpToolsAvailable'],
				mcpTools: ['repository_get_file_content'],
				followUps: ['Update dependencies', 'Check for vulnerabilities', 'Test compatibility'],
			},
			'estimate-effort': {
				template: `I need an effort estimate for this {{itemType}}:

**{{itemType}} Details:**
- **Title:** {{title}}
- **ID:** {{id}}
- **URL:** {{url}}

**Requested Action:** Help me estimate the development effort, complexity, and timeline for implementing this {{itemType}}.

{{#mcpToolsAvailable}}
You can examine the codebase to understand the scope and complexity.
{{/mcpToolsAvailable}}`,
				requiredVariables: ['itemType', 'title', 'id', 'url'],
				optionalVariables: ['mcpToolsAvailable'],
				mcpTools: ['repository_get_file_content', 'issues_get_detail'],
				followUps: ['Create task breakdown', 'Set milestones', 'Plan sprints'],
			},
		};

		return templates[action];
	}

	/**
	 * Build template variables from the context
	 */
	private buildTemplateVariables(context: ChatIssueContext, config: ChatPromptConfig): Record<string, any> {
		const { item, repository, metadata } = context;

		let title: string;
		let id: string;
		let url: string | null;
		let description: string | undefined;
		let itemType: string;

		if (isLaunchpadItem(item)) {
			title = item.title;
			id = item.id;
			url = item.url;
			description = undefined; // LaunchpadItem doesn't have body, would need to fetch from underlyingPullRequest
			itemType = 'pull request';
		} else if (isPullRequest(item)) {
			title = item.title;
			id = `#${item.id}`;
			url = item.url;
			description = undefined; // PullRequest doesn't have body property
			itemType = 'pull request';
		} else if (isIssue(item)) {
			title = item.title;
			id = `#${item.id}`;
			url = item.url;
			description = (item as any).body; // Issue has body property
			itemType = 'issue';
		} else {
			// Fallback for IssueOrPullRequest
			title = item.title;
			id = item.id;
			url = item.url;
			description = undefined;
			itemType = item.type === 'pullrequest' ? 'pull request' : 'issue';
		}

		const variables: Record<string, any> = {
			title: title,
			id: id,
			url: url,
			itemType: itemType,
			description: description,
			repository: repository?.name,
			worktree: metadata?.worktree,
			mcpToolsAvailable: config.includeMcpTools,
			...config.variables,
		};

		return variables;
	}

	/**
	 * Get MCP tools for the given action
	 */
	private getMcpToolsForAction(action: ChatAction, includeMcp?: boolean): McpToolReference[] {
		if (!includeMcp) return [];

		const template = this.getTemplateForAction(action);
		return (template.mcpTools || []).map(toolName => mcpTools[toolName]).filter(Boolean);
	}

	/**
	 * Process a template with variables using simple mustache-like syntax
	 */
	private processTemplate(template: string, variables: Record<string, any>): string {
		let result = template;

		// Replace simple variables {{variable}}
		result = result.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
			return variables[key] !== undefined ? String(variables[key]) : '';
		});

		// Handle conditional sections {{#variable}}...{{/variable}}
		result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_match, key, content) => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-return
			return variables[key] ? content : '';
		});

		return result.trim();
	}

	/**
	 * Build the MCP tools section for the prompt
	 */
	private buildMcpToolsSection(tools: McpToolReference[]): string {
		if (tools.length === 0) return '';

		let section = '**Available GitKraken MCP Tools:**\n';
		for (const tool of tools) {
			section += `- **${tool.name}**: ${tool.description}\n`;
			if (tool.example) {
				section += `  *Example: ${tool.example}*\n`;
			}
		}

		return section;
	}
}
