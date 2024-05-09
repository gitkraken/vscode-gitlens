import type { AnyEntityIdentifierInput, EntityIdentifier } from '@gitkraken/provider-apis';
import { EntityIdentifierProviderType, EntityType, EntityVersion } from '@gitkraken/provider-apis';
import type { IssueOrPullRequest } from '../../../git/models/issue';
import { equalsIgnoreCase } from '../../../system/string';
import type { FocusItem } from '../../focus/focusProvider';
import type { IntegrationId } from './models';
import { HostingIntegrationId, SelfHostedIntegrationId } from './models';

function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

function isFocusItem(item: IssueOrPullRequest | FocusItem): item is FocusItem {
	return (item as FocusItem).uuid !== undefined;
}

export function getEntityIdentifierInput(entity: IssueOrPullRequest | FocusItem): AnyEntityIdentifierInput {
	let entityType = EntityType.Issue;
	if (entity.type === 'pullrequest') {
		entityType = EntityType.PullRequest;
	}

	let provider = EntityIdentifierProviderType.Github;
	let domain = undefined;
	if (!isGitHubDotCom(entity.provider.domain)) {
		provider = EntityIdentifierProviderType.GithubEnterprise;
		domain = entity.provider.domain;
	}

	return {
		provider: provider,
		entityType: entityType,
		version: EntityVersion.One,
		domain: domain,
		entityId: isFocusItem(entity) ? entity.graphQLId! : entity.nodeId!,
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
