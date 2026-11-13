import * as assert from 'assert';
import type {
	PullRequestMember,
	PullRequestMergeQueueEntry,
	PullRequestProjection,
} from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestMergeQueueState,
	PullRequestReviewDecision,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import type { ActionablePullRequest } from '@gitlens/integrations/index.js';
import { getActionablePullRequests, toActionablePullRequestInput } from '@gitlens/integrations/index.js';
import type { LaunchpadActionCategory } from '../models/launchpad.js';
import { getLaunchpadActionCategory, launchpadActionCategories } from '../models/launchpad.js';
import type { ReviewRequirementActionablePullRequest } from '../utils/reviewRequirement.utils.js';
import { getReviewNotRequiredActionCategory } from '../utils/reviewRequirement.utils.js';

/**
 * The shared categorizer calls any of the viewer's pull requests nobody has reviewed "needs reviewers", whether or not
 * the repository requires a review. These pin the GitLens-side demotion for a host that definitively says none is
 * required (#5863).
 */

const providers = {
	github: { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
	ghe: { id: 'cloud-github-enterprise', name: 'GitHub Enterprise', domain: 'ghe.example.com', icon: 'github' },
	gitlab: { id: 'gitlab', name: 'GitLab', domain: 'gitlab.com', icon: 'gitlab' },
	azure: { id: 'azureDevOps', name: 'Azure DevOps', domain: 'dev.azure.com', icon: 'azdo' },
	bitbucket: { id: 'bitbucket', name: 'Bitbucket', domain: 'bitbucket.org', icon: 'bitbucket' },
} satisfies Record<string, ProviderReference>;

const me: PullRequestMember = { id: 'me', name: 'me', username: 'me' };

/** An open pull request the viewer authored that nobody has been asked to review, mergeable with passing checks
 *  unless told otherwise. */
function createPullRequest(options?: {
	provider?: ProviderReference;
	/** `null` for an untagged row. */
	projection?: PullRequestProjection | null;
	reviewDecision?: PullRequestReviewDecision;
	isDraft?: boolean;
	mergeableState?: PullRequestMergeableState;
	checks?: PullRequestStatusCheckRollupState;
	mergeQueue?: PullRequestMergeQueueEntry;
}): PullRequest {
	return new PullRequest(
		options?.provider ?? providers.github,
		me,
		'1',
		'PR_kwNode1',
		'A pull request',
		'https://github.com/owner/repo/pull/1',
		{ owner: 'owner', repo: 'repo' },
		'opened',
		new Date(0),
		new Date(0),
		undefined,
		undefined,
		options?.mergeableState ?? PullRequestMergeableState.Mergeable,
		true,
		undefined,
		options?.isDraft ?? false,
		undefined,
		undefined,
		undefined,
		undefined,
		options?.reviewDecision,
		[],
		[],
		undefined,
		options?.checks ?? PullRequestStatusCheckRollupState.Success,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		1,
		true,
		options?.projection === null ? undefined : (options?.projection ?? 'search'),
		undefined,
		undefined, // viewerUnresolved
		undefined, // milestone
		options?.mergeQueue,
		options?.mergeQueue != null ? true : undefined,
	);
}

/** What the Launchpad provider does: the shared verdict, the merge-queue override, then the review demotion. */
function categorize(
	pr: PullRequest,
	fetched?: { reviewDecision: PullRequestReviewDecision | undefined; hasReviewRequests: boolean },
): { category: LaunchpadActionCategory; item: ActionablePullRequest } {
	const [item] = getActionablePullRequests([toActionablePullRequestInput(pr)], { id: me.id });
	let category = getLaunchpadActionCategory(item.suggestedActionCategory, pr);
	const demoted = getReviewNotRequiredActionCategory(category, item, pr, fetched);
	if (demoted != null) {
		category = demoted;
		item.viewer.shouldAssignReviewer = false;
	}
	return { category: category, item: item };
}

function flags(
	options?: Partial<Omit<ReviewRequirementActionablePullRequest, 'viewer'>> & { shouldMerge?: boolean },
): ReviewRequirementActionablePullRequest {
	return {
		isDraft: options?.isDraft ?? false,
		failingCI: options?.failingCI ?? false,
		hasConflicts: options?.hasConflicts ?? false,
		viewer: { shouldMerge: options?.shouldMerge ?? false },
	};
}

suite('Launchpad review requirement', () => {
	test('the shared categorizer calls an unreviewed pull request needing reviewers', () => {
		// The premise of the demotion — if this starts failing, provider-apis learned about review requirements.
		const [item] = getActionablePullRequests([toActionablePullRequestInput(createPullRequest())], {
			id: me.id,
		});
		assert.strictEqual(item.suggestedActionCategory, 'unassignedReviewers');
		assert.strictEqual(item.viewer.shouldAssignReviewer, true);
	});

	test('a GitHub pull request whose repository requires no review is Ready to Merge', () => {
		const { category, item } = categorize(createPullRequest());
		assert.strictEqual(category, 'mergeable');
		assert.strictEqual(item.viewer.shouldAssignReviewer, false);
	});

	test('a GitHub pull request whose repository requires a review still needs reviewers', () => {
		const { category, item } = categorize(
			createPullRequest({ reviewDecision: PullRequestReviewDecision.ReviewRequired }),
		);
		assert.strictEqual(category, 'unassigned-reviewers');
		assert.strictEqual(item.viewer.shouldAssignReviewer, true);
	});

	test("a GitHub pull request whose read didn't select the decision still needs reviewers", () => {
		const { category, item } = categorize(createPullRequest({ projection: 'repos' }));
		assert.strictEqual(category, 'unassigned-reviewers');
		assert.strictEqual(item.viewer.shouldAssignReviewer, true);
	});

	test('a GitHub pull request of unknown projection still needs reviewers', () => {
		assert.strictEqual(categorize(createPullRequest({ projection: null })).category, 'unassigned-reviewers');
	});

	test('a decision fetched by a follow-up read is used where the row has none', () => {
		const pr = createPullRequest({ projection: 'repos' });
		assert.strictEqual(
			categorize(pr, { reviewDecision: undefined, hasReviewRequests: false }).category,
			'mergeable',
		);
		assert.strictEqual(
			categorize(pr, {
				reviewDecision: PullRequestReviewDecision.ReviewRequired,
				hasReviewRequests: false,
			}).category,
			'unassigned-reviewers',
		);
	});

	test('a GitHub Enterprise pull request is judged like a GitHub one', () => {
		assert.strictEqual(categorize(createPullRequest({ provider: providers.ghe })).category, 'mergeable');
		assert.strictEqual(
			categorize(
				createPullRequest({
					provider: providers.ghe,
					reviewDecision: PullRequestReviewDecision.ReviewRequired,
				}),
			).category,
			'unassigned-reviewers',
		);
	});

	for (const provider of [providers.gitlab, providers.azure, providers.bitbucket]) {
		test(`${provider.name} pull requests are left as they were`, () => {
			const item = flags({ shouldMerge: true });
			for (const projection of ['search', 'repos'] as const) {
				const pr = createPullRequest({ provider: provider, projection: projection });
				assert.strictEqual(getReviewNotRequiredActionCategory('unassigned-reviewers', item, pr), undefined);
				// Not even a fetched decision speaks for a host that doesn't report one.
				assert.strictEqual(
					getReviewNotRequiredActionCategory('unassigned-reviewers', item, pr, {
						reviewDecision: undefined,
						hasReviewRequests: false,
					}),
					undefined,
				);
				// Nor do review requests.
				assert.strictEqual(
					getReviewNotRequiredActionCategory('unassigned-reviewers', item, pr, {
						reviewDecision: undefined,
						hasReviewRequests: true,
					}),
					undefined,
				);
			}
		});
	}

	suite('replays the cascade without the needs-reviewers rule', () => {
		test('a draft is a Draft', () => {
			assert.strictEqual(categorize(createPullRequest({ isDraft: true })).category, 'draft');
		});

		test('failing checks are Failed Checks', () => {
			assert.strictEqual(
				categorize(createPullRequest({ checks: PullRequestStatusCheckRollupState.Failed })).category,
				'failed-checks',
			);
		});

		test('conflicts outrank failing checks', () => {
			assert.strictEqual(
				categorize(
					createPullRequest({
						mergeableState: PullRequestMergeableState.Conflicting,
						checks: PullRequestStatusCheckRollupState.Failed,
					}),
				).category,
				'conflicts',
			);
		});

		test('nothing else is Other', () => {
			assert.strictEqual(
				categorize(createPullRequest({ mergeableState: PullRequestMergeableState.Unknown })).category,
				'other',
			);
		});

		const pr = createPullRequest();
		const cases: [ReviewRequirementActionablePullRequest, LaunchpadActionCategory][] = [
			[flags(), 'other'],
			[flags({ shouldMerge: true }), 'mergeable'],
			[flags({ shouldMerge: true, isDraft: true }), 'draft'],
			[flags({ isDraft: true, failingCI: true }), 'failed-checks'],
			[flags({ isDraft: true, failingCI: true, hasConflicts: true }), 'conflicts'],
			[flags({ hasConflicts: true }), 'conflicts'],
		];
		for (const [item, expected] of cases) {
			test(`${JSON.stringify(item)} is ${expected}`, () => {
				assert.strictEqual(getReviewNotRequiredActionCategory('unassigned-reviewers', item, pr), expected);
			});
		}
	});

	suite('pending review requests the panel read dropped (#6206)', () => {
		const pr = createPullRequest({ projection: 'repos' });
		const requested = { reviewDecision: undefined, hasReviewRequests: true };
		const requestedRequired = {
			reviewDecision: PullRequestReviewDecision.ReviewRequired,
			hasReviewRequests: true,
		};
		const get = (
			item: ReviewRequirementActionablePullRequest,
			fetched: { reviewDecision: PullRequestReviewDecision | undefined; hasReviewRequests: boolean },
			category: LaunchpadActionCategory = 'unassigned-reviewers',
			target: PullRequest = pr,
		): LaunchpadActionCategory | undefined => getReviewNotRequiredActionCategory(category, item, target, fetched);

		test('a pull request waiting on requested reviewers is Waiting for Review, not Ready to Merge', () => {
			assert.strictEqual(get(flags({ shouldMerge: true }), requested), 'waiting-for-review');
		});

		test('requests make it Waiting for Review whatever the decision', () => {
			assert.strictEqual(get(flags({ shouldMerge: true }), requestedRequired), 'waiting-for-review');
		});

		test('failing checks still outrank waiting for review', () => {
			assert.strictEqual(get(flags({ failingCI: true }), requested), 'failed-checks');
		});

		test('conflicts still outrank waiting for review', () => {
			assert.strictEqual(get(flags({ failingCI: true, hasConflicts: true }), requested), 'conflicts');
		});

		test("a draft is Waiting for Review because the shared cascade's waiting step comes after its draft step", () => {
			assert.strictEqual(get(flags({ isDraft: true }), requested), 'waiting-for-review');
		});

		test('a GitHub Enterprise pull request is judged like a GitHub one', () => {
			assert.strictEqual(
				get(flags(), requested, 'unassigned-reviewers', createPullRequest({ provider: providers.ghe })),
				'waiting-for-review',
			);
		});

		test('every other category is left as it was', () => {
			for (const category of launchpadActionCategories) {
				if (category === 'unassigned-reviewers') continue;

				assert.strictEqual(get(flags({ shouldMerge: true }), requested, category), undefined, category);
			}
		});
	});

	test('every other category is left as it was', () => {
		const pr = createPullRequest();
		for (const category of launchpadActionCategories) {
			if (category === 'unassigned-reviewers') continue;

			assert.strictEqual(
				getReviewNotRequiredActionCategory(category, flags({ shouldMerge: true }), pr),
				undefined,
				category,
			);
		}
	});

	test('a queued pull request stays In Merge Queue', () => {
		const pr = createPullRequest({
			mergeQueue: { state: PullRequestMergeQueueState.Queued, enqueuedAt: new Date(0) },
		});
		assert.strictEqual(categorize(pr).category, 'queued');
	});
});
