import type { Container } from '../../../../container';
import { isIssue } from '../../../../git/models/issue';
import { isPullRequest } from '../../../../git/models/pullRequest';
import type { LaunchpadItem } from '../../../launchpad/launchpadProvider';
import { mcpTools } from '../../mcpTools';
import type {
	ChatAction,
	ChatIssueContext,
	ChatPromptConfig,
	ChatPromptResult,
	ChatPromptTemplate,
	McpToolReference,
} from '../../models/chat';
import {
	analyzeDependencies,
	createBranch,
	createTests,
	createWorktree,
	estimateEffort,
	explainIssue,
	reviewChanges,
	startWork,
	suggestImplementation,
	switchToBranch,
	updateDocumentation,
} from '../../prompts';

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
		if (!template) {
			throw new Error(`No chat template found for action: ${action}`);
		}

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
	private getTemplateForAction(action: ChatAction): ChatPromptTemplate | undefined {
		switch (action) {
			case 'create-branch':
				return createBranch;
			case 'create-worktree':
				return createWorktree;
			case 'switch-to-branch':
				return switchToBranch;
			case 'review-changes':
				return reviewChanges;
			case 'explain-issue':
				return explainIssue;
			case 'suggest-implementation':
				return suggestImplementation;
			case 'create-tests':
				return createTests;
			case 'update-documentation':
				return updateDocumentation;
			case 'analyze-dependencies':
				return analyzeDependencies;
			case 'estimate-effort':
				return estimateEffort;
			case 'start-work':
				return startWork;
			default:
				return undefined;
		}
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
		return (template?.mcpTools || []).map(toolName => mcpTools[toolName]).filter(Boolean);
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
