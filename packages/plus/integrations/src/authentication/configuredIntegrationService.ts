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
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { providersMetadata } from '../providers/metadata.js';
import {
	areDomainsOnSameHost,
	baseUrlFromDomain,
	hostFromDomain,
	sameConfiguredBaseUrl,
} from '../utils/domain.utils.js';
import { isSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { CloudCredentialOrigin, CloudIntegrationSync } from './cloudIntegrationObservations.js';
import { CloudIntegrationObservations } from './cloudIntegrationObservations.js';
import type { IntegrationAuthenticationSessionDescriptor } from './integrationAuthenticationProvider.js';
import type {
	CloudIntegrationAuthType,
	CloudIntegrationConnection,
	ConfiguredIntegrationDescriptor,
	ConnectionResource,
	ProviderAuthenticationSession,
} from './models.js';
import {
	getSessionIdentity,
	getSupportedCloudIntegrationIds,
	isSameAuthenticationSession,
	sessionExpiry,
} from './models.js';

const cloudLogoutKey = 'integrations:cloudLogout';

interface StoredSession {
	cloudOrigin?: CloudCredentialOrigin;
	id: string;
	accessToken: string;
	account?: { label?: string; displayName?: string; id: string };
	scopes: string[];
	cloud?: boolean;
	type: CloudIntegrationAuthType | undefined;
	expiresAt?: string;
	domain?: string;
	/** See {@link ProviderAuthenticationSession.baseUrl}: the configured address, path included. */
	baseUrl?: string;
	protocol?: string;
	/** The provider app key paired with the token for providers whose client needs one (e.g. Trello). */
	appKey?: string;
}

export interface ConfiguredIntegrationsChangeEvent {
	readonly added: readonly IntegrationIds[];
	readonly removed: readonly IntegrationIds[];
}

type IntegrationSessionChangeEvent = {
	readonly integrationId: IntegrationIds;
	readonly session: ProviderAuthenticationSession;
	readonly previousDomain?: string;
};

type CredentialAcquisitions = { unscoped?: Promise<void>; connections: Map<string, Promise<void>> };

type CloudLogoutConnection = ConfiguredIntegrationDescriptor & { retained: boolean };

type ConfiguredStorageState = {
	configured?: Map<IntegrationIds, ConfiguredIntegrationDescriptor[]>;
	persistence: Promise<void>;
	locks: Map<IntegrationIds, Promise<void>>;
	epoch: number;
	scopes: Map<string, number>;
	signOuts: Map<string, number>;
	publications: Map<string, number>;
	removals: Map<string, number>;
	cloud: CloudIntegrationObservations;
	onCloudLogout: Emitter<readonly CloudLogoutConnection[]>;
	// KEEP: A partial secret/descriptor write blocks this variant until both are stored successfully.
	expiries: Map<string, number | null>;
};
const configuredStorageState = new WeakMap<IntegrationServiceContext['storage'], ConfiguredStorageState>();

export class ConfiguredIntegrationService implements Disposable {
	private readonly _onDidChange = new Emitter<ConfiguredIntegrationsChangeEvent>();
	private readonly _onWillChangeSession = new Emitter<IntegrationSessionChangeEvent>();
	private readonly _onWillRemoveSessions = new Emitter<{
		integrationId: IntegrationIds;
		connectionId?: string;
		cloud?: boolean;
		domain?: string;
	}>();
	private readonly _acquisitions = new Map<IntegrationIds, CredentialAcquisitions>();
	private readonly state: ConfiguredStorageState;
	private _disposed = false;
	get onDidChange(): Event<ConfiguredIntegrationsChangeEvent> {
		return this._onDidChange.event;
	}
	get onCloudLogout(): Event<readonly CloudLogoutConnection[]> {
		return this.state.onCloudLogout.event;
	}
	get onWillChangeSession(): Event<IntegrationSessionChangeEvent> {
		return this._onWillChangeSession.event;
	}
	get onWillRemoveSessions(): typeof this._onWillRemoveSessions.event {
		return this._onWillRemoveSessions.event;
	}

	constructor(private readonly ctx: IntegrationServiceContext) {
		let state = configuredStorageState.get(ctx.storage);
		if (state == null) {
			state = {
				persistence: Promise.resolve(),
				locks: new Map(),
				epoch: 0,
				scopes: new Map(),
				signOuts: new Map(),
				publications: new Map(),
				removals: new Map(),
				cloud: new CloudIntegrationObservations(ctx.storage.get(cloudLogoutKey)),
				onCloudLogout: new Emitter<readonly CloudLogoutConnection[]>(),
				expiries: new Map(),
			};
			configuredStorageState.set(ctx.storage, state);
		}
		this.state = state;
	}

	dispose(): void {
		this._disposed = true;
		this._onDidChange.dispose();
		this._onWillChangeSession.dispose();
		this._onWillRemoveSessions.dispose();
	}

	private get configured(): Map<IntegrationIds, ConfiguredIntegrationDescriptor[]> {
		if (this.state.configured == null) {
			this.state.configured = new Map<IntegrationIds, ConfiguredIntegrationDescriptor[]>();

			const storedConfigured = this.ctx.storage.get('integrations:configured');
			for (const [id, configured] of Object.entries(storedConfigured ?? {}) as [
				IntegrationIds,
				StoredConfiguredIntegrationDescriptor[],
			][]) {
				if (configured == null) continue;

				const descriptors = configured.map(d => ({
					...d,
					baseUrl: isSelfManagedHostIntegrationId(id) ? getStoredBaseUrl(d.baseUrl, d.domain) : d.baseUrl,
					domain: this.normalizeConfiguredDomain(id, d.domain),
					id: d.id || d.domain || providersMetadata[id]?.domain || id,
					expiresAt: d.expiresAt ? new Date(d.expiresAt) : undefined,
				}));
				this.state.configured.set(id, descriptors);
			}
		}

		return this.state.configured;
	}

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
					(options?.domain != null &&
						!this.domainsMatch(id ?? descriptor.integrationId, descriptor.domain, options.domain)) ||
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

	private storeConfigured(id: IntegrationIds, descriptors?: ConfiguredIntegrationDescriptor[]): Promise<void> {
		const pending = this.state.persistence.then(async () => {
			const updated = new Map(this.configured);
			if (descriptors == null) {
				updated.delete(id);
			} else {
				updated.set(id, descriptors);
			}

			const record: Partial<StoredIntegrationConfigurations> = {};
			for (const [providerId, connections] of updated) {
				record[providerId] = connections.map(connection => ({
					...connection,
					expiresAt:
						connection.expiresAt instanceof Date
							? connection.expiresAt.toISOString()
							: connection.expiresAt,
				}));
			}
			await this.ctx.storage.store('integrations:configured', record);
			this.state.configured = updated;
		});
		this.state.persistence = pending.catch(() => {});
		return pending;
	}

	private async addOrUpdateConfigured(descriptor: ConfiguredIntegrationDescriptor): Promise<void> {
		descriptor = {
			...descriptor,
			baseUrl: isSelfManagedHostIntegrationId(descriptor.integrationId)
				? getStoredBaseUrl(descriptor.baseUrl, descriptor.domain)
				: descriptor.baseUrl,
			domain: this.normalizeConfiguredDomain(descriptor.integrationId, descriptor.domain),
		};
		const descriptors = [...(this.configured.get(descriptor.integrationId) ?? [])];
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
		// A write without a workspace (a failed lookup, or a session re-store) keeps the stored pair whole.
		const resource = descriptor.resourceId != null ? descriptor : existing;
		const normalized: ConfiguredIntegrationDescriptor = {
			...descriptor,
			primary: primary,
			type: type,
			accountName: accountName,
			resourceName: resource?.resourceName,
			resourceId: resource?.resourceId,
		};

		let changed: boolean;
		if (existing != null) {
			// `baseUrl` is compared alongside `domain`, not folded into it: `domain` is normalized to a bare
			// host, so a connection re-pointed to another context path on the SAME host is identical by domain
			// and would otherwise be treated as unchanged — leaving the stored descriptor, and every warm
			// integration listening for the change, on the old address.
			if (
				existing.domain === normalized.domain &&
				sameConfiguredBaseUrl(existing.baseUrl, normalized.baseUrl) &&
				existing.expiresAt === normalized.expiresAt &&
				existing.scopes === normalized.scopes &&
				(existing.primary ?? false) === (normalized.primary ?? false) &&
				existing.type === normalized.type &&
				existing.accountName === normalized.accountName &&
				existing.resourceName === normalized.resourceName &&
				existing.resourceId === normalized.resourceId
			) {
				return;
			}

			// Only fire the change event on address/scopes/primary/type/accountName changes (ignore expiresAt churn)
			changed =
				existing.domain !== normalized.domain ||
				!sameConfiguredBaseUrl(existing.baseUrl, normalized.baseUrl) ||
				existing.scopes !== normalized.scopes ||
				(existing.primary ?? false) !== (normalized.primary ?? false) ||
				existing.type !== normalized.type ||
				existing.accountName !== normalized.accountName ||
				existing.resourceName !== normalized.resourceName ||
				existing.resourceId !== normalized.resourceId;

			descriptors.splice(descriptors.indexOf(existing), 1);
		} else {
			changed = true;
		}

		descriptors.push(normalized);
		await this.storeConfigured(descriptor.integrationId, descriptors);

		if (changed) {
			this.fireChange(descriptor.integrationId);
		}
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

		await this.storeConfigured(id, descriptors);
		this.fireChange(undefined, id);
	}

	private withLock<T>(id: IntegrationIds, fn: () => Promise<T> | T): Promise<T> {
		const locks = this.state.locks;
		const run = (locks.get(id) ?? Promise.resolve()).then(fn);
		const settled = run.then(
			() => undefined,
			() => undefined,
		);
		locks.set(id, settled);
		void settled.then(() => {
			if (locks.get(id) === settled) {
				locks.delete(id);
			}
		});
		return run;
	}

	serializesCredentialAcquisition(id: IntegrationIds): boolean {
		return id === GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	}

	/**
	 * KEEP: not reentrant. A `connectionId` acquisition waits for that connection's and every earlier unscoped one;
	 * an unscoped acquisition waits for every earlier acquisition of `id`.
	 */
	withCredentialAcquisition<T>(
		id: IntegrationIds,
		connectionId: string | undefined,
		fn: () => Promise<T>,
	): Promise<T> {
		if (!this.serializesCredentialAcquisition(id)) return fn();

		let queue = this._acquisitions.get(id);
		if (queue == null) {
			queue = { connections: new Map() };
			this._acquisitions.set(id, queue);
		}

		const predecessors = (
			connectionId != null
				? [queue.unscoped, queue.connections.get(connectionId)]
				: [queue.unscoped, ...queue.connections.values()]
		).filter(p => p != null);
		const run = Promise.all(predecessors).then(() => fn());
		const settled = run.then(
			() => undefined,
			() => undefined,
		);
		if (connectionId != null) {
			queue.connections.set(connectionId, settled);
		} else {
			queue.unscoped = settled;
			queue.connections.clear();
		}

		const current = queue;
		void settled.then(() => {
			if (connectionId != null) {
				if (current.connections.get(connectionId) === settled) {
					current.connections.delete(connectionId);
				}
			} else if (current.unscoped === settled) {
				current.unscoped = undefined;
			}

			if (current.unscoped == null && current.connections.size === 0 && this._acquisitions.get(id) === current) {
				this._acquisitions.delete(id);
			}
		});
		return run;
	}

	/**
	 * Taken before a token is read or fetched and handed to {@link storeSession}. A later sign-out or a recovery
	 * that replaces the credential invalidates the pending store.
	 */
	getSignOutMark(): number {
		return ++this.state.epoch;
	}

	private retirePendingStores(scope: string, cloud?: boolean): void {
		this.retireStoredWrites(scope, cloud);
		this.state.signOuts.set(cloud == null ? scope : `${scope}|${cloud}`, this.getStoredWriteMark());
	}

	beginCloudSync(): number {
		return ++this.state.epoch;
	}

	get lastCloudLogout(): number {
		return this.state.cloud.lastLogout;
	}

	get hasCloudLogout(): boolean {
		return this.state.cloud.hasLogout;
	}

	async retireCloudAccount(mark: number): Promise<CloudIntegrationSync | undefined> {
		if (this._disposed) return undefined;

		const connections = this.getConfigured(undefined, { cloud: true });
		const sync = this.state.cloud.acceptLogout(mark, ++this.state.epoch, connections);
		if (sync == null) return undefined;

		const persist = this.persistCloudLogout();

		const departing = connections.map(c => ({
			...c,
			retained: this.state.cloud.acquiredAfter(`${c.integrationId}|connection:${c.id}`, mark),
		}));
		// KEEP: Reserve all provider locks before notifying observers that can start publishing the next account.
		const cleanup = getSupportedCloudIntegrationIds().map(id =>
			this.withLock(id, () => this.clearDepartedCloudCredentials(id, mark, sync.mark)),
		);
		this.state.onCloudLogout.fire(departing);
		const results = await Promise.allSettled([persist, ...cleanup]);
		const failure = results.find(result => result.status === 'rejected');
		if (failure != null) throw failure.reason;
		return this._disposed ? undefined : sync;
	}

	private persistCloudLogout(): Promise<void> {
		const pending = this.state.persistence.then(() =>
			this.ctx.storage.store(cloudLogoutKey, this.state.cloud.snapshotLogout()),
		);
		this.state.persistence = pending.catch(() => {});
		return pending;
	}

	private async clearDepartedCloudCredentials(id: IntegrationIds, cutoff: number, logout: number): Promise<void> {
		const connections = this.getConfigured(id);
		const ids = new Set(connections.map(c => c.id));
		ids.add(providersMetadata[id]?.domain || id);
		const failures: unknown[] = [];
		for (const connectionId of ids) {
			try {
				const localKey = this.getLocalSecretKey(id, connectionId);
				const raw = await this.ctx.storage.getSecret(localKey);
				if (raw != null && isLegacyCloudSecret(raw)) {
					await this.ctx.storage.deleteSecret(localKey);
					await this.removeConfigured(id, { connectionId: connectionId, cloud: false });
				}
				const scope = `${id}|connection:${connectionId}`;
				if (this.state.cloud.acquiredAfter(scope, cutoff)) continue;

				const departed = connections.find(c => c.id === connectionId && c.cloud);
				if (departed != null && this.state.cloud.depart(id, departed.domain, connectionId, logout)) {
					await this.persistCloudLogout();
				}
				try {
					await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id, connectionId));
				} finally {
					this.state.cloud.remove(scope);
					await this.removeConfigured(id, { connectionId: connectionId, cloud: true });
				}
			} catch (ex) {
				failures.push(ex);
			}
		}
		if (failures.length) throw new AggregateError(failures, 'Unable to clear retired cloud credentials.');
	}

	getCloudDeparture(id: IntegrationIds, session: ProviderAuthenticationSession): number | undefined {
		return session.cloud ? this.state.cloud.departedAt(id, session.domain, session.id) : undefined;
	}

	confirmHostCloudSession(
		id: IntegrationIds,
		session: ProviderAuthenticationSession,
		logout: number,
	): Promise<boolean> {
		return this.withLock(id, async () => {
			if (this._disposed) return false;

			const departure = this.getCloudDeparture(id, session);
			if (departure != null && logout < departure) return false;

			const stored = await this.peekSecret(id, session.id, true, session.domain);
			if (this._disposed || logout !== this.lastCloudLogout || stored === null) return false;
			if (stored === undefined) {
				return (
					departure == null &&
					!this.getConfigured(id, {
						cloud: true,
						domain: isSelfManagedHostIntegrationId(id) ? session.domain : undefined,
					}).some(c => c.id === session.id)
				);
			}

			return (
				stored.id === session.id &&
				stored.cloud &&
				stored.accessToken === session.accessToken &&
				(!stored.account.id || stored.account.id === session.account.id)
			);
		});
	}

	async acceptCloudSync(
		mark: number,
		connections: ReadonlyMap<IntegrationIds, readonly CloudIntegrationConnection[]>,
	): Promise<CloudIntegrationSync | undefined> {
		if (this._disposed) return undefined;

		const sync = this.state.cloud.accept(mark, connections);
		if (sync == null) return undefined;

		// KEEP: A previous sync may already have dispatched a storage operation under another provider lock.
		await Promise.all(this.state.locks.values());
		return !this._disposed && sync.isCurrent() ? sync : undefined;
	}

	supersedingPrimary(id: IntegrationIds, session: ProviderAuthenticationSession, mark: number): string | undefined {
		return this.state.cloud.supersedingPrimary(id, session.domain, session.id, mark);
	}

	hasNewCloudConnection(id: IntegrationIds, domain: string | undefined, mark: number): boolean {
		const scopedDomain = isSelfManagedHostIntegrationId(id) ? domain : undefined;
		return this.getConfigured(id, { cloud: true, domain: scopedDomain }).some(c =>
			this.state.cloud.observedSince(`${id}|connection:${c.id}`, mark),
		);
	}

	async dispatchHostListRetirement(
		id: IntegrationIds,
		domain: string,
		sync: CloudIntegrationSync,
		retire: () => Promise<void>,
	): Promise<boolean> {
		const dispatched = await this.withLock(id, () => {
			if (this._disposed || !sync.isCurrent() || this.hasNewCloudConnection(id, domain, sync.mark)) {
				return undefined;
			}

			// KEEP: The host can re-enter storage after dispatch, so it must settle outside the provider lock.
			return { settled: retire() };
		});
		if (dispatched == null) return false;

		await dispatched.settled;
		return !this._disposed && sync.isCurrent() && !this.hasNewCloudConnection(id, domain, sync.mark);
	}

	getStoredWriteMark(): number {
		return this.state.epoch;
	}

	isStoredWriteRetiredSince(
		id: IntegrationIds,
		session: Pick<ProviderAuthenticationSession, 'id' | 'domain' | 'cloud'>,
		mark: number,
	): boolean {
		return (
			this._disposed ||
			(session.cloud && this.state.cloud.loggedOutSince(mark)) ||
			this.hasRetirement(this.state.scopes, id, session, mark)
		);
	}

	async captureConfiguredConnection(id: IntegrationIds, connectionId: string): Promise<(() => boolean) | undefined> {
		const matches = this.getConfigured(id).filter(connection => connection.id === connectionId);
		const selected = matches.find(connection => connection.cloud) ?? matches[0];
		if (selected == null) return undefined;

		const mark = this.state.epoch;
		const scope = { id: connectionId, domain: selected.domain ?? '', cloud: selected.cloud };
		const current = () =>
			!this._disposed &&
			!(selected.cloud && this.state.cloud.loggedOutSince(mark)) &&
			!this.hasRetirement(this.state.removals, id, scope, mark) &&
			this.configured
				.get(id)
				?.some(connection => connection.id === connectionId && connection.cloud === selected.cloud) === true;
		return this.withLock(id, async () => {
			if (
				selected.cloud &&
				this.hasCloudLogout &&
				(await this.peekSecret(id, connectionId, true, scope.domain)) == null
			) {
				return undefined;
			}
			return current() ? current : undefined;
		});
	}

	private async duringRemoval(scope: string, cloud: boolean | undefined, remove: () => Promise<void>): Promise<void> {
		const key = cloud == null ? scope : `${scope}|${cloud}`;
		this.retirePendingStores(scope, cloud);
		this.state.removals.set(key, Infinity);
		try {
			await remove();
		} finally {
			const mark = ++this.state.epoch;
			this.state.removals.set(key, mark);
			this.state.signOuts.set(key, mark);
		}
	}

	captureStoredRelationshipCurrency(
		id: IntegrationIds,
		session: ProviderAuthenticationSession,
	): Promise<(() => boolean) | undefined> {
		return this.withLock(id, async () => {
			const mark = this.getStoredWriteMark();
			const stored = await this.peekSecret(id, session.id, session.cloud, session.domain);
			if (
				this.isStoredWriteRetiredSince(id, session, mark) ||
				stored == null ||
				!isSameAuthenticationSession(stored, session)
			) {
				return undefined;
			}

			const scope = `${id}|connection:${session.id}|${session.cloud}`;
			const expiries = this.state.expiries;
			if (expiries.get(scope) === null) return undefined;

			expiries.set(scope, sessionExpiry(stored.expiresAt));
			return () => !this.isStoredWriteRetiredSince(id, session, mark) && (expiries.get(scope) ?? 0) > Date.now();
		});
	}

	private retireStoredWrites(scope: string, cloud?: boolean): void {
		const retirements = this.state;
		retirements.scopes.set(cloud == null ? scope : `${scope}|${cloud}`, ++retirements.epoch);
		for (const variant of cloud == null ? [true, false] : [cloud]) {
			const key = `${scope}|${variant}`;
			if (retirements.expiries.get(key) !== null) {
				retirements.expiries.delete(key);
			}
		}
	}

	private getHostScope(id: IntegrationIds, domain: string): string {
		return `${id}|host:${hostFromDomain(domain) ?? domain}`;
	}

	isSessionRetiredSince(
		id: IntegrationIds,
		session: Pick<ProviderAuthenticationSession, 'id' | 'domain'> & { cloud?: boolean },
		mark: number,
		acquisitionMark = mark,
	): boolean {
		return (
			(session.cloud !== false && !this.state.cloud.allows(this.state.cloud.origin(mark))) ||
			this.hasRetirement(this.state.signOuts, id, session, mark) ||
			this.hasRetirement(this.state.publications, id, session, acquisitionMark)
		);
	}

	private hasRetirement(
		scopes: ReadonlyMap<string, number>,
		id: IntegrationIds,
		session: Pick<ProviderAuthenticationSession, 'id' | 'domain'> & { cloud?: boolean },
		mark: number,
	): boolean {
		const since = (scope: string) =>
			(scopes.get(scope) ?? 0) > mark ||
			(session.cloud !== false && (scopes.get(`${scope}|true`) ?? 0) > mark) ||
			(session.cloud !== true && (scopes.get(`${scope}|false`) ?? 0) > mark);
		if (since(id)) return true;
		if (isSelfManagedHostIntegrationId(id) && session.domain && since(this.getHostScope(id, session.domain))) {
			return true;
		}
		return since(`${id}|connection:${session.id}`);
	}

	/**
	 * Stores the session's secret and descriptor together. A pending store can be invalidated by a sign-out or a
	 * credential recovery. A recovery must still own the stored credential when it publishes its replacement.
	 */
	storeSession(
		id: IntegrationIds,
		session: ProviderAuthenticationSession,
		options?: {
			signOutMark?: number;
			acquisitionMark?: number;
			resource?: ConnectionResource;
			expectedStoredAccessToken?: string;
			primaryResponse?: 'named' | 'legacy';
			sync?: CloudIntegrationSync;
		},
	): Promise<boolean> {
		const origin = session.cloud
			? this.state.cloud.origin(options?.sync?.mark ?? options?.signOutMark ?? this.getSignOutMark())
			: undefined;
		return this.withLock(id, async () => {
			const canStore = () =>
				!this._disposed &&
				(origin == null || this.state.cloud.allows(origin)) &&
				options?.sync?.isCurrent() !== false &&
				(options?.signOutMark == null ||
					!this.isSessionRetiredSince(id, session, options.signOutMark, options.acquisitionMark));
			if (!canStore()) return false;

			const scope = `${id}|connection:${session.id}`;
			const expiryScope = `${scope}|${session.cloud}`;
			const expiries = this.state.expiries;
			const previous = await this.peekSecret(id, session.id, session.cloud, session.domain);
			if (
				(options?.primaryResponse === 'legacy' &&
					options.signOutMark != null &&
					this.state.cloud.observedSince(scope, options.signOutMark)) ||
				!canStore() ||
				(options?.expectedStoredAccessToken != null &&
					previous?.accessToken !== options.expectedStoredAccessToken)
			) {
				return false;
			}

			const changed = getSessionIdentity(previous) !== getSessionIdentity(session);
			const replaced = changed || previous?.account?.id !== session.account?.id;
			if (replaced) {
				this.retireStoredWrites(scope, session.cloud);
			}
			if (changed) {
				this._onWillChangeSession.fire({
					integrationId: id,
					session: session,
					previousDomain: previous?.domain,
				});
			}

			if (!canStore()) return false;

			const trackedExpiry = expiries.get(expiryScope);
			const nextExpiry = sessionExpiry(session.expiresAt);
			if (typeof trackedExpiry === 'number') {
				expiries.set(expiryScope, Math.min(trackedExpiry, nextExpiry));
			}
			const logoutAtDispatch = this.lastCloudLogout;
			try {
				await this.writeSecret(id, session, options?.resource, origin);
			} catch (ex) {
				if (origin != null && !this.state.cloud.allows(origin)) throw ex;

				this.retirePendingStores(scope, session.cloud);
				if (session.cloud) {
					this.state.cloud.observe(scope, this.state.epoch);
				}
				expiries.set(expiryScope, null);
				throw ex;
			}
			if (origin != null && !this.state.cloud.allows(origin)) return false;

			if (origin != null) {
				this.state.cloud.published(scope, origin.mark);
			}
			if (expiries.has(expiryScope)) {
				expiries.set(expiryScope, nextExpiry);
			}
			if (replaced || nextExpiry !== sessionExpiry(previous?.expiresAt)) {
				// KEEP: A write already dispatched at logout precedes acquisitions admitted after it.
				const mark =
					session.cloud && this.lastCloudLogout !== logoutAtDispatch
						? this.lastCloudLogout
						: ++this.state.epoch;
				this.state.publications.set(expiryScope, mark);
				if (
					options?.expectedStoredAccessToken != null &&
					session.accessToken !== options.expectedStoredAccessToken
				) {
					this.state.signOuts.set(expiryScope, mark);
				}
			}

			if (session.cloud && options?.primaryResponse !== 'legacy') {
				this.state.cloud.observe(
					scope,
					options?.sync?.isCurrent() === false ? options.sync.mark : ++this.state.epoch,
				);
				if (
					options?.primaryResponse === 'named' &&
					options.signOutMark != null &&
					options.sync?.isCurrent() !== false &&
					this.supersedingPrimary(id, session, options.signOutMark) == null
				) {
					const primaryMark = ++this.state.epoch;
					await this.setPrimaryConnectionCore(id, session.id);
					this.state.cloud.observePrimary(id, session.domain, session.id, primaryMark);
				}
			}
			return true;
		});
	}

	peekStoredSession(
		id: IntegrationIds,
		connectionId: string,
		cloud: boolean,
		domain: string,
	): Promise<ProviderAuthenticationSession | undefined> {
		return this.withLock(id, async () => {
			if (this._disposed) return undefined;

			const session = await this.peekSecret(id, connectionId, cloud, domain);
			return this._disposed ? undefined : (session ?? undefined);
		});
	}

	private async peekSecret(
		id: IntegrationIds,
		connectionId: string,
		cloud: boolean,
		domain: string,
	): Promise<ProviderAuthenticationSession | null | undefined> {
		const json = await this.ctx.storage.getSecret(this.getSecretKey(id, connectionId, cloud));
		if (json == null) return undefined;

		try {
			const stored = JSON.parse(json) as StoredSession;
			if (this.isRetiredSecret(stored, cloud)) return null;
			return convertStoredSessionToSession(
				stored,
				{ connectionId: connectionId, domain: domain, scopes: [] },
				cloud,
			);
		} catch {
			return undefined;
		}
	}

	private isRetiredSecret(session: StoredSession, cloud: boolean): boolean {
		if (!cloud && session.cloud !== false && session.expiresAt != null) return this.hasCloudLogout;
		return (cloud || session.cloud === true) && !this.state.cloud.allows(session.cloudOrigin);
	}

	getStoredSession(
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
	): Promise<ProviderAuthenticationSession | undefined> {
		return this.withLock(id, async () => {
			if (this._disposed) return undefined;

			const sessionId = this.resolveConnectionId(id, descriptor);
			let session = descriptor.cloud === true ? undefined : await this.readSecret(id, sessionId, false);
			if (this._disposed) return undefined;

			let cloudIfMissing = false;
			if (session != null && session.cloud !== false && session.expiresAt != null) {
				cloudIfMissing = true;
				try {
					await this.deleteSecrets(id, session.id);
					if (this.hasCloudLogout) return undefined;

					await this.writeSecret(id, { ...session, cloud: true });
				} catch {}
			}

			if (session == null && descriptor.cloud !== false) {
				cloudIfMissing = true;
				session = await this.readSecret(id, sessionId, true);
			}

			return this._disposed || (session != null && this.isRetiredSecret(session, cloudIfMissing))
				? undefined
				: convertStoredSessionToSession(session, descriptor, cloudIfMissing);
		});
	}

	/**
	 * Deletes one connection's stored session. `signOut` is for a delete that signs the integration out (a forced new
	 * session): it also refuses the store of any token of the provider, or of the descriptor's self-managed host,
	 * fetched before it (see {@link getSignOutMark}). A cleanup of a replaced token leaves it unset.
	 */
	deleteStoredSessions(
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		cloud?: boolean,
		options?: {
			preserveConfigured?: boolean;
			signOut?: boolean;
			signOutMark?: number;
			unobservedSince?: number;
			sync?: CloudIntegrationSync;
		},
	): Promise<boolean> {
		return this.withLock(id, async () => {
			if (this._disposed || options?.sync?.isCurrent() === false) return false;

			const connectionId = this.resolveConnectionId(id, descriptor);
			if (
				options?.unobservedSince != null &&
				this.state.cloud.observedSince(`${id}|connection:${connectionId}`, options.unobservedSince)
			) {
				return false;
			}

			if (
				options?.signOutMark != null &&
				this.isSessionRetiredSince(
					id,
					{ id: connectionId, domain: descriptor.domain, cloud: cloud },
					options.signOutMark,
				)
			) {
				return false;
			}

			if (options?.signOut) {
				this.retirePendingStores(
					isSelfManagedHostIntegrationId(id) && descriptor.domain
						? this.getHostScope(id, descriptor.domain)
						: id,
				);
			}
			await this.deleteSecrets(id, connectionId, cloud, {
				...options,
				onRemoving: () =>
					this._onWillRemoveSessions.fire({
						integrationId: id,
						connectionId: connectionId,
						cloud: cloud,
						domain: descriptor.domain,
					}),
			});
			return true;
		});
	}

	/** Signs out of every stored session of the provider, or of one self-managed host when `domain` is given. */
	deleteAllStoredSessions(
		id: IntegrationIds,
		cloud?: boolean,
		domain?: string,
		sync?: CloudIntegrationSync,
	): Promise<boolean> {
		const scope = isSelfManagedHostIntegrationId(id) && domain != null ? this.getHostScope(id, domain) : id;
		return this.withLock(id, async () => {
			if (
				this._disposed ||
				sync?.isCurrent() === false ||
				(sync && this.hasNewCloudConnection(id, domain, sync.mark))
			) {
				return false;
			}

			await this.duringRemoval(scope, cloud, async () => {
				this._onWillRemoveSessions.fire({ integrationId: id, cloud: cloud, domain: domain });
				if (this._disposed) return;

				await this.deleteAllSecrets(id, cloud, domain);
			});
			return !this._disposed;
		});
	}

	async purgeStoredConfiguration(ids: readonly string[]): Promise<void> {
		for (const id of ids as readonly IntegrationIds[]) {
			await this.withLock(id, async () => {
				const descriptors =
					this.ctx.storage.get<StoredIntegrationConfigurations>('integrations:configured')?.[id];
				if (descriptors == null) return;

				await this.duringRemoval(id, undefined, async () => {
					for (const descriptor of descriptors) {
						const key = descriptor.id || descriptor.domain || providersMetadata[id]?.domain || id;
						await this.ctx.storage.deleteSecret(this.getLocalSecretKey(id, key));
						await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id, key));
						if (descriptor.domain) {
							await this.ctx.storage.deleteWorkspace(`connected:${id}:${descriptor.domain}`);
						}
					}
					await this.storeConfigured(id);
				});
			});
		}
	}

	private async deleteSecrets(
		id: IntegrationIds,
		connectionId: string,
		cloud?: boolean,
		options?: { preserveConfigured?: boolean; onRemoving?: () => void },
	): Promise<void> {
		await this.duringRemoval(`${id}|connection:${connectionId}`, cloud, async () => {
			if (options?.onRemoving != null) {
				options.onRemoving();
				if (this._disposed) return;
			}

			if (cloud == null || cloud === false) {
				await this.ctx.storage.deleteSecret(this.getLocalSecretKey(id, connectionId));
			}

			if (cloud == null || cloud === true) {
				await this.ctx.storage.deleteSecret(this.getCloudSecretKey(id, connectionId));
				this.state.cloud.remove(`${id}|connection:${connectionId}`);
			}

			if (options?.preserveConfigured) return;

			await this.removeConfigured(id, { connectionId: connectionId, cloud: cloud });
		});
	}

	private async deleteAllSecrets(id: IntegrationIds, cloud?: boolean, domain?: string): Promise<void> {
		// Delete every connection's secret (multi-account): secrets are keyed per connection id, so a
		// single canonical-domain delete would orphan secondary tokens. When a domain is given (self-managed
		// disconnect of one host), scope to that host so other hosts under the same provider id survive.
		const descriptors = this.configured.get(id);
		const connectionIds = [
			...new Set(
				(domain != null ? descriptors?.filter(c => this.domainsMatch(id, c.domain, domain)) : descriptors)?.map(
					c => c.id,
				) ?? [],
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

	private async writeSecret(
		id: IntegrationIds,
		session: ProviderAuthenticationSession | StoredSession,
		resource?: ConnectionResource,
		cloudOrigin?: CloudCredentialOrigin,
	): Promise<void> {
		await this.ctx.storage.storeSecret(
			this.getSecretKey(id, session.id, session.cloud ?? false),
			JSON.stringify(cloudOrigin == null ? session : { ...session, cloudOrigin: cloudOrigin }),
		);

		await this.addOrUpdateConfigured({
			id: session.id,
			integrationId: id,
			domain: isSelfManagedHostIntegrationId(id) ? session.domain : undefined,
			baseUrl: isSelfManagedHostIntegrationId(id) ? session.baseUrl : undefined,
			expiresAt: session.expiresAt,
			scopes: session.scopes.join(','),
			cloud: session.cloud ?? false,
			type: session.type,
			accountName: session.account?.label || undefined,
			resourceName: resource?.name,
			resourceId: resource?.id,
		});
	}

	private async readSecret(
		id: IntegrationIds,
		sessionId: string,
		cloud: boolean = false,
	): Promise<StoredSession | undefined> {
		let storedSession: StoredSession | undefined;
		try {
			const sessionJSON = await this.ctx.storage.getSecret(this.getSecretKey(id, sessionId, cloud));
			if (this._disposed) return undefined;

			if (sessionJSON) {
				storedSession = JSON.parse(sessionJSON);
				if (storedSession != null) {
					if (this.isRetiredSecret(storedSession, cloud)) return undefined;

					const configured = this.configured.get(id);
					const connectionId = storedSession.id ?? sessionId;
					const sessionCloud = storedSession.cloud ?? cloud;
					const domain = isSelfManagedHostIntegrationId(id)
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
							// Rebuilt from the secret, so it must carry the address the session does; omitting it
							// leaves the descriptor claiming no context path and makes reconcile read every
							// routine check-in as a re-pointed connection.
							baseUrl: isSelfManagedHostIntegrationId(id) ? storedSession.baseUrl : undefined,
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
			if (this._disposed) return undefined;

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
		return isSelfManagedHostIntegrationId(id)
			? descriptors.filter(d => this.isInPrimaryScope(id, d, domain))
			: descriptors;
	}

	private isInPrimaryScope(
		id: IntegrationIds,
		descriptor: ConfiguredIntegrationDescriptor,
		domain: string | undefined,
	): boolean {
		return !isSelfManagedHostIntegrationId(id) || this.domainsMatch(id, descriptor.domain, domain);
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

		const domain = isSelfManagedHostIntegrationId(id) ? descriptor.domain : undefined;
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
	/**
	 * The address already stored for a self-managed connection — see {@link ConfiguredIntegrationDescriptor.baseUrl}.
	 *
	 * Exists so a session rebuilt from a backend response that omits the domain can keep the address the
	 * connection was configured with, rather than silently falling back to the bare host and losing a context
	 * path the user never changed. Looked up by connection id first, then by host for an unscoped fetch.
	 */
	/**
	 * Whether `connectionId` names a cloud connection configured for `domain`'s host.
	 *
	 * The caller-facing question is "is this id evidence that a token belongs to this host". A connection id
	 * can arrive from a caller rather than from our own configuration, so it is only evidence once it matches
	 * a descriptor we stored for that host — see the host guard in `CloudIntegrationAuthenticationProvider`.
	 */
	isConnectionConfiguredForHost(
		id: IntegrationIds,
		connectionId: string | undefined,
		domain: string | undefined,
	): boolean {
		if (connectionId == null) return false;

		const connection = this.getConfigured(id, { cloud: true }).find(c => c.id === connectionId);
		if (connection == null) return false;

		return !isSelfManagedHostIntegrationId(id) || this.domainsMatch(id, connection.domain, domain);
	}

	getConfiguredBaseUrl(id: IntegrationIds, connectionId: string | undefined, domain?: string): string | undefined {
		if (!isSelfManagedHostIntegrationId(id)) return undefined;

		const configured = this.getConfigured(id, { cloud: true });
		const byId = connectionId != null ? configured.find(c => c.id === connectionId) : undefined;
		if (byId != null) return byId.baseUrl;

		return configured.find(c => this.domainsMatch(id, c.domain, domain))?.baseUrl;
	}

	getConfiguredConnectionId(id: IntegrationIds, domain: string | undefined, cloud?: boolean): string | undefined {
		const scoped = isSelfManagedHostIntegrationId(id) ? domain : undefined;
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
		const candidates = this.configured.get(id)?.filter(c => this.domainsMatch(id, c.domain, domain));
		if (cloud == null || candidates == null) return candidates;

		const scoped = candidates.filter(c => c.cloud === cloud);
		return scoped.length ? scoped : candidates;
	}

	/**
	 * Marks the given connection as the primary/default for the provider and clears the flag on its
	 * siblings. Persists immediately instead of relying on a session re-store to carry the primary flag.
	 */
	setPrimaryConnection(
		id: IntegrationIds,
		connectionId: string,
		list?: { sync: CloudIntegrationSync; domain?: string },
	): Promise<void> {
		return this.withLock(id, async () => {
			if (this._disposed) return;

			if (
				list != null &&
				(!list.sync.isCurrent() ||
					this.state.cloud.supersedingPrimary(id, list.domain, connectionId, list.sync.mark) != null)
			) {
				return;
			}

			await this.setPrimaryConnectionCore(id, connectionId);
			if (list != null || this._disposed) return;

			const selected = this.getConfigured(id, { cloud: true }).find(c => c.id === connectionId && c.primary);
			if (selected != null) {
				const mark = ++this.state.epoch;
				this.state.cloud.observe(`${id}|connection:${connectionId}`, mark);
				this.state.cloud.observePrimary(id, selected.domain, connectionId, mark);
			}
		});
	}

	private async setPrimaryConnectionCore(id: IntegrationIds, connectionId: string): Promise<void> {
		const descriptors = this.configured.get(id);
		if (descriptors == null || descriptors.length === 0) return;
		if (!descriptors.some(d => d.id === connectionId)) return;

		const target =
			descriptors.find(d => d.id === connectionId && d.cloud) ?? descriptors.find(d => d.id === connectionId);
		if (target == null) return;

		const domain = isSelfManagedHostIntegrationId(id) ? target.domain : undefined;
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

		await this.storeConfigured(id, updated);
		this.fireChange(id);
	}

	/**
	 * Removes a single connection (its secret + configured descriptor). If it was the primary and other
	 * connections remain, a secondary is promoted (see {@link removeConfigured}). Unlike
	 * {@link deleteAllStoredSessions}, this only affects the targeted connection. Pass `cloud` to scope
	 * the removal to the cloud/local variant when a local PAT and a cloud session share a connection id.
	 */
	deleteConnection(id: IntegrationIds, connectionId: string, cloud?: boolean): Promise<void> {
		return this.withLock(id, async () => {
			if (this._disposed) return;

			await this.deleteSecrets(id, connectionId, cloud, {
				onRemoving: () =>
					this._onWillRemoveSessions.fire({ integrationId: id, connectionId: connectionId, cloud: cloud }),
			});
		});
	}

	private _addedIds = new Set<IntegrationIds>();
	private _removedIds = new Set<IntegrationIds>();
	private _fireChangeDebounced?: () => void;

	private normalizeConfiguredDomain(id: IntegrationIds, domain: string | undefined): string | undefined {
		if (!isSelfManagedHostIntegrationId(id)) return domain;

		return hostFromDomain(domain) ?? domain;
	}

	private domainsMatch(id: IntegrationIds, first: string | undefined, second: string | undefined): boolean {
		if (first === second) return true;
		if (!isSelfManagedHostIntegrationId(id)) return false;
		if (first == null || second == null) return false;

		return areDomainsOnSameHost(first, second);
	}

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

function isLegacyCloudSecret(raw: string): boolean {
	try {
		const session = JSON.parse(raw) as StoredSession;
		return session?.cloud === true || (session?.cloud !== false && session?.expiresAt != null);
	} catch {
		return false;
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
		baseUrl: getStoredBaseUrl(storedSession.baseUrl, storedSession.domain, storedSession.protocol),
		protocol: storedSession.protocol,
		type: storedSession.type,
		// Carried for providers whose client needs an app key alongside the token (e.g. Trello); without
		// this a rehydrated session silently loses the key and every read no-ops.
		appKey: storedSession.appKey,
	};
}

function getStoredBaseUrl(
	baseUrl: string | undefined,
	domain: string | undefined,
	protocol?: string,
): string | undefined {
	if (baseUrl != null) return baseUrl;

	const legacyUrl = baseUrlFromDomain(domain, protocol);
	return legacyUrl != null && new URL(legacyUrl).pathname !== '/' ? legacyUrl : undefined;
}
