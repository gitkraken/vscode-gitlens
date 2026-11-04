import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { getIssueFieldPresence } from '../fieldPresence.js';
import type { BatchSlot } from '../models/integration.js';
import type {
	IssueEtagFields,
	IssueEtagInclude,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../reads/etag.js';
import {
	issueEtag,
	issueEtagFieldsFromShape,
	pullRequestEtag,
	pullRequestEtagFieldsFromShape,
	pullRequestEtagIncludes,
} from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import type { GitHubPullRequestFixture, GitHubPullRequestFixtureOverrides } from './githubFixtures.js';
import { gitHubPullRequest } from './githubFixtures.js';
import { connectedGitHub } from './sweepHelpers.js';

/**
 * The correctness core of the batch reads' etags on GitHub/GHE: a cheap check and a full read of the SAME pull
 * request must compute the SAME etag, or every refresh of it costs a full read (or, were the cheap path to collapse
 * two states the full one tells apart, answers `unchanged` for a pull request that changed).
 *
 * The full row's etag is computed after `fromGitHubPullRequest`'s conversions, which are not the identity everywhere
 * (`EXPECTED` checks read as success, a null mergeability as none). So each case feeds ONE raw GitHub node through the integration's real full read and its real cheap read, answering each
 * request with only the fields that request selected, and compares the etags.
 */

type Node = Record<string, unknown>;

function prNode(number: number, overrides: GitHubPullRequestFixtureOverrides): GitHubPullRequestFixture {
	return gitHubPullRequest(
		number,
		{
			updatedAt: '2026-01-02T03:04:05Z',
			headRefOid: `head-${number}`,
			// GitHub always answers it (it is non-null) when the document selects it.
			isMergeQueueEnabled: false,
			commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
			...overrides,
		},
		{ owner: 'o', name: 'r' },
	);
}

/**
 * Exactly what `getPullRequestsEtagFieldsBatch` selects for `includes`, picked off the same node the full read is
 * served.
 */
function cheapPrNode(
	node: GitHubPullRequestFixture,
	includes: readonly PullRequestEtagInclude[],
	mergeQueue: boolean,
): Node {
	const picked: Node = {
		id: node.id,
		number: node.number,
		state: node.state,
		isDraft: node.isDraft,
		updatedAt: node.updatedAt,
		headRefOid: node.headRefOid,
	};
	if (mergeQueue) {
		picked.mergeQueueEntry =
			node.mergeQueueEntry != null
				? { state: node.mergeQueueEntry.state, enqueuedAt: node.mergeQueueEntry.enqueuedAt }
				: null;
		// The same selection as the full read's, so it is served as is.
		picked.mergeQueueEvents = node.mergeQueueEvents ?? null;
		// Selected with the rest, and only its presence is read.
		picked.isMergeQueueEnabled = node.isMergeQueueEnabled;
	}
	if (includes.includes('mergeable')) {
		picked.mergeable = node.mergeable;
	}
	if (includes.includes('reviewDecision')) {
		picked.reviewDecision = node.reviewDecision;
	}
	if (includes.includes('checks')) {
		picked.commits = { nodes: node.commits.nodes.map(n => ({ commit: n.commit })) };
	}
	return picked;
}

/** What the document asked for, read back from its text, so the served node answers with what was selected. */
function selectedIncludes(query: string): PullRequestEtagInclude[] {
	const selected: PullRequestEtagInclude[] = [];
	if (/\bmergeable\b/.test(query)) {
		selected.push('mergeable');
	}
	if (/\breviewDecision\b/.test(query)) {
		selected.push('reviewDecision');
	}
	if (/\bstatusCheckRollup\b/.test(query)) {
		selected.push('checks');
	}
	return selected;
}

/** Every set the agreement is proven for: none, each include alone, and all of them. */
const etagIncludeSets: readonly (readonly PullRequestEtagInclude[])[] = [
	[],
	['mergeable'],
	['reviewDecision'],
	['checks'],
	pullRequestEtagIncludes,
];

const userRequest = {
	asCodeOwner: false,
	id: 'rr1',
	requestedReviewer: { login: 'reviewer', avatarUrl: '', url: 'https://github.com/reviewer' },
};
/** A team request: the `... on User` selection leaves an empty, but present, reviewer. */
const teamRequest = { asCodeOwner: true, id: 'rr2', requestedReviewer: {} };
const ghostRequest = { asCodeOwner: false, id: 'rr3', requestedReviewer: null };
const commentedReview = {
	id: 'rv1',
	author: { login: 'reviewer', avatarUrl: '', url: 'https://github.com/reviewer' },
	state: 'COMMENTED' as const,
	commit: { oid: 'head' },
};

const prCases: [string, GitHubPullRequestFixtureOverrides][] = [
	['open', {}],
	['closed', { state: 'CLOSED', closed: true, closedAt: '2026-01-03T00:00:00Z' }],
	['merged', { state: 'MERGED', closed: true, mergedAt: '2026-01-03T00:00:00Z' }],
	['draft', { isDraft: true }],
	['mergeable CONFLICTING', { mergeable: 'CONFLICTING' }],
	['mergeable UNKNOWN', { mergeable: 'UNKNOWN' }],
	['mergeable null', { mergeable: null }],
	['reviewDecision CHANGES_REQUESTED', { reviewDecision: 'CHANGES_REQUESTED' }],
	['reviewDecision REVIEW_REQUIRED', { reviewDecision: 'REVIEW_REQUIRED' }],
	['reviewDecision null', { reviewDecision: null }],
	['reviewDecision null, a user requested', { reviewDecision: null, reviewRequests: { nodes: [userRequest] } }],
	['reviewDecision null, a team requested', { reviewDecision: null, reviewRequests: { nodes: [teamRequest] } }],
	['reviewDecision null, a ghost requested', { reviewDecision: null, reviewRequests: { nodes: [ghostRequest] } }],
	['reviewDecision null, only commented', { reviewDecision: null, latestReviews: { nodes: [commentedReview] } }],
	['reviewDecision APPROVED, a user requested', { reviewRequests: { nodes: [userRequest] } }],
	...(['SUCCESS', 'FAILURE', 'PENDING', 'EXPECTED', 'ERROR'] as const).map(
		(state): [string, GitHubPullRequestFixtureOverrides] => [
			`rollup ${state}`,
			{ commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: state } } }] } },
		],
	),
	['rollup null', { commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: null } }] } }],
	['no commits', { commits: { totalCount: 0, nodes: [] } }],
	['not queued', { mergeQueueEntry: null }],
	[
		'removed from the queue, checks failed',
		{
			mergeQueueEntry: null,
			mergeQueueEvents: {
				nodes: [
					{
						__typename: 'RemovedFromMergeQueueEvent',
						createdAt: '2026-01-02T05:00:00Z',
						reason: 'failed_checks',
					},
				],
			},
		},
	],
	[
		'removed from the queue by merging',
		{
			mergeQueueEntry: null,
			mergeQueueEvents: {
				nodes: [
					{
						__typename: 'RemovedFromMergeQueueEvent',
						createdAt: '2026-01-02T05:00:00Z',
						reason: 'merged',
					},
				],
			},
		},
	],
	['rejoined the queue', { mergeQueueEvents: { nodes: [{ __typename: 'AddedToMergeQueueEvent' }] } }],
	...(['QUEUED', 'AWAITING_CHECKS', 'MERGEABLE', 'UNMERGEABLE', 'LOCKED'] as const).map(
		(state): [string, GitHubPullRequestFixtureOverrides] => [
			`queued ${state}`,
			{
				mergeQueueEntry: {
					state: state,
					enqueuedAt: '2026-01-02T04:00:00Z',
					estimatedTimeToMerge: 600,
					mergeQueue: { url: 'https://github.com/o/r/queue/main' },
					position: 1,
				},
			},
		],
	),
];

