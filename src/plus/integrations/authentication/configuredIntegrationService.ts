import type { Disposable, Event } from 'vscode';
import { EventEmitter } from 'vscode';
import type { IntegrationIds } from '../../../constants.integrations';
import { GitCloudHostIntegrationId } from '../../../constants.integrations';
import type {
	StoredConfiguredIntegrationDescriptor,
	StoredIntegrationConfigurations,
} from '../../../constants.storage';
import type { Container } from '../../../container';
import { debounce } from '../../../system/function/debounce';
import { flatten } from '../../../system/iterable';
import { getBuiltInIntegrationSession } from '../../gk/utils/-webview/integrationAuthentication.utils';
import { providersMetadata } from '../providers/models';
import { isGitSelfManagedHostIntegrationId } from '../utils/-webview/integration.utils';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthenticationProvider';
import type { ConfiguredIntegrationDescriptor, ProviderAuthenticationSession } from './models';

interface StoredSession {
	id: string;
	accessToken: string;
	account?: { label?: string; displayName?: string; id: string };
	scopes: string[];
	cloud?: boolean;
	expiresAt?: string;
	domain?: string;
	protocol?: string;
}

export interface ConfiguredIntegrationsChangeEvent {
	readonly added: readonly IntegrationIds[];
	readonly removed: readonly IntegrationIds[];
}

export class ConfiguredIntegrationService implements Disposable {
	private readonly _onDidChange = new EventEmitter<ConfiguredIntegrationsChangeEvent>();
	get onDidChange(): Event<ConfiguredIntegrationsChangeEvent> {
		return this._onDidChange.event;
	}

	constructor(private readonly container: Container) {}

	dispose(): void {
		this._onDidChange.dispose();
	}

	private _configured?: Map<IntegrationIds, ConfiguredIntegrationDescriptor[]>;
	private get configured(): Map<IntegrationIds, ConfiguredIntegrationDescriptor[]> {
		if (this._configured == null) {
			this._configured = new Map<IntegrationIds, ConfiguredIntegrationDescriptor[]>();

			const storedConfigured = this.container.storage.get('integrations:configured');
			for (const [id, configured] of Object.entries(storedConfigured ?? {}) as [
				IntegrationIds,
				StoredConfiguredIntegrationDescriptor[],
			][]) {
				if (configured == null) continue;

				const descriptors = configured.map(d => ({
					...d,
					expiresAt: d.expiresAt ? new Date(d.expiresAt) : undefined,
				}));
				this._configured.set(id, descriptors);
			}
		}

		return this._configured;
	}

	// async because we do the heavy work of checking authentication api for your vscode GitHub session
	async getConfigured(
		id?: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): Promise<ConfiguredIntegrationDescriptor[]> {
		const descriptors = this.getConfiguredLiteCore(id, options);

		if (
			(id != null && id !== GitCloudHostIntegrationId.GitHub) ||
			options?.cloud === true ||
			this.configured.get(GitCloudHostIntegrationId.GitHub)
		) {
			return descriptors;
		}

		// If we don't have a cloud config for GitHub, include a descriptor for the built-in VS Code session of GitHub even though we don't store it
		const session = await getBuiltInIntegrationSession(
			this.container,
			GitCloudHostIntegrationId.GitHub,
			{
				domain: providersMetadata[GitCloudHostIntegrationId.GitHub].domain,
				scopes: providersMetadata[GitCloudHostIntegrationId.GitHub].scopes,
			},
			{ silent: true },
		);

		if (session != null) {
			descriptors.push({
				integrationId: GitCloudHostIntegrationId.GitHub,
				domain: undefined,
				expiresAt: session.expiresAt,
				scopes: providersMetadata[GitCloudHostIntegrationId.GitHub].scopes.join(','),
				cloud: false,
			});
		}

		return descriptors;
	}

