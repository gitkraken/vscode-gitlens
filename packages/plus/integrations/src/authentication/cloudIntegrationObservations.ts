import { uuid } from '@gitlens/utils/crypto.js';
import type { IntegrationIds } from '../constants.js';
import { hostFromDomain } from '../utils/domain.utils.js';
import { isSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import type { CloudIntegrationConnection, ConfiguredIntegrationDescriptor } from './models.js';

export interface CloudIntegrationSync {
	readonly mark: number;
	isCurrent(): boolean;
}

type CloudOrder = { owner: string; mark: number };
type CloudLogout = CloudOrder & { departures: readonly string[] };
export type CloudCredentialOrigin = CloudOrder & { after?: string };

export class CloudIntegrationObservations {
	private readonly owner = uuid();
	private readonly acquisitions = new Map<string, number>();
	// KEEP: Request ordinals belong to one storage owner; a reopened owner records which durable logout it followed.
	private readonly inheritedLogout?: string;
	private _logout?: CloudOrder;
	get hasLogout(): boolean {
		return this._logout != null;
	}

	snapshotLogout(): CloudLogout | undefined {
		return this._logout && { ...this._logout, departures: [...this.departures.keys()] };
	}

	constructor(previousLogout?: CloudLogout) {
		this._logout = previousLogout;
		if (previousLogout != null) {
			this.inheritedLogout = `${previousLogout.owner}:${previousLogout.mark}`;
			for (const scope of previousLogout.departures) {
				this.departures.set(scope, 0);
			}
		}
	}

	origin(mark: number): CloudCredentialOrigin {
		return { owner: this.owner, mark: mark, after: this.inheritedLogout };
	}

	allows(origin: CloudCredentialOrigin | undefined): boolean {
		const logout = this._logout;
		return (
			logout == null ||
			(origin != null &&
				(origin.owner === logout.owner
					? origin.mark > logout.mark
					: origin.after === `${logout.owner}:${logout.mark}`))
		);
	}

	published(scope: string, mark: number): void {
		this.acquisitions.set(scope, mark);
	}

	acquiredAfter(scope: string, mark: number): boolean {
		return (this.acquisitions.get(scope) ?? 0) > mark;
	}

	private latestSync = 0;
	private _lastLogout = 0;
	get lastLogout(): number {
		return this._lastLogout;
	}
	private readonly connections = new Map<string, number>();
	private readonly departures = new Map<string, number>();
	private readonly primaries = new Map<string, { connectionId: string; mark: number }>();

	acceptLogout(
		request: number,
		mark: number,
		connections: readonly ConfiguredIntegrationDescriptor[],
	): CloudIntegrationSync | undefined {
		if (this._logout?.owner === this.owner && request <= this._logout.mark) return undefined;

		for (const connection of connections) {
			this.depart(connection.integrationId, connection.domain, connection.id, mark);
		}
		this._logout = { owner: this.owner, mark: request };
		this._lastLogout = mark;
		this.latestSync = Math.max(this.latestSync, request);
		return { mark: mark, isCurrent: () => this.latestSync === request };
	}

	accept(
		mark: number,
		connections: ReadonlyMap<IntegrationIds, readonly CloudIntegrationConnection[]>,
	): CloudIntegrationSync | undefined {
		if (mark <= this.latestSync) return undefined;

		this.latestSync = mark;
		for (const [id, entries] of connections) {
			for (const connection of entries) {
				if (connection.id == null) continue;

				this.observe(`${id}|connection:${connection.id}`, mark);
				if (connection.primary) {
					this.observePrimary(id, connection.domain, connection.id, mark);
				}
			}
		}
		return { mark: mark, isCurrent: () => this.latestSync === mark };
	}

	loggedOutSince(mark: number): boolean {
		return this.lastLogout > mark;
	}

	observe(scope: string, mark: number): void {
		this.connections.set(scope, Math.max(mark, this.connections.get(scope) ?? 0));
	}

	observedSince(scope: string, mark: number): boolean {
		return (this.connections.get(scope) ?? 0) > mark;
	}

	remove(scope: string): void {
		this.connections.delete(scope);
		this.acquisitions.delete(scope);
	}

	depart(id: IntegrationIds, domain: string | undefined, connectionId: string, mark: number): boolean {
		const scope = JSON.stringify([this.primaryScope(id, domain), connectionId]);
		const previous = this.departures.get(scope);
		this.departures.set(scope, Math.max(mark, previous ?? 0));
		return previous == null;
	}

	departedAt(id: IntegrationIds, domain: string, connectionId: string): number | undefined {
		return this.departures.get(JSON.stringify([this.primaryScope(id, domain), connectionId]));
	}

	observePrimary(id: IntegrationIds, domain: string | undefined, connectionId: string, mark: number): void {
		const scope = this.primaryScope(id, domain);
		if ((this.primaries.get(scope)?.mark ?? 0) <= mark) {
			this.primaries.set(scope, { connectionId: connectionId, mark: mark });
		}
	}

	supersedingPrimary(
		id: IntegrationIds,
		domain: string | undefined,
		connectionId: string,
		mark: number,
	): string | undefined {
		const primary = this.primaries.get(this.primaryScope(id, domain));
		return primary != null && primary.mark > mark && primary.connectionId !== connectionId
			? primary.connectionId
			: undefined;
	}

	private primaryScope(id: IntegrationIds, domain?: string): string {
		return isSelfManagedHostIntegrationId(id) && domain ? `${id}|host:${hostFromDomain(domain) ?? domain}` : id;
	}
}
