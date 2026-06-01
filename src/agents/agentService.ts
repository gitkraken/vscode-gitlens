import type { GkAgent } from '@env/gk/agentFetcher.js';
import { fetchAgents, isCliExecutableAvailable } from '@env/gk/agentFetcher.js';

export type { GkAgent };

/** Known CLI agent IDs — used internally to filter the detected-CLI list. Privatized in the rearch
 * (Decision #16); previously exported from `cli/agents.ts`. */
const cliAgentIds = new Set<string>(['claude-cli', 'codex', 'copilot', 'gemini', 'opencode']);

const cacheTtlMs = 5 * 60_000;

export class AgentService {
	private _cache: { value: GkAgent[]; expiresAt: number } | undefined;
	private _inflight: Promise<GkAgent[]> | undefined;
	// Bumped on every `invalidateCache()` so in-flight fetches dispatched before the invalidation
	// know to skip the cache write when they resolve later.
	private _generation = 0;

	/** Fetches the live agent list. Internally cached with a 5min TTL; concurrent callers share a single in-flight fetch. */
	async getAll(): Promise<readonly GkAgent[]> {
		const c = this._cache;
		if (c != null && c.expiresAt > Date.now()) return c.value;
		if (this._inflight != null) return this._inflight;

		const generation = this._generation;
		this._inflight = (async () => {
			try {
				const value = await fetchAgents();
				// Only write the cache if no invalidation has happened since dispatch.
				if (this._generation === generation) {
					this._cache = { value: value, expiresAt: Date.now() + cacheTtlMs };
				}
				return value;
			} finally {
				if (this._generation === generation) {
					this._inflight = undefined;
				}
			}
		})();

		return this._inflight;
	}

	/** Convenience accessor for the `claude-cli` agent — many callers only want this one. */
	async getClaude(): Promise<GkAgent | undefined> {
		const agents = await this.getAll();
		return agents.find(a => a.name === 'claude-cli');
	}

	/** Detected CLI-kind agents whose executable exists on disk. Centralizes the filter currently
	 *  duplicated in `agentRegistry.getDetectedCliDescriptors` and `claudeResume`. */
	async getDetectedCliAgents(): Promise<readonly GkAgent[]> {
		const agents = await this.getAll();
		return agents.filter(a => cliAgentIds.has(a.name) && a.detected && isCliExecutableAvailable(a.executable));
	}

	/** Drops the cached list. Called after hook install/uninstall to surface fresh state. */
	invalidateCache(): void {
		this._cache = undefined;
		this._inflight = undefined;
		this._generation++;
	}
}
