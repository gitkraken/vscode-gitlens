/** Browser stub — gkcli isn't reachable from the web extension host, so `getClaudeAgent` always
 *  resolves to undefined. Mirrors the `GkAgent` shape from the node-side `agents.ts` so consumers
 *  see a consistent type across both env barrels. */
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

export function getClaudeAgent(): Promise<GkAgent | undefined> {
	return Promise.resolve(undefined);
}
