import { computed } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { IssuesCloudHostIntegrationId } from '@gitlens/integrations/constants.js';
import type { Config } from '../../../config.js';
import type { Subscription } from '../../../plus/gk/models/subscription.js';
import type { AiModelInfo, AIState, IntegrationStateInfo } from '../../rpc/services/types.js';
import type { SettingsScope } from '../../settings/settingsService.js';
import type { HostStorage } from '../shared/host/storage.js';
import { createStateGroup } from '../shared/state/signals.js';
import { settingsCategories } from './categories/index.js';
import type { SettingsSearchMatch } from './model.js';
import { getPath, searchSettings } from './model.js';

/**
 * Creates a new Settings state instance with all signals initialized to defaults.
 * Called by the root component; the returned object is passed to actions as a parameter.
 *
 * The config snapshot is host-owned (refreshed via `settings.onConfigChanged`);
 * everything else is webview-owned UI state.
 */
export function createSettingsState(storage?: HostStorage) {
	const { signal, persisted, resetAll, startAutoPersist, dispose } = createStateGroup({
		storage: storage,
		version: 1,
	});

	// Persisted UI — `retainContextWhenHidden` is off, so a tab-away rebuilds the
	// webview; everything a user would notice resetting mid-session lives here
	const selectedCategoryId = persisted<string>('selectedCategoryId', 'current-line');
	/** Nav rail share of the split panel, as a percentage (0–100) — wide enough that
	 * the longest category names (with a Pro badge + count) don't clip by default */
	const navPosition = persisted<number>('navPosition', 23);
	/** Write scope — silently snapping back to 'user' on tab-away would misroute writes */
	const scope = persisted<'user' | 'workspace'>('scope', 'user');
	const query = persisted<string>('query', '');

	// Host-pushed domain data
	const config = signal<Config | undefined>(undefined);
	const customSettings = signal<Record<string, boolean>>({});
	const version = signal<string>('');
	const scopes = signal<SettingsScope[]>([['user', 'User']]);

	// Shared-service domain data (subscription/integrations/ai) — `undefined`
	// means not yet loaded, so panels can show skeletons instead of empty states
	const subscription = signal<Subscription | undefined>(undefined);
	const cloudIntegrations = signal<IntegrationStateInfo[] | undefined>(undefined);
	const aiState = signal<AIState | undefined>(undefined);
	const aiModel = signal<AiModelInfo | undefined>(undefined);
	/** Shared-service fetch failures, so panels can show an error + retry instead of a forever-skeleton */
	const serviceErrors = signal<{ subscription: boolean; integrations: boolean; ai: boolean }>({
		subscription: false,
		integrations: false,
		ai: false,
	});

	// Ephemeral UI
	/**
	 * Setting key targeted by a deep-link anchor, highlighted until the next
	 * navigation/search; the nonce makes re-requesting the same anchor re-scroll.
	 */
	const anchorKey = signal<{ key: string; nonce: number } | undefined>(undefined);

	// Infrastructure
	const loading = signal<boolean>(true);
	const error = signal<string | undefined>(undefined);

	// Derived
	const searchResults = computed<SettingsSearchMatch[]>(() =>
		searchSettings(settingsCategories, query.get(), getSettingValue),
	);

	const selectedCategory = computed(() => {
		const id = selectedCategoryId.get();
		return settingsCategories.find(c => c.id === id) ?? settingsCategories[0];
	});

	/**
	 * Control keys to highlight in the selected category — the key targeted by
	 * a deep-link anchor when one is active, else the active search's matches.
	 */
	const highlightedKeys = computed<string[]>(() => {
		const anchor = anchorKey.get();
		if (anchor != null) return [anchor.key];

		if (!query.get()) return [];

		const match = searchResults.get().find(m => m.category.id === selectedCategoryId.get());
		return match?.matchedKeys ?? [];
	});

	const hasAccount = computed<boolean>(() => subscription.get()?.account != null);

	const isIntegrationConnected = (id: IssuesCloudHostIntegrationId) =>
		cloudIntegrations.get()?.some(i => i.id === id && i.connected) ?? false;

	/** Issue-integration connection cues for the Autolinks banner. */
	const hasConnectedJira = computed<boolean>(() => isIntegrationConnected(IssuesCloudHostIntegrationId.Jira));
	const hasConnectedLinear = computed<boolean>(() => isIntegrationConnected(IssuesCloudHostIntegrationId.Linear));

	/**
	 * Resolves a setting path to its current value — customSettings first
	 * (only when non-null, so custom keys shadow config paths), then nested config.
	 */
	function getSettingValue<T>(path: string): T | undefined {
		const custom = customSettings.get()[path];
		if (custom != null) return custom as unknown as T;

		const c = config.get();
		if (c == null) return undefined;
		return getPath<T>(c, path);
	}

	return {
		// Persisted
		selectedCategoryId: selectedCategoryId,
		navPosition: navPosition,
		scope: scope,
		query: query,

		// Host-pushed
		config: config,
		customSettings: customSettings,
		version: version,
		scopes: scopes,

		// Shared services
		subscription: subscription,
		cloudIntegrations: cloudIntegrations,
		aiState: aiState,
		aiModel: aiModel,
		serviceErrors: serviceErrors,

		// Ephemeral UI
		anchorKey: anchorKey,

		// Infrastructure
		loading: loading,
		error: error,

		// Derived (read-only)
		searchResults: searchResults,
		selectedCategory: selectedCategory,
		highlightedKeys: highlightedKeys,
		hasAccount: hasAccount,
		hasConnectedJira: hasConnectedJira,
		hasConnectedLinear: hasConnectedLinear,

		// Helpers
		getSettingValue: getSettingValue,

		// Lifecycle
		resetAll: resetAll,
		startAutoPersist: startAutoPersist,
		dispose: dispose,
	};
}

/** Settings state type — the return value of `createSettingsState()`. */
export type SettingsState = ReturnType<typeof createSettingsState>;

export const settingsStateContext = createContext<SettingsState>('settingsState');
