import type { Disposable } from 'vscode';
import type { IntegrationIds } from '../../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations';
import type { Container } from '../../../container';
import { gate } from '../../../system/decorators/-webview/gate';
import { log } from '../../../system/decorators/log';
import { supportedIntegrationIds } from '../utils/-webview/integration.utils';
import type { ConfiguredIntegrationService } from './configuredIntegrationService';
import type { IntegrationAuthenticationProvider } from './integrationAuthenticationProvider';
import { BuiltInAuthenticationProvider } from './integrationAuthenticationProvider';
import { isSupportedCloudIntegrationId } from './models';

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationIds, IntegrationAuthenticationProvider>();

	constructor(
		private readonly container: Container,
		private readonly configuredIntegrationService: ConfiguredIntegrationService,
	) {}

	dispose(): void {
		this.providers.forEach(p => void p.dispose());
		this.providers.clear();
	}

	async get(providerId: IntegrationIds): Promise<IntegrationAuthenticationProvider> {
		return this.ensureProvider(providerId);
	}

	@log()
	async reset(): Promise<void> {
		// TODO: This really isn't ideal, since it will only work for "cloud" providers as we won't have any more specific descriptors
		await Promise.allSettled(
			supportedIntegrationIds.map(async providerId =>
				(await this.ensureProvider(providerId)).deleteAllSessions(),
			),
		);
	}

	supports(providerId: string): boolean {
		switch (providerId) {
			case GitCloudHostIntegrationId.AzureDevOps:
			case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			case GitCloudHostIntegrationId.Bitbucket:
			case GitSelfManagedHostIntegrationId.GitHubEnterprise:
			case GitCloudHostIntegrationId.GitLab:
			case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
			case IssuesCloudHostIntegrationId.Jira:
				return true;
			case GitCloudHostIntegrationId.GitHub:
				return isSupportedCloudIntegrationId(GitCloudHostIntegrationId.GitHub);
			default:
				return false;
		}
	}

	@gate()
	private async ensureProvider(providerId: IntegrationIds): Promise<IntegrationAuthenticationProvider> {
		let provider = this.providers.get(providerId);
		if (provider == null) {
			switch (providerId) {
				case GitCloudHostIntegrationId.AzureDevOps:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './azureDevOps')
					).AzureDevOpsAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './azureDevOps')
					).AzureDevOpsServerAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitCloudHostIntegrationId.Bitbucket:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket')
					).BitbucketAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitSelfManagedHostIntegrationId.BitbucketServer:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket')
					).BitbucketServerAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitCloudHostIntegrationId.GitHub:
					provider = isSupportedCloudIntegrationId(GitCloudHostIntegrationId.GitHub)
						? new (
								await import(/* webpackChunkName: "integrations" */ './github')
							).GitHubAuthenticationProvider(this.container, this, this.configuredIntegrationService)
						: new BuiltInAuthenticationProvider(
								this.container,
								this,
								this.configuredIntegrationService,
								providerId,
							);

					break;
				case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseCloudAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
					);
					break;
				case GitSelfManagedHostIntegrationId.GitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitCloudHostIntegrationId.GitLab:
					provider = isSupportedCloudIntegrationId(GitCloudHostIntegrationId.GitLab)
						? new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
							).GitLabCloudAuthenticationProvider(this.container, this, this.configuredIntegrationService)
						: new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
							).GitLabLocalAuthenticationProvider(
								this.container,
								this,
								this.configuredIntegrationService,
								GitCloudHostIntegrationId.GitLab,
							);
					break;
				case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabSelfHostedCloudAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
					);
					break;
				case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabLocalAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
						GitSelfManagedHostIntegrationId.GitLabSelfHosted,
					);
					break;
				case IssuesCloudHostIntegrationId.Jira:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './jira')
					).JiraAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				default:
					provider = new BuiltInAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
						providerId,
					);
			}
			this.providers.set(providerId, provider);
		}

		return provider;
	}
}
