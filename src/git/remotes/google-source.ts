import { GerritRemote } from './gerrit';

export class GoogleSourceRemote extends GerritRemote {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom, false);
	}

	override get id() {
		return 'google-source';
	}

	override get name() {
		return this.formatName('Google Source');
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
