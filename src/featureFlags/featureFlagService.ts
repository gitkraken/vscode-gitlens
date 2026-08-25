import type { deserializeConfig, IConfigCatCache, IConfigCatClient } from '@configcat/sdk';
import type * as FeatureFlagProjectConfigModule from '@configcat/sdk/lib/esm/ProjectConfig.js';
import { env as vscodeEnv } from 'vscode';
import { fetch } from '@env/fetch.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../container.js';

type DeserializeFeatureFlagConfig = typeof deserializeConfig;

export type FeatureFlagValue = boolean | string | number;
export enum FeatureFlagKey {
	GraphGateIntroVideo = 'glensGraphGateIntroVideo',
	WelcomeTitleVariant = 'glensWelcomeTitleVariant',
}
export type FeatureFlagMap = Readonly<Partial<Record<FeatureFlagKey, FeatureFlagValue>>>;
export interface FeatureFlagService {
	dispose(): void;
	/** Resolves once the initial background fetch and evaluation completes, whether it succeeded or not */
	readonly whenReady: Promise<void>;
	/** Whether a flag fetch has ever completed on this machine — a cached flag map from a past success
	 *  (even an empty one, when the deployed config defines no keys) or a recorded attempt that finished
	 *  without caching (failed response, offline). Distinguishes a genuine first run from a machine
	 *  where fetching has already had its chance. */
	readonly hasEverFetched: boolean;
	getFlag<T extends FeatureFlagValue>(key: FeatureFlagKey, defaultValue: T): T;
	getAllFlags(): FeatureFlagMap;
}

/** A/B (welcome title): the variant the most recently rendered Welcome view actually showed —
 *  latched per window session, so neither a mid-session flag fetch nor the view's re-bootstrap on
 *  every hide→show can flip the title on screen (or relabel events with an arm the user never saw) */
let renderedWelcomeTitleVariant: boolean | undefined;

export function latchWelcomeTitleVariant(container: Container): boolean {
	if (renderedWelcomeTitleVariant == null) {
		renderedWelcomeTitleVariant = container.featureFlags.getFlag(FeatureFlagKey.WelcomeTitleVariant, false);
		setFeatureFlagTelemetryGlobalAttributes(container);
	}

	return renderedWelcomeTitleVariant;
}

/** (Re-)stamps the `featureFlags` telemetry global attribute. Called at activation, when the
 *  background fetch lands (see `extension.ts`), and when either A/B latches its rendered variant
 *  (see `graphWebview.ts` and `latchWelcomeTitleVariant`) — so events carry the freshest
 *  attribution available. */
export function setFeatureFlagTelemetryGlobalAttributes(container: Container): void {
	const flags = new Map<string, FeatureFlagValue>(Object.entries(container.featureFlags.getAllFlags()));

	// `glensWelcomeTitleVariant` reports the variant a rendered Welcome view actually showed — but
	// only when the key was actually fetched: a cohort-less render (the fetch failed or hasn't
	// landed, or the experiment isn't deployed) must stay absent rather than synthesize a control
	// label, and an unconditional write would also keep the empty-map clear below unreachable
	if (renderedWelcomeTitleVariant != null && flags.has(FeatureFlagKey.WelcomeTitleVariant)) {
		flags.set(FeatureFlagKey.WelcomeTitleVariant, renderedWelcomeTitleVariant);
	}

	// `glensGraphGateIntroVideo` reports the variant the user actually SAW, not the fetched value:
	// the Graph latches the rendered variant per window and persists it, so a fetch landing
	// mid-session can't relabel events for a user who never saw the new variant — while a later
	// render that DOES show it (e.g. after a window reload) updates the label. Until a gate has
	// ever been shown the key is omitted: an unexposed user isn't in the experiment.
	const shownIntroVideo = container.storage.get('graph:signInGate:introVideoShown');
	if (shownIntroVideo != null) {
		flags.set(FeatureFlagKey.GraphGateIntroVideo, shownIntroVideo);
	} else {
		flags.delete(FeatureFlagKey.GraphGateIntroVideo);
	}

	// An empty map CLEARS the attribute — a fetch can retire every flag mid-session, and a stale
	// value would relabel the rest of the session's events
	container.telemetry.setGlobalAttribute(
		'featureFlags',
		flags.size === 0
			? undefined
			: JSON.stringify(Object.fromEntries([...flags].sort(([a], [b]) => a.localeCompare(b)))),
	);
}

