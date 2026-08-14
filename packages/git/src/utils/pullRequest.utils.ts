import type {
	PullRequest,
	PullRequestComparisonRefs,
	PullRequestRefs,
	PullRequestRepositoryIdentityDescriptor,
	PullRequestShape,
	PullRequestSortField,
	PullRequestSorting,
} from '../models/pullRequest.js';
import { shortenRevision } from './revision.utils.js';

/**
 * How each sort field is read off a {@link PullRequestShape}, for the filtered PR search, which MERGES its
 * relationship × state facets in the facade and so has to order the union itself instead of trusting the
 * per-facet server order. Only the fields the shape carries appear — the same rule as `getIssueComparator`, and
 * the reason {@link PullRequestSortField} is just these two.
 */
const pullRequestSortValues: Partial<
	Record<PullRequestSortField, (pr: PullRequestShape) => number | Date | string | undefined>
> = {
	created: pr => pr.createdDate,
	updated: pr => pr.updatedDate,
};

/**
 * A comparator for one sort key over normalized pull requests, or `undefined` when the field isn't derivable
 * from a {@link PullRequestShape} — the signal that the key is only honorable on a SINGLE-origin read where the
 * provider already ordered the page. Missing values sort LAST in both directions (partitioned before any
 * arithmetic so two missing values compare equal, exactly as `getIssueComparator` does).
 *
 * Note it orders whatever it is handed. Sorting a page already capped at the result ceiling does not make it the
 * top N.
 */
export function getPullRequestComparator(
	sort: PullRequestSorting,
): ((a: PullRequestShape, b: PullRequestShape) => number) | undefined {
	const [field, direction] = sort.split(':') as [PullRequestSortField, 'asc' | 'desc'];
	const getValue = pullRequestSortValues[field];
	if (getValue == null) return undefined;

	return (a, b) => {
		const left = toComparable(getValue(a));
		const right = toComparable(getValue(b));
		if (left == null || right == null) {
			if (left == null && right == null) return 0;

			return left == null ? 1 : -1;
		}

		const ordered = left < right ? -1 : left > right ? 1 : 0;
		return direction === 'asc' ? ordered : -ordered;
	};
}

function toComparable(value: number | Date | string | undefined): number | string | undefined {
	return value instanceof Date ? value.getTime() : value;
}

export interface PullRequestUrlIdentity<TProvider extends string = string> {
	provider?: TProvider;

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
		number: value.number,
		title: value.title,
		body: value.body,
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
						cloneHttps: value.refs.head.cloneHttps,
						cloneSsh: value.refs.head.cloneSsh,
						isFork: value.refs.head.isFork,
					},
					base: {
						exists: value.refs.base.exists,
						owner: value.refs.base.owner,
						repo: value.refs.base.repo,
						sha: value.refs.base.sha,
						branch: value.refs.base.branch,
						url: value.refs.base.url,
						cloneHttps: value.refs.base.cloneHttps,
						cloneSsh: value.refs.base.cloneSsh,
						isFork: value.refs.base.isFork,
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
		authoredByMe: value.authoredByMe,
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