/**
 * Answers every GraphQL request from `byNumber`, keyed by each alias's `$k` variable, with what that request
 * selected: the whole node for a full read, only the etag fields for a cheap one.
 */
function serveGraphQL(runtime: FakeRuntime, byNumber: Map<number, object>, field: 'pullRequest' | 'issue'): string[] {
	const queries: string[] = [];
	runtime.http.fetch = (_input, init) => {
		const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
			query: string;
			variables: Record<string, unknown>;
		};
		queries.push(body.query);
		const cheap = /^query get(PullRequests|Issues)EtagFieldsBatch\(/.test(body.query);
		const includes = selectedIncludes(body.query);
		const prefix = field === 'pullRequest' ? 'p' : 'i';

		const data: Record<string, unknown> = {};
		for (const [name, value] of Object.entries(body.variables)) {
			const match = /^k(\d+)$/.exec(name);
			if (match == null) continue;

			const node = byNumber.get(value as number);
			assert.ok(node != null);
			data[`${prefix}${match[1]}`] = {
				[field]: !cheap
					? field === 'pullRequest'
						? selectedQueue(node, body.query)
						: node
					: field === 'pullRequest'
						? cheapPrNode(
								node as GitHubPullRequestFixture,
								includes,
								/\bmergeQueueEntry\b/.test(body.query),
							)
						: cheapIssueNode(node as Node, /\breactions\b/.test(body.query)),
			};
		}
		return Promise.resolve(
			new Response(JSON.stringify({ data: data }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
	};
	return queries;
}

/** The full read's node, without the merge-queue data when the document didn't select it, as GitHub would answer. */
function selectedQueue(node: object, query: string): object {
	if (/\bmergeQueueEntry\b/.test(query)) return node;

	const rest: Node = { ...node };
	delete rest.mergeQueueEntry;
	delete rest.isMergeQueueEnabled;
	delete rest.mergeQueueEvents;
	return rest;
}

function fulfilled<T>(slots: BatchSlot<T>[] | undefined): T[] {
	assert.ok(slots != null);
	return slots.map(slot => {
		assert.equal(slot.status, 'fulfilled', slot.status === 'rejected' ? String(slot.reason) : undefined);
		return slot.value;
	});
}

suite('GitHub etag agreement: the cheap check and the full read compute the same etag', () => {
	for (const includes of etagIncludeSets) {
		test(`pull requests, every state, draft, mergeable, review decision and rollup (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime({ mergeQueue: true });
			const byNumber = new Map(prCases.map(([, overrides], i) => [i + 1, prNode(i + 1, overrides)]));
			const queries = serveGraphQL(runtime, byNumber, 'pullRequest');
			const { manager, gh } = await connectedGitHub(runtime);
			const coordinates = prCases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

			const full = await gh.getPullRequestsBatchResult(coordinates);
			const cheap = await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: includes });

			assert.ok(queries.some(q => q.startsWith('query getPullRequestsBatch(')));
			assert.ok(queries.some(q => q.startsWith('query getPullRequestsEtagFieldsBatch(')));
			const fullRows = fulfilled<PullRequestShape | undefined>(full?.value);
			const cheapRows = fulfilled<PullRequestEtagFields | undefined>(cheap?.value);
			prCases.forEach(([name], i) => {
				const shape = fullRows[i];
				const fields = cheapRows[i];
				assert.ok(shape != null && fields != null, name);
				assert.equal(
					pullRequestEtag(fields, includes),
					pullRequestEtag(pullRequestEtagFieldsFromShape(shape), includes),
					name,
				);
			});

			manager.dispose();
		});
	}

	for (const includes of etagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with no full request (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime({ mergeQueue: true });
			const byNumber = new Map(prCases.map(([, overrides], i) => [i + 1, prNode(i + 1, overrides)]));
			const queries = serveGraphQL(runtime, byNumber, 'pullRequest');
			const { manager, gh } = await connectedGitHub(runtime);
			(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
				Promise.resolve(undefined);
			const targets = prCases.map(([name], i) => ({ key: name, owner: 'o', repo: 'r', number: i + 1 }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
				etagIncludes: includes,
			});
			const etags = new Map(first.items.map(i => [i.key, i.etag]));
			queries.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				etagIncludes: includes,
			});

			assert.ok(
				queries.every(q => q.startsWith('query getPullRequestsEtagFieldsBatch(')),
				'only the cheap check is sent',
			);
			assert.deepEqual(
				second.items.filter(i => !i.unchanged).map(i => i.key),
				[],
				'every unchanged pull request is answered unchanged',
			);
			assert.deepEqual(
				second.items.map(i => i.etag),
				first.items.map(i => i.etag),
			);

			manager.dispose();
		});
	}

	test('joining, moving through, leaving or being removed from the merge queue is never answered unchanged, with no include', async () => {
		// None of these moves `updatedAt`, so without the queue in the default etag a held row would keep a stale queue.
		const entry = (state: 'AWAITING_CHECKS' | 'MERGEABLE', enqueuedAt = '2026-01-02T04:00:00Z') => ({
			state: state,
			enqueuedAt: enqueuedAt,
			estimatedTimeToMerge: 600,
			mergeQueue: { url: 'https://github.com/o/r/queue/main' },
			position: 1,
		});
		// Removal moves neither `updatedAt` nor, when it happens between two checks, the queue entry either check saw.
		const removal = (createdAt: string) => ({
			nodes: [
				{
					__typename: 'RemovedFromMergeQueueEvent' as const,
					createdAt: createdAt,
					reason: 'failed_checks',
				},
			],
		});
		const steps: [string, GitHubPullRequestFixtureOverrides, GitHubPullRequestFixtureOverrides][] = [
			['joins', { mergeQueueEntry: null }, { mergeQueueEntry: entry('AWAITING_CHECKS') }],
			['moves on', { mergeQueueEntry: entry('AWAITING_CHECKS') }, { mergeQueueEntry: entry('MERGEABLE') }],
			[
				'rejoins',
				{ mergeQueueEntry: entry('AWAITING_CHECKS') },
				{ mergeQueueEntry: entry('AWAITING_CHECKS', '2026-01-02T05:00:00Z') },
			],
			['leaves', { mergeQueueEntry: entry('MERGEABLE') }, { mergeQueueEntry: null }],
			[
				'joins and is removed between checks',
				{ mergeQueueEntry: null, mergeQueueEvents: { nodes: [] } },
				{
					mergeQueueEntry: null,
					mergeQueueEvents: removal('2026-01-02T05:00:00Z'),
				},
			],
			[
				'is removed again',
				{
					mergeQueueEntry: null,
					mergeQueueEvents: removal('2026-01-02T05:00:00Z'),
				},
				{
					mergeQueueEntry: null,
					mergeQueueEvents: removal('2026-01-02T06:00:00Z'),
				},
			],
		];
		const runtime = createFakeRuntime({ mergeQueue: true });
		const byNumber = new Map<number, object>(steps.map(([, before], i) => [i + 1, prNode(i + 1, before)]));
		serveGraphQL(runtime, byNumber, 'pullRequest');
		const { manager, gh } = await connectedGitHub(runtime);
		(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
			Promise.resolve(undefined);
		const targets = steps.map(([name], i) => ({ key: name, owner: 'o', repo: 'r', number: i + 1 }));

		const first = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: targets,
			etagIncludes: [],
		});
		const etags = new Map(first.items.map(i => [i.key, i.etag]));
		steps.forEach(([, , after], i) => byNumber.set(i + 1, prNode(i + 1, after)));

		const second = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			etagIncludes: [],
		});

		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged ?? false]),
			steps.map(([name]) => [name, false]),
		);

		manager.dispose();
	});

	test('without the opt-in, a queued or queue-removed pull request has the etag of one that never queued, on BOTH paths', async () => {
		// The document doesn't select the queue, so the server (which would answer it if asked) sends none of it.
		const queued: GitHubPullRequestFixtureOverrides = {
			mergeQueueEntry: {
				state: 'AWAITING_CHECKS',
				enqueuedAt: '2026-01-02T04:00:00Z',
				estimatedTimeToMerge: 600,
				mergeQueue: { url: 'https://github.com/o/r/queue/main' },
				position: 1,
			},
			isMergeQueueEnabled: true,
			mergeQueueEvents: { nodes: [{ __typename: 'AddedToMergeQueueEvent' as const }] },
		};
		const removed: GitHubPullRequestFixtureOverrides = {
			mergeQueueEntry: null,
			isMergeQueueEnabled: true,
			mergeQueueEvents: {
				nodes: [
					{
						__typename: 'RemovedFromMergeQueueEvent' as const,
						createdAt: '2026-01-02T05:00:00Z',
						reason: 'failed_checks',
					},
				],
			},
		};
		const neverQueued: GitHubPullRequestFixtureOverrides = { mergeQueueEntry: null, isMergeQueueEnabled: false };
		const cases: [string, GitHubPullRequestFixtureOverrides][] = [
			['queued', queued],
			['removed from the queue', removed],
		];
		const runtime = createFakeRuntime();
		const byNumber = new Map<number, object>(cases.map((_, i) => [i + 1, prNode(i + 1, neverQueued)]));
		const queries = serveGraphQL(runtime, byNumber, 'pullRequest');
		const { manager, gh } = await connectedGitHub(runtime);
		const coordinates = cases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

		const fullEtags = async (): Promise<string[]> =>
			fulfilled<PullRequestShape | undefined>((await gh.getPullRequestsBatchResult(coordinates))?.value).map(
				shape => {
					assert.ok(shape != null);
					assert.equal(shape.mergeQueue, undefined);
					assert.equal(shape.mergeQueueRequired, undefined);
					assert.equal(shape.mergeQueueRemoval, undefined);
					return pullRequestEtag(pullRequestEtagFieldsFromShape(shape), []);
				},
			);
		const cheapEtags = async (): Promise<string[]> =>
			fulfilled<PullRequestEtagFields | undefined>(
				(await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: [] }))?.value,
			).map(fields => {
				assert.ok(fields != null);
				return pullRequestEtag(fields, []);
			});

		const before = await fullEtags();
		cases.forEach(([, overrides], i) => byNumber.set(i + 1, prNode(i + 1, overrides)));
		const after = await fullEtags();
		const cheap = await cheapEtags();

		for (const query of queries) {
			assert.doesNotMatch(query, /\b(mergeQueueEntry|isMergeQueueEnabled|timelineItems)\b/);
		}
		assert.deepEqual(after, before, "the queue state the server holds never enters the full read's etag");
		assert.deepEqual(cheap, before, "nor the cheap check's, so the two agree");

		manager.dispose();
	});

	for (const selected of [true, false]) {
		test(`queued, removed and never-queued pull requests compute the same etag on the cheap check and the full read, ${selected ? 'with' : 'without'} the merge-queue selection`, async () => {
			const cases = prCases.filter(([name]) => /queue|never/.test(name));
			const runtime = createFakeRuntime({ mergeQueue: selected });
			const byNumber = new Map(cases.map(([, overrides], i) => [i + 1, prNode(i + 1, overrides)]));
			const queries = serveGraphQL(runtime, byNumber, 'pullRequest');
			const { manager, gh } = await connectedGitHub(runtime);
			const coordinates = cases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

			const fullRows = fulfilled<PullRequestShape | undefined>(
				(await gh.getPullRequestsBatchResult(coordinates))?.value,
			);
			const cheapRows = fulfilled<PullRequestEtagFields | undefined>(
				(await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: [] }))?.value,
			);

			assert.equal(
				queries.every(q => /\bmergeQueueEntry\b/.test(q)),
				selected,
			);
			cases.forEach(([name], i) => {
				const shape = fullRows[i];
				const fields = cheapRows[i];
				assert.ok(shape != null && fields != null, name);
				const etag = pullRequestEtag(fields, []);
				assert.equal(etag, pullRequestEtag(pullRequestEtagFieldsFromShape(shape), []), name);
				assert.equal(etag.includes('merge-queue-read'), selected, name);
			});

			manager.dispose();
		});
	}

	test('an etag from a read with the merge-queue selection never equals one without it, for a queued, removed or never-queued pull request', async () => {
		const queued: GitHubPullRequestFixtureOverrides = {
			mergeQueueEntry: {
				state: 'AWAITING_CHECKS',
				enqueuedAt: '2026-01-02T04:00:00Z',
				estimatedTimeToMerge: 600,
				mergeQueue: { url: 'https://github.com/o/r/queue/main' },
				position: 1,
			},
			isMergeQueueEnabled: true,
		};
		const removed: GitHubPullRequestFixtureOverrides = {
			mergeQueueEntry: null,
			isMergeQueueEnabled: true,
			mergeQueueEvents: {
				nodes: [
					{
						__typename: 'RemovedFromMergeQueueEvent' as const,
						createdAt: '2026-01-02T05:00:00Z',
						reason: 'failed_checks',
					},
				],
			},
		};
		const cases: [string, GitHubPullRequestFixtureOverrides][] = [
			['queued', queued],
			['removed', removed],
			['never queued', { mergeQueueEntry: null, isMergeQueueEnabled: false }],
		];

		const etagsOf = async (selected: boolean): Promise<{ full: string[]; cheap: string[] }> => {
			const runtime = createFakeRuntime({ mergeQueue: selected });
			serveGraphQL(
				runtime,
				new Map(cases.map(([, overrides], i) => [i + 1, prNode(i + 1, overrides)])),
				'pullRequest',
			);
			const { manager, gh } = await connectedGitHub(runtime);
			const coordinates = cases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));
			const full = fulfilled<PullRequestShape | undefined>(
				(await gh.getPullRequestsBatchResult(coordinates))?.value,
			).map(shape => pullRequestEtag(pullRequestEtagFieldsFromShape(shape!), []));
			const cheap = fulfilled<PullRequestEtagFields | undefined>(
				(await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: [] }))?.value,
			).map(fields => pullRequestEtag(fields!, []));
			manager.dispose();
			return { full: full, cheap: cheap };
		};

		const without = await etagsOf(false);
		const withData = await etagsOf(true);

		cases.forEach(([name], i) => {
			for (const a of [without.full[i], without.cheap[i]]) {
				for (const b of [withData.full[i], withData.cheap[i]]) {
					assert.notEqual(a, b, name);
				}
			}
		});
		// A read without the selection computes the etag it did before the selection existed: all three look the
		// same but for the queued and removed ones' own terms, which the document never asked for.
		const neverQueued = `pr1:["opened",false,${Date.parse('2026-01-02T03:04:05Z')},"head-3"]`;
		assert.equal(without.full[2], neverQueued);
		assert.equal(without.cheap[2], neverQueued);
		assert.equal(
			withData.full[2],
			`pr1:["opened",false,${Date.parse('2026-01-02T03:04:05Z')},"head-3",["merge-queue-read"]]`,
		);
	});

	test('a null review decision with a pending request reads as no decision on BOTH paths', async () => {
		// GitHub's null means the repository requires no review. Pinned so a decision derived from the pending
		// request, on either path, fails here by name rather than as one row of the table above.
		const runtime = createFakeRuntime({ mergeQueue: true });
		const byNumber = new Map([[1, prNode(1, { reviewDecision: null, reviewRequests: { nodes: [userRequest] } })]]);
		serveGraphQL(runtime, byNumber, 'pullRequest');
		const { manager, gh } = await connectedGitHub(runtime);
		const coordinates = [{ owner: 'o', repo: 'r', number: 1 }];

		const [shape] = fulfilled((await gh.getPullRequestsBatchResult(coordinates))?.value);
		const [fields] = fulfilled(
			(await gh.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: ['reviewDecision'] }))?.value,
		);

		assert.ok(shape != null && fields != null);
		assert.equal(shape.reviewDecision, undefined);
		assert.equal(fields.reviewDecision, undefined);

		manager.dispose();
	});
});

function issueNode(number: number, overrides: Node): Node {
	return {
		id: `issue-${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `https://github.com/o/r/issues/${number}`,
		state: 'OPEN',
		closed: false,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: '2026-01-02T03:04:05Z',
		closedAt: null,
		author: { login: 'octo', avatarUrl: '', url: 'https://github.com/octo' },
		assignees: { nodes: [] },
		comments: { totalCount: 0 },
		labels: { nodes: [] },
		reactions: { totalCount: 0 },
		repository: { name: 'r', owner: { login: 'o' }, viewerPermission: 'WRITE', url: 'https://github.com/o/r' },
		body: '',
		...overrides,
	};
}

/** Exactly what `getIssuesEtagFieldsBatch` selects: the thumbs-up reactions only when the query asked for them. */
function cheapIssueNode(node: Node, reactions: boolean): Node {
	const picked: Node = { id: node.id, number: node.number, state: node.state, updatedAt: node.updatedAt };
	if (reactions) {
		picked.reactions = node.reactions;
	}
	return picked;
}

/** Every set the issue agreement is proven for. */
const issueEtagIncludeSets: readonly (readonly IssueEtagInclude[])[] = [[], ['reactions']];

const closedIssue: Node = { state: 'CLOSED', closed: true, closedAt: '2026-01-03T00:00:00Z' };
const issueCases: [string, Node][] = [
	['open', {}],
	['closed', closedIssue],
	['no reactions', { reactions: { totalCount: 0 } }],
	['3 reactions', { reactions: { totalCount: 3 } }],
	['closed, 12 reactions', { ...closedIssue, reactions: { totalCount: 12 } }],
];

suite('GitHub issue etag agreement', () => {
	for (const includes of issueEtagIncludeSets) {
		test(`open and closed issues, with no and some reactions, compute the same etag on the cheap check and the full read (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const byNumber = new Map(issueCases.map(([, overrides], i) => [i + 1, issueNode(i + 1, overrides)]));
			const queries = serveGraphQL(runtime, byNumber, 'issue');
			const { manager, gh } = await connectedGitHub(runtime);
			const coordinates = issueCases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

			const fullRows = fulfilled<IssueShape | undefined>((await gh.getIssuesBatchResult(coordinates))?.value);
			const cheapRows = fulfilled<IssueEtagFields | undefined>(
				(await gh.getIssuesEtagFieldsResult(coordinates, { etagIncludes: includes }))?.value,
			);

			const cheapQuery = queries.find(q => q.startsWith('query getIssuesEtagFieldsBatch('));
			assert.ok(cheapQuery != null);
			assert.equal(/\breactions\b/.test(cheapQuery), includes.includes('reactions'), 'selects reactions');
			const etags = new Map<string, string>();
			issueCases.forEach(([name], i) => {
				const shape = fullRows[i];
				const fields = cheapRows[i];
				assert.ok(shape != null && fields != null, name);
				// The full row's count counts only where its read is known to fetch reactions.
				assert.equal(getIssueFieldPresence(shape)?.reactions, 'fetched', name);
				const etag = issueEtag(fields, includes);
				assert.equal(etag, issueEtag(issueEtagFieldsFromShape(shape), includes), name);
				etags.set(name, etag);
			});
			assert.notEqual(etags.get('open'), etags.get('closed'), 'the state is part of the etag');
			assert.equal(
				etags.get('no reactions') !== etags.get('3 reactions'),
				includes.includes('reactions'),
				'the reaction count is part of the etag only with the include',
			);

			manager.dispose();
		});
	}

	for (const includes of issueEtagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with no full request (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const byNumber = new Map([
				[1, issueNode(1, { reactions: { totalCount: 2 } })],
				[2, issueNode(2, closedIssue)],
			]);
			const queries = serveGraphQL(runtime, byNumber, 'issue');
			const { manager } = await connectedGitHub(runtime);
			const targets = [
				{ key: 'open', owner: 'o', repo: 'r', number: 1 },
				{ key: 'closed', owner: 'o', repo: 'r', number: 2 },
			];

			const first = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
				etagIncludes: includes,
			});
			queries.length = 0;
			const second = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
				etagIncludes: includes,
			});

			assert.ok(queries.every(q => q.startsWith('query getIssuesEtagFieldsBatch(')));
			assert.deepEqual(
				second.items.map(i => [i.key, i.unchanged]),
				[
					['open', true],
					['closed', true],
				],
			);

			manager.dispose();
		});
	}

	for (const includes of issueEtagIncludeSets) {
		const covered = includes.length > 0;
		test(`end to end: a reaction alone, which moves no update time, is ${covered ? 'read in full' : 'unseen'} when the etag ${covered ? 'covers' : "doesn't cover"} reactions`, async () => {
			const runtime = createFakeRuntime();
			const byNumber = new Map([
				[1, issueNode(1, { reactions: { totalCount: 0 } })],
				[2, issueNode(2, { reactions: { totalCount: 5 } })],
			]);
			const queries = serveGraphQL(runtime, byNumber, 'issue');
			const { manager } = await connectedGitHub(runtime);
			const targets = [
				{ key: 'reacted', owner: 'o', repo: 'r', number: 1 },
				{ key: 'untouched', owner: 'o', repo: 'r', number: 2 },
			];

			const first = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets,
				etagIncludes: includes,
			});
			byNumber.set(1, issueNode(1, { reactions: { totalCount: 1 } }));
			queries.length = 0;
			const second = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitHub,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				queries.map(q => /^query (\w+)\(/.exec(q)?.[1]),
				covered ? ['getIssuesEtagFieldsBatch', 'getIssuesBatch'] : ['getIssuesEtagFieldsBatch'],
			);
			assert.deepEqual(
				second.items.map(i => [i.key, i.unchanged, i.issue?.thumbsUpCount]),
				[covered ? ['reacted', undefined, 1] : ['reacted', true, undefined], ['untouched', true, undefined]],
			);

			manager.dispose();
		});
	}
});
