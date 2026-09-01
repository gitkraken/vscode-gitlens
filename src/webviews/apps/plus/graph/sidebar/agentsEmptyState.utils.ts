/** The Agents panel's empty presentation: `connect` pitches connecting an agent; `no-sessions` keeps
 *  the tree and only replaces its generic empty text. See #5777. */
export type AgentsPanelEmptyState =
	| { type: 'connect'; reason: 'agents-undetected' | 'agents-unconnected' }
	| { type: 'no-sessions' };

/**
 * `hooksAgents: undefined` means "no push yet" or "agents feature unavailable" — no verdict either
 * way. A visible banner already carries the connect pitch, so it demotes one to `no-sessions`.
 *
 * @param sessionCount Family-filtered total, pre-"past sessions" toggle — hidden ended sessions still
 * prove agents are connected
 */
export function resolveAgentsEmptyState(options: {
	hooksAgents: readonly { installed: boolean }[] | undefined;
	sessionCount: number;
	bannerVisible: boolean;
}): AgentsPanelEmptyState | undefined {
	const { hooksAgents, sessionCount, bannerVisible } = options;

	if (sessionCount > 0) return undefined;
	if (hooksAgents == null) return undefined;

	if (hooksAgents.some(a => a.installed)) return { type: 'no-sessions' };
	if (bannerVisible) return { type: 'no-sessions' };

	return { type: 'connect', reason: hooksAgents.length === 0 ? 'agents-undetected' : 'agents-unconnected' };
}
