import type { Disposable as VsCodeDisposable } from 'vscode';
import { env, version, window } from 'vscode';
import { fetch as envFetch, wrapForForcedInsecureSSL } from '@env/fetch.js';
import { getPlatform, isWeb } from '@env/platform.js';
import type {
	ConfigChangeEvent,
	ConfigProvider,
	HttpProvider,
	IntegrationServiceContext,
	IntegrationServiceHooks,
	IntegrationsRemoteConfig,
	IntegrationStorageProvider,
} from '@gitlens/integrations/context.js';
import { Emitter } from '@gitlens/utils/event.js';
import { flatSettled } from '@gitlens/utils/promise.js';
import type { Source as TelemetrySource } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import {
	showBitbucketPRCommitLinksAppNotInstalledWarningMessage,
	showIntegrationDisconnectedTooManyFailedRequestsWarningMessage,
	showIntegrationRequestFailed500WarningMessage,
	showIntegrationRequestTimedOutWarningMessage,
} from '../../../messages.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { ServerConnection } from '../../gk/serverConnection.js';
import { createAccountAdapter } from './gkDevFlows.js';

/**
 * Builds an {@link IntegrationServiceContext} from the host's `Container`.
 *
 * Lives outside the eventual `@gitlens/integrations` package — it is the
 * vscode-bound adapter the host wires up at construction time so the
 * package itself stays vscode-free. Mirrors the pattern in `@gitlens/git`
 * where `GitProviderService` constructs a `GitServiceContext` from VS Code
 * primitives and passes it into the standalone library.
 *
 * Returned context implements {@link Disposable}; `dispose()` releases every
 * VS Code event subscription and `Emitter` the adapters wired up. The host
 * MUST dispose this when tearing down the integration service.
 */
export function createIntegrationServiceContext(
	container: Container,
	connection: ServerConnection,
): IntegrationServiceContext & VsCodeDisposable {
	const disposables: VsCodeDisposable[] = [];
	const ctx: IntegrationServiceContext = {
		storage: createStorageAdapter(container),
		account: createAccountAdapter(container, connection, disposables),
		config: createConfigAdapter(disposables),
		http: createHttpAdapter(container),
		cache: container.cache,
		repositories: {
			// Flatten the open repos to their remotes here — the package only maps remotes to integrations.
			// `container.git` is read lazily (called at query time, well after this context is constructed).
			getOpenRemotes: () => flatSettled(container.git.openRepositories.map(r => r.git.remotes.getRemotes())),
		},
		hooks: createIntegrationServiceHooks(container),
	};
	return Object.assign(ctx, {
		dispose: function (): void {
			for (const d of disposables.splice(0)) {
				try {
					d.dispose();
				} catch {
					/* swallow per VS Code disposal convention */
				}
			}
		},
	});
}

function createHttpAdapter(container: Container): HttpProvider {
	const clientName = container.debugging ? 'GitLens-Debug' : container.prerelease ? 'GitLens-Pre' : 'GitLens';
	return {
		isWeb: isWeb,
		userAgent: `${clientName}/${container.version} (${env.appName}/${version}; ${getPlatform()})`,
		fetch: envFetch,
		wrapForForcedInsecureSSL: wrapForForcedInsecureSSL,
	};
}

function createConfigAdapter(disposables: VsCodeDisposable[]): ConfigProvider {
	const onDidChange = new Emitter<ConfigChangeEvent>();
	disposables.push(onDidChange);
	disposables.push(
		configuration.onDidChangeAny(e => {
			onDidChange.fire({
				remotes: configuration.changed(e, 'remotes'),
				integrationsEnabled: configuration.changed(e, 'integrations.enabled'),
				launchpad:
					configuration.changed(e, 'launchpad.experimental.queryLimit') ||
					configuration.changed(e, 'launchpad.ignoredRepositories') ||
					configuration.changed(e, 'launchpad.includedOrganizations') ||
					configuration.changed(e, 'launchpad.ignoredOrganizations'),
				httpProxy: configuration.changedCore(e, ['http.proxy', 'http.proxyStrictSSL']),
			});
		}),
	);

	return {
		isIntegrationsEnabled: () => configuration.get('integrations.enabled', undefined, true),
		getLaunchpadOptions: () => ({
			queryLimit: configuration.get('launchpad.experimental.queryLimit'),
			ignoredRepositories: configuration.get('launchpad.ignoredRepositories'),
			includedOrganizations: configuration.get('launchpad.includedOrganizations'),
			ignoredOrganizations: configuration.get('launchpad.ignoredOrganizations'),
		}),
		getRemoteConfigs: (): readonly IntegrationsRemoteConfig[] =>
			(configuration.get('remotes') ?? [])
				.filter(r => r.domain != null)
				.map(r => ({
					type: r.type,
					domain: r.domain,
					ignoreSSLErrors: r.ignoreSSLErrors,
				})),
		onDidChange: onDidChange.event,
	};
}

