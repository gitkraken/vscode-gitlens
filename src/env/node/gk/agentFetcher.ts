import { existsSync } from 'node:fs';
import { Logger } from '@gitlens/utils/logger.js';
import { runCLICommand } from './cli/utils.js';

export type GkAgent = {
	readonly name: string;
	readonly displayName: string;
	readonly detected: boolean;
	readonly executable?: string;
	readonly mcpSupported: boolean;
	readonly mcpInstalled: boolean;
	readonly hooksSupported: boolean;
	readonly hooksInstalled: boolean;
};

/** Returns true if the given CLI executable path exists on disk. Node-side implementation. */
export function isCliExecutableAvailable(executable: string | undefined): boolean {
	return typeof executable === 'string' && executable.length > 0 && existsSync(executable);
}

export async function fetchAgents(cliPath?: string): Promise<GkAgent[]> {
	try {
		const output = await runCLICommand(['agents', 'list', '--json'], cliPath ? { cwd: cliPath } : undefined);
		return parseAgents(output);
	} catch (ex) {
		Logger.error(ex, 'Failed to get agent list from CLI');
		return [];
	}
}

function parseAgents(output: string): GkAgent[] {
	let raw: unknown;
	try {
		raw = JSON.parse(output);
	} catch (ex) {
		Logger.error(ex, `'gk agents list' returned non-JSON: ${output.slice(0, 500)}`);
		return [];
	}
	if (!Array.isArray(raw)) return [];

	const agents: GkAgent[] = [];
	for (const item of raw as unknown[]) {
		if (item == null || typeof item !== 'object') continue;

		const a = item as Record<string, unknown>;
		if (
			typeof a.name !== 'string' ||
			typeof a.displayName !== 'string' ||
			typeof a.detected !== 'boolean' ||
			typeof a.mcpSupported !== 'boolean' ||
			typeof a.mcpInstalled !== 'boolean' ||
			typeof a.hooksSupported !== 'boolean' ||
			typeof a.hooksInstalled !== 'boolean'
		) {
			continue;
		}

		agents.push({
			name: a.name,
			displayName: a.displayName,
			detected: a.detected,
			executable: typeof a.executable === 'string' ? a.executable : undefined,
			mcpSupported: a.mcpSupported,
			mcpInstalled: a.mcpInstalled,
			hooksSupported: a.hooksSupported,
			hooksInstalled: a.hooksInstalled,
		});
	}
	return agents;
}
