import { existsSync } from 'node:fs';
import { Logger } from '@gitlens/utils/logger.js';
import { runCLICommand } from './cli/utils.js';

/** The CLI's classification of an agent: `'cli'` (headless CLI tool) or `'gui'` (editor/IDE). The Go
 * enum can also emit `'unknown'` (`ClientTypeUnknown`) for a hook-capable client absent from the CLI's
 * MCP registry — not currently reachable, but a real value we must not drop agents for. */
export type GkAgentType = 'cli' | 'gui' | 'unknown';

export type GkAgent = {
	readonly name: string;
	readonly displayName: string;
	readonly detected: boolean;
	readonly executable?: string;
	readonly mcpSupported: boolean;
	readonly mcpInstalled: boolean;
	readonly hooksSupported: boolean;
	readonly hooksInstalled: boolean;
	readonly type: GkAgentType;
};

/** Returns true if the given CLI executable path exists on disk. Node-side implementation. */
export function isCliExecutableAvailable(executable: string | undefined): boolean {
	return typeof executable === 'string' && executable.length > 0 && existsSync(executable);
}

export async function fetchAgents(): Promise<GkAgent[]> {
	try {
		// cwd doesn't matter for `agents list` (verified) — runCLICommand's default is fine
		const output = await runCLICommand(['agents', 'list', '--json']);
		return parseAgents(output);
	} catch (ex) {
		Logger.error(ex, 'Failed to get agent list from CLI');
		return [];
	}
}

/** Exported for unit testing — not part of the public `@env/gk/agentFetcher` surface consumers use. */
export function parseAgents(output: string): GkAgent[] {
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
			typeof a.hooksInstalled !== 'boolean' ||
			typeof a.type !== 'string'
		) {
			continue;
		}

		// The CLI's `type` enum may grow (or emit a value this build predates); normalize any
		// unrecognized string to 'unknown' rather than dropping the agent, so a forward-compat CLI
		// release doesn't silently disappear agents from the UI.
		const type: GkAgentType = a.type === 'cli' || a.type === 'gui' || a.type === 'unknown' ? a.type : 'unknown';

		agents.push({
			name: a.name,
			displayName: a.displayName,
			detected: a.detected,
			executable: typeof a.executable === 'string' ? a.executable : undefined,
			mcpSupported: a.mcpSupported,
			mcpInstalled: a.mcpInstalled,
			hooksSupported: a.hooksSupported,
			hooksInstalled: a.hooksInstalled,
			type: type,
		});
	}
	return agents;
}