/**
 * ConfigCat's getClient() requires an SDK key parameter,
 * but since this service operates in offline mode with a prefetched config,
 * we do not have the actual key, and it doesn't matter.
 *
 * The zeroed-out key placeholder satisfies the API requirement without making any real requests to ConfigCat's servers.
 */
const localSdkKey = 'configcat-sdk-1/0000000000000000000000/0000000000000000000000';

class PrefetchedConfigCache implements IConfigCatCache {
	private config: string | undefined;
	constructor(serializedConfig: string | undefined) {
		this.config = serializedConfig;
	}

	get(_key: string): string | undefined {
		return this.config;
	}

	set(_key: string, value: string): void {
		this.config = value;
	}
}

export class ConfigCatFeatureFlagService implements FeatureFlagService {
	readonly whenReady: Promise<void>;
	readonly hasEverFetched: boolean;

	private _flags: FeatureFlagMap;

	constructor(private readonly container: Container) {
		const cached = this.container.storage.get('featureFlags:flags');
		this.hasEverFetched = cached != null || this.container.storage.get('featureFlags:fetched') === true;
		this._flags = Object.freeze(cached ?? {});

		// Fire background fetch to evaluate flags — results apply to this session once ready and are
		// stored for the next activation
		this.whenReady = this.fetchAndCacheFlags();
	}

	dispose(): void {}

	getFlag<T extends FeatureFlagValue>(key: FeatureFlagKey, defaultValue: T): T {
		const value = this._flags[key];
		if (value == null || typeof value !== typeof defaultValue) {
			return defaultValue;
		}
		return value as T;
	}

	getAllFlags(): FeatureFlagMap {
		return this._flags;
	}

