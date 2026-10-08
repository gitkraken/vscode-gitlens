import { EventEmitter, l10n, window } from 'vscode';
import type { Event } from 'vscode';
import type { GkAgent } from '@env/gk/agentFetcher.js';
import { fetchAgents, isCliExecutableAvailable } from '@env/gk/agentFetcher.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areEqual } from '@gitlens/utils/object.js';
import { pauseOnCancelOrTimeout } from '@gitlens/utils/promise.js';
import { getPresentableErrorMessage } from '../errors.js';

export type { GkAgent };

/** Known CLI agent IDs — used internally to filter the detected-CLI list. Privatized in the rearch
 * (Decision #16); previously exported from `cli/agents.ts`. */
const cliAgentIds = new Set<string>(['claude-cli', 'codex', 'copilot', 'gemini', 'opencode']);

/** Whether `agent` is one of the known CLI agents, detected or not. */
export function isCliAgent(agent: GkAgent): boolean {
	return cliAgentIds.has(agent.name);
}

const agentCacheTtlMs = 5 * 60_000;
// A wedged `gk agents list` must not hang every agent surface. The deadline is per fetch (measured from
// dispatch), so concurrent and late callers share it rather than each starting its own wait
const agentListTimeoutMs = 10_000;
// Deliberately longer than the caller deadline: the deadline keeps the UI responsive, while this is passed
// to the fetch as its exec timeout, to reap a hung process. A fetch still unsettled past it (the process
// ignored the kill, or a grandchild holds its stdout) is abandoned, so detection retries at most once per window
const agentListReapMs = 30_000;
// The exec timeout only starts once the CLI executable is resolved, a little after dispatch, so abandoning exactly
// at the reap window could race the kill and spawn a second process alongside the one about to be reaped
const agentListAbandonMarginMs = 5_000;

type InflightFetch = {
	promise: Promise<GkAgent[]>;
	deadline: number;
	abandonAt: number;
	/** Set once any caller of this fetch got a fallback (stale list or timeout) instead of its result */
	fellBack: boolean;
};

export class AgentService {
	// Kept past expiry (until `invalidateCache()`), so callers get the last known list while a refresh runs
	private _cache: { value: GkAgent[]; expiresAt: number; seq: number } | undefined;
	private _inflight: InflightFetch | undefined;
	// Bumped on every `invalidateCache()` so in-flight fetches dispatched before the invalidation
	// know to skip the cache write when they resolve later.
	private _generation = 0;
	// Bumped on every dispatch, so an abandoned fetch that settles late never overwrites a newer fetch's result
	private _fetchSeq = 0;

	private readonly _onDidChangeAgents = new EventEmitter<void>();
	/** Fires whenever the cached agent list is invalidated (hook install/uninstall, per-agent MCP install), or
	 *  when a fetch whose callers got a stale list or a timeout instead of its result finally succeeds. */
	get onDidChangeAgents(): Event<void> {
		return this._onDidChangeAgents.event;
	}

	/** The parameters exist for tests; production always uses the defaults. */
	constructor(
		private readonly fetch: (timeoutMs: number) => Promise<GkAgent[]> = fetchAgents,
		private readonly timeoutMs: number = agentListTimeoutMs,
		private readonly reapMs: number = agentListReapMs,
		private readonly abandonMarginMs: number = agentListAbandonMarginMs,
		private readonly cacheTtlMs: number = agentCacheTtlMs,
	) {}

	dispose(): void {
		this._onDidChangeAgents.dispose();
	}

	/** Fetches the live agent list. Internally cached with a 5min TTL (successful fetches only); concurrent
	 *  callers share a single in-flight fetch and its deadline (10s from dispatch).
	 *  Once the cache expires, the last successful list is returned at once while a refresh runs in the
	 *  background (stale-while-revalidate); the refresh caches and fires {@link onDidChangeAgents} when it lands.
	 *  With no previous list, callers wait for the fetch until its deadline, then reject — a caller arriving after
	 *  the deadline rejects at once, until the fetch settles or is abandoned (35s from dispatch), when the next
	 *  caller dispatches a new one. A timed-out fetch keeps running, caches if it later succeeds, and then fires
	 *  {@link onDidChangeAgents}.
	 *  A rejection means "unknown", so callers must not read it as "no agents".
	 *  @param options.fresh Never return an expired list — for callers that act on the list (install/uninstall),
	 *  not just show it. A still-unexpired cache is fresh enough. A fresh caller waits for the in-flight fetch
	 *  until it's abandoned (35s from dispatch), rather than the shared deadline, so a user action never fails on a
	 *  slow but healthy fetch. */
	async getAll(options?: { fresh?: boolean }): Promise<readonly GkAgent[]> {
		const c = this._cache;
		if (c != null && c.expiresAt > Date.now()) return c.value;

		let inflight = this._inflight;
		if (inflight != null && inflight.abandonAt <= Date.now()) {
			Logger.warn(`'gk agents list' did not settle within ${this.reapMs}ms; abandoning it and retrying`);
			inflight = undefined;
		}
		inflight ??= this.dispatchFetch();

		// Whether this caller gets a stale list or a timeout, it wants the real list once it arrives
		if (c != null && options?.fresh !== true) {
			inflight.fellBack = true;
			return c.value;
		}

		// A fresh caller is a user action that needs the list to act on, so it waits for as long as the fetch can still
		// settle (until it's abandoned); a display read shares the fetch's deadline, so renders never stall on it
		const waitUntil = options?.fresh === true ? inflight.abandonAt : inflight.deadline;
		const remaining = waitUntil - Date.now();
		if (remaining > 0) {
			try {
				const result = await pauseOnCancelOrTimeout(inflight.promise, undefined, remaining);
				if (!result.paused) return result.value;
			} catch (ex) {
				// The fetch failed outright (e.g. its process was killed at the reap window). Reported like a timeout, as
				// detection didn't finish either way, and the raw error names the command path
				Logger.warn('Agent detection failed', ex);
			}
		}

		inflight.fellBack = true;
		throw new Error(l10n.t("Agent detection didn't finish"));
	}

