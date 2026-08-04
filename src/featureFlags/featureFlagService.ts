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
	WelcomeTitleVariant = 'glensWelcomeTitleVariant',
}
export type FeatureFlagMap = Readonly<Partial<Record<FeatureFlagKey, FeatureFlagValue>>>;
export interface FeatureFlagService {
	dispose(): void;
	getFlag<T extends FeatureFlagValue>(key: FeatureFlagKey, defaultValue: T): T;
	getAllFlags(): FeatureFlagMap;
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
	private readonly _flags: FeatureFlagMap;

	constructor(private readonly container: Container) {
		this._flags = Object.freeze(this.container.storage.get('featureFlags:flags') ?? {});

		// Fire background fetch to evaluate flags and store them for the NEXT activation
		void this.fetchAndCacheFlags();
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
	 * and stores the resolved flag map in globalState for the next activation.
	 * Fire-and-forget — errors are logged but never propagated.
	 */
	private async fetchAndCacheFlags(): Promise<void> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.fetchAndCacheFlags`);

		try {
			const response = await fetch(this.container.urls.getGkApiUrl('feature-flags', 'config'), {
				// This fetch bypasses ServerConnection (unauthenticated, fire-and-forget), so set the shared
				// User-Agent explicitly — otherwise Node's built-in fetch defaults to `node` and the request is
				// unattributable server-side.
				headers: { Accept: 'application/json', 'User-Agent': this.container.userAgent },
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
				await this.container.storage.store('featureFlags:flags', flags);
			}
		} catch (ex) {
			Logger.debug(ex, scope, 'Failed to fetch and cache feature flags');
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
