import type { Disposable, Event } from 'vscode';
import { EventEmitter } from 'vscode';
import type { IntegrationId } from '../../../constants.integrations';
import { HostingIntegrationId } from '../../../constants.integrations';
import type { StoredConfiguredIntegrationDescriptor } from '../../../constants.storage';
import type { Container } from '../../../container';
import { debounce } from '../../../system/function/debounce';
import { flatten } from '../../../system/iterable';
import { getBuiltInIntegrationSession } from '../../gk/utils/-webview/integrationAuthentication.utils';
import { isSelfHostedIntegrationId, providersMetadata } from '../providers/models';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthenticationProvider';
import type { ConfiguredIntegrationDescriptor, ProviderAuthenticationSession } from './models';

interface StoredSession {
	id: string;
	accessToken: string;
	account?: {
		label?: string;
		displayName?: string;
		id: string;
	};
	scopes: string[];
	cloud?: boolean;
	expiresAt?: string;
	domain?: string;
}

export type ConfiguredIntegrationType = 'cloud' | 'local';

export interface ConfiguredIntegrationsChangeEvent {
	ids: IntegrationId[];
}

export class ConfiguredIntegrationService implements Disposable {
	private readonly _onDidChange = new EventEmitter<ConfiguredIntegrationsChangeEvent>();
	get onDidChange(): Event<ConfiguredIntegrationsChangeEvent> {
		return this._onDidChange.event;
	}

	private _configured?: Map<IntegrationId, ConfiguredIntegrationDescriptor[]>;

	constructor(private readonly container: Container) {}

	dispose(): void {
		this._onDidChange.dispose();
	}

	private get configured(): Map<IntegrationId, ConfiguredIntegrationDescriptor[]> {
		if (this._configured == null) {
			this._configured = new Map();
			const storedConfigured = this.container.storage.get('integrations:configured');
			for (const [id, configured] of Object.entries(storedConfigured ?? {})) {
				if (configured == null) continue;
				const descriptors = configured.map(d => ({
					...d,
					expiresAt: d.expiresAt ? new Date(d.expiresAt) : undefined,
				}));
				this._configured.set(id as IntegrationId, descriptors);
			}
		}

		return this._configured;
	}

	// async because we do the heavy work of checking authentication api for your vscode GitHub session
	async getConfigured(options?: {
		id?: IntegrationId;
		domain?: string;
		type?: ConfiguredIntegrationType;
	}): Promise<ConfiguredIntegrationDescriptor[]> {
		const descriptors: ConfiguredIntegrationDescriptor[] = [];
		const configured =
			options?.id != null
				? this.configured.get(options.id)
				: [...flatten<ConfiguredIntegrationDescriptor>(this.configured.values())];

		if (configured != null && (options?.domain != null || options?.type != null)) {
			for (const descriptor of configured) {
				if (options?.domain != null && descriptor.domain !== options.domain) continue;
				if (options?.type === 'cloud' && !descriptor.cloud) continue;
				if (options?.type === 'local' && descriptor.cloud) continue;
				descriptors.push(descriptor);
			}
		} else {
			descriptors.push(...(configured ?? []));
		}

		// If we don't have a cloud config for GitHub, include a descriptor for the built-in VS Code session of GitHub even though we don't store it
		if (
			(options?.id == null || options.id === HostingIntegrationId.GitHub) &&
			options?.type !== 'cloud' &&
			!this.configured.get(HostingIntegrationId.GitHub)
		) {
			const vscodeSession = await getBuiltInIntegrationSession(
				this.container,
				HostingIntegrationId.GitHub,
				{
					domain: providersMetadata[HostingIntegrationId.GitHub].domain,
					scopes: providersMetadata[HostingIntegrationId.GitHub].scopes,
				},
				{ silent: true },
			);

			if (vscodeSession != null) {
				descriptors.push({
					integrationId: HostingIntegrationId.GitHub,
					domain: undefined,
					expiresAt: vscodeSession.expiresAt,
					scopes: providersMetadata[HostingIntegrationId.GitHub].scopes.join(','),
					cloud: false,
				});
			}
		}

		return descriptors;
	}

