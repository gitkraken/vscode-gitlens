import type { Disposable } from 'vscode';
import type { IntegrationIds } from '../../../constants.integrations.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations.js';
import type { Container } from '../../../container.js';
import { gate } from '../../../system/decorators/gate.js';
import { debug } from '../../../system/decorators/log.js';
import { supportedIntegrationIds } from '../utils/-webview/integration.utils.js';
import type { ConfiguredIntegrationService } from './configuredIntegrationService.js';
import type { IntegrationAuthenticationProvider } from './integrationAuthenticationProvider.js';
import { BuiltInAuthenticationProvider } from './integrationAuthenticationProvider.js';
import { isSupportedCloudIntegrationId } from './models.js';

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

	@debug()
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
						await import(/* webpackChunkName: "integrations" */ './azureDevOps.js')
					).AzureDevOpsAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './azureDevOps.js')
					).AzureDevOpsServerAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitCloudHostIntegrationId.Bitbucket:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket.js')
					).BitbucketAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitSelfManagedHostIntegrationId.BitbucketServer:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket.js')
					).BitbucketServerAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitCloudHostIntegrationId.GitHub:
					provider = isSupportedCloudIntegrationId(GitCloudHostIntegrationId.GitHub)
						? new (
								await import(/* webpackChunkName: "integrations" */ './github.js')
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
						await import(/* webpackChunkName: "integrations" */ './github.js')
					).GitHubEnterpriseCloudAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
					);
					break;
				case GitSelfManagedHostIntegrationId.GitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github.js')
					).GitHubEnterpriseAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case GitCloudHostIntegrationId.GitLab:
					provider = isSupportedCloudIntegrationId(GitCloudHostIntegrationId.GitLab)
						? new (
								await import(/* webpackChunkName: "integrations" */ './gitlab.js')
							).GitLabCloudAuthenticationProvider(this.container, this, this.configuredIntegrationService)
						: new (
								await import(/* webpackChunkName: "integrations" */ './gitlab.js')
							).GitLabLocalAuthenticationProvider(
								this.container,
								this,
								this.configuredIntegrationService,
								GitCloudHostIntegrationId.GitLab,
							);
					break;
				case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab.js')
					).GitLabSelfHostedCloudAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
					);
					break;
				case GitSelfManagedHostIntegrationId.GitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab.js')
					).GitLabLocalAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
						GitSelfManagedHostIntegrationId.GitLabSelfHosted,
					);
					break;
				case IssuesCloudHostIntegrationId.Jira:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './jira.js')
					).JiraAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case IssuesCloudHostIntegrationId.Linear:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './linear.js')
					).LinearAuthenticationProvider(this.container, this, this.configuredIntegrationService);
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