	// getConfigured without the async check for the GitHub vscode session (which forces async and is a db hit)
	getConfiguredLite(
		id: GitCloudHostIntegrationId.GitHub,
		options: { cloud: true; domain?: never },
	): ConfiguredIntegrationDescriptor[];
	getConfiguredLite(
		id: Exclude<IntegrationIds, GitCloudHostIntegrationId.GitHub>,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[];
	getConfiguredLite(
		id: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[] {
		return this.getConfiguredLiteCore(id, options);
	}

	private getConfiguredLiteCore(
		id?: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[] {
		const descriptors: ConfiguredIntegrationDescriptor[] = [];

		const configured =
			id != null
				? this.configured.get(id)
				: [...flatten<ConfiguredIntegrationDescriptor>(this.configured.values())];
		if (!configured?.length) return descriptors;

		if (options?.domain != null || options?.cloud != null) {
			for (const descriptor of configured) {
				if (
					(options?.domain != null && descriptor.domain !== options.domain) ||
					(options?.cloud === true && !descriptor.cloud) ||
					(options?.cloud === false && descriptor.cloud)
				) {
					continue;
				}

				descriptors.push(descriptor);
			}
		} else {
			descriptors.push(...configured);
		}

		return descriptors;
	}

	private async storeConfigured(): Promise<void> {
		// We need to convert the map to a record to store
		const configured: StoredIntegrationConfigurations = {} as unknown as StoredIntegrationConfigurations;
		for (const [id, descriptors] of this.configured) {
			configured[id] = descriptors.map(d => ({
				...d,
				expiresAt: d.expiresAt
					? d.expiresAt instanceof Date
						? d.expiresAt.toISOString()
						: d.expiresAt
					: undefined,
			}));
		}

		await this.container.storage.store('integrations:configured', configured);
	}

	private async addOrUpdateConfigured(descriptor: ConfiguredIntegrationDescriptor): Promise<void> {
		const descriptors = this.configured.get(descriptor.integrationId) ?? [];
		const existing = descriptors.find(
			d =>
				d.domain === descriptor.domain &&
				d.integrationId === descriptor.integrationId &&
				d.cloud === descriptor.cloud,
		);

		let changed = false;
		if (existing != null) {
			if (existing.expiresAt === descriptor.expiresAt && existing.scopes === descriptor.scopes) {
				return;
			}

			// Only fire the change event if the scopes changes (i.e. ignore any expiresAt changes)
			changed = existing.scopes !== descriptor.scopes;

			// remove the existing descriptor from the array
			descriptors.splice(descriptors.indexOf(existing), 1);
		} else {
			changed = true;
		}

		descriptors.push(descriptor);
		this.configured.set(descriptor.integrationId, descriptors);

		if (changed) {
			this.fireChange(descriptor.integrationId);
		}
		await this.storeConfigured();
	}

	private async removeConfigured(
		id: IntegrationIds,
		options: { cloud: boolean | undefined; domain: string | undefined },
	): Promise<void> {
		let changed = false;
		const descriptors = [];

		for (const d of this.configured.get(id) ?? []) {
			if (
				d.domain === options.domain &&
				(options?.cloud == null ||
					(options?.cloud === true && d.cloud === true) ||
					(options?.cloud === false && d.cloud === false))
			) {
				changed = true;
				continue;
			}

			descriptors.push(d);
		}

		this.configured.set(id, descriptors);

		if (changed) {
			this.fireChange(undefined, id);
		}

		await this.storeConfigured();
	}

	async storeSession(id: IntegrationIds, session: ProviderAuthenticationSession): Promise<void> {
		await this.writeSecret(id, session);
	}

	async getStoredSession(
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		cloud: boolean = false,
	): Promise<ProviderAuthenticationSession | undefined> {
		const sessionId = this.getSessionId(descriptor);
		let session = await this.readSecret(id, sessionId, false);
		if (!cloud) return convertStoredSessionToSession(session, descriptor, false);

		let cloudIfMissing = false;
		if (session != null) {
			// Check the `expiresAt` field
			// If it has an expiresAt property and the key is the old type, then it's a cloud session,
			// so delete it from the local key and
			// store with the "cloud" type key, and then use that one.
			// Otherwise it's a local session under the local key, so just return it.
			if (session.expiresAt != null) {
				cloudIfMissing = true;
				await Promise.allSettled([this.deleteSecrets(id, session.id), this.writeSecret(id, session)]);
			}
		}

		// If no local session we try to restore a session with the cloud key
		if (session == null) {
			cloudIfMissing = true;
			session = await this.readSecret(id, sessionId, true);
		}

		return convertStoredSessionToSession(session, descriptor, cloudIfMissing);
	}

	async deleteStoredSessions(
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		cloud?: boolean,
	): Promise<void> {
		await this.deleteSecrets(id, this.getSessionId(descriptor), cloud);
	}

	async deleteAllStoredSessions(id: IntegrationIds, cloud?: boolean): Promise<void> {
		await this.deleteAllSecrets(id, cloud);
	}

	async deleteSecrets(id: IntegrationIds, sessionId: string, cloud?: boolean): Promise<void> {
		if (cloud == null || cloud === false) {
			await this.container.storage.deleteSecret(this.getLocalSecretKey(id, sessionId));
		}

		if (cloud == null || cloud === true) {
			await this.container.storage.deleteSecret(this.getCloudSecretKey(id, sessionId));
		}

		await this.removeConfigured(id, {
			cloud: cloud,
			domain: isGitSelfManagedHostIntegrationId(id) ? sessionId : undefined,
		});
	}

	async deleteAllSecrets(id: IntegrationIds, cloud?: boolean): Promise<void> {
		if (isGitSelfManagedHostIntegrationId(id)) {
			// Hack because session IDs are tied to domain. Update this when session ids are different
			const configuredDomains = this.configured.get(id)?.map(c => c.domain);
			if (configuredDomains != null) {
				for (const domain of configuredDomains) {
					await this.deleteSecrets(id, domain!, cloud);
				}
			}

			return;
		}

		await this.deleteSecrets(id, providersMetadata[id].domain, cloud);
	}

	async writeSecret(id: IntegrationIds, session: ProviderAuthenticationSession | StoredSession): Promise<void> {
		await this.container.storage.storeSecret(
			this.getSecretKey(id, session.id, session.cloud ?? false),
			JSON.stringify(session),
		);

		await this.addOrUpdateConfigured({
			integrationId: id,
			domain: isGitSelfManagedHostIntegrationId(id) ? session.domain : undefined,
			expiresAt: session.expiresAt,
			scopes: session.scopes.join(','),
			cloud: session.cloud ?? false,
		});
	}

	async readSecret(
		id: IntegrationIds,
		sessionId: string,
		cloud: boolean = false,
	): Promise<StoredSession | undefined> {
		let storedSession: StoredSession | undefined;
		try {
			const sessionJSON = await this.container.storage.getSecret(this.getSecretKey(id, sessionId, cloud));
			if (sessionJSON) {
				storedSession = JSON.parse(sessionJSON);
				if (storedSession != null) {
					const configured = this.configured.get(id);
					const domain = isGitSelfManagedHostIntegrationId(id) ? storedSession.id : undefined;
					if (
						configured == null ||
						configured.length === 0 ||
						!configured.some(c => c.domain === domain && c.integrationId === id)
					) {
						await this.addOrUpdateConfigured({
							integrationId: id,
							domain: domain,
							expiresAt: storedSession.expiresAt,
							scopes: storedSession.scopes.join(','),
							cloud: storedSession.cloud ?? false,
						});
					}
				}
			}
		} catch (_ex) {
			try {
				await this.deleteSecrets(id, sessionId, cloud);
			} catch {}
		}
		return storedSession;
	}

	private getSecretKey(
		id: IntegrationIds,
		sessionId: string,
		cloud: boolean = false,
	):
		| `gitlens.integration.auth:${IntegrationIds}|${string}`
		| `gitlens.integration.auth.cloud:${IntegrationIds}|${string}` {
		return cloud ? this.getCloudSecretKey(id, sessionId) : this.getLocalSecretKey(id, sessionId);
	}

	private getLocalSecretKey(
		id: IntegrationIds,
		sessionId: string,
	): `gitlens.integration.auth:${IntegrationIds}|${string}` {
		return `gitlens.integration.auth:${id}|${sessionId}`;
	}

	private getCloudSecretKey(
		id: IntegrationIds,
		sessionId: string,
	): `gitlens.integration.auth.cloud:${IntegrationIds}|${string}` {
		return `gitlens.integration.auth.cloud:${id}|${sessionId}`;
	}

	getSessionId(descriptor: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor.domain;
	}

	private _addedIds = new Set<IntegrationIds>();
	private _removedIds = new Set<IntegrationIds>();
	private _fireChangeDebounced?: () => void;
	private fireChange(added?: IntegrationIds, removed?: IntegrationIds) {
		this._fireChangeDebounced ??= debounce(() => {
			const added = [...this._addedIds];
			this._addedIds.clear();
			const removed = [...this._removedIds];
			this._removedIds.clear();

			this._onDidChange.fire({ added: added, removed: removed });
		}, 250);

		if (added != null) {
			this._addedIds.add(added);
		}
		if (removed != null) {
			this._removedIds.add(removed);
		}
		this._fireChangeDebounced();
	}
}

function convertStoredSessionToSession(
	storedSession: StoredSession | undefined,
	descriptor: IntegrationAuthenticationSessionDescriptor,
	cloudIfMissing: boolean,
): ProviderAuthenticationSession | undefined {
	if (storedSession == null) return undefined;

	return {
		id: storedSession.id,
		accessToken: storedSession.accessToken,
		account: {
			id: storedSession.account?.id ?? '',
			label: storedSession.account?.label ?? '',
		},
		scopes: storedSession.scopes,
		cloud: storedSession.cloud ?? cloudIfMissing,
		expiresAt: storedSession.expiresAt ? new Date(storedSession.expiresAt) : undefined,
		domain: storedSession.domain ?? descriptor.domain,
		protocol: storedSession.protocol,
	};
}
