import type { Container } from '../../container';
import type { SearchedIssue } from '../../git/models/issue';
import type { SearchedPullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import type { RemoteProviderId } from '../../git/remotes/remoteProvider';
import { debug } from '../../system/decorators/log';
import type { ProviderIntegration, ProviderKey, SupportedProviderIds } from './providerIntegration';
import { AzureDevOpsIntegration } from './providers/azureDevOps';
import { BitbucketIntegration } from './providers/bitbucket';
import { GitHubEnterpriseIntegration, GitHubIntegration } from './providers/github';
import { GitLabIntegration, GitLabSelfHostedIntegration } from './providers/gitlab';
import { ProviderId } from './providers/models';
import { ProvidersApi } from './providers/providersApi';

export class IntegrationService {
	private _integrations = new Map<ProviderKey, ProviderIntegration>();
	private _providersApi: ProvidersApi;

	constructor(private readonly container: Container) {
		this._providersApi = new ProvidersApi(container);
	}

	get(id: SupportedProviderIds, domain?: string): ProviderIntegration {
		const key: ProviderKey = `${id}|${domain}`;
		let provider = this._integrations.get(key);
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
				case ProviderId.GitLabSelfHosted:
					if (domain == null) throw new Error(`Domain is required for '${id}' integration`);
					provider = new GitLabSelfHostedIntegration(this.container, this._providersApi, domain);
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
			this._integrations.set(key, provider);
		}

		return provider;
	}

	getByRemote(remote: GitRemote): ProviderIntegration | undefined {
		if (remote?.provider == null) return undefined;

		const id = convertRemoteIdToProviderId(remote.provider.id);
		return id != null ? this.get(id, remote.domain) : undefined;
	}

	@debug<IntegrationService['getMyIssues']>({ args: { 0: r => r.name } })
	async getMyIssues(remote: GitRemote): Promise<SearchedIssue[] | undefined> {
		if (remote?.provider == null) return undefined;

		const provider = this.getByRemote(remote);
		return provider?.searchMyIssues();
	}

	@debug<IntegrationService['getMyPullRequests']>({ args: { 0: r => r.name } })
	async getMyPullRequests(remote: GitRemote): Promise<SearchedPullRequest[] | undefined> {
		if (remote?.provider == null) return undefined;

		const provider = this.getByRemote(remote);
		return provider?.searchMyPullRequests();
	}

	supports(remoteId: RemoteProviderId): boolean {
		return convertRemoteIdToProviderId(remoteId) != null;
	}
}

function convertRemoteIdToProviderId(remoteId: RemoteProviderId): SupportedProviderIds | undefined {
	switch (remoteId) {
		case 'azure-devops':
			return ProviderId.AzureDevOps;
		case 'bitbucket':
		case 'bitbucket-server':
			return ProviderId.Bitbucket;
		case 'github':
			return ProviderId.GitHub;
		case 'gitlab':
			return ProviderId.GitLab;
		default:
			return undefined;
	}
}
