/**
 * The Agents panel's empty presentation, resolved from hooks + session state. `connect` replaces the
 * tree body with a pitch naming why the list is empty (no agents connected) and routing to the Agents
 * settings page; `no-sessions` keeps the tree (and its filter/past-sessions chrome) and only swaps the
 * generic "No items" for a truthful line. See #5777.
 */
export type AgentsPanelEmptyState =
	| { type: 'connect'; reason: 'agents-undetected' | 'agents-unconnected' }
	| { type: 'no-sessions' };

/**
 * Decides what the Agents panel shows when it has no sessions to list.
 *
 * Returns `undefined` when there is nothing to explain: sessions exist, or `hooksAgents` is
 * `undefined` — before the host's first agents push (treating "unknown" as "unconnected" would flash
 * the pitch at every panel open) and while the agents feature is unavailable (disabled by setting or
 * org, or a host with no session providers — pitching agents that cannot be connected would be a lie).
 *
 * The pitch must never lie: it only appears when NO detected agent has hooks installed — the banner's
 * own `canInstallHooks` gate is the wrong predicate here, since it stays true while one agent is
 * connected and working and another merely lacks hooks. And while the "Connect Your AI Agents" banner
 * is still visible it already carries the pitch, so the empty body drops to the neutral line instead
 * of saying the same thing twice; once the banner is dismissed the pitch becomes the panel's permanent
 * answer — that persistence is the point of #5777.
 *
 * @param hooksAgents Detected, hooks-capable agents (`undefined` while unknown or the agents feature
 * is unavailable; `[]` when enabled but none detected)
 * @param sessionCount Family-filtered session total — NOT the post-"past sessions"-toggle count, since
 * hidden ended sessions still prove agents are connected
 * @param bannerVisible Whether the Connect Your AI Agents banner is currently rendered above the tree
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
