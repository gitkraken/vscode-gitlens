import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Event } from '@gitlens/utils/event.js';
import { areDomainsOnSameHost, hostFromDomain } from '../utils/domain.utils.js';
import type {
	GetSessionOptions,
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession, SessionPublication } from './models.js';
import { getSessionIdentity } from './models.js';

type Observation = {
	request: number;
	identity: string | undefined;
	descriptorDomain: string;
	actualDomain: string;
	cloud: boolean | undefined;
	sessionKey?: string;
	sessionId?: string;
	connectionId?: string;
};

type Retirement = {
	descriptors: Set<string>;
	actuals: Set<string>;
	host?: string;
	all?: boolean;
};

function domainKey(domain: string): string {
	return hostFromDomain(domain) ?? domain;
}

function descriptorKey(domain: string, connectionId: string | undefined, cloud: boolean | undefined): string {
	return JSON.stringify([domainKey(domain), connectionId, cloud]);
}

function actualKey(domain: string, id: string, cloud: boolean | undefined): string {
	return JSON.stringify([domainKey(domain), id, cloud]);
}

export class ObservedAuthenticationProvider implements IntegrationAuthenticationProvider {
	private readonly observations = new Map<string, Observation>();
	private readonly credentials = new Map<string, Observation>();
	private readonly descriptorRetirements = new Map<string, number>();
	private readonly actualRetirements = new Map<string, number>();
	private readonly hostRetirements = new Map<string, number>();
	private readonly activeRetirements = new Set<Retirement>();
	private sequence = 0;
	private globalRetirement = 0;
	private disposed = false;

	constructor(
		private readonly host: IntegrationAuthenticationProvider,
		private readonly selfManaged: boolean,
		private readonly publish: (publication: SessionPublication, domains: (string | undefined)[]) => void,
	) {}

	get onDidChange(): Event<void> {
		return this.host.onDidChange;
	}

