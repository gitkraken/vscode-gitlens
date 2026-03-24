import { env as vscodeEnv, workspace } from 'vscode';
import { fetch } from '@env/fetch.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../container.js';

type ConfigCatModule = typeof import('@configcat/sdk');
type ConfigCatClient = import('@configcat/sdk').IConfigCatClient;
type ConfigCatCache = import('@configcat/sdk').IConfigCatCache;
type FeatureFlagProjectConfigModule = typeof import('@configcat/sdk/lib/esm/ProjectConfig.js');

export type FeatureFlagValue = boolean | string | number;

type FeatureFlagMap = Record<string, FeatureFlagValue>;

const localSdkKey = 'configcat-sdk-1/0000000000000000000000/0000000000000000000000';

class PrefetchedConfigCache implements ConfigCatCache {
	constructor(private serializedConfig: string | undefined) {}

	get(_key: string): string | undefined {
		return this.serializedConfig;
	}

	set(_key: string, value: string): void {
		this.serializedConfig = value;
	}
}

export class FeatureFlagService {
	private readonly _client: Promise<ConfigCatClient | undefined>;

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

	async getFlag<T extends FeatureFlagValue>(key: string, defaultValue: T): Promise<T> {
		const client = await this._client;
		if (client == null) return defaultValue;

		try {
			const details = await client.getValueDetailsAsync(key, defaultValue);
			Logger.warn(
				`[FeatureFlagService] Flag '${key}': value=${String(details.value)}, isDefaultValue=${String(details.isDefaultValue)}, matchedRule=${JSON.stringify(details.matchedTargetingRule)}, matchedPercentage=${JSON.stringify(details.matchedPercentageOption)}, user=${JSON.stringify(details.user)}`,
			);
			return details.value as T;
		} catch (ex) {
			Logger.warn(ex, `Failed to evaluate feature flag '${key}'; using default value`);
			return defaultValue;
		}
	}

	async getAllFlags(): Promise<FeatureFlagMap> {
		const client = await this._client;
		if (client == null) return {};

		try {
			const values = await client.getAllValuesAsync();
			const flags: FeatureFlagMap = {};

			for (const { settingKey, settingValue } of values) {
				if (
					typeof settingValue === 'boolean' ||
					typeof settingValue === 'number' ||
					typeof settingValue === 'string'
				) {
					flags[settingKey] = settingValue;
				}
			}

			return flags;
		} catch (ex) {
			Logger.warn(ex, 'Failed to evaluate feature flags; returning no flags');
			return {};
		}
	}

	private async loadClient(): Promise<ConfigCatClient | undefined> {
		using scope = maybeStartScopedLogger(`${getLoggableName(this)}.loadClient`);

		try {
			const response = await fetch(this.container.urls.getGkApiUrl('feature-flags', 'config'), {
				headers: { Accept: 'application/json' },
			});

			if (!response.ok) {
				Logger.warn(
					scope,
					`Failed to fetch feature flags config (${response.status} ${response.statusText}); using defaults`,
				);
				return undefined;
			}

			const configJson = await response.text();
			if (!configJson) {
				Logger.warn(scope, 'Feature flags config response was empty; using defaults');
				return undefined;
			}

			return await this.createClient(configJson);
		} catch (ex) {
			Logger.warn(ex, scope, 'Failed to fetch feature flags config; using defaults');
			return undefined;
		}
	}

	private async createClient(configJson: string): Promise<ConfigCatClient | undefined> {
		const [sdk, projectConfigModule] = await Promise.all([
			import(/* webpackChunkName: "feature-flags" */ '@configcat/sdk'),
			import(/* webpackChunkName: "feature-flags" */ '@configcat/sdk/lib/esm/ProjectConfig.js'),
		]);

		try {
			Logger.warn(`[FeatureFlagService] container.env: "${this.container.env}"`);
			Logger.warn(`[FeatureFlagService] container.debugging: ${String(this.container.debugging)}`);
			Logger.warn(
				`[FeatureFlagService] container.prereleaseOrDebugging: ${String(this.container.prereleaseOrDebugging)}`,
			);
			Logger.warn(
				`[FeatureFlagService] gitkraken.env setting: "${String(workspace.getConfiguration().get('gitkraken.env') ?? 'N/A')}"`,
			);
			Logger.warn(`[FeatureFlagService] machineId identifier: "${vscodeEnv.machineId}"`);
			Logger.warn(`[FeatureFlagService] configJson: ${configJson}`);

			const cache = new PrefetchedConfigCache(this.serializeProjectConfig(configJson, sdk, projectConfigModule));
			const client = sdk.getClient(localSdkKey, sdk.PollingMode.ManualPoll, {
				cache: cache,
				defaultUser: { identifier: vscodeEnv.machineId, country: 'ES' },
				offline: true,
			});

			await client.waitForReady();
			await client.forceRefreshAsync();

			// Temporary: dump all flag evaluation details to verify targeting
			const allDetails = await client.getAllValueDetailsAsync();
			for (const detail of allDetails) {
				if (detail.matchedTargetingRule != null) {
					Logger.warn(
						`[FeatureFlagService] Flag '${detail.key}': value=${String(detail.value)}, isDefault=${String(detail.isDefaultValue)}, matchedRule=${JSON.stringify(detail.matchedTargetingRule)}, user=${JSON.stringify(detail.user)}`,
					);
				}
			}

			return client;
		} catch (ex) {
			Logger.warn(ex, 'Failed to initialize ConfigCat feature flag client; using defaults');
			return undefined;
		}
	}

	private serializeProjectConfig(
		configJson: string,
		sdk: ConfigCatModule,
		projectConfigModule: FeatureFlagProjectConfigModule,
	): string {
		const config = sdk.deserializeConfig(configJson);
		const projectConfig = new projectConfigModule.ProjectConfig(
			configJson,
			config,
			projectConfigModule.ProjectConfig.generateTimestamp(),
			undefined,
		);

		return projectConfigModule.ProjectConfig.serialize(projectConfig);
	}
}
