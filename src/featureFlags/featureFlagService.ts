import type { deserializeConfig, IConfigCatCache, IConfigCatClient, SettingTypeOf } from '@configcat/sdk';
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
	WelcomeTitle = 'glensWelcomeTitle',
}
export type FeatureFlagMap = Partial<Record<FeatureFlagKey, FeatureFlagValue>>;
export interface FeatureFlagService {
	dispose(): void;
	getFlag<T extends FeatureFlagValue>(key: FeatureFlagKey, defaultValue: T): Promise<FeatureFlagValue>;
	getAllFlags(): Promise<FeatureFlagMap>;
}

const _featureFlagKeys: ReadonlySet<string> = new Set<FeatureFlagKey>(Object.values(FeatureFlagKey));
export function isFeatureFlagKey(key: string): key is FeatureFlagKey {
	return _featureFlagKeys.has(key);
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
	private readonly _client: Promise<IConfigCatClient | undefined>;

	constructor(private readonly container: Container) {
		this._client = this.loadClient();
	}

	dispose(): void {
		void this._client.then(
			client => {
				client?.dispose();
			},
			() => {},
		);
	}

	async getFlag<T extends FeatureFlagValue>(key: FeatureFlagKey, defaultValue: T): Promise<SettingTypeOf<T> | T> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.getFlag`);

		const client = await this._client;
		if (client == null) return defaultValue;

		try {
			const details = await client.getValueDetailsAsync<T>(key, defaultValue);
			return details.value;
		} catch (ex) {
			Logger.debug(ex, scope, `Failed to evaluate feature flag '${key}'; return default value`);
			return defaultValue;
		}
	}

	async getAllFlags(): Promise<FeatureFlagMap> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.getAllFlags`);

		const client = await this._client;
		if (client == null) return {};

		try {
			const values = await client.getAllValuesAsync();
			const flags: FeatureFlagMap = {};

			for (const { settingKey, settingValue } of values) {
				if (
					isFeatureFlagKey(settingKey) &&
					(typeof settingValue === 'boolean' ||
						typeof settingValue === 'number' ||
						typeof settingValue === 'string')
				) {
					flags[settingKey] = settingValue;
				}
			}

			return flags;
		} catch (ex) {
			Logger.debug(ex, scope, 'Failed to evaluate feature flags; returning no flags');
			return {};
		}
	}

	private async loadClient(): Promise<IConfigCatClient | undefined> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.loadClient`);

		try {
			const response = await fetch(this.container.urls.getGkApiUrl('feature-flags', 'config'), {
				headers: { Accept: 'application/json' },
			});

			if (!response.ok) {
				Logger.debug(
					scope,
					`Failed to fetch feature flags config (${response.status} ${response.statusText}); using defaults`,
				);
				return undefined;
			}

			const configJson = await response.text();
			if (!configJson) {
				Logger.debug(scope, 'Feature flags config response was empty; using defaults');
				return undefined;
			}

			return await this.createClient(configJson);
		} catch (ex) {
			Logger.debug(ex, scope, 'Failed to fetch feature flags config; using defaults');
			return undefined;
		}
	}

	private async createClient(configJson: string): Promise<IConfigCatClient | undefined> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.createClient`);

		const [sdkResult, projectConfigResult] = await Promise.allSettled([
			import(/* webpackChunkName: "feature-flags" */ '@configcat/sdk'),
			import(/* webpackChunkName: "feature-flags" */ '@configcat/sdk/lib/esm/ProjectConfig.js'),
		]);

		const sdk = getSettledValue(sdkResult);
		const projectConfigModule = getSettledValue(projectConfigResult);

		if (sdk == null || projectConfigModule == null) {
			Logger.debug(scope, 'Failed to load ConfigCat SDK modules; using defaults');
			return undefined;
		}

		try {
			const cache = new PrefetchedConfigCache(
				this.serializeProjectConfig(configJson, sdk.deserializeConfig, projectConfigModule),
			);
			const client = sdk.getClient(localSdkKey, sdk.PollingMode.ManualPoll, {
				cache: cache,
				defaultUser: { identifier: vscodeEnv.machineId, country: 'ES' },
				offline: true,
			});

			await client.waitForReady();
			await client.forceRefreshAsync();
			return client;
		} catch (ex) {
			Logger.debug(ex, scope, 'Failed to initialize ConfigCat feature flag client; using defaults');
			return undefined;
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
