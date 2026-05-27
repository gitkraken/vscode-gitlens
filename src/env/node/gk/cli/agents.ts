import { existsSync } from 'node:fs';
import { Logger } from '@gitlens/utils/logger.js';
import { runCLICommand } from './utils.js';

/** Returns true if the given CLI executable path exists on disk. Used by the agent picker /
 *  dispatch to filter out CLIs gkcli detects but whose binaries have since been moved/uninstalled. */
export function isCliExecutableAvailable(executable: string | undefined): boolean {
	return typeof executable === 'string' && executable.length > 0 && existsSync(executable);
}

/**
 * An AI agent as reported by `gk agents list --json`. Requires gkcli ≥ 3.1.63
 * (enforced by `productConfigProvider.ts` `cli.minimumCoreVersion`).
 */
export interface GkAgent {
	readonly name: string;
	readonly displayName: string;
	readonly detected: boolean;
	readonly executable?: string;
	readonly mcpSupported: boolean;
	readonly mcpInstalled: boolean;
	readonly hooksSupported: boolean;
	readonly hooksInstalled: boolean;
}

/** Known IDE agent IDs — used to filter IDE entries out of the MCP install picker and to identify the host IDE. */
export const ideAgentIds = new Set<string>([
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

/** Known CLI agent IDs — used by the Start Work / Start Review agent picker. */
export const cliAgentIds = new Set<string>(['claude-cli', 'codex', 'copilot', 'gemini', 'opencode']);

// Hook install state changes through GitLens-mediated commands always call `invalidateAgentsCache`,
// so the TTL only governs how quickly we'd notice an external `gk ai-hook install`. 5 min is plenty —
// banner staleness windows of seconds aren't worth the extra CLI spawns.
const cacheTtlMs = 5 * 60_000;
let cache: { value: GkAgent[]; expiresAt: number } | undefined;
let inflight: Promise<GkAgent[]> | undefined;

/** Drops the cached agent list — call after install/uninstall hooks so the next read returns fresh state. */
export function invalidateAgentsCache(): void {
	cache = undefined;
	inflight = undefined;
}

/**
 * Returns every agent gkcli knows about (detected or not). Cached for {@link cacheTtlMs};
 * concurrent callers share a single in-flight fetch.
 */
export async function getAllAgents(cliPath?: string): Promise<GkAgent[]> {
	const c = cache;
	if (c != null && c.expiresAt > Date.now()) return c.value;
	if (inflight != null) return inflight;

	inflight = (async () => {
		try {
			const value = await fetchAgents(cliPath);
			cache = { value: value, expiresAt: Date.now() + cacheTtlMs };
			return value;
		} finally {
			inflight = undefined;
		}
	})();

	return inflight;
}

/** Convenience accessor for the `claude-cli` agent — many callers only want this one. */
export async function getClaudeAgent(cliPath?: string): Promise<GkAgent | undefined> {
	const agents = await getAllAgents(cliPath);
	return agents.find(a => a.name === 'claude-cli');
}

async function fetchAgents(cliPath?: string): Promise<GkAgent[]> {
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
