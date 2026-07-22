// Minimal `IntegrationServiceContext` implementation for unit tests.
//
// Every method either returns a sensible default, throws "not implemented"
// (for surfaces a given test won't exercise), or records the call for later
// assertion. Tests opt in to richer behavior by overriding fields after
// construction — the typical pattern is:
//
//   const runtime = createFakeRuntime();
//   runtime.subscription.isPro = async () => true;
//   const manager = createIntegrationManager(runtime);
//
// This file lives in the package's own __tests__/ tree so tests are
// runtime-pure (no VS Code, no `Container`).

import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type {
	AccountProvider,
	AuthenticationSessionsChangeEvent,
	ConfigChangeEvent,
	ConfigProvider,
	HttpProvider,
	IntegrationCacheProvider,
	IntegrationServiceContext,
	IntegrationServiceHooks,
	IntegrationStorageProvider,
	RepositoriesProvider,
} from '../context.js';

export interface FakeRuntime extends IntegrationServiceContext {
	/** Captured telemetry-hook invocations for assertion. */
	readonly emittedEvents: Array<{ event: string; props?: Record<string, unknown>; source?: unknown }>;
	/** Manual trigger for `subscription.onDidChange`. */
	fireSubscriptionChange(): void;
	/** Manual trigger for `subscription.onDidCheckIn`. */
	fireSubscriptionCheckIn(force?: boolean): void;
	/** Manual trigger for `authentication.onDidChangeSessions`. */
	fireAuthenticationSessionChange(providerId: string): void;
	/** Manual trigger for `config.onDidChange`. */
	fireConfigChange(change: ConfigChangeEvent): void;
}

