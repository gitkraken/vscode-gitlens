import type { Disposable } from 'vscode';
import type { IntegrationId } from '../../../constants.integrations';
import { HostingIntegrationId, IssueIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import type { StoredConfiguredIntegrationDescriptor } from '../../../constants.storage';
import type { Container } from '../../../container';
import { gate } from '../../../system/decorators/-webview/gate';
import { log } from '../../../system/decorators/log';
import { supportedIntegrationIds } from '../providers/models';
import type { IntegrationAuthenticationProvider } from './integrationAuthenticationProvider';
import { BuiltInAuthenticationProvider } from './integrationAuthenticationProvider';
import type { ConfiguredIntegrationDescriptor } from './models';
import { isSupportedCloudIntegrationId } from './models';

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationId, IntegrationAuthenticationProvider>();
	private _configured?: Map<IntegrationId, ConfiguredIntegrationDescriptor[]>;

	constructor(private readonly container: Container) {}

	dispose(): void {
		this.providers.forEach(p => void p.dispose());
		this.providers.clear();
	}

	get configured(): Map<IntegrationId, ConfiguredIntegrationDescriptor[]> {
		if (this._configured == null) {
			this._configured = new Map();
			const storedConfigured = this.container.storage.get('integrations:configured');
			for (const [id, configured] of Object.entries(storedConfigured ?? {})) {
				if (configured == null) continue;
				const descriptors = configured.map(d => ({
					...d,
					expiresAt: d.expiresAt ? new Date(d.expiresAt) : undefined,
				}));
				this._configured.set(id as IntegrationId, descriptors);
			}
		}

		return this._configured;
	}

	private async storeConfigured() {
		// We need to convert the map to a record to store
		const configured: Record<string, StoredConfiguredIntegrationDescriptor[]> = {};
		for (const [id, descriptors] of this.configured) {
			configured[id] = descriptors.map(d => ({
				...d,
				expiresAt: d.expiresAt
					? d.expiresAt instanceof Date
						? d.expiresAt.toISOString()
						: d.expiresAt
					: undefined,
			}));
		}

		await this.container.storage.store('integrations:configured', configured);
	}

	async addConfigured(descriptor: ConfiguredIntegrationDescriptor): Promise<void> {
		const descriptors = this.configured.get(descriptor.integrationId) ?? [];
		// Only add if one does not exist
		if (descriptors.some(d => d.domain === descriptor.domain && d.integrationId === descriptor.integrationId)) {
			return;
		}
		descriptors.push(descriptor);
		this.configured.set(descriptor.integrationId, descriptors);
		await this.storeConfigured();
	}

	async removeConfigured(
		descriptor: Pick<ConfiguredIntegrationDescriptor, 'integrationId' | 'domain'>,
	): Promise<void> {
		const descriptors = this.configured.get(descriptor.integrationId);
		if (descriptors == null) return;
		const index = descriptors.findIndex(
			d => d.domain === descriptor.domain && d.integrationId === descriptor.integrationId,
		);
		if (index === -1) return;

		descriptors.splice(index, 1);
		this.configured.set(descriptor.integrationId, descriptors);

		await this.storeConfigured();
	}

	async get(providerId: IntegrationId): Promise<IntegrationAuthenticationProvider> {
		return this.ensureProvider(providerId);
	}

	@log()
	async reset(): Promise<void> {
		// TODO: This really isn't ideal, since it will only work for "cloud" providers as we won't have any more specific descriptors
		await Promise.allSettled(
			supportedIntegrationIds.map(async providerId => (await this.ensureProvider(providerId)).deleteSession()),
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
					).AzureDevOpsAuthenticationProvider(this.container, this);
					break;
				case HostingIntegrationId.Bitbucket:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './bitbucket')
					).BitbucketAuthenticationProvider(this.container, this);
					break;
				case HostingIntegrationId.GitHub:
					provider = isSupportedCloudIntegrationId(HostingIntegrationId.GitHub)
						? new (
								await import(/* webpackChunkName: "integrations" */ './github')
						  ).GitHubAuthenticationProvider(this.container, this)
						: new BuiltInAuthenticationProvider(this.container, this, providerId);

					break;
				case SelfHostedIntegrationId.CloudGitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseCloudAuthenticationProvider(this.container, this);
					break;
				case SelfHostedIntegrationId.GitHubEnterprise:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './github')
					).GitHubEnterpriseAuthenticationProvider(this.container, this);
					break;
				case HostingIntegrationId.GitLab:
					provider = isSupportedCloudIntegrationId(HostingIntegrationId.GitLab)
						? new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
						  ).GitLabCloudAuthenticationProvider(this.container, this)
						: new (
								await import(/* webpackChunkName: "integrations" */ './gitlab')
						  ).GitLabLocalAuthenticationProvider(this.container, this, HostingIntegrationId.GitLab);
					break;
				case SelfHostedIntegrationId.CloudGitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabSelfHostedCloudAuthenticationProvider(this.container, this);
					break;
				case SelfHostedIntegrationId.GitLabSelfHosted:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './gitlab')
					).GitLabLocalAuthenticationProvider(this.container, this, SelfHostedIntegrationId.GitLabSelfHosted);
					break;
				case IssueIntegrationId.Jira:
					provider = new (
						await import(/* webpackChunkName: "integrations" */ './jira')
					).JiraAuthenticationProvider(this.container, this);
					break;
				default:
					provider = new BuiltInAuthenticationProvider(this.container, this, providerId);
			}
			this.providers.set(providerId, provider);
		}

		return provider;
	}
}