	async getSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: GetSessionOptions,
	): Promise<ProviderAuthenticationSession | undefined> {
		if (this.disposed) return undefined;

		const request = ++this.sequence;
		const scope = JSON.stringify([
			descriptor.connectionId,
			domainKey(descriptor.domain),
			descriptor.cloud,
			descriptor.scopes,
		]);
		const source = await this.host.getSession(descriptor, options);
		if (source != null && this.selfManaged && !areDomainsOnSameHost(descriptor.domain, source.domain)) {
			throw new CancellationError();
		}
		if (this.isRetired(request, descriptor, source)) throw new CancellationError();

		const identity = getSessionIdentity(source);
		const previous = this.observations.get(scope);
		const sessionKey =
			source == null
				? (previous?.sessionKey ??
					(descriptor.connectionId
						? actualKey(descriptor.domain, descriptor.connectionId, descriptor.cloud ?? true)
						: undefined))
				: actualKey(source.domain || descriptor.domain, source.id, source.cloud);
		const credential = sessionKey == null ? undefined : this.credentials.get(sessionKey);
		const latest =
			credential != null && (previous == null || credential.request > previous.request) ? credential : previous;
		if (latest != null && latest.request > request && latest.identity !== identity) {
			throw new CancellationError();
		}

		const session: ProviderAuthenticationSession | undefined =
			source == null
				? undefined
				: {
						id: source.id,
						accessToken: source.accessToken,
						account: source.account,
						scopes: source.scopes,
						cloud: source.cloud,
						type: source.type,
						expiresAt: source.expiresAt,
						domain: source.domain,
						baseUrl: source.baseUrl,
						protocol: source.protocol,
						appKey: source.appKey,
					};
		if (latest == null || latest.request <= request) {
			if (previous == null || previous.identity !== identity || credential?.identity !== identity) {
				this.publish(
					{
						session: session,
						previousSessionId: latest?.sessionId ?? descriptor.connectionId,
						connectionId: descriptor.connectionId,
						cloud: session != null ? session.cloud : (latest?.cloud ?? descriptor.cloud),
						replacePrimary: !descriptor.connectionId,
					},
					[descriptor.domain, session?.domain, previous?.actualDomain],
				);
			}

			const observation: Observation = {
				request: request,
				identity: identity,
				descriptorDomain: descriptor.domain,
				actualDomain: session?.domain || descriptor.domain,
				cloud: session?.cloud ?? descriptor.cloud,
				sessionKey: sessionKey,
				sessionId: source?.id ?? latest?.sessionId ?? descriptor.connectionId,
				connectionId: descriptor.connectionId,
			};
			this.observations.set(scope, observation);
			if (sessionKey != null) {
				this.credentials.set(sessionKey, observation);
			}
		}

		return session;
	}

	async deleteSession(
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?: { preserveConfigured?: boolean },
	): Promise<void> {
		const retirement = this.retireConnection(descriptor);
		this.activeRetirements.add(retirement);
		try {
			await this.host.deleteSession(descriptor, options);
		} finally {
			this.markRetirement(retirement);
			this.activeRetirements.delete(retirement);
		}
	}

	async deleteAllSessions(descriptor?: IntegrationAuthenticationSessionDescriptor): Promise<void> {
		const retirement = this.retireAll(this.selfManaged ? descriptor?.domain : undefined);
		this.activeRetirements.add(retirement);
		try {
			await this.host.deleteAllSessions(descriptor);
		} finally {
			this.markRetirement(retirement);
			this.activeRetirements.delete(retirement);
		}
	}

	dispose(): void {
		if (this.disposed) return;

		this.disposed = true;
		this.retireAll();
		this.host.dispose();
	}

	private isRetired(
		request: number,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		session: ProviderAuthenticationSession | undefined,
	): boolean {
		if (this.disposed || request < this.globalRetirement) return true;

		const host = domainKey(descriptor.domain);
		const variants = new Set([undefined, descriptor.cloud, session?.cloud]);
		if (descriptor.cloud == null && session?.cloud == null) {
			variants.add(true);
			variants.add(false);
		}
		const descriptorIdentities = Array.from(variants, cloud =>
			descriptorKey(descriptor.domain, descriptor.connectionId, cloud),
		);
		const actual =
			session == null ? undefined : actualKey(session.domain || descriptor.domain, session.id, session.cloud);
		const actualAnyVariant =
			session == null ? undefined : actualKey(session.domain || descriptor.domain, session.id, undefined);
		if (
			request < (this.hostRetirements.get(host) ?? 0) ||
			descriptorIdentities.some(key => request < (this.descriptorRetirements.get(key) ?? 0)) ||
			(actual != null && request < (this.actualRetirements.get(actual) ?? 0)) ||
			(actualAnyVariant != null && request < (this.actualRetirements.get(actualAnyVariant) ?? 0))
		) {
			return true;
		}

		for (const retirement of this.activeRetirements) {
			if (
				retirement.all ||
				retirement.host === host ||
				descriptorIdentities.some(key => retirement.descriptors.has(key)) ||
				(actual != null && retirement.actuals.has(actual)) ||
				(actualAnyVariant != null && retirement.actuals.has(actualAnyVariant))
			) {
				return true;
			}
		}

		return false;
	}

	private retireConnection(descriptor: IntegrationAuthenticationSessionDescriptor): Retirement {
		const host = domainKey(descriptor.domain);
		const matching = [...this.observations.values()].filter(o => {
			if (domainKey(o.descriptorDomain) !== host && domainKey(o.actualDomain) !== host) return false;
			if (descriptor.cloud != null && o.cloud !== descriptor.cloud) return false;
			return descriptor.connectionId == null
				? o.connectionId == null
				: o.connectionId === descriptor.connectionId || o.sessionId === descriptor.connectionId;
		});
		const actuals = new Set(
			matching
				.filter((o): o is Observation & { sessionId: string } => o.sessionId != null)
				.map(o => actualKey(o.actualDomain, o.sessionId, o.cloud)),
		);
		if (descriptor.connectionId != null) {
			actuals.add(actualKey(descriptor.domain, descriptor.connectionId, descriptor.cloud));
		}

		const targets = [...this.observations.values()].filter(o => {
			if (descriptor.cloud != null && o.cloud !== descriptor.cloud) return false;
			return (
				matching.includes(o) ||
				(o.sessionId != null && actuals.has(actualKey(o.actualDomain, o.sessionId, o.cloud)))
			);
		});
		const retirement: Retirement = { descriptors: new Set(), actuals: new Set() };
		retirement.descriptors.add(descriptorKey(descriptor.domain, descriptor.connectionId, descriptor.cloud));
		if (descriptor.connectionId != null) {
			retirement.actuals.add(actualKey(descriptor.domain, descriptor.connectionId, descriptor.cloud));
		}

		for (const target of targets) {
			this.addTarget(retirement, target);
			this.publish(
				{
					previousSessionId: target.sessionId,
					connectionId: target.connectionId,
					cloud: target.cloud,
					replacePrimary: target.connectionId == null,
				},
				[target.descriptorDomain, target.actualDomain],
			);
		}

		if (targets.every(target => target.connectionId !== descriptor.connectionId)) {
			this.publish(
				{
					previousSessionId: descriptor.connectionId,
					connectionId: descriptor.connectionId,
					cloud: descriptor.cloud,
					replacePrimary: descriptor.connectionId == null,
				},
				[descriptor.domain],
			);
		}

		this.removeTargets(targets);
		this.markRetirement(retirement);
		return retirement;
	}

	private retireAll(domain?: string): Retirement {
		const host = domain == null ? undefined : domainKey(domain);
		const retirement: Retirement = { descriptors: new Set(), actuals: new Set(), host: host, all: host == null };
		const targets = [...this.observations.values()].filter(
			o => host == null || domainKey(o.descriptorDomain) === host || domainKey(o.actualDomain) === host,
		);
		for (const target of targets) {
			this.addTarget(retirement, target);
			this.publish(
				{
					previousSessionId: target.sessionId,
					connectionId: target.connectionId,
					cloud: target.cloud,
					replacePrimary: target.connectionId == null,
				},
				[target.descriptorDomain, target.actualDomain],
			);
		}

		if (targets.length === 0) {
			this.publish({ replacePrimary: true }, [domain]);
		}

		this.removeTargets(targets);
		this.markRetirement(retirement);
		return retirement;
	}

	private addTarget(retirement: Retirement, observation: Observation): void {
		retirement.descriptors.add(
			descriptorKey(observation.descriptorDomain, observation.connectionId, observation.cloud),
		);
		if (observation.sessionId != null) {
			retirement.actuals.add(actualKey(observation.actualDomain, observation.sessionId, observation.cloud));
		}
	}

	private removeTargets(targets: Observation[]): void {
		const removed = new Set(targets);
		for (const [key, observation] of this.observations) {
			if (removed.has(observation)) {
				this.observations.delete(key);
			}
		}

		for (const [key, observation] of this.credentials) {
			if (removed.has(observation)) {
				this.credentials.delete(key);
			}
		}
	}

	private markRetirement(retirement: Retirement): void {
		const mark = ++this.sequence;
		if (retirement.all) {
			this.globalRetirement = mark;
		}
		if (retirement.host != null) {
			this.hostRetirements.set(retirement.host, mark);
		}
		for (const key of retirement.descriptors) {
			this.descriptorRetirements.set(key, mark);
		}

		for (const key of retirement.actuals) {
			this.actualRetirements.set(key, mark);
		}
	}
}
