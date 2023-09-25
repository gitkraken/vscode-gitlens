import type { Container } from '../../container';
import { GitHubEnterpriseIntegration, GitHubIntegration } from './github';
import type { ProviderIntegration, ProviderKey, SupportedProviderIds } from './providerIntegration';

export class ProviderIntegrationService {
	private _providers = new Map<ProviderKey, ProviderIntegration>();
	constructor(private readonly container: Container) {}

	get(id: SupportedProviderIds, domain?: string): ProviderIntegration {
		const key: ProviderKey = `${id}|${domain}`;
		let provider = this._providers.get(key);
		if (provider == null) {
			switch (id) {
				case 'github':
					provider = new GitHubIntegration(this.container);
					break;
				case 'github-enterprise':
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitHubEnterpriseIntegration(this.container, domain);
					break;
			}
			this._providers.set(key, provider);
		}

		return provider;
	}
}
