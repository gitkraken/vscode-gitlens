import type {
	GitHubMember,
	GitHubPullRequest,
	GitHubPullRequestLite,
	GitHubPullRequestMergeableState,
	GitHubPullRequestReviewDecision,
} from '@gitlens/git-github/models.js';

/**
 * Fake GitHub GraphQL pull request nodes, typed against the models so a field added to, removed from, or renamed in
 * `GitHubPullRequest` fails to compile here instead of leaving each test's hand-built copy stale.
 */

/** The fields the full fragment selects (or a query adds) that {@link GitHubPullRequest} doesn't model. */
type GitHubPullRequestFixtureExtras = {
	mergedBy: Pick<GitHubMember, 'login'> | null;
	/** Only selected by the branch search, which reads it to match a fork that has since been deleted. */
	headRepositoryOwner?: { login: string } | null;
};

export type GitHubPullRequestFixture = GitHubPullRequest & GitHubPullRequestFixtureExtras;

/**
 * Overrides for a fixture. GitHub answers `null` for a few fields the models type as non-null (`mergeable` and
 * `reviewDecision` where there is none, `headRepository` once a fork is deleted); those stay assignable here so a
 * test can serve them.
 */
export type GitHubPullRequestFixtureOverrides = Partial<
	Omit<GitHubPullRequestFixture, 'headRepository' | 'mergeable' | 'reviewDecision'>
> & {
	headRepository?: GitHubPullRequest['headRepository'] | null;
	mergeable?: GitHubPullRequestMergeableState | null;
	reviewDecision?: GitHubPullRequestReviewDecision | null;
};

/** Where a fixture's pull request lives. Both its head and its base repository, unless `overrides` splits them. */
export type GitHubFixtureRepo = { owner: string; name: string };

/** A pull request node carrying only the lite fragment's fields, from `repo`'s `feature` branch. */
export function gitHubPullRequestLite(
	number: number,
	overrides?: Partial<GitHubPullRequestLite>,
	repo: GitHubFixtureRepo = { owner: 'o', name: 'a' },
): GitHubPullRequestLite {
	const repository = {
		isFork: false,
		name: repo.name,
		owner: { login: repo.owner },
		sshUrl: `git@github.com:${repo.owner}/${repo.name}.git`,
		url: `https://github.com/${repo.owner}/${repo.name}`,
	};
	return {
		id: `node-${number}`,
		number: number,
		title: `PR ${number}`,
		body: `Body ${number}`,
		permalink: `https://github.com/${repo.owner}/${repo.name}/pull/${number}`,
		url: `https://github.com/${repo.owner}/${repo.name}/pull/${number}`,
		state: 'OPEN',
		closed: false,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-01T00:00:00Z',
		closedAt: null,
		mergedAt: null,
		author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
		baseRefName: 'main',
		baseRefOid: 'base',
		headRefName: 'feature',
		headRefOid: 'head',
		headRepository: repository,
		repository: { ...repository, viewerPermission: 'WRITE' },
		isCrossRepository: false,
		isDraft: false,
		...overrides,
	};
}

/** A pull request node carrying every field of the full fragment, from `repo`'s `feature` branch. */
export function gitHubPullRequest(
	number: number,
	overrides?: GitHubPullRequestFixtureOverrides,
	repo?: GitHubFixtureRepo,
): GitHubPullRequestFixture {
	const node = {
		...gitHubPullRequestLite(number, undefined, repo),
		additions: 1,
		assignees: { nodes: [] },
		changedFiles: 1,
		checksUrl: '',
		deletions: 1,
		mergeable: 'MERGEABLE',
		mergedBy: null,
		reviewDecision: 'APPROVED',
		latestReviews: { nodes: [] },
		viewerLatestReview: null,
		reviewRequests: { nodes: [] },
		commits: { totalCount: 0, nodes: [] },
		totalCommentsCount: 0,
		viewerCanUpdate: true,
		...overrides,
	};
	return node as GitHubPullRequestFixture;
}
