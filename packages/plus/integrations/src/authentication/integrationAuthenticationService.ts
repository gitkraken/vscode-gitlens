import type { GitRemote } from '@gitlens/git/models/remote.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import type { Disposable } from '@gitlens/utils/disposable.js';
import type { IntegrationIds, SupportedCloudIntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { IntegrationService } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ApiClients } from '../providers/apiClients.js';
import type { Source } from '../telemetry.js';
import { supportedIntegrationIds } from '../utils/integration.utils.js';
import type { CloudIntegrationService } from './cloudIntegrationService.js';
import type { ConfiguredIntegrationService } from './configuredIntegrationService.js';
import type { IntegrationAuthenticationProvider } from './integrationAuthenticationProvider.js';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider.js';

export class IntegrationAuthenticationService implements Disposable {
	private readonly providers = new Map<IntegrationIds, IntegrationAuthenticationProvider>();

	constructor(
		private readonly configuredIntegrationService: ConfiguredIntegrationService,
		readonly ctx: IntegrationServiceContext,
		/**
		 * Lazy accessor for the owning {@link IntegrationService}. Injected by the composition root
		 * ({@link createIntegrationManager}) to break the auth↔service construction cycle without a
		 * mutable setter or a host round-trip; only resolved at runtime (long after construction).
		 */
		private readonly getIntegrationService: () => IntegrationService,
		/** The package's cloud token-exchange client, constructed by the composition root. */
		readonly cloudIntegrations: CloudIntegrationService,
	) {}

	dispose(): void {
		this.providers.forEach(p => p.dispose());
		this.providers.clear();
	}

	/**
	 * Initiates the cloud-integration connect flow on the owning service. Cloud auth providers call
	 * this when they need a session that doesn't exist yet (see
	 * {@link CloudIntegrationAuthenticationProvider}).
	 */
	connectCloudIntegrations(
		connect: { integrationIds: SupportedCloudIntegrationIds[]; skipIfConnected?: boolean; skipPreSync?: boolean },
		source?: Source,
	): Promise<boolean> {
		return this.getIntegrationService().connectCloudIntegrations(connect, source);
	}

	/**
	 * Resolves the connected git-host integration for a `GitRemote`, via the owning service. Lets
	 * package-internal callers (e.g. the Bitbucket provider) resolve a remote's integration without a
	 * host round-trip.
	 */
	getByRemote(remote: GitRemote): Promise<GitHostIntegration | undefined> {
		return this.getIntegrationService().getByRemote(remote);
	}

	/** Resolves the per-integration `ignoreSSLErrors` flag via the owning service (host-config-backed). */
	ignoreSSLErrors(integration: GitHostIntegration | { id: IntegrationIds; domain?: string }): boolean | 'force' {
		return this.getIntegrationService().ignoreSSLErrors(integration);
	}

	/** The package-built per-provider API clients, via the owning service (built once + memoized there). */
	get apis(): ApiClients {
		return this.getIntegrationService().apis;
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
			case GitCloudHostIntegrationId.GitLab:
			case IssuesCloudHostIntegrationId.Jira:
			case GitCloudHostIntegrationId.GitHub:
				return true;
			default:
				return false;
		}
	}

	@gate()
	private async ensureProvider(providerId: IntegrationIds): Promise<IntegrationAuthenticationProvider> {
		let provider = this.providers.get(providerId);
		if (provider != null) return provider;

		// Optional consumer override for custom auth (e.g. a manual-token provider). GitLens omits it —
		// the package constructs its own cloud providers below (so GitLens's cloud auth needs no host hook).
		const hostProvider = await this.ctx.hooks?.createAuthenticationProvider?.({
			id: providerId,
			auth: this,
			configured: this.configuredIntegrationService,
		});
		if (hostProvider != null) {
			this.providers.set(providerId, hostProvider);
			return hostProvider;
		}

		// Every cloud integration shares one provider, parameterized by id (cloud-only).
		switch (providerId) {
			case GitCloudHostIntegrationId.GitHub:
			case GitSelfManagedHostIntegrationId.CloudGitHubEnterprise:
			case GitCloudHostIntegrationId.GitLab:
			case GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted:
			case GitCloudHostIntegrationId.AzureDevOps:
			case GitSelfManagedHostIntegrationId.AzureDevOpsServer:
			case GitCloudHostIntegrationId.Bitbucket:
			case GitSelfManagedHostIntegrationId.BitbucketServer:
			case IssuesCloudHostIntegrationId.Jira:
			case IssuesCloudHostIntegrationId.Linear:
			case IssuesCloudHostIntegrationId.Trello:
				provider = new CloudIntegrationAuthenticationProvider(
					this,
					this.configuredIntegrationService,
					providerId,
				);
				break;
			default:
				throw new Error(`No authentication provider registered for integration '${String(providerId)}'`);
		}

		this.providers.set(providerId, provider);
		return provider;
	}
}
