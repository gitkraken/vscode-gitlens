/**
 * Config service — access GitLens configuration, VS Code core settings,
 * and change events.
 */

import { ConfigurationTarget } from 'vscode';
import type {
	ConfigPath,
	ConfigPathValue,
	CoreConfigPath,
	CoreConfigPathValue,
} from '../../../system/-webview/configuration.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createEventSubscription } from '../eventVisibilityBuffer.js';
import type { EventSubscriber } from './types.js';

export class WebviewConfigService {
	/**
	 * Fired when GitLens configuration changes.
	 * Pure signal — handler should re-fetch relevant config as needed.
	 */
	readonly onConfigChanged: EventSubscriber<undefined>;

	constructor(buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.onConfigChanged = createEventSubscription<undefined>(
			buffer,
			'configChanged',
			'signal',
			buffered => configuration.onDidChange(() => buffered(undefined)),
			undefined,
			tracker,
		);
	}

	/**
	 * Get a GitLens configuration value by dot path (e.g., 'views.commitDetails.autolinks.enabled').
	 */
	get<T extends ConfigPath>(key: T): Promise<ConfigPathValue<T>> {
		return Promise.resolve(configuration.get(key));
	}

	/**
	 * Get multiple GitLens configuration values in a single RPC call.
	 * Returns a tuple of values matching the order of the keys.
	 */
	getMany<const T extends readonly ConfigPath[]>(
		...keys: T
	): Promise<{ [K in keyof T]: ConfigPathValue<T[K] & ConfigPath> }> {
		return Promise.resolve(
			keys.map(key => configuration.get(key)) as unknown as {
				[K in keyof T]: ConfigPathValue<T[K] & ConfigPath>;
			},
		);
	}

	/**
	 * Get a VS Code core configuration value (e.g., 'workbench.tree.renderIndentGuides').
	 */
	getCore<T extends CoreConfigPath>(key: T): Promise<CoreConfigPathValue<T> | undefined> {
		return Promise.resolve(configuration.getCore(key));
	}

	/**
	 * Get multiple VS Code core configuration values in a single RPC call.
	 * Returns a tuple of values matching the order of the keys.
	 */
	getManyCore<const T extends readonly CoreConfigPath[]>(
		...keys: T
	): Promise<{
		[K in keyof T]: CoreConfigPathValue<T[K] & CoreConfigPath> | undefined;
	}> {
		return Promise.resolve(
			keys.map(key => configuration.getCore(key)) as unknown as {
				[K in keyof T]: CoreConfigPathValue<T[K] & CoreConfigPath> | undefined;
			},
		);
	}

	/**
	 * Update a GitLens configuration value by dot path.
	 */
	async update<T extends ConfigPath>(key: T, value: ConfigPathValue<T>): Promise<void> {
		await configuration.update(key, value, ConfigurationTarget.Global);
	}
}