export function createFakeRuntime(): FakeRuntime {
	const emittedEvents: FakeRuntime['emittedEvents'] = [];

	const subOnChange = new Emitter<void>();
	const subOnCheckIn = new Emitter<{ force?: boolean }>();
	const authOnChange = new Emitter<AuthenticationSessionsChangeEvent>();
	const configOnChange = new Emitter<ConfigChangeEvent>();

	const storage = new Map<string, unknown>();
	const workspaceStorage = new Map<string, unknown>();
	const secrets = new Map<string, string>();
	const issueCache = new Map<string, unknown>();
	const currentAccountCache = new Map<string, { etag: string | undefined; value: unknown }>();

	const storageProvider: IntegrationStorageProvider = {
		get: <T>(key: string) => storage.get(key) as T | undefined,
		store: async <T>(key: string, value: T) => {
			storage.set(key, value);
		},
		delete: async (key: string) => {
			storage.delete(key);
		},
		deleteWithPrefix: async (prefix: string) => {
			for (const key of storage.keys()) {
				if (key.startsWith(prefix)) {
					storage.delete(key);
				}
			}
		},
		getWorkspace: <T>(key: string) => workspaceStorage.get(key) as T | undefined,
		storeWorkspace: async <T>(key: string, value: T) => {
			workspaceStorage.set(key, value);
		},
		deleteWorkspace: async (key: string) => {
			workspaceStorage.delete(key);
		},
		getSecret: async (key: string) => secrets.get(key),
		storeSecret: async (key: string, value: string) => {
			secrets.set(key, value);
		},
		deleteSecret: async (key: string) => {
			secrets.delete(key);
		},
	};

	const account: AccountProvider = {
		getAccount: async () => undefined,
		onDidChange: subOnChange.event,
		onDidCheckIn: subOnCheckIn.event,
		onDidChangeSessions: authOnChange.event,
		isTrialOrPaid: async () => false,
		fetchGkApi: () => {
			throw new Error('FakeRuntime.account.fetchGkApi: not implemented in test');
		},
		connect: async () => false,
		openManagement: async () => false,
	};

	const config: ConfigProvider = {
		isIntegrationsEnabled: () => true,
		getLaunchpadOptions: () => ({}),
		getRemoteConfigs: () => [],
		onDidChange: configOnChange.event,
	};

	const http: HttpProvider = {
		isWeb: false,
		userAgent: 'FakeClient/0.0.0 (FakeApp/1.0.0; test-x64)',
		fetch: () => {
			throw new Error('FakeRuntime.http.fetch: not implemented in test');
		},
		wrapForForcedInsecureSSL: (_, fn) => Promise.resolve(fn()),
	};

	const cache: IntegrationCacheProvider = {
		getRepositoryMetadata: undefined as never,
		getRepositoryDefaultBranch: undefined as never,
		getPullRequestForSha: undefined as never,
		getPullRequestForBranch: undefined as never,
		getPullRequest: () => {
			throw new Error('FakeRuntime.cache.getPullRequest: not implemented in test');
		},
		getIssueOrPullRequest: undefined as never,
		getIssue: (id, resource, integration, cacheable) => {
			const key = `${integration?.id ?? 'none'}:${integration?.domain ?? 'none'}:${id}:${JSON.stringify(resource)}`;
			const cached = issueCache.get(key);
			if (cached != null) {
				return cached as ReturnType<typeof cacheable>['value'];
			}

			const entry = cacheable({ invalidate: () => issueCache.delete(key) } as never).value;
			issueCache.set(key, entry);
			void Promise.resolve(entry).catch(() => issueCache.delete(key));
			return entry;
		},
		getCurrentAccount: (integration, cacheable, options) => {
			const key = `${integration.id}:${integration.domain}:${options?.connectionId ?? ''}`;
			const cached = currentAccountCache.get(key);
			if (cached != null && cached.etag === options?.etag) {
				return cached.value as ReturnType<typeof cacheable>['value'];
			}

			const entry = cacheable({ invalidate: () => currentAccountCache.delete(key) } as never).value;
			currentAccountCache.set(key, { etag: options?.etag, value: entry });
			void Promise.resolve(entry).catch(() => currentAccountCache.delete(key));
			return entry;
		},
	};

	const repositories: RepositoriesProvider = { getOpenRemotes: async () => [] };

	// Capture telemetry-hook invocations under stable event names for assertions.
	const hooks: IntegrationServiceHooks = {
		connection: {
			onStarted: (e, source) =>
				emittedEvents.push({ event: 'integration.connection.started', props: { ...e }, source: source }),
			onCompleted: (e, source) =>
				emittedEvents.push({ event: 'integration.connection.completed', props: { ...e }, source: source }),
			onManaged: source =>
				emittedEvents.push({ event: 'integration.connection.settings.opened', source: source }),
			onStateChanged: e =>
				emittedEvents.push({ event: `integration.connection.${e.kind}.changed`, props: { ...e } }),
			onConnectionsFetchFailed: e =>
				emittedEvents.push({ event: 'integration.connections.fetch.failed', props: { ...e } }),
			onConnectionFetchFailed: e =>
				emittedEvents.push({ event: 'integration.connection.fetch.failed', props: { ...e } }),
			onDisconnectFailed: e =>
				emittedEvents.push({ event: 'integration.connection.disconnect.failed', props: { ...e } }),
			onConnectedChanged: e =>
				emittedEvents.push({ event: 'integration.connection.count.changed', props: { ...e } }),
		},
		session: {
			onRefreshSkipped: e =>
				emittedEvents.push({ event: 'integration.session.refresh.skipped', props: { ...e } }),
		},
	};

	return {
		storage: storageProvider,
		account: account,
		config: config,
		http: http,
		cache: cache,
		repositories: repositories,
		hooks: hooks,
		emittedEvents: emittedEvents,
		fireSubscriptionChange: () => subOnChange.fire(),
		fireSubscriptionCheckIn: (force?: boolean) => subOnCheckIn.fire({ force: force }),
		fireAuthenticationSessionChange: (providerId: string) => authOnChange.fire({ provider: { id: providerId } }),
		fireConfigChange: (change: ConfigChangeEvent) => configOnChange.fire(change),
	};
}
