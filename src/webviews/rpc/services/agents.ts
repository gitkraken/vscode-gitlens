import type { PastAgentSessionsResult } from '../../../agents/models/agentSessionState.js';
import type { Container } from '../../../container.js';

export class AgentsService {
	constructor(private readonly container: Container) {}

	/**
	 * Gets the past sessions a worktree can resume, most-recently-active first.
	 *
	 * Past sessions only — live ones already reach webviews on a push channel, and a snapshot taken
	 * here would disagree with it within seconds.
	 *
	 * Returns `undefined` when agents are unavailable (the org gate is off, or we're in a browser
	 * host, where no providers exist) as distinct from an empty result, which means the store simply
	 * holds nothing for this worktree. Callers cache the two differently.
	 */
	async getPastSessionsForWorktree(
		worktreePath: string,
		options?: { limit?: number },
		signal?: AbortSignal,
	): Promise<PastAgentSessionsResult | undefined> {
		signal?.throwIfAborted();

		const agents = this.container.agentStatus;
		if (agents == null) return undefined;

		const result = await agents.getPastSessions(worktreePath, options);
		signal?.throwIfAborted();

		return result;
	}
}
