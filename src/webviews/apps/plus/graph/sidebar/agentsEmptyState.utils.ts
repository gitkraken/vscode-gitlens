/** The Agents panel's empty presentation: `connect` pitches connecting an agent; `no-sessions` keeps
 *  the tree and only replaces its generic empty text. See #5777. */
export type AgentsPanelEmptyState =
	| { type: 'connect'; reason: 'agents-undetected' | 'agents-unconnected' }
	| { type: 'no-sessions' };

/**
 * Decides what the Agents panel shows when it has no sessions to list. `undefined` means nothing to
 * explain: sessions exist, or `hooksAgents` is `undefined` — no push yet, or the agents feature is
 * unavailable — where a pitch would flash or lie.
 *
 * The pitch requires that NO agent has hooks installed (not the banner's `canInstallHooks`, which stays
 * true while one agent works and another merely lacks hooks) and that the banner isn't already pitching.
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
