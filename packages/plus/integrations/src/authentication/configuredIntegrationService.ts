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
					// Backfill a stable connection id for pre-multi-account stored data: the domain for
					// self-managed hosts, or the provider's canonical domain for cloud (which is the legacy
					// secret-key session id), so existing secrets keep resolving with zero migration. Fall back
					// to the integration id (never empty) when no domain is known — self-managed providers carry
					// `domain: ''` in metadata, and an empty id would collide across connections and produce
					// ambiguous secret keys (`...|`).
					id: d.id || d.domain || providersMetadata[id]?.domain || id,
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
		// Key connections by their stable id (+ cloud, to preserve legacy local/cloud coexistence) so
		// multiple accounts on the same provider+domain no longer overwrite each other.
		const existing = descriptors.find(d => d.id === descriptor.id && d.cloud === descriptor.cloud);

		// The first connection for a provider/domain is primary by default; an explicit flag (or the
		// existing value) always wins. Self-managed providers can span multiple hosts under the same
		// integration id, so each host needs its own primary.
		const primaryScope = this.getPrimaryScope(descriptor.integrationId, descriptors, descriptor.domain);
		const primary = descriptor.primary ?? existing?.primary ?? !primaryScope.some(d => d.primary);
		// Preserve a previously-resolved type/accountName when the incoming write doesn't carry them (e.g.
		// the model re-stores the primary session with an empty account, after reconcile enriched it).
		const type = descriptor.type ?? existing?.type;
		const accountName = descriptor.accountName ?? existing?.accountName;
		const normalized: ConfiguredIntegrationDescriptor = {
			...descriptor,
			primary: primary,
			type: type,
			accountName: accountName,
		};

		let changed: boolean;
		if (existing != null) {
			if (
				existing.domain === normalized.domain &&
				existing.expiresAt === normalized.expiresAt &&
				existing.scopes === normalized.scopes &&
				(existing.primary ?? false) === (normalized.primary ?? false) &&
				existing.type === normalized.type &&
				existing.accountName === normalized.accountName
			) {
				return;
			}

			// Only fire the change event on domain/scopes/primary/type/accountName changes (ignore expiresAt churn)
			changed =
				existing.domain !== normalized.domain ||
				existing.scopes !== normalized.scopes ||
				(existing.primary ?? false) !== (normalized.primary ?? false) ||
				existing.type !== normalized.type ||
				existing.accountName !== normalized.accountName;

			// remove the existing descriptor from the array
			descriptors.splice(descriptors.indexOf(existing), 1);
		} else {
			changed = true;
		}

		descriptors.push(normalized);
		this.configured.set(descriptor.integrationId, descriptors);

		if (changed) {
			this.fireChange(descriptor.integrationId);
		}
		await this.storeConfigured();
	}

	private async removeConfigured(
		id: IntegrationIds,
		options: { connectionId: string; cloud: boolean | undefined },
	): Promise<void> {
		const existing = this.configured.get(id);
		if (existing == null || existing.length === 0) return;

		const removedPrimaryDomains = new Set<string | undefined>();
		const descriptors: ConfiguredIntegrationDescriptor[] = [];
		for (const d of existing) {
			if (
				d.id === options.connectionId &&
				(options?.cloud == null ||
					(options?.cloud === true && d.cloud === true) ||
					(options?.cloud === false && d.cloud === false))
			) {
				if (d.primary) {
					removedPrimaryDomains.add(d.domain);
				}
				continue;
			}

			descriptors.push(d);
		}

		if (descriptors.length === existing.length) return; // nothing matched

		// Promote a secondary to primary when the removed connection was the primary and others remain
		// in the same primary scope, so the provider/host stays in a well-defined connected state.
		for (const domain of removedPrimaryDomains) {
			if (descriptors.some(d => this.isInPrimaryScope(id, d, domain) && d.primary)) continue;

			const index = descriptors.findIndex(d => this.isInPrimaryScope(id, d, domain));
			if (index !== -1) {
				descriptors[index] = { ...descriptors[index], primary: true };
			}
		}

		this.configured.set(id, descriptors);
		this.fireChange(undefined, id);
		await this.storeConfigured();
	}

	async storeSession(id: IntegrationIds, session: ProviderAuthenticationSession): Promise<void> {
		await this.writeSecret(id, session);
	}

	async getStoredSession(
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		const sessionId = this.resolveConnectionId(id, descriptor);
		let session = descriptor.cloud === true ? undefined : await this.readSecret(id, sessionId, false);

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
		if (session == null && descriptor.cloud !== false) {
			cloudIfMissing = true;
			session = await this.readSecret(id, sessionId, true);
		}

		return convertStoredSessionToSession(session, descriptor, cloudIfMissing);
	}

	async deleteStoredSessions(
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		cloud?: boolean,
		options?: { preserveConfigured?: boolean },
	): Promise<void> {
		await this.deleteSecrets(id, this.resolveConnectionId(id, descriptor), cloud, options);
	}

	async deleteAllStoredSessions(id: IntegrationIds, cloud?: boolean, domain?: string): Promise<void> {
		await this.deleteAllSecrets(id, cloud, domain);
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
				// Mirror the hydration backfill so the secret keys we delete match what was written: fall back
				// through domain, the provider's canonical domain, then the integration id (never empty). A
				// legacy cloud descriptor stored neither id nor domain, so an empty connection id here would
				// miss the canonical-domain secret (e.g. `integration.auth.cloud:github|github.com`) and orphan it.
				const connectionId =
					descriptor.id || descriptor.domain || providersMetadata[id as IntegrationIds]?.domain || id;
				await this.ctx.storage.deleteSecret(this.getLocalSecretKey(id as IntegrationIds, connectionId));
				await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id as IntegrationIds, connectionId));
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

	async deleteSecrets(
		id: IntegrationIds,
		connectionId: string,
		cloud?: boolean,
		options?: { preserveConfigured?: boolean },
	): Promise<void> {
		if (cloud == null || cloud === false) {
			await this.ctx.storage.deleteSecret(this.getLocalSecretKey(id, connectionId));
		}

		if (cloud == null || cloud === true) {
			await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id, connectionId));
		}

		if (options?.preserveConfigured) return;

		await this.removeConfigured(id, { connectionId: connectionId, cloud: cloud });
	}

	async deleteAllSecrets(id: IntegrationIds, cloud?: boolean, domain?: string): Promise<void> {
		// Delete every connection's secret (multi-account): secrets are keyed per connection id, so a
		// single canonical-domain delete would orphan secondary tokens. When a domain is given (self-managed
		// disconnect of one host), scope to that host so other hosts under the same provider id survive.
		const descriptors = this.configured.get(id);
		const connectionIds = [
			...new Set(
				(domain != null ? descriptors?.filter(c => c.domain === domain) : descriptors)?.map(c => c.id) ?? [],
			),
		];
		if (connectionIds.length) {
			for (const connectionId of connectionIds) {
				await this.deleteSecrets(id, connectionId, cloud);
			}

			return;
		}

		// A domain-scoped clear that matched nothing means this host has no stored connections, so it must be
		// a no-op. The canonical-domain fallback below would target a bogus key (self-managed canonical domain
		// is empty), so skip it.
		if (domain != null) return;

		// No configured connections (e.g. an orphaned secret with no descriptor): fall back to the
		// provider's canonical domain, which is the legacy session id for cloud providers. Mirror the
		// hydration backfill's `|| id` guard so a self-managed provider (empty canonical domain) doesn't
		// target an ambiguous empty connection id.
		await this.deleteSecrets(id, providersMetadata[id]?.domain || id, cloud);
	}

	async writeSecret(id: IntegrationIds, session: ProviderAuthenticationSession | StoredSession): Promise<void> {
		await this.ctx.storage.storeSecret(
			this.getSecretKey(id, session.id, session.cloud ?? false),
			JSON.stringify(session),
		);

		await this.addOrUpdateConfigured({
			id: session.id,
			integrationId: id,
			domain: isGitSelfManagedHostIntegrationId(id) ? session.domain : undefined,
			expiresAt: session.expiresAt,
			scopes: session.scopes.join(','),
			cloud: session.cloud ?? false,
			type: session.type,
			accountName: session.account?.label || undefined,
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
					const connectionId = storedSession.id ?? sessionId;
					const sessionCloud = storedSession.cloud ?? cloud;
					const domain = isGitSelfManagedHostIntegrationId(id)
						? (storedSession.domain ?? storedSession.id)
						: undefined;
					if (
						configured == null ||
						configured.length === 0 ||
						!configured.some(
							c => c.id === connectionId && c.integrationId === id && c.cloud === sessionCloud,
						)
					) {
						await this.addOrUpdateConfigured({
							id: connectionId,
							integrationId: id,
							domain: domain,
							expiresAt: storedSession.expiresAt,
							scopes: storedSession.scopes.join(','),
							cloud: sessionCloud,
							type: storedSession.type,
							accountName: storedSession.account?.label || undefined,
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

	private getPrimaryScope(
		id: IntegrationIds,
		descriptors: ConfiguredIntegrationDescriptor[],
		domain: string | undefined,
	): ConfiguredIntegrationDescriptor[] {
		return isGitSelfManagedHostIntegrationId(id)
			? descriptors.filter(d => this.isInPrimaryScope(id, d, domain))
			: descriptors;
	}

	private isInPrimaryScope(
		id: IntegrationIds,
		descriptor: ConfiguredIntegrationDescriptor,
		domain: string | undefined,
	): boolean {
		return !isGitSelfManagedHostIntegrationId(id) || descriptor.domain === domain;
	}

	/**
	 * Resolves the connection id used as the secret-key session id for an auth descriptor.
	 * - If the descriptor targets a specific connection (`connectionId`), that wins.
	 * - Otherwise returns the primary connection's id for the provider (matching the descriptor's domain
	 *   for self-managed hosts; any connection for cloud hosts, where the stored domain is undefined).
	 * - Falls back to the descriptor domain when nothing is configured yet, preserving legacy
	 *   (pre-multi-account) reads with zero secret migration.
	 */
	resolveConnectionId(id: IntegrationIds, descriptor: IntegrationAuthenticationSessionDescriptor): string {
		// An empty connectionId is not a real target — treat it as "no target" so it resolves the primary
		// rather than keying a secret under an empty id.
		if (descriptor.connectionId) return descriptor.connectionId;

		const domain = isGitSelfManagedHostIntegrationId(id) ? descriptor.domain : undefined;
		const candidates = this.scopeConnectionCandidates(id, domain, descriptor.cloud);
		return (candidates?.find(c => c.primary) ?? candidates?.[0])?.id ?? descriptor.domain;
	}

	/**
	 * Returns the id of the configured connection an unscoped descriptor resolves to (the primary for the
	 * descriptor's domain, matching {@link resolveConnectionId}'s selection), or `undefined` when nothing is
	 * configured for it. Unlike {@link resolveConnectionId} this only returns a genuine per-connection cloud
	 * token id (never a local/PAT or domain-derived legacy id), so callers can safely use it to scope a cloud
	 * token fetch to one host of a multi-host self-managed provider, or fall through to the provider-global
	 * primary endpoint on `undefined`.
	 */
	getConfiguredConnectionId(id: IntegrationIds, domain: string | undefined, cloud?: boolean): string | undefined {
		const scoped = isGitSelfManagedHostIntegrationId(id) ? domain : undefined;
		const candidates = this.scopeConnectionCandidates(id, scoped, cloud);
		const connection = candidates?.find(c => c.primary) ?? candidates?.[0];
		if (connection == null) return undefined;

		// Only return a real per-connection cloud token id. Reject a local (PAT) descriptor (surfaced by
		// scopeConnectionCandidates' non-cloud fallback) and a domain-derived legacy id (the descriptor's own
		// domain or the provider's canonical domain — see ConfiguredIntegrationDescriptor.id), either of which
		// would target `v1/provider-tokens/tokens/{domain}` (rejected as a non-uuid). Callers then fall through
		// to the provider-scoped primary endpoint.
		if (!connection.cloud) return undefined;

		const canonicalDomain = providersMetadata[id]?.domain;
		if (connection.id === connection.domain || (canonicalDomain && connection.id === canonicalDomain)) {
			return undefined;
		}
		return connection.id;
	}

	/**
	 * Selects configured descriptors for a provider matching `domain`, further narrowed to the `cloud`
	 * variant when specified. A connection id can have both a local (PAT) and cloud descriptor whose ids
	 * differ (e.g. a legacy local descriptor keyed by domain alongside a real cloud token id); scoping by
	 * `cloud` keeps a cloud-scoped read/delete from resolving the local id (and vice versa). Falls back to
	 * the domain-only set when no variant matches, so legacy single-variant resolution is unchanged.
	 */
	private scopeConnectionCandidates(
		id: IntegrationIds,
		domain: string | undefined,
		cloud: boolean | undefined,
	): ConfiguredIntegrationDescriptor[] | undefined {
		const candidates = this.configured.get(id)?.filter(c => c.domain === domain);
		if (cloud == null || candidates == null) return candidates;

		const scoped = candidates.filter(c => c.cloud === cloud);
		return scoped.length ? scoped : candidates;
	}

	/**
	 * Marks the given connection as the primary/default for the provider and clears the flag on its
	 * siblings. Persists immediately instead of relying on a session re-store to carry the primary flag.
	 */
	async setPrimaryConnection(id: IntegrationIds, connectionId: string): Promise<void> {
		const descriptors = this.configured.get(id);
		if (descriptors == null || descriptors.length === 0) return;
		if (!descriptors.some(d => d.id === connectionId)) return;

		const target =
			descriptors.find(d => d.id === connectionId && d.cloud) ?? descriptors.find(d => d.id === connectionId);
		if (target == null) return;

		const domain = isGitSelfManagedHostIntegrationId(id) ? target.domain : undefined;
		// A connection id can have both a local (PAT) and cloud descriptor. Mark the primary on a single
		// canonical variant (prefer cloud, since multi-account primaries are cloud-driven) within the
		// provider/host scope, so other self-managed hosts keep their own default connection.
		const primaryIsCloud = descriptors.some(
			d => d.id === connectionId && d.cloud && this.isInPrimaryScope(id, d, domain),
		);

		let changed = false;
		const updated = descriptors.map(d => {
			if (!this.isInPrimaryScope(id, d, domain)) return d;

			const primary = d.id === connectionId && (d.cloud ?? false) === primaryIsCloud;
			if ((d.primary ?? false) === primary) return d;

			changed = true;
			return { ...d, primary: primary };
		});
		if (!changed) return;

		this.configured.set(id, updated);
		this.fireChange(id);
		await this.storeConfigured();
	}

	/**
	 * Removes a single connection (its secret + configured descriptor). If it was the primary and other
	 * connections remain, a secondary is promoted (see {@link removeConfigured}). Unlike
	 * {@link deleteAllStoredSessions}, this only affects the targeted connection. Pass `cloud` to scope
	 * the removal to the cloud/local variant when a local PAT and a cloud session share a connection id.
	 */
	async deleteConnection(id: IntegrationIds, connectionId: string, cloud?: boolean): Promise<void> {
		await this.deleteSecrets(id, connectionId, cloud);
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