	// getConfigured without the async check for the GitHub vscode session (which forces async and is a db hit)
	getConfiguredLite(options?: {
		id?: IntegrationId;
		domain?: string;
		type?: ConfiguredIntegrationType;
	}): ConfiguredIntegrationDescriptor[] {
		const descriptors: ConfiguredIntegrationDescriptor[] = [];

		const configured =
			options?.id != null
				? this.configured.get(options.id)
				: [...flatten<ConfiguredIntegrationDescriptor>(this.configured.values())];
		if (configured == null) return descriptors;

		if (options?.domain != null || options?.type != null) {
			for (const descriptor of configured) {
				if (options?.domain != null && descriptor.domain !== options.domain) continue;
				if (options?.type === 'cloud' && !descriptor.cloud) continue;
				if (options?.type === 'local' && descriptor.cloud) continue;
				descriptors.push(descriptor);
			}
		} else {
			descriptors.push(...configured);
		}

		return descriptors;
	}

	private async storeConfigured(): Promise<void> {
		// We need to convert the map to a record to store
		const configured: Record<string, StoredConfiguredIntegrationDescriptor[]> = {};
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

	private async addConfigured(descriptor: ConfiguredIntegrationDescriptor): Promise<void> {
		const descriptors = this.configured.get(descriptor.integrationId) ?? [];
		const existing = descriptors.find(
			d =>
				d.domain === descriptor.domain &&
				d.integrationId === descriptor.integrationId &&
				d.cloud === descriptor.cloud,
		);

		if (existing != null) {
			if (existing.expiresAt === descriptor.expiresAt && existing.scopes === descriptor.scopes) {
				return;
			}

			//remove the existing descriptor from the array
			const index = descriptors.indexOf(existing);
			descriptors.splice(index, 1);
		}

		descriptors.push(descriptor);
		this.configured.set(descriptor.integrationId, descriptors);
		this.queueDidChange(descriptor.integrationId);
		await this.storeConfigured();
	}

	private async removeConfigured(
		id: IntegrationId,
		options?: { domain?: string; type?: ConfiguredIntegrationType },
	): Promise<void> {
		const descriptors = this.configured
			.get(id)
			?.filter(d =>
				options?.type === 'cloud'
					? !(d.cloud === true && d.domain === options?.domain)
					: options?.type === 'local'
					  ? !(d.cloud === false && d.domain === options?.domain)
					  : d.domain !== options?.domain,
			);

		if (descriptors != null && descriptors.length === 0) {
			this.configured.delete(id);
		}

		this.configured.set(id, descriptors ?? []);
		this.queueDidChange(id);
		await this.storeConfigured();
	}

	async storeSession(id: IntegrationId, session: ProviderAuthenticationSession): Promise<void> {
		await this.writeSecret(id, session);
	}

	async getStoredSession(
		id: IntegrationId,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		type: ConfiguredIntegrationType = 'local',
	): Promise<ProviderAuthenticationSession | undefined> {
		const sessionId = this.getSessionId(descriptor);
		let session = await this.readSecret(id, sessionId, 'local');
		if (type !== 'cloud') return convertStoredSessionToSession(session, descriptor, false);

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
			session = await this.readSecret(id, sessionId, 'cloud');
		}

		return convertStoredSessionToSession(session, descriptor, cloudIfMissing);
	}

	async deleteStoredSessions(
		id: IntegrationId,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		type?: ConfiguredIntegrationType,
	): Promise<void> {
		await this.deleteSecrets(id, this.getSessionId(descriptor), type);
	}

	async deleteAllStoredSessions(id: IntegrationId, type?: ConfiguredIntegrationType): Promise<void> {
		await this.deleteAllSecrets(id, type);
	}

