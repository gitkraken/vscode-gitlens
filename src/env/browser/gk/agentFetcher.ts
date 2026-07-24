// Browser-side stub for `@env/gk/agentFetcher`. The gkcli is a Node-only tool — webviews and
// vscode.dev never have access to it, so the picker / dispatch paths that depend on detected
// CLI agents short-circuit to empty in browser builds.

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

/** Browser stub — CLI executables are never available in browser builds. Always returns false. */
export function isCliExecutableAvailable(_executable: string | undefined): boolean {
	return false;
}

export function fetchAgents(): Promise<GkAgent[]> {
	return Promise.resolve([]);
}
