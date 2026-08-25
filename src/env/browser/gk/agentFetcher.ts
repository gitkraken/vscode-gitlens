// Browser-side stub for `@env/gk/agentFetcher`. The gkcli is a Node-only tool — webviews and
// vscode.dev never have access to it, so the picker / dispatch paths that depend on detected
// CLI agents short-circuit to empty in browser builds.

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

/** Browser stub — CLI executables are never available in browser builds. Always returns false. */
export function isCliExecutableAvailable(_executable: string | undefined): boolean {
	return false;
}

export function fetchAgents(): Promise<GkAgent[]> {
	return Promise.resolve([]);
}
