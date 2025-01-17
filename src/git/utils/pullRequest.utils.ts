import type { HostingIntegrationId, SelfHostedIntegrationId } from '../../constants.integrations';
import type {
	PullRequest,
	PullRequestComparisonRefs,
	PullRequestRefs,
	PullRequestRepositoryIdentityDescriptor,
	PullRequestShape,
} from '../models/pullRequest';
import { shortenRevision } from './revision.utils';

export interface PullRequestUrlIdentity {
	provider?: SelfHostedIntegrationId | HostingIntegrationId;

	ownerAndRepo?: string;
	prNumber: string;
}

export function getComparisonRefsForPullRequest(repoPath: string, prRefs: PullRequestRefs): PullRequestComparisonRefs {
	const refs: PullRequestComparisonRefs = {
		repoPath: repoPath,
		base: { ref: prRefs.base.sha, label: `${prRefs.base.branch} (${shortenRevision(prRefs.base.sha)})` },
		head: { ref: prRefs.head.sha, label: prRefs.head.branch },
	};
	return refs;
}

export function getPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
	let prNumber: string | undefined = undefined;

	let match = search.match(/(?:\/)(\d+)/); // any number starting with "/"
	if (match != null) {
		prNumber = match[1];
	}

	if (prNumber == null) {
		match = search.match(/^#?(\d+)$/); // just a number or with a leading "#"
		if (match != null) {
			prNumber = match[1];
		}
	}

	return prNumber == null ? undefined : { ownerAndRepo: undefined, prNumber: prNumber, provider: undefined };
}

export function getRepositoryIdentityForPullRequest(
	pr: PullRequest,
	headRepo: boolean = true,
): PullRequestRepositoryIdentityDescriptor {
	if (headRepo) {
		return {
			remote: {
				url: pr.refs?.head?.url,
				domain: pr.provider.domain,
			},
			name: `${pr.refs?.head?.owner ?? pr.repository.owner}/${pr.refs?.head?.repo ?? pr.repository.repo}`,
			provider: {
				id: pr.provider.id,
				domain: pr.provider.domain,
				repoDomain: pr.refs?.head?.owner ?? pr.repository.owner,
				repoName: pr.refs?.head?.repo ?? pr.repository.repo,
			},
		};
	}

	return {
		remote: {
			url: pr.refs?.base?.url ?? pr.url,
			domain: pr.provider.domain,
		},
		name: `${pr.refs?.base?.owner ?? pr.repository.owner}/${pr.refs?.base?.repo ?? pr.repository.repo}`,
		provider: {
			id: pr.provider.id,
			domain: pr.provider.domain,
			repoDomain: pr.refs?.base?.owner ?? pr.repository.owner,
			repoName: pr.refs?.base?.repo ?? pr.repository.repo,
			repoOwnerDomain: pr.refs?.base?.owner ?? pr.repository.owner,
		},
	};
}

export function isMaybeNonSpecificPullRequestSearchUrl(search: string): boolean {
	return getPullRequestIdentityFromMaybeUrl(search) != null;
}

export function serializePullRequest(value: PullRequest): PullRequestShape {
	const serialized: PullRequestShape = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		nodeId: value.nodeId,
		title: value.title,
		url: value.url,
		createdDate: value.createdDate,
		updatedDate: value.updatedDate,
		closedDate: value.closedDate,
		closed: value.closed,
		author: {
			id: value.author.id,
			name: value.author.name,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		state: value.state,
		mergedDate: value.mergedDate,
		mergeableState: value.mergeableState,
		refs: value.refs
			? {
					head: {
						exists: value.refs.head.exists,
						owner: value.refs.head.owner,
						repo: value.refs.head.repo,
						sha: value.refs.head.sha,
						branch: value.refs.head.branch,
						url: value.refs.head.url,
					},
					base: {
						exists: value.refs.base.exists,
						owner: value.refs.base.owner,
						repo: value.refs.base.repo,
						sha: value.refs.base.sha,
						branch: value.refs.base.branch,
						url: value.refs.base.url,
					},
					isCrossRepository: value.refs.isCrossRepository,
			  }
			: undefined,
		isDraft: value.isDraft,
		additions: value.additions,
		deletions: value.deletions,
		commentsCount: value.commentsCount,
		thumbsUpCount: value.thumbsUpCount,
		reviewDecision: value.reviewDecision,
		reviewRequests: value.reviewRequests,
		assignees: value.assignees,
		project: value.project
			? {
					id: value.project.id,
					name: value.project.name,
					resourceId: value.project.resourceId,
					resourceName: value.project.resourceName,
			  }
			: undefined,
	};
	return serialized;
}
