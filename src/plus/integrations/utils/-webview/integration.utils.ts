import { GitSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
import type { IntegrationIds } from '@gitlens/integrations/constants.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { ensurePaidPlan } from '../../../gk/utils/-webview/plus.utils.js';

/**
 * Host-side paid gate for connecting an integration. Replaces the Pro paywall that used to live in the
 * `GitHubEnterpriseIntegration`/`GitLabSelfHostedIntegration` `connect()` overrides — so the package's
 * `connect()` stays pure mechanism. Gates ONLY those two cloud Enterprise/self-hosted GitHub & GitLab
 * integrations, exactly as on main — Bitbucket Server and Azure DevOps Server were never paywalled and
 * still connect for free. Returns `false` if the user declined the upgrade.
 */
export function ensureIntegrationConnectAllowed(
	container: Container,
	integration: { readonly id: IntegrationIds; readonly name: string },
): Promise<boolean> {
	if (
		integration.id !== GitSelfManagedHostIntegrationId.CloudGitHubEnterprise &&
		integration.id !== GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
	) {
		return Promise.resolve(true);
	}

	const source: Source = { source: 'integrations', detail: { action: 'connect', integration: integration.id } };
	return ensurePaidPlan(container, `Rich integration with ${integration.name} is a Pro feature.`, source);
}
