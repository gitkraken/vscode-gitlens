// Browser-side stub for `@env/gk/cli/agents`. The gkcli is a Node-only tool — webviews and
// vscode.dev never have access to it, so the picker / dispatch paths that depend on detected
// CLI agents short-circuit to empty in browser builds.

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

export const ideAgentIds = new Set<string>();
export const cliAgentIds = new Set<string>();

export function invalidateAgentsCache(): void {}

export function getAllAgents(): Promise<GkAgent[]> {
	return Promise.resolve([]);
}

export function getClaudeAgent(): Promise<GkAgent | undefined> {
	return Promise.resolve(undefined);
}

// oxlint-disable-next-line @typescript-eslint/no-unused-vars
export function isCliExecutableAvailable(executable: string | undefined): boolean {
	return false;
}
