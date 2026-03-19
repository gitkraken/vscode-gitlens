import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { RemoteProviderId } from '../models/remoteProvider.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import { GerritRemoteProvider } from './gerrit.js';

export class GoogleSourceRemoteProvider extends GerritRemoteProvider {
	constructor(
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom: boolean = false,
		context?: RemoteProviderContext,
	) {
		super(domain, path, protocol, name, custom, false, context);
	}

	override get id(): RemoteProviderId {
		return 'google-source';
	}

	override get gkProviderId(): GkProviderId | undefined {
		return undefined;
	}

	override get name(): string {
		return this.formatName('Google Source');
	}

	protected override get issueLinkPattern(): string {
		throw new Error('unsupported');
	}

	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		return [];
	}

	protected override get baseUrl(): string {
		return `${this.protocol}://${this.domain}/${this.path}`;
	}

	private get reviewDomain(): string {
		const [subdomain, ...domains] = this.domain.split('.');
		return [`${subdomain}-review`, ...domains].join('.');
	}

	protected override get baseReviewUrl(): string {
		return `${this.protocol}://${this.reviewDomain}`;
	}
}
