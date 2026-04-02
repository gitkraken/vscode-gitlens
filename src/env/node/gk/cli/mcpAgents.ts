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

/** Gets the CLI provider ID that corresponds to the current host IDE */
export function getHostAgentId(hostAppName: string | undefined): string | undefined {
	switch (hostAppName) {
		case 'code':
			return 'vscode';
		case 'code-insiders':
			return 'vscode-insiders';
		case 'code-exploration':
			return 'vscode-exploration';
		default:
			return hostAppName;
	}
}

/** Queries the CLI for the list of supported MCP agents, excluding the current host IDE */
export async function getSelectableAgents(hostAgentId: string | undefined, cliPath?: string): Promise<McpAgent[]> {
	try {
		const output = await runCLICommand(
			['mcp', 'install', '--list', '--json'],
			cliPath ? { cwd: cliPath } : undefined,
		);
		const agents = JSON.parse(output) as McpAgent[];
		return agents.filter(a => a.detected && a.name !== hostAgentId);
	} catch (ex) {
		Logger.error(ex, 'Failed to get MCP agent list from CLI');
		return [];
	}
}
