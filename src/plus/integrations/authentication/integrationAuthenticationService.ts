import type { Disposable } from 'vscode';
import type { IntegrationId } from '../../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import type { Container } from '../../../container';
import { gate } from '../../../system/decorators/-webview/gate';
import { log } from '../../../system/decorators/log';
import { supportedIntegrationIds } from '../providers/models';
import type { ConfiguredIntegrationService } from './configuredIntegrationService';
import type { IntegrationAuthenticationProvider } from './integrationAuthenticationProvider';
import { BuiltInAuthenticationProvider } from './integrationAuthenticationProvider';
import { isSupportedCloudIntegrationId } from './models';

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationId, IntegrationAuthenticationProvider>();

	constructor(
		private readonly container: Container,
		private readonly configuredIntegrationService: ConfiguredIntegrationService,
	) {}

	dispose(): void {
		this.providers.forEach(p => void p.dispose());
		this.providers.clear();
	}

	async get(providerId: IntegrationId): Promise<IntegrationAuthenticationProvider> {
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
			case HostingIntegrationId.AzureDevOps:
			case HostingIntegrationId.Bitbucket:
			case SelfHostedIntegrationId.GitHubEnterprise:
			case HostingIntegrationId.GitLab:
			case SelfHostedIntegrationId.GitLabSelfHosted:
			case IssueIntegrationId.Jira:
				return true;
			case HostingIntegrationId.GitHub:
				return isSupportedCloudIntegrationId(HostingIntegrationId.GitHub);
			default:
				return false;
		}
	}

	@gate()
	private async ensureProvider(providerId: IntegrationId): Promise<IntegrationAuthenticationProvider> {
		let provider = this.providers.get(providerId);
		if (provider == null) {
			switch (providerId) {
				case HostingIntegrationId.AzureDevOps:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './azureDevOps')
					).AzureDevOpsAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case HostingIntegrationId.Bitbucket:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket')
					).BitbucketAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case HostingIntegrationId.GitHub:
					provider = isSupportedCloudIntegrationId(HostingIntegrationId.GitHub)
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
				case SelfHostedIntegrationId.CloudGitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseCloudAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
					);
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseAuthenticationProvider(this.container, this, this.configuredIntegrationService);
					break;
				case HostingIntegrationId.GitLab:
					provider = isSupportedCloudIntegrationId(HostingIntegrationId.GitLab)
						? new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
						  ).GitLabCloudAuthenticationProvider(this.container, this, this.configuredIntegrationService)
						: new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
						  ).GitLabLocalAuthenticationProvider(
								this.container,
								this,
								this.configuredIntegrationService,
								HostingIntegrationId.GitLab,
						  );
					break;
				case SelfHostedIntegrationId.CloudGitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabSelfHostedCloudAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
					);
					break;
				case SelfHostedIntegrationId.GitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabLocalAuthenticationProvider(
						this.container,
						this,
						this.configuredIntegrationService,
						SelfHostedIntegrationId.GitLabSelfHosted,
					);
					break;
				case IssueIntegrationId.Jira:
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
