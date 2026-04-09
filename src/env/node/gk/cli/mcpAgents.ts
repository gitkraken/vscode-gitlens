import { Logger } from '@gitlens/utils/logger.js';
import { runCLICommand } from './utils.js';

/**
 * Represents an MCP agent/client as reported by the GitKraken CLI.
 * Corresponds to the JSON output of `gk mcp install --list --json`.
 */
export interface McpAgent {
	readonly name: string;
	readonly displayName: string;
	readonly detected: boolean;
}

/** Known IDE agent IDs to exclude from the MCP agent picker */
const ideAgentIds = new Set([
	'vscode',
	'vscode-insiders',
	'windsurf',
	'cursor',
	'zed',
	'trae',
	'kiro',
	'jetbrains-copilot',
	'antigravity',
]);

/** Queries the CLI for the list of detected MCP agents, excluding IDE agents */
export async function getSelectableAgents(cliPath?: string): Promise<McpAgent[]> {
	try {
		const output = await runCLICommand(
			['mcp', 'install', '--list', '--json'],
			cliPath ? { cwd: cliPath } : undefined,
		);

		let parsed: unknown;
		try {
			parsed = JSON.parse(output);
		} catch (parseEx) {
			const outputToLog = output.slice(0, 500);
			Logger.error(parseEx, `MCP agent list command returned non-JSON output: ${outputToLog}`);
			return [];
		}
		if (!Array.isArray(parsed)) return [];

		const agents: McpAgent[] = [];
		for (const item of parsed as unknown[]) {
			if (
				item != null &&
				typeof (item as McpAgent).name === 'string' &&
				typeof (item as McpAgent).displayName === 'string' &&
				typeof (item as McpAgent).detected === 'boolean' &&
				(item as McpAgent).detected &&
				!ideAgentIds.has((item as McpAgent).name)
			) {
				agents.push(item as McpAgent);
			}
		}
		return agents;
	} catch (ex) {
		Logger.error(ex, 'Failed to get MCP agent list from CLI');
		return [];
	}
}
