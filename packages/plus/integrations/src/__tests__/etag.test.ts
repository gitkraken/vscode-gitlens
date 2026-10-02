import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestReviewer, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type {
	IssueEtagFields,
	IssueEtagInclude,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../models/integration.js';
import { issueEtagIncludes, pullRequestEtagIncludes, pullRequestRevision } from '../models/integration.js';
import {
	findInvalidIssueEtagInclude,
	issueEtag,
	issueEtagFieldsFromShape,
	normalizeIssueEtagIncludes,
	pullRequestEtag,
	pullRequestEtagFieldsFromShape,
} from '../reads/etag.js';

/**
 * The batch reads' etags: a cheap check answers `unchanged` only when its etag equals the caller's, so the property
 * that matters is that every change-state input moves the etag — a stamp that ignored one would answer `unchanged`
 * for a pull request that changed.
 */

const base: PullRequestEtagFields = {
	state: 'opened',
	isDraft: false,
	updatedDate: new Date('2026-01-01T00:00:00Z'),
	headSha: 'abc',
	mergeableState: PullRequestMergeableState.Mergeable,
	reviewDecision: PullRequestReviewDecision.Approved,
	statusCheckRollupState: PullRequestStatusCheckRollupState.Success,
};

const noIncludes: readonly PullRequestEtagInclude[] = [];
const includeSets: readonly (readonly PullRequestEtagInclude[])[] = [
	noIncludes,
	['mergeable'],
	['reviewDecision'],
	['checks'],
	['mergeable', 'reviewDecision'],
	['mergeable', 'checks'],
	['reviewDecision', 'checks'],
	pullRequestEtagIncludes,
];

suite('pullRequestEtag', () => {
	test('is deterministic: equal fields give equal etags, whatever object holds them', () => {
		for (const includes of includeSets) {
			assert.equal(
				pullRequestEtag({ ...base }, includes),
				pullRequestEtag({ ...base, updatedDate: new Date(base.updatedDate.getTime()) }, includes),
			);
		}
	});

	const changes: [string, Partial<PullRequestEtagFields>][] = [
		['state', { state: 'merged' }],
		['isDraft', { isDraft: true }],
		['isDraft unknown', { isDraft: undefined }],
		['updatedDate', { updatedDate: new Date('2026-01-01T00:00:01Z') }],
		['headSha', { headSha: 'def' }],
		['headSha unknown', { headSha: undefined }],
	];
	for (const [name, change] of changes) {
		test(`a change of ${name} changes the etag, whatever the includes`, () => {
			for (const includes of includeSets) {
				assert.notEqual(pullRequestEtag({ ...base, ...change }, includes), pullRequestEtag(base, includes));
			}
		});
	}

	const includeChanges: [PullRequestEtagInclude, string, Partial<PullRequestEtagFields>][] = [
		['mergeable', 'mergeableState', { mergeableState: PullRequestMergeableState.Conflicting }],
		['mergeable', 'mergeableState unknown', { mergeableState: undefined }],
		['reviewDecision', 'reviewDecision', { reviewDecision: PullRequestReviewDecision.ChangesRequested }],
		['reviewDecision', 'reviewDecision unknown', { reviewDecision: undefined }],
		['checks', 'statusCheckRollupState', { statusCheckRollupState: PullRequestStatusCheckRollupState.Failed }],
		['checks', 'statusCheckRollupState unknown', { statusCheckRollupState: undefined }],
	];
	for (const [include, name, change] of includeChanges) {
		test(`a change of ${name} changes the etag only when '${include}' is listed`, () => {
			for (const includes of includeSets) {
				const changed = pullRequestEtag({ ...base, ...change }, includes);
				const unchanged = pullRequestEtag(base, includes);
				if (includes.includes(include)) {
					assert.notEqual(changed, unchanged, `[${includes.join(', ')}] must see it`);
				} else {
					assert.equal(changed, unchanged, `[${includes.join(', ')}] must not force a full read for it`);
				}
			}
		});
	}

	test('the order of the includes and repeats in them do not change the etag', () => {
		const canonical = pullRequestEtag(base, ['mergeable', 'reviewDecision', 'checks']);
		assert.equal(pullRequestEtag(base, ['checks', 'mergeable', 'reviewDecision']), canonical);
		assert.equal(
			pullRequestEtag(base, ['reviewDecision', 'checks', 'mergeable', 'checks', 'mergeable']),
			canonical,
		);
		assert.equal(pullRequestEtag(base, ['checks', 'checks']), pullRequestEtag(base, ['checks']));
	});

	test('no includes gives the bare `pr1:` form, and a set names its includes in canonical order', () => {
		assert.match(pullRequestEtag(base, []), /^pr1:\[/);
		assert.match(pullRequestEtag(base, ['checks']), /^pr1\+checks:\[/);
		assert.match(pullRequestEtag(base, ['checks', 'mergeable']), /^pr1\+mergeable\+checks:\[/);
		assert.match(
			pullRequestEtag(base, ['checks', 'reviewDecision', 'mergeable']),
			/^pr1\+mergeable\+reviewDecision\+checks:\[/,
		);
	});

	test('two different sets never produce the same etag, even when the values they read are identical', () => {
		const nothing: PullRequestEtagFields = { state: 'opened', updatedDate: base.updatedDate };
		for (const fields of [nothing, base]) {
			const etags = includeSets.map(includes => pullRequestEtag(fields, includes));
			assert.equal(new Set(etags).size, includeSets.length);
		}
		assert.notEqual(pullRequestEtag(nothing, ['mergeable']), pullRequestEtag(nothing, ['checks']));
	});

	test('reads the check rollup off a PullRequest, where the shape has no such field — by name, not by class', () => {
		const pr = new PullRequest(
			{ id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
			{ id: 'octo', name: 'octo' },
			'1',
			'node1',
			'title',
			'https://github.com/o/r/pull/1',
			{ owner: 'o', repo: 'r' },
			'opened',
			new Date(0),
			base.updatedDate,
			undefined,
			undefined,
			PullRequestMergeableState.Mergeable,
			undefined,
			{
				head: { owner: 'o', repo: 'r', branch: 'feature', sha: 'abc', exists: true, url: '' },
				base: { owner: 'o', repo: 'r', branch: 'main', sha: 'base', exists: true, url: '' },
				isCrossRepository: false,
			},
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			PullRequestReviewDecision.Approved,
			undefined,
			undefined,
			undefined,
			PullRequestStatusCheckRollupState.Success,
		);

		assert.deepEqual(pullRequestEtagFieldsFromShape(pr), base);
		assert.deepEqual(
			pullRequestEtagFieldsFromShape({ ...pr } as PullRequestShape),
			base,
			'a copy that is no longer a `PullRequest` instance keeps its rollup',
		);
		const { statusCheckRollupState: _rollup, ...shape } = pr;
		assert.equal(pullRequestEtagFieldsFromShape(shape as PullRequestShape).statusCheckRollupState, undefined);
	});

	test('a revision is appended to the base inputs only when set, and every change of it changes the etag', () => {
		for (const includes of includeSets) {
			const withRevision = pullRequestEtag({ ...base, revision: '0123456789abcdef' }, includes);
			assert.notEqual(withRevision, pullRequestEtag(base, includes));
			assert.notEqual(withRevision, pullRequestEtag({ ...base, revision: 'fedcba9876543210' }, includes));
		}
		assert.equal(
			pullRequestEtag({ ...base, revision: '0123456789abcdef' }, []),
			'pr1:["opened",false,1767225600000,"abc","0123456789abcdef"]',
		);
		assert.equal(
			pullRequestEtag({ ...base, revision: '0123456789abcdef' }, ['mergeable']),
			'pr1+mergeable:["opened",false,1767225600000,"abc","0123456789abcdef","Mergeable"]',
		);
	});

	test('a host without a revision keeps the exact etag it had before revisions existed', () => {
		const pr = gitHubPullRequestShape();
		const fields = pullRequestEtagFieldsFromShape(pr);
		assert.ok(!('revision' in fields), 'a GitHub row carries no revision');
		assert.equal(pullRequestEtag(fields, []), 'pr1:["opened",false,1767225600000,"abc"]');
		assert.equal(
			pullRequestEtag(fields, pullRequestEtagIncludes),
			'pr1+mergeable+reviewDecision+checks:["opened",false,1767225600000,"abc","Mergeable","Approved","success"]',
		);
	});

	test('an Azure DevOps or Azure DevOps Server row carries the revision of its own fields; no other host does', () => {
		for (const providerId of [
			GitCloudHostIntegrationId.AzureDevOps,
			GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		]) {
			const pr = gitHubPullRequestShape({
				provider: { id: providerId, name: 'Azure', domain: 'dev.azure.com', icon: 'azdo' },
			});
			const fields = pullRequestEtagFieldsFromShape(pr);
			assert.equal(fields.revision, pullRequestRevision(pr), providerId);
			assert.match(pullRequestEtag(fields, []), /^pr1:\["opened",false,1767225600000,"abc","[0-9a-f]{16}"\]$/);
		}
		for (const providerId of [
			GitCloudHostIntegrationId.GitHub,
			GitCloudHostIntegrationId.GitLab,
			GitCloudHostIntegrationId.Bitbucket,
			GitSelfManagedHostIntegrationId.BitbucketServer,
			GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
			GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		]) {
			const pr = gitHubPullRequestShape({
				provider: { id: providerId, name: 'Host', domain: 'example.com', icon: 'x' },
			});
			assert.equal(pullRequestEtagFieldsFromShape(pr).revision, undefined, providerId);
		}
	});
});

suite('pullRequestRevision', () => {
	const reviewer = (id: string, state: PullRequestReviewState): PullRequestReviewer => ({
		reviewer: { id: id, name: `name of ${id}` },
		state: state,
	});
	const source = {
		title: 'Title',
		body: 'Body',
		refs: { base: { branch: 'main' } },
		reviewRequests: [reviewer('a', PullRequestReviewState.ReviewRequested)],
		latestReviews: [
			reviewer('b', PullRequestReviewState.Approved),
			reviewer('c', PullRequestReviewState.ChangesRequested),
		],
	};

	test('is a 64-bit hex hash, and is deterministic', () => {
		assert.match(pullRequestRevision(source), /^[0-9a-f]{16}$/);
		assert.equal(pullRequestRevision({ ...source }), pullRequestRevision(source));
	});

	const changes: [string, Partial<typeof source> & Record<string, unknown>][] = [
		['the title', { title: 'Retitled' }],
		['the description', { body: 'Edited' }],
		['the description removed', { body: undefined }],
		['the target branch', { refs: { base: { branch: 'release' } } }],
		[
			'a reviewer added',
			{ reviewRequests: [...source.reviewRequests, reviewer('d', PullRequestReviewState.ReviewRequested)] },
		],
		['a reviewer removed', { latestReviews: [source.latestReviews[0]] }],
		['a vote', { latestReviews: [source.latestReviews[0], reviewer('c', PullRequestReviewState.Approved)] }],
		[
			'a request answered',
			{
				reviewRequests: [],
				latestReviews: [...source.latestReviews, reviewer('a', PullRequestReviewState.Approved)],
			},
		],
		['reviews never read', { reviewRequests: undefined, latestReviews: undefined }],
	];
	for (const [name, change] of changes) {
		test(`a change of ${name} changes the revision`, () => {
			assert.notEqual(pullRequestRevision({ ...source, ...change }), pullRequestRevision(source));
		});
	}

	test("reads only each reviewer's id and state, in no particular order", () => {
		assert.equal(
			pullRequestRevision({
				...source,
				latestReviews: [
					{ ...source.latestReviews[1], reviewer: { id: 'c', name: 'renamed', avatarUrl: 'x' } },
					source.latestReviews[0],
				],
			}),
			pullRequestRevision(source),
		);
	});
});

suite('issueEtag', () => {
	const issueBase: IssueEtagFields = { state: 'opened', updatedDate: new Date('2026-01-01T00:00:00Z') };

	test('is deterministic', () => {
		assert.equal(
			issueEtag({ ...issueBase }, []),
			issueEtag({ ...issueBase, updatedDate: new Date(issueBase.updatedDate) }, []),
		);
		assert.match(issueEtag(issueBase, []), /^is1:/);
	});

	test('a change of state or updatedDate changes the etag', () => {
		assert.notEqual(issueEtag({ ...issueBase, state: 'closed' }, []), issueEtag(issueBase, []));
		assert.notEqual(issueEtag({ ...issueBase, updatedDate: new Date(1) }, []), issueEtag(issueBase, []));
	});

	test('no includes gives the exact `is1:` form etags had before includes existed', () => {
		assert.equal(issueEtag(issueBase, []), 'is1:["opened",1767225600000]');
		assert.equal(issueEtag({ ...issueBase, thumbsUpCount: 3 }, []), 'is1:["opened",1767225600000]');
	});

	test("'reactions' names itself in the prefix and adds the thumbs-up count, `null` when the row has none", () => {
		assert.equal(
			issueEtag({ ...issueBase, thumbsUpCount: 3 }, ['reactions']),
			'is1+reactions:["opened",1767225600000,3]',
		);
		assert.equal(
			issueEtag({ ...issueBase, thumbsUpCount: 0 }, ['reactions']),
			'is1+reactions:["opened",1767225600000,0]',
		);
		assert.equal(issueEtag(issueBase, ['reactions']), 'is1+reactions:["opened",1767225600000,null]');
	});

	test("a change of the thumbs-up count changes the etag only when 'reactions' is listed", () => {
		for (const [from, to] of [
			[0, 1],
			[2, 3],
			[undefined, 0],
		]) {
			const before = { ...issueBase, thumbsUpCount: from };
			const after = { ...issueBase, thumbsUpCount: to };
			assert.equal(issueEtag(after, []), issueEtag(before, []), `${from} -> ${to} without the include`);
			assert.notEqual(issueEtag(after, ['reactions']), issueEtag(before, ['reactions']), `${from} -> ${to}`);
		}
	});

	test('the order of the includes and repeats in them do not change the etag', () => {
		const once = issueEtag({ ...issueBase, thumbsUpCount: 2 }, ['reactions']);
		assert.equal(issueEtag({ ...issueBase, thumbsUpCount: 2 }, ['reactions', 'reactions']), once);
		assert.deepEqual(normalizeIssueEtagIncludes(['reactions', 'reactions']), ['reactions']);
		assert.deepEqual(normalizeIssueEtagIncludes([]), []);
	});

	test('two different sets never produce the same etag, even when the values they read are identical', () => {
		for (const fields of [issueBase, { ...issueBase, thumbsUpCount: 1 }]) {
			const sets: readonly (readonly IssueEtagInclude[])[] = [[], issueEtagIncludes];
			const etags = sets.map(includes => issueEtag(fields, includes));
			assert.equal(new Set(etags).size, 2);
		}
	});

	test('an unknown include is found, and a known one is not', () => {
		assert.equal(findInvalidIssueEtagInclude(['reactions']), undefined);
		assert.equal(findInvalidIssueEtagInclude([]), undefined);
		assert.equal(findInvalidIssueEtagInclude(['reactions', 'votes']), 'votes');
		assert.equal(findInvalidIssueEtagInclude(['mergeable']), 'mergeable');
	});

	test('reads its fields off an issue shape', () => {
		const issue = { id: '1', state: 'closed', updatedDate: new Date(5), title: 'x' } as unknown as IssueShape;
		assert.deepEqual(issueEtagFieldsFromShape(issue), { state: 'closed', updatedDate: new Date(5) });
	});

	test('reads the thumbs-up count only off a row whose read fetched reactions', () => {
		const row = (providerId: string, projection: string | undefined, thumbsUpCount: number | undefined) =>
			({
				id: '1',
				provider: { id: providerId, name: providerId, domain: 'example.com', icon: 'x' },
				state: 'opened',
				updatedDate: new Date(5),
				thumbsUpCount: thumbsUpCount,
				projection: projection,
			}) as unknown as IssueShape;

		const fetched: [string, number][] = [
			[GitCloudHostIntegrationId.GitHub, 4],
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 0],
			[GitCloudHostIntegrationId.GitLab, 2],
			[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 1],
		];
		for (const [providerId, count] of fetched) {
			assert.equal(issueEtagFieldsFromShape(row(providerId, 'batch', count)).thumbsUpCount, count, providerId);
		}

		// A tracker's votes and Azure DevOps' placeholder are not reactions; an untagged row's read is unknown.
		const ignored: [string, string | undefined][] = [
			[IssuesCloudHostIntegrationId.Jira, 'batch'],
			[IssuesCloudHostIntegrationId.Linear, 'batch'],
			[GitCloudHostIntegrationId.AzureDevOps, 'batch'],
			[GitCloudHostIntegrationId.GitHub, undefined],
		];
		for (const [providerId, projection] of ignored) {
			const fields = issueEtagFieldsFromShape(row(providerId, projection, 7));
			assert.ok(!('thumbsUpCount' in fields), `${providerId} (${projection})`);
		}
	});

	test('a missing or unparseable date never throws, and never matches a real one', () => {
		for (const updatedDate of [undefined, new Date(Number.NaN)]) {
			const fields = { ...issueBase, updatedDate: updatedDate as unknown as Date };
			assert.doesNotThrow(() => issueEtag(fields, []));
			assert.doesNotThrow(() =>
				pullRequestEtag({ state: 'opened', updatedDate: fields.updatedDate }, pullRequestEtagIncludes),
			);
			assert.notEqual(issueEtag(fields, []), issueEtag(issueBase, []));
		}
	});
});

function gitHubPullRequestShape(overrides?: Pick<PullRequestShape, 'provider'>): PullRequestShape {
	const pr = new PullRequest(
		{ id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' },
		{ id: 'octo', name: 'octo' },
		'1',
		'node1',
		'title',
		'https://github.com/o/r/pull/1',
		{ owner: 'o', repo: 'r' },
		'opened',
		new Date(0),
		base.updatedDate,
		undefined,
		undefined,
		PullRequestMergeableState.Mergeable,
		undefined,
		{
			head: { owner: 'o', repo: 'r', branch: 'feature', sha: 'abc', exists: true, url: '' },
			base: { owner: 'o', repo: 'r', branch: 'main', sha: 'base', exists: true, url: '' },
			isCrossRepository: false,
		},
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		PullRequestReviewDecision.Approved,
		undefined,
		undefined,
		undefined,
		PullRequestStatusCheckRollupState.Success,
	);
	// A copy that keeps the class's getters, as `stampNativePullRequest` copies a row.
	return overrides != null ? Object.assign(Object.create(PullRequest.prototype) as PullRequest, pr, overrides) : pr;
}
