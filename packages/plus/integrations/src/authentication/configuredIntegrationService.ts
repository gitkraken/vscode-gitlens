import { debounce } from '@gitlens/utils/debounce.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { flatten } from '@gitlens/utils/iterable.js';
import type {
	IntegrationIds,
	StoredConfiguredIntegrationDescriptor,
	StoredIntegrationConfigurations,
} from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { providersMetadata } from '../providers/models.js';
import { isGitSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthenticationProvider.js';
import type {
	CloudIntegrationAuthType,
	ConfiguredIntegrationDescriptor,
	ProviderAuthenticationSession,
} from './models.js';

interface StoredSession {
	id: string;
	accessToken: string;
	account?: { label?: string; displayName?: string; id: string };
	scopes: string[];
	cloud?: boolean;
	type: CloudIntegrationAuthType | undefined;
	expiresAt?: string;
	domain?: string;
	protocol?: string;
}

export interface ConfiguredIntegrationsChangeEvent {
	readonly added: readonly IntegrationIds[];
	readonly removed: readonly IntegrationIds[];
}

export class ConfiguredIntegrationService implements Disposable {
	private readonly _onDidChange = new Emitter<ConfiguredIntegrationsChangeEvent>();
	get onDidChange(): Event<ConfiguredIntegrationsChangeEvent> {
		return this._onDidChange.event;
	}

	constructor(private readonly ctx: IntegrationServiceContext) {}

	dispose(): void {
		this._onDidChange.dispose();
	}

	private _configured?: Map<IntegrationIds, ConfiguredIntegrationDescriptor[]>;
	private get configured(): Map<IntegrationIds, ConfiguredIntegrationDescriptor[]> {
		if (this._configured == null) {
			this._configured = new Map<IntegrationIds, ConfiguredIntegrationDescriptor[]>();

			const storedConfigured = this.ctx.storage.get('integrations:configured');
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

	// Synchronous: reads the in-memory configured map (lazily hydrated from storage). No async work —
	// the old async variant only existed to weave in the built-in VS Code GitHub session, which is gone.
	getConfigured(
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

		await this.ctx.storage.store('integrations:configured', configured);
	}

	private async addOrUpdateConfigured(descriptor: ConfiguredIntegrationDescriptor): Promise<void> {
		const descriptors = this.configured.get(descriptor.integrationId) ?? [];
		const existing = descriptors.find(
			d =>
				d.domain === descriptor.domain &&
				d.integrationId === descriptor.integrationId &&
				d.cloud === descriptor.cloud,
		);

		let changed: boolean;
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
	): Promise<ProviderAuthenticationSession | undefined> {
		const sessionId = this.getSessionId(descriptor);
		let session = await this.readSecret(id, sessionId, false);

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

	/**
	 * Reclaims all stored configuration + secrets for the given (typically retired) integration ids.
	 * Used to clean up state left behind when an id is removed from the model — e.g. the local
	 * self-managed `github-enterprise`/`gitlab-self-hosted` ids dropped when integrations went cloud-only.
	 * Domains are read from the stored config (secrets are keyed by domain); ids with no stored config
	 * are a no-op.
	 */
	async purgeStoredConfiguration(ids: readonly string[]): Promise<void> {
		const stored =
			this.ctx.storage.get<Record<string, StoredConfiguredIntegrationDescriptor[] | undefined>>(
				'integrations:configured',
			);
		if (stored == null) return;

		let changed = false;
		for (const id of ids) {
			if (!(id in stored)) continue;

			for (const descriptor of stored[id] ?? []) {
				const sessionId = descriptor.domain ?? '';
				await this.ctx.storage.deleteSecret(this.getLocalSecretKey(id as IntegrationIds, sessionId));
				await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id as IntegrationIds, sessionId));
				if (descriptor.domain) {
					await this.ctx.storage.deleteWorkspace(`connected:${id}:${descriptor.domain}`);
				}
			}
			changed = true;
		}
		if (!changed) return;

		const remaining = Object.fromEntries(Object.entries(stored).filter(([key]) => !ids.includes(key)));
		await this.ctx.storage.store('integrations:configured', remaining as StoredIntegrationConfigurations);
	}

	async deleteSecrets(id: IntegrationIds, sessionId: string, cloud?: boolean): Promise<void> {
		if (cloud == null || cloud === false) {
			await this.ctx.storage.deleteSecret(this.getLocalSecretKey(id, sessionId));
		}

		if (cloud == null || cloud === true) {
			await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id, sessionId));
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
		await this.ctx.storage.storeSecret(
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
			const sessionJSON = await this.ctx.storage.getSecret(this.getSecretKey(id, sessionId, cloud));
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
	): `integration.auth:${IntegrationIds}|${string}` | `integration.auth.cloud:${IntegrationIds}|${string}` {
		return cloud ? this.getCloudSecretKey(id, sessionId) : this.getLocalSecretKey(id, sessionId);
	}

	private getLocalSecretKey(id: IntegrationIds, sessionId: string): `integration.auth:${IntegrationIds}|${string}` {
		return `integration.auth:${id}|${sessionId}`;
	}

	private getCloudSecretKey(
		id: IntegrationIds,
		sessionId: string,
	): `integration.auth.cloud:${IntegrationIds}|${string}` {
		return `integration.auth.cloud:${id}|${sessionId}`;
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
		type: storedSession.type,
	};
}