function createStorageAdapter(container: Container): IntegrationStorageProvider {
	// The host's `Storage` class uses key-mapping types for compile-time
	// validation; the package owns its own keys, so cast to `never`.
	return {
		get: <T>(key: string) => container.storage.get(key as never) as T | undefined,
		store: <T>(key: string, value: T) => container.storage.store(key as never, value as never),
		delete: (key: string) => container.storage.delete(key as never),
		deleteWithPrefix: (prefix: string) => container.storage.deleteWithPrefix(prefix as never),
		getWorkspace: <T>(key: string) => container.storage.getWorkspace(key as never) as T | undefined,
		storeWorkspace: <T>(key: string, value: T) => container.storage.storeWorkspace(key as never, value as never),
		deleteWorkspace: (key: string) => container.storage.deleteWorkspace(key as never),
		// The package emits un-prefixed secret keys (`integration.auth[.cloud]:…`); GitLens owns the
		// `gitlens.` SecretStorage namespace, so re-prepend it here. Keeps stored keys byte-identical to
		// pre-extraction (no orphaned tokens on upgrade) while the package stays prefix-agnostic.
		getSecret: (key: string) => container.storage.getSecret(`gitlens.${key}` as never),
		storeSecret: (key: string, value: string) => container.storage.storeSecret(`gitlens.${key}` as never, value),
		deleteSecret: (key: string) => container.storage.deleteSecret(`gitlens.${key}` as never),
	};
}

function createIntegrationServiceHooks(container: Container): IntegrationServiceHooks {
	return {
		onReauthenticationRequired: async message => {
			const confirm = { title: 'Reauthenticate' };
			return (await window.showErrorMessage(message, confirm)) === confirm;
		},

		onConfirmDisconnect: async ({ integrationName, offerSignOut }) => {
			const disable = { title: 'Disable' };
			const disableAndSignOut = { title: 'Disable & Sign Out' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				offerSignOut
					? `Are you sure you want to disable the rich integration with ${integrationName}?\n\nNote: signing out clears the saved authentication.`
					: `Are you sure you want to disable the rich integration with ${integrationName}?`,
				{ modal: true },
				...(offerSignOut ? [disable, disableAndSignOut, cancel] : [disable, cancel]),
			);
			if (result == null || result === cancel) return undefined;

			return { signOut: result === disableAndSignOut };
		},

		// Behavioral domain events — map the package's typed events to GitLens's `cloudIntegrations/*` telemetry schema.
		// The package never names these event ids; this is the only place the mapping lives. The
		// `source` cast narrows the package's widened `Source` to the host's enumerated `Source`.
		connection: {
			onStarted: ({ integrationIds }, source) =>
				container.telemetry.sendEvent(
					'cloudIntegrations/connecting',
					{ 'integration.ids': integrationIds?.join(',') },
					source as TelemetrySource | undefined,
				),
			onCompleted: ({ integrationIds, connectedIntegrationIds }, source) =>
				container.telemetry.sendEvent(
					'cloudIntegrations/connected',
					{
						'integration.ids': integrationIds?.join(','),
						'integration.connected.ids': connectedIntegrationIds?.join(','),
					},
					source as TelemetrySource | undefined,
				),
			onManaged: source =>
				container.telemetry.sendEvent(
					'cloudIntegrations/settingsOpened',
					{ 'integration.id': undefined },
					source as TelemetrySource | undefined,
				),
			onStateChanged: ({ id, key, connected, kind }) => {
				switch (kind) {
					case 'hosting':
						container.telemetry.sendEvent(
							connected
								? 'cloudIntegrations/hosting/connected'
								: 'cloudIntegrations/hosting/disconnected',
							{ 'hostingProvider.provider': id, 'hostingProvider.key': key },
						);
						break;
					case 'remote':
						container.telemetry.sendEvent(
							connected ? 'remoteProviders/connected' : 'remoteProviders/disconnected',
							{
								'hostingProvider.provider': id,
								'hostingProvider.key': key,
								// Deprecated
								'remoteProviders.key': key,
							},
						);
						break;
					case 'issue':
						container.telemetry.sendEvent(
							connected ? 'cloudIntegrations/issue/connected' : 'cloudIntegrations/issue/disconnected',
							{ 'issueProvider.provider': id, 'issueProvider.key': key },
						);
						break;
				}
			},
			onConnectionsFetchFailed: ({ code }) =>
				container.telemetry.sendEvent('cloudIntegrations/getConnections/failed', { code: code }),
			onConnectionFetchFailed: ({ id, code, refreshing }) =>
				container.telemetry.sendEvent(
					refreshing
						? 'cloudIntegrations/refreshConnection/failed'
						: 'cloudIntegrations/getConnection/failed',
					{ code: code, 'integration.id': id },
				),
			onDisconnectFailed: ({ id, code }) =>
				container.telemetry.sendEvent('cloudIntegrations/disconnect/failed', {
					code: code,
					'integration.id': id,
				}),
			onConnectedChanged: ({ integrationIds }) => {
				// Match main: only mutate global telemetry attributes when telemetry is enabled.
				if (!container.telemetry.enabled) return;

				container.telemetry.setGlobalAttributes({
					'cloudIntegrations.connected.count': integrationIds.length,
					'cloudIntegrations.connected.ids': integrationIds.join(','),
				});
			},
		},
		session: {
			onRefreshSkipped: ({ id, reason, cloud }) =>
				container.telemetry.sendEvent('cloudIntegrations/refreshConnection/skippedUnusualToken', {
					'integration.id': id,
					reason: reason,
					cloud: cloud,
				}),
		},

		// User-facing notifications the package raises; the host renders them via the shared message helpers.
		ui: {
			onError: message => void window.showErrorMessage(message),
			onRequestFailed: message => void showIntegrationRequestFailed500WarningMessage(message),
			onRequestTimedOut: name => void showIntegrationRequestTimedOutWarningMessage(name),
			onDisconnectedAfterTooManyFailures: name =>
				void showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(name),
			onBitbucketCommitLinksAppMissing: revLink =>
				void showBitbucketPRCommitLinksAppNotInstalledWarningMessage(revLink),
		},
	};
}