	/**
	 * Fetches fresh config from the API, evaluates all flags via ConfigCat SDK,
	 * applies the resolved flag map to this session, and stores it in globalState
	 * for the next activation. Errors are logged but never propagated.
	 */
	private async fetchAndCacheFlags(): Promise<void> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.fetchAndCacheFlags`);

		try {
			const response = await fetch(this.container.urls.getGkApiUrl('feature-flags', 'config'), {
				// This fetch bypasses ServerConnection (unauthenticated, fire-and-forget), so set the shared
				// User-Agent explicitly — otherwise Node's built-in fetch defaults to `node` and the request is
				// unattributable server-side.
				headers: { Accept: 'application/json', 'User-Agent': this.container.userAgent },
				// Bounded so `whenReady` always settles (and the `finally` below always runs) even on a
				// network that blackholes the request — an unbounded hang would re-arm the graph
				// bootstrap's first-run wait on every activation
				signal: AbortSignal.timeout(10000),
			});

			if (!response.ok) {
				Logger.debug(scope, `Failed to fetch feature flags config (${response.status} ${response.statusText})`);
				return;
			}

			const configJson = await response.text();
			if (!configJson) {
				Logger.debug(scope, 'Feature flags config response was empty');
				return;
			}

			const flags = await this.evaluateFlags(configJson);
			if (flags != null) {
				this._flags = Object.freeze(flags);
				await this.container.storage.store('featureFlags:flags', flags);
			}
		} catch (ex) {
			Logger.debug(ex, scope, 'Failed to fetch and cache feature flags');
		} finally {
			// Record that a fetch COMPLETED (even without caching) — `hasEverFetched` gates the graph
			// bootstrap's bounded first-run wait, which would otherwise re-arm on every activation for a
			// machine whose fetches hang or fail (e.g. a firewall silently dropping the API traffic)
			if (!this.hasEverFetched) {
				void this.container.storage.store('featureFlags:fetched', true);
			}
		}
	}

	/**
	 * Creates a temporary ConfigCat client to evaluate all flags from the given config JSON,
	 * then disposes it immediately.
	 */
	private async evaluateFlags(configJson: string): Promise<FeatureFlagMap | undefined> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.evaluateFlags`);

		const [sdkResult, projectConfigResult] = await Promise.allSettled([
			import(/* webpackChunkName: "feature-flags" */ '@configcat/sdk'),
			import(/* webpackChunkName: "feature-flags" */ '@configcat/sdk/lib/esm/ProjectConfig.js'),
		]);

		const sdk = getSettledValue(sdkResult);
		const projectConfigModule = getSettledValue(projectConfigResult);

		if (sdk == null || projectConfigModule == null) {
			Logger.debug(scope, 'Failed to load ConfigCat SDK modules');
			return undefined;
		}

		let client: IConfigCatClient | undefined;
		try {
			const cache = new PrefetchedConfigCache(
				this.serializeProjectConfig(configJson, sdk.deserializeConfig, projectConfigModule),
			);
			client = sdk.getClient(localSdkKey, sdk.PollingMode.ManualPoll, {
				cache: cache,
				defaultUser: { identifier: vscodeEnv.machineId },
				offline: true,
				// Route the SDK's own diagnostics into GitLens' debug channel rather than letting its default
				// console logger write to the extension host output. Asking for a key by name (below) logs an
				// SDK error when the shared config doesn't define it — which happens whenever GitLens' flag
				// list and the deployed config drift (flag retired server-side, or a new key shipped ahead of
				// the rollout). That's a config-drift signal for us, not something to surface on every
				// activation — exactly the per-startup noise the per-key evaluation was meant to remove.
				logger: {
					log: (level, eventId, message) => {
						// Only the per-key "setting not found" case (event 1001) is the expected drift noise.
						// Route everything else at error level through `Logger.error`, or a genuine SDK failure
						// (config fetch rejected, bad SDK key) would be invisible at default verbosity — the
						// opposite of what silencing the noise was for.
						if (eventId !== 1001 && level === sdk.LogLevel.Error) {
							Logger.error(undefined, scope, `ConfigCat: ${String(message)}`);
							return;
						}

						Logger.debug(scope, `ConfigCat: ${String(message)}`);
					},
				},
			});

			await client.waitForReady();
			await client.forceRefreshAsync();

			// Evaluate ONLY the keys GitLens actually reads. `getAllValuesAsync()` evaluates every setting in
			// the shared GitKraken config — dozens belong to other products and target by `User.Email`, which
			// this client deliberately doesn't supply (see `defaultUser` below). Each of those logs a
			// "User.Email attribute is missing" warning to the extension host on every startup, and their
			// values are discarded here anyway. Evaluation is offline against the prefetched config, so this
			// loop does no I/O.
			const flags: Partial<Record<FeatureFlagKey, FeatureFlagValue>> = {};

			for (const key of Object.values(FeatureFlagKey)) {
				const settingValue = await client.getValueAsync(key, undefined);
				if (
					typeof settingValue === 'boolean' ||
					typeof settingValue === 'number' ||
					typeof settingValue === 'string'
				) {
					flags[key] = settingValue;
				}
			}

			return flags;
		} catch (ex) {
			Logger.debug(ex, scope, 'Failed to evaluate feature flags');
			return undefined;
		} finally {
			client?.dispose();
		}
	}

	private serializeProjectConfig(
		configJson: string,
		deserializeConfig: DeserializeFeatureFlagConfig,
		projectConfigModule: typeof FeatureFlagProjectConfigModule,
	): string {
		const config = deserializeConfig(configJson);
		const projectConfig = new projectConfigModule.ProjectConfig(
			configJson,
			config,
			projectConfigModule.ProjectConfig.generateTimestamp(),
			undefined,
		);

		return projectConfigModule.ProjectConfig.serialize(projectConfig);
	}
}
