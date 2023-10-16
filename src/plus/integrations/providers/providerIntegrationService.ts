import type { Container } from '../../../container';
import { AzureDevOpsIntegration } from './azureDevOps';
import { BitbucketIntegration } from './bitbucket';
import { GitHubEnterpriseIntegration, GitHubIntegration } from './github';
import { GitLabIntegration } from './gitlab';
import { ProviderId } from './models';
import type { ProviderIntegration, ProviderKey, SupportedProviderIds } from './providerIntegration';
import { ProvidersApi } from './providersApi';

export class ProviderIntegrationService {
	private _providers = new Map<ProviderKey, ProviderIntegration>();
	private _providersApi: ProvidersApi;
	constructor(private readonly container: Container) {
		this._providersApi = new ProvidersApi(container);
	}

	get(id: SupportedProviderIds, domain?: string): ProviderIntegration {
		const key: ProviderKey = `${id}|${domain}`;
		let provider = this._providers.get(key);
		if (provider == null) {
			switch (id) {
				case ProviderId.GitHub:
					provider = new GitHubIntegration(this.container, this._providersApi);
					break;
				case ProviderId.GitHubEnterprise:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitHubEnterpriseIntegration(this.container, this._providersApi, domain);
					break;
				case ProviderId.GitLab:
					provider = new GitLabIntegration(this.container, this._providersApi);
					break;
				case ProviderId.Bitbucket:
					provider = new BitbucketIntegration(this.container, this._providersApi);
					break;
				case ProviderId.AzureDevOps:
					provider = new AzureDevOpsIntegration(this.container, this._providersApi);
					break;
				default:
					throw new Error(`Provider '${id}' is not supported`);
			}
			this._providers.set(key, provider);
		}

		return provider;
	}
}
