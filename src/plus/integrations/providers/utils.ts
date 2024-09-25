import type { AnyEntityIdentifierInput, EntityIdentifier } from '@gitkraken/provider-apis';
import { EntityIdentifierProviderType, EntityType, EntityVersion } from '@gitkraken/provider-apis';
import type { IntegrationId } from '../../../constants.integrations';
import { HostingIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import type { IssueOrPullRequest } from '../../../git/models/issue';
import { equalsIgnoreCase } from '../../../system/string';
import type { LaunchpadItem } from '../../launchpad/launchpadProvider';

function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

function isGitLabDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'gitlab.com');
}

function isLaunchpadItem(item: IssueOrPullRequest | LaunchpadItem): item is LaunchpadItem {
	return (item as LaunchpadItem).uuid !== undefined;
}

export function getEntityIdentifierInput(entity: IssueOrPullRequest | LaunchpadItem): AnyEntityIdentifierInput {
	let entityType = EntityType.Issue;
	if (entity.type === 'pullrequest') {
		entityType = EntityType.PullRequest;
	}

	let provider = fromStringToEntityIdentifierProviderType(entity.provider.id);
	let domain = undefined;
	if (provider === EntityIdentifierProviderType.Github && !isGitHubDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GithubEnterprise;
		domain = entity.provider.domain;
	}
	if (provider === EntityIdentifierProviderType.Gitlab && !isGitLabDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GitlabSelfHosted;
		domain = entity.provider.domain;
	}

	return {
		provider: provider,
		entityType: entityType,
		version: EntityVersion.One,
		domain: domain,
		entityId: isLaunchpadItem(entity) ? entity.graphQLId! : entity.nodeId!,
	};
}

export function getProviderIdFromEntityIdentifier(entityIdentifier: EntityIdentifier): IntegrationId | undefined {
	switch (entityIdentifier.provider) {
		case EntityIdentifierProviderType.Github:
			return HostingIntegrationId.GitHub;
		case EntityIdentifierProviderType.GithubEnterprise:
			return SelfHostedIntegrationId.GitHubEnterprise;
		default:
			return undefined;
	}
}

function fromStringToEntityIdentifierProviderType(str: string): EntityIdentifierProviderType {
	switch (str) {
		case 'github':
			return EntityIdentifierProviderType.Github;
		case 'gitlab':
			return EntityIdentifierProviderType.Gitlab;
		default:
			throw new Error(`Unknown provider type '${str}'`);
	}
}