	private dispatchFetch(): InflightFetch {
		const generation = this._generation;
		const seq = ++this._fetchSeq;
		const dispatchedAt = Date.now();
		const inflight: InflightFetch = {
			promise: undefined!,
			deadline: dispatchedAt + this.timeoutMs,
			abandonAt: dispatchedAt + this.reapMs + this.abandonMarginMs,
			fellBack: false,
		};

		const promise = (async () => {
			const value = await this.fetch(this.reapMs);
			// Only write the cache if no invalidation has happened since dispatch, and no newer fetch has already
			// cached (a fetch abandoned past the reap window can still settle after its replacement)
			if (this._generation === generation && (this._cache == null || this._cache.seq < seq)) {
				const previous = this._cache?.value;
				this._cache = { value: value, expiresAt: Date.now() + this.cacheTtlMs, seq: seq };
				// Callers that got a stale list or a timeout rendered a fallback; let subscribers refresh with the real
				// list, unless it matches the stale list they already have
				if (inflight.fellBack && (previous == null || !areEqual(previous, value))) {
					this._onDidChangeAgents.fire();
				}
			}
			return value;
		})();

		// Warn once per fetch, however many callers are waiting on it
		const timer = setTimeout(
			() => Logger.warn(`'gk agents list' did not finish within ${this.timeoutMs}ms; agent detection timed out`),
			this.timeoutMs,
		);

		inflight.promise = promise;
		// Runs after `_inflight` is assigned below (`then` callbacks are always async). Compares identity, not
		// generation: an abandoned fetch settling late must not clear the fetch that replaced it
		const settle = () => {
			clearTimeout(timer);
			if (this._inflight === inflight) {
				this._inflight = undefined;
			}
		};
		void promise.then(settle, settle);

		this._inflight = inflight;
		return inflight;
	}

	/** Looks up one agent by its `gk agents list` name (`claude-cli`, `codex`, `copilot`, `opencode`, …).
	 *  Rejects like {@link getAll} when detection times out. */
	async getAgent(agentName: string): Promise<GkAgent | undefined> {
		const agents = await this.getAll();
		return agents.find(a => a.name === agentName);
	}

	/** Convenience accessor for the `claude-cli` agent — many callers only want this one. */
	getClaude(): Promise<GkAgent | undefined> {
		return this.getAgent('claude-cli');
	}

	/** Detected CLI-kind agents whose executable exists on disk. Centralizes the filter currently
	 *  duplicated in `agentRegistry.getDetectedCliDescriptors` and `agentResume`. */
	async getDetectedCliAgents(): Promise<readonly GkAgent[]> {
		const agents = await this.getAll();
		return agents.filter(a => isCliAgent(a) && a.detected && isCliExecutableAvailable(a.executable));
	}

	/** Hook-capable agents outside the known CLI set (cursor, antigravity, ...) — feeds the Settings
	 *  Agents table's "Editors" section. Excludes every `cliAgentIds` name regardless of detection
	 *  state, so an undetected CLI (which never gets a row in the CLI section) doesn't leak in here
	 *  as a duplicate. */
	async getHookOnlyAgents(): Promise<readonly GkAgent[]> {
		const agents = await this.getAll();
		return agents.filter(a => a.hooksSupported && !isCliAgent(a));
	}

	/** Drops the cached list. Called after hook install/uninstall to surface fresh state. Dropped, not just expired:
	 *  callers invalidate because the list is known to be wrong, so it must not be served as a stale fallback. */
	invalidateCache(): void {
		this._cache = undefined;
		this._inflight = undefined;
		this._generation++;
		this._onDidChangeAgents.fire();
	}
}

/** The agent list for a command about to act on it (hook or MCP install/uninstall), so never an expired one; or
 *  `undefined` once a detection failure has been reported to the user. Callers return on `undefined` rather than
 *  throw, so a detection failure (e.g. a timeout) is never reported or tracked as a failed (un)install. */
export async function getAgentsOrShowError(agents: AgentService): Promise<readonly GkAgent[] | undefined> {
	try {
		return await agents.getAll({ fresh: true });
	} catch (ex) {
		Logger.warn('Unable to detect agents', ex);
		void window.showErrorMessage(l10n.t('Unable to detect agents: {0}', getPresentableErrorMessage(ex)));
		return undefined;
	}
}
