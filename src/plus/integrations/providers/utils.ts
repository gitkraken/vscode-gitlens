import type { AnyEntityIdentifierInput } from '@gitkraken/provider-apis';
import { EntityIdentifierProviderType, EntityType, EntityVersion } from '@gitkraken/provider-apis';
import type { IssueOrPullRequest } from '../../../git/models/issue';
import { equalsIgnoreCase } from '../../../system/string';

function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export function getEntityIdentifierInput(issueOrPullRequest: IssueOrPullRequest): AnyEntityIdentifierInput {
	let entityType = EntityType.Issue;
	if (issueOrPullRequest.type === 'pullrequest') {
		entityType = EntityType.PullRequest;
	}

	let provider = EntityIdentifierProviderType.Github;
	let domain = undefined;
	if (!isGitHubDotCom(issueOrPullRequest.provider.domain)) {
		provider = EntityIdentifierProviderType.GithubEnterprise;
		domain = issueOrPullRequest.provider.domain;
	}

	return {
		provider: provider,
		entityType: entityType,
		version: EntityVersion.One,
		domain: domain,
		entityId: issueOrPullRequest.nodeId!,
	};
}
