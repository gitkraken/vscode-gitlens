import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks';
import type { GkProviderId } from '../../gk/models/repositoryIdentities';
import { GerritRemote } from './gerrit';
import type { RemoteProviderId } from './remoteProvider';

export class GoogleSourceRemote extends GerritRemote {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom, false);
	}

	override get id(): RemoteProviderId {
		return 'google-source';
	}

	override get gkProviderId(): GkProviderId | undefined {
		return undefined; // TODO@eamodio DRAFTS add this when supported by backend
	}

	override get name() {
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