	async deleteSecrets(id: IntegrationId, sessionId: string, type?: ConfiguredIntegrationType): Promise<void> {
		if (type == null || type === 'local') {
			await this.container.storage.deleteSecret(this.getLocalSecretKey(id, sessionId));
		}

		if (type == null || type === 'cloud') {
			await this.container.storage.deleteSecret(this.getCloudSecretKey(id, sessionId));
		}

		await this.removeConfigured(id, {
			domain: isSelfHostedIntegrationId(id) ? sessionId : undefined,
			type: type,
		});
	}

	async deleteAllSecrets(id: IntegrationId, type?: ConfiguredIntegrationType): Promise<void> {
		if (isSelfHostedIntegrationId(id)) {
			// Hack because session IDs are tied to domain. Update this when session ids are different
			const configuredDomains = this.configured.get(id)?.map(c => c.domain);
			if (configuredDomains != null) {
				for (const domain of configuredDomains) {
					await this.deleteSecrets(id, domain!, type);
				}
			}

			return;
		}

		await this.deleteSecrets(id, providersMetadata[id].domain, type);
	}

	async writeSecret(id: IntegrationId, session: ProviderAuthenticationSession | StoredSession): Promise<void> {
		await this.container.storage.storeSecret(
			this.getSecretKey(id, session.id, session.cloud ? 'cloud' : 'local'),
			JSON.stringify(session),
		);

		await this.addConfigured({
			integrationId: id,
			domain: isSelfHostedIntegrationId(id) ? session.domain : undefined,
			expiresAt: session.expiresAt,
			scopes: session.scopes.join(','),
			cloud: session.cloud ?? false,
		});
	}

	async readSecret(
		id: IntegrationId,
		sessionId: string,
		type: ConfiguredIntegrationType = 'local',
	): Promise<StoredSession | undefined> {
		let storedSession: StoredSession | undefined;
		try {
			const sessionJSON = await this.container.storage.getSecret(this.getSecretKey(id, sessionId, type));
			if (sessionJSON) {
				storedSession = JSON.parse(sessionJSON);
				if (storedSession != null) {
					const configured = this.configured.get(id);
					const domain = isSelfHostedIntegrationId(id) ? storedSession.id : undefined;
					if (
						configured == null ||
						configured.length === 0 ||
						!configured.some(c => c.domain === domain && c.integrationId === id)
					) {
						await this.addConfigured({
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
				await this.deleteSecrets(id, sessionId, type);
			} catch {}
		}
		return storedSession;
	}

	private getSecretKey(
		id: IntegrationId,
		sessionId: string,
		type: ConfiguredIntegrationType = 'local',
	):
		| `gitlens.integration.auth:${IntegrationId}|${string}`
		| `gitlens.integration.auth.cloud:${IntegrationId}|${string}` {
		return type === 'cloud' ? this.getCloudSecretKey(id, sessionId) : this.getLocalSecretKey(id, sessionId);
	}

	private getLocalSecretKey(
		id: IntegrationId,
		sessionId: string,
	): `gitlens.integration.auth:${IntegrationId}|${string}` {
		return `gitlens.integration.auth:${id}|${sessionId}`;
	}

	private getCloudSecretKey(
		id: IntegrationId,
		sessionId: string,
	): `gitlens.integration.auth.cloud:${IntegrationId}|${string}` {
		return `gitlens.integration.auth.cloud:${id}|${sessionId}`;
	}

	getSessionId(descriptor: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor.domain;
	}

	private changedIds = new Set<IntegrationId>();
	private debouncedFireDidChange?: () => void;
	private queueDidChange(id: IntegrationId) {
		this.debouncedFireDidChange ??= debounce(() => {
			this._onDidChange.fire({ ids: [...this.changedIds] });
			this.changedIds.clear();
		}, 300);

		this.changedIds.add(id);
		this.debouncedFireDidChange();
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
	};
}
