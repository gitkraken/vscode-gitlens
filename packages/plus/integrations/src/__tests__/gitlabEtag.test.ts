import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import {
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { getIssueFieldPresence } from '../fieldPresence.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type {
	BatchSlot,
	IssueEtagFields,
	IssueEtagInclude,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../models/integration.js';
import { pullRequestEtagIncludes } from '../models/integration.js';
import { issueEtag, issueEtagFieldsFromShape, pullRequestEtag, pullRequestEtagFieldsFromShape } from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedGitLab, primarySession } from './sweepHelpers.js';

/**
 * The GitLab cheap etag check: GitLens' own client reads each project's merge requests (or issues) by iid, up to 100
 * per request, where the full read sends one provider-apis request per target.
 *
 * The correctness core is agreement: the full row's etag is computed after provider-apis' GitLab mapping and
 * `fromProviderPullRequest` (or `toIssueShape`), neither of which is the identity everywhere — a locked merge request
 * reads as merged, an issue's state comes from `closedAt`. So each case feeds ONE raw GitLab node through the
 * integration's real full read and its real cheap read, answering each request at the HTTP level with only the
 * fields that request selected, and compares the etags.
 */

type Node = Record<string, unknown>;

const user = {
	id: 'gid://gitlab/User/1',
	name: 'Me',
	username: 'me',
	publicEmail: null,
	avatarUrl: 'https://gitlab.com/uploads/me.png',
	webUrl: 'https://gitlab.com/me',
};

function projectNode(fullPath: string): Node {
	return {
		id: `gid://gitlab/Project/${fullPath.length}`,
		httpUrlToRepo: `https://gitlab.com/${fullPath}.git`,
		fullPath: fullPath,
		sshUrlToRepo: `git@gitlab.com:${fullPath}.git`,
		webUrl: `https://gitlab.com/${fullPath}`,
	};
}

function reviewer(reviewState: string | null | undefined): Node {
	return {
		...user,
		id: `gid://gitlab/User/${reviewState ?? 'none'}`,
		mergeRequestInteraction: reviewState === undefined ? null : { approved: false, reviewState: reviewState },
	};
}

let jobId = 0;
function job(status: string | null, allowFailure = false): Node {
	jobId++;
	return {
		allowFailure: allowFailure,
		createdAt: '2026-01-01T00:00:00Z',
		finishedAt: null,
		id: `gid://gitlab/Ci::Build/${jobId}`,
		name: `job ${jobId}`,
		status: status,
	};
}

function pipeline(...jobs: Node[]): Node {
	return { stages: { nodes: [{ name: 'test', jobs: { nodes: jobs } }] } };
}

/** A merge request as provider-apis' `getPullRequestForRepo` selects it. */
function mrNode(iid: number, overrides: Node): Node {
	return {
		id: `gid://gitlab/MergeRequest/${iid}00`,
		state: 'opened',
		author: user,
		diffRefs: { baseSha: 'base', headSha: `head-${iid}` },
		diffStatsSummary: { additions: 1, deletions: 1, fileCount: 1 },
		commitCount: 1,
		draft: false,
		userNotesCount: 0,
		upvotes: 0,
		title: `MR ${iid}`,
		description: 'body',
		webUrl: `https://gitlab.com/group/r/-/merge_requests/${iid}`,
		createdAt: '2026-01-01T00:00:00Z',
		updatedAt: `2026-01-02T03:04:${String(iid % 60).padStart(2, '0')}Z`,
		mergedAt: null,
		iid: String(iid),
		targetBranch: 'main',
		sourceBranch: `feature-${iid}`,
		assignees: { nodes: [] },
		reviewers: { nodes: [] },
		mergeStatusEnum: 'CAN_BE_MERGED',
		labels: { nodes: [] },
		milestone: null,
		headPipeline: pipeline(job('SUCCESS')),
		sourceProject: projectNode('group/r'),
		...overrides,
	};
}

/** Exactly what `getMergeRequestsEtagFields` selects for `includes`, picked off the node the full read is served. */
function cheapMrNode(node: Node, includes: readonly PullRequestEtagInclude[]): Node {
	const diffRefs = node.diffRefs as { headSha: string | null } | null;
	const picked: Node = {
		iid: node.iid,
		state: node.state,
		draft: node.draft,
		updatedAt: node.updatedAt,
		diffRefs: diffRefs == null ? null : { headSha: diffRefs.headSha },
	};
	if (includes.includes('mergeable')) {
		picked.mergeStatusEnum = node.mergeStatusEnum;
	}
	if (includes.includes('reviewDecision')) {
		const reviewers = node.reviewers as { nodes: { mergeRequestInteraction: { reviewState: string } | null }[] };
		picked.reviewers = {
			nodes: reviewers.nodes.map(r => ({
				mergeRequestInteraction:
					r.mergeRequestInteraction == null ? null : { reviewState: r.mergeRequestInteraction.reviewState },
			})),
		};
	}
	if (includes.includes('checks')) {
		const headPipeline = node.headPipeline as {
			stages: { nodes: { jobs: { nodes: { status: string | null; allowFailure: boolean }[] } }[] };
		} | null;
		picked.headPipeline =
			headPipeline == null
				? null
				: {
						stages: {
							nodes: headPipeline.stages.nodes.map(stage => ({
								jobs: {
									nodes: stage.jobs.nodes.map(j => ({
										status: j.status,
										allowFailure: j.allowFailure,
									})),
								},
							})),
						},
					};
	}
	return picked;
}

/** An issue as provider-apis' `getIssue` selects it. */
function issueNode(iid: number, overrides: Node): Node {
	return {
		author: user,
		assignees: { nodes: [] },
		closedAt: null,
		createdAt: '2026-01-01T00:00:00Z',
		description: 'body',
		dueDate: null,
		id: `gid://gitlab/Issue/${iid}00`,
		iid: String(iid),
		labels: { nodes: [] },
		state: 'opened',
		title: `Issue ${iid}`,
		type: 'ISSUE',
		updatedAt: `2026-01-02T03:04:${String(iid % 60).padStart(2, '0')}Z`,
		upvotes: 0,
		userNotesCount: 0,
		webUrl: `https://gitlab.com/group/r/-/issues/${iid}`,
		milestone: null,
		...overrides,
	};
}

/** Exactly what `getIssuesEtagFields` selects: the upvotes only when the query asked for them. */
function cheapIssueNode(node: Node, upvotes: boolean): Node {
	const picked: Node = { iid: node.iid, closedAt: node.closedAt, updatedAt: node.updatedAt };
	if (upvotes) {
		picked.upvotes = node.upvotes;
	}
	return picked;
}

/** What the document asked for, read back from its text, so the served node answers with what was selected. */
function selectedIncludes(query: string): PullRequestEtagInclude[] {
	const selected: PullRequestEtagInclude[] = [];
	if (/\bmergeStatusEnum\b/.test(query)) {
		selected.push('mergeable');
	}
	if (/\breviewers\b/.test(query)) {
		selected.push('reviewDecision');
	}
	if (/\bheadPipeline\b/.test(query)) {
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

interface SentRequest {
	operation: string;
	url: string;
	query: string;
	variables: Record<string, unknown>;
}

/**
 * Projects by full path, each a map of iid to node, or `null` for a project GitLab answers `null` for (missing, or
 * not visible to the token).
 */
type Projects = Map<string, Map<number, Node> | null>;

/**
 * Answers every GitLab GraphQL request — provider-apis' full reads, GitLens' own confirming reads and the cheap etag
 * reads — from `projects`, by operation, with what that request selected. `override` may answer a request first.
 */
function serveGitLab(
	runtime: FakeRuntime,
	projects: Projects,
	override?: (request: SentRequest) => Response | undefined,
): SentRequest[] {
	const sent: SentRequest[] = [];
	runtime.http.fetch = (input, init) => {
		const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
			query: string;
			variables: Record<string, unknown>;
		};
		const operation = /query (\w+)\(/.exec(body.query)?.[1] ?? '';
		const request = { operation: operation, url: input.toString(), query: body.query, variables: body.variables };
		sent.push(request);

		const overridden = override?.(request);
		if (overridden != null) return Promise.resolve(overridden);

		const { variables } = body;
		switch (operation) {
			case 'getPullRequestForRepo': {
				const fullPath = variables.fullPath as string;
				const project = projects.get(fullPath);
				if (project == null) return Promise.resolve(json(200, { data: { project: null } }));

				const node = project.get(Number(variables.iid)) ?? null;
				return Promise.resolve(
					json(200, { data: { project: { ...projectNode(fullPath), archived: false, mergeRequest: node } } }),
				);
			}
			case 'getMergeRequest': {
				const project = projects.get(variables.fullPath as string);
				if (project == null) return Promise.resolve(json(200, { data: { project: null } }));
				// Only a miss reaches the confirming read, so the merge request is missing here too.
				return Promise.resolve(json(200, { data: { project: { mergeRequest: null } } }));
			}
			case 'GetSingleIssue': {
				const fullPath = variables.projectId as string;
				const project = projects.get(fullPath);
				if (project == null) return Promise.resolve(json(200, { data: { project: null } }));

				const node = project.get(Number(variables.issueNumber)) ?? null;
				return Promise.resolve(json(200, { data: { project: { ...projectNode(fullPath), issue: node } } }));
			}
			case 'hasIssue': {
				const project = projects.get(variables.fullPath as string);
				if (project == null) return Promise.resolve(json(200, { data: { project: null } }));

				const node = project.get(Number(variables.iid));
				return Promise.resolve(
					json(200, { data: { project: { issue: node != null ? { iid: node.iid } : null } } }),
				);
			}
			case 'getMergeRequestsEtagFields':
			case 'getIssuesEtagFields': {
				const project = projects.get(variables.fullPath as string);
				if (project == null) return Promise.resolve(json(200, { data: { project: null } }));

				const includes = selectedIncludes(body.query);
				const nodes = (variables.iids as string[])
					.map(iid => project.get(Number(iid)))
					.filter(node => node != null)
					.map(node =>
						operation === 'getIssuesEtagFields'
							? cheapIssueNode(node, /\bupvotes\b/.test(body.query))
							: cheapMrNode(node, includes),
					);
				const connection = operation === 'getIssuesEtagFields' ? 'issues' : 'mergeRequests';
				return Promise.resolve(
					json(200, {
						data: { project: { [connection]: { pageInfo: { hasNextPage: false }, nodes: nodes } } },
					}),
				);
			}
		}
		return Promise.reject(new Error(`unexpected request: ${body.query}`));
	};
	return sent;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

function fulfilled<T>(slots: BatchSlot<T>[] | undefined): T[] {
	assert.ok(slots != null);
	return slots.map(slot => {
		assert.equal(slot.status, 'fulfilled', slot.status === 'rejected' ? String(slot.reason) : undefined);
		return slot.value;
	});
}

function skipCurrentAccount(gl: GitHostIntegration): void {
	(gl as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
		Promise.resolve(undefined);
}

const prCases: [string, Node][] = [
	['opened', {}],
	['closed', { state: 'closed' }],
	['merged', { state: 'merged', mergedAt: '2026-01-03T00:00:00Z' }],
	// provider-apis has no `locked` state, and `fromProviderPullRequestState` reads the `undefined` as merged.
	['locked', { state: 'locked' }],
	['draft', { draft: true }],
	['a later updatedAt', { updatedAt: '2026-05-06T07:08:09Z' }],
	['no diffRefs', { diffRefs: null }],
	['a null headSha', { diffRefs: { baseSha: 'base', headSha: null } }],
	...['CANNOT_BE_MERGED', 'CANNOT_BE_MERGED_RECHECK', 'UNCHECKED', 'CHECKING', null].map((status): [string, Node] => [
		`mergeStatusEnum ${status}`,
		{ mergeStatusEnum: status },
	]),
	...['APPROVED', 'REQUESTED_CHANGES', 'REVIEWED', 'UNAPPROVED', 'UNREVIEWED', 'REVIEW_STARTED', null].map(
		(state): [string, Node] => [`a reviewer ${state}`, { reviewers: { nodes: [reviewer(state)] } }],
	),
	['a reviewer with no interaction', { reviewers: { nodes: [reviewer(undefined)] } }],
	[
		'reviewers APPROVED and REQUESTED_CHANGES',
		{ reviewers: { nodes: [reviewer('APPROVED'), reviewer('REQUESTED_CHANGES')] } },
	],
	['reviewers REVIEWED and APPROVED', { reviewers: { nodes: [reviewer('REVIEWED'), reviewer('APPROVED')] } }],
	[
		'reviewers REVIEW_STARTED and APPROVED',
		{ reviewers: { nodes: [reviewer('REVIEW_STARTED'), reviewer('APPROVED')] } },
	],
	['no head pipeline', { headPipeline: null }],
	['a pipeline with no stages', { headPipeline: { stages: { nodes: [] } } }],
	...['FAILED', 'RUNNING', 'PENDING', 'CREATED', 'MANUAL', 'SKIPPED', 'CANCELED', 'PREPARING', 'SCHEDULED', null].map(
		(status): [string, Node] => [`a job ${status}`, { headPipeline: pipeline(job(status)) }],
	),
	['a failed job that may fail', { headPipeline: pipeline(job('FAILED', true), job('SUCCESS')) }],
	['a pending and a passing job', { headPipeline: pipeline(job('PENDING'), job('SUCCESS')) }],
	[
		'two stages, one failing',
		{
			headPipeline: {
				stages: {
					nodes: [
						{ name: 'build', jobs: { nodes: [job('SUCCESS')] } },
						{ name: 'test', jobs: { nodes: [job('FAILED')] } },
					],
				},
			},
		},
	],
];

function prProjects(): Projects {
	return new Map([['group/r', new Map(prCases.map(([, overrides], i) => [i + 1, mrNode(i + 1, overrides)]))]]);
}

const prCoordinates = prCases.map((_, i) => ({ owner: 'group', repo: 'r', number: i + 1 }));

/** The cheap requests one project's merge requests take: chunks of 10 when the check rollup is selected, else 100. */
function cheapRequestCount(count: number, includes: readonly PullRequestEtagInclude[]): number {
	return Math.ceil(count / (includes.includes('checks') ? 10 : 100));
}

suite('GitLab etag agreement: the cheap check and the full read compute the same etag', () => {
	for (const includes of etagIncludeSets) {
		test(`merge requests, every state, draft, mergeability, review decision and pipeline (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveGitLab(runtime, prProjects());
			const { manager, gl } = await connectedGitLab(runtime);

			const full = await gl.getPullRequestsBatchResult(prCoordinates);
			const cheap = await gl.getPullRequestsEtagFieldsResult(prCoordinates, { etagIncludes: includes });

			assert.equal(sent.filter(r => r.operation === 'getPullRequestForRepo').length, prCases.length);
			assert.equal(
				sent.filter(r => r.operation === 'getMergeRequestsEtagFields').length,
				cheapRequestCount(prCases.length, includes),
			);
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

	test('every include is meaningful on GitLab: the full row carries a value for each, and the cheap check reads it', async () => {
		const runtime = createFakeRuntime();
		serveGitLab(runtime, prProjects());
		const { manager, gl } = await connectedGitLab(runtime);

		const cheapRows = fulfilled(
			(await gl.getPullRequestsEtagFieldsResult(prCoordinates, { etagIncludes: pullRequestEtagIncludes }))?.value,
		);
		const fullRows = fulfilled((await gl.getPullRequestsBatchResult(prCoordinates))?.value);
		const byName = (name: string): { fields: PullRequestEtagFields | undefined; shape: PullRequestShape } => {
			const index = prCases.findIndex(([caseName]) => caseName === name);
			const shape = fullRows[index];
			assert.ok(shape != null, name);
			return { fields: cheapRows[index], shape: shape };
		};

		const expectations: [string, keyof PullRequestEtagFields, unknown][] = [
			['locked', 'state', 'merged'],
			['no diffRefs', 'headSha', ''],
			['opened', 'mergeableState', PullRequestMergeableState.Mergeable],
			['mergeStatusEnum CANNOT_BE_MERGED', 'mergeableState', PullRequestMergeableState.Conflicting],
			['mergeStatusEnum CHECKING', 'mergeableState', PullRequestMergeableState.Unknown],
			['mergeStatusEnum null', 'mergeableState', undefined],
			['opened', 'reviewDecision', undefined],
			['a reviewer APPROVED', 'reviewDecision', PullRequestReviewDecision.Approved],
			['a reviewer REVIEWED', 'reviewDecision', undefined],
			['a reviewer UNREVIEWED', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['a reviewer with no interaction', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['a reviewer REVIEW_STARTED', 'reviewDecision', PullRequestReviewDecision.Approved],
			['reviewers APPROVED and REQUESTED_CHANGES', 'reviewDecision', PullRequestReviewDecision.ChangesRequested],
			['opened', 'statusCheckRollupState', PullRequestStatusCheckRollupState.Success],
			['no head pipeline', 'statusCheckRollupState', undefined],
			['a job FAILED', 'statusCheckRollupState', PullRequestStatusCheckRollupState.Failed],
			['a job RUNNING', 'statusCheckRollupState', PullRequestStatusCheckRollupState.Pending],
			['a failed job that may fail', 'statusCheckRollupState', PullRequestStatusCheckRollupState.Success],
			['two stages, one failing', 'statusCheckRollupState', PullRequestStatusCheckRollupState.Failed],
		];
		for (const [name, field, expected] of expectations) {
			const { fields, shape } = byName(name);
			assert.equal(fields?.[field], expected, `${name}: ${field} (cheap)`);
			assert.equal(pullRequestEtagFieldsFromShape(shape)[field], expected, `${name}: ${field} (full)`);
		}

		manager.dispose();
	});

	for (const includes of etagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with only the cheap query sent (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveGitLab(runtime, prProjects());
			const { manager, gl } = await connectedGitLab(runtime);
			skipCurrentAccount(gl);
			const targets = prCases.map(([name], i) => ({ key: name, owner: 'group', repo: 'r', number: i + 1 }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: targets,
				etagIncludes: includes,
			});
			const etags = new Map(first.items.map(i => [i.key, i.etag]));
			sent.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => r.operation),
				new Array<string>(cheapRequestCount(prCases.length, includes)).fill('getMergeRequestsEtagFields'),
				'only the cheap check is sent',
			);
			assert.deepEqual(
				second.items.filter(i => !i.unchanged).map(i => i.key),
				[],
				'every unchanged merge request is answered unchanged',
			);
			assert.deepEqual(
				second.items.map(i => i.etag),
				first.items.map(i => i.etag),
			);

			manager.dispose();
		});
	}

	test('end to end: a merge request that moved is read in full, and only it', async () => {
		const runtime = createFakeRuntime();
		const projects = prProjects();
		const sent = serveGitLab(runtime, projects);
		const { manager, gl } = await connectedGitLab(runtime);
		skipCurrentAccount(gl);
		const targets = [1, 2, 3].map(n => ({ key: `k${n}`, owner: 'group', repo: 'r', number: n }));

		const first = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: targets,
			etagIncludes: ['checks'],
		});
		// The pipeline moved without `updatedAt` moving: only an etag that covers checks notices.
		projects.get('group/r')!.set(2, mrNode(2, { headPipeline: pipeline(job('FAILED')) }));
		sent.length = 0;

		const second = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
			etagIncludes: ['checks'],
		});

		assert.deepEqual(
			sent.map(r => [r.operation, r.variables.iid]),
			[
				['getMergeRequestsEtagFields', undefined],
				['getPullRequestForRepo', '2'],
			],
		);
		assert.deepEqual(
			second.items.map(i => [
				i.key,
				i.unchanged,
				i.pullRequest != null
					? pullRequestEtagFieldsFromShape(i.pullRequest).statusCheckRollupState
					: undefined,
			]),
			[
				['k1', true, undefined],
				['k2', undefined, PullRequestStatusCheckRollupState.Failed],
				['k3', true, undefined],
			],
		);

		manager.dispose();
	});
});

const issueCases: [string, Node][] = [
	['opened', {}],
	['closed', { state: 'closed', closedAt: '2026-01-03T00:00:00Z' }],
	// `toIssueShape` reads `closedAt`, never GitLab's state: both paths must agree this one reads open.
	['closed without closedAt', { state: 'closed', closedAt: null }],
	['locked', { state: 'locked' }],
	['a later updatedAt', { updatedAt: '2026-05-06T07:08:09Z' }],
	['4 upvotes', { upvotes: 4 }],
	['closed, 9 upvotes', { state: 'closed', closedAt: '2026-01-03T00:00:00Z', upvotes: 9 }],
];

/** Every set the issue agreement is proven for. */
const issueEtagIncludeSets: readonly (readonly IssueEtagInclude[])[] = [[], ['reactions']];

function issueProjects(): Projects {
	return new Map([['group/r', new Map(issueCases.map(([, overrides], i) => [i + 1, issueNode(i + 1, overrides)]))]]);
}

suite('GitLab issue etag agreement', () => {
	for (const includes of issueEtagIncludeSets) {
		test(`opened, closed and locked issues, with no and some upvotes, compute the same etag on the cheap check and the full read (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveGitLab(runtime, issueProjects());
			const { manager, gl } = await connectedGitLab(runtime);
			const coordinates = issueCases.map((_, i) => ({ owner: 'group', repo: 'r', number: i + 1 }));

			const fullRows = fulfilled<IssueShape | undefined>((await gl.getIssuesBatchResult(coordinates))?.value);
			const cheapRows = fulfilled<IssueEtagFields | undefined>(
				(await gl.getIssuesEtagFieldsResult(coordinates, { etagIncludes: includes }))?.value,
			);

			assert.equal(sent.filter(r => r.operation === 'getIssuesEtagFields').length, 1);
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
			assert.deepEqual(
				cheapRows.map(f => f?.state),
				['opened', 'closed', 'opened', 'opened', 'opened', 'opened', 'closed'],
			);
			assert.deepEqual(
				cheapRows.map(f => f?.thumbsUpCount),
				includes.includes('reactions') ? [0, 0, 0, 0, 0, 4, 9] : new Array(issueCases.length).fill(undefined),
			);
			// `opened` and `4 upvotes` differ in their upvotes and their update time; compare two that differ in only one.
			const reacted = issueEtag({ ...cheapRows[0]!, thumbsUpCount: 4 }, includes);
			assert.equal(reacted !== etags.get('opened'), includes.includes('reactions'));

			manager.dispose();
		});
	}

	for (const includes of issueEtagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with only the cheap query sent (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveGitLab(runtime, issueProjects());
			const { manager } = await connectedGitLab(runtime);
			const targets = issueCases.map(([name], i) => ({ key: name, owner: 'group', repo: 'r', number: i + 1 }));

			const first = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: targets,
				etagIncludes: includes,
			});
			sent.length = 0;
			const second = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => r.operation),
				['getIssuesEtagFields'],
			);
			assert.deepEqual(
				second.items.map(i => [i.key, i.unchanged]),
				issueCases.map(([name]) => [name, true]),
			);

			manager.dispose();
		});
	}

	for (const includes of issueEtagIncludeSets) {
		const covered = includes.length > 0;
		test(`end to end: an upvote alone, which moves no update time, is ${covered ? 'read in full' : 'unseen'} when the etag ${covered ? 'covers' : "doesn't cover"} reactions`, async () => {
			const runtime = createFakeRuntime();
			const issues = new Map([
				[1, issueNode(1, { upvotes: 0 })],
				[2, issueNode(2, { upvotes: 3 })],
			]);
			const sent = serveGitLab(runtime, new Map([['group/r', issues]]));
			const { manager } = await connectedGitLab(runtime);
			const targets = [
				{ key: 'upvoted', owner: 'group', repo: 'r', number: 1 },
				{ key: 'untouched', owner: 'group', repo: 'r', number: 2 },
			];

			const first = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: targets,
				etagIncludes: includes,
			});
			issues.set(1, issueNode(1, { upvotes: 1 }));
			sent.length = 0;
			const second = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.GitLab,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => r.operation),
				covered ? ['getIssuesEtagFields', 'GetSingleIssue'] : ['getIssuesEtagFields'],
			);
			assert.deepEqual(
				second.items.map(i => [i.key, i.unchanged, i.issue?.thumbsUpCount]),
				[covered ? ['upvoted', undefined, 1] : ['upvoted', true, undefined], ['untouched', true, undefined]],
			);

			manager.dispose();
		});
	}
});

suite('GitLab etag check: requests and slots', () => {
	function mrs(...iids: number[]): Map<number, Node> {
		return new Map(iids.map(iid => [iid, mrNode(iid, {})]));
	}

	test('targets across two projects send one request per project and map back positionally', async () => {
		const runtime = createFakeRuntime();
		const sent = serveGitLab(
			runtime,
			new Map([
				['group/a', mrs(1, 3)],
				['other/sub/b', mrs(2)],
			]),
		);
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'group', repo: 'a', number: 1 },
				{ owner: 'other/sub', repo: 'b', number: 2 },
				{ owner: 'group', repo: 'a', number: 3 },
			],
			{},
		);

		assert.deepEqual(
			sent.map(r => [r.variables.fullPath, r.variables.iids]),
			[
				['group/a', ['1', '3']],
				['other/sub/b', ['2']],
			],
		);
		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['head-1', 'head-2', 'head-3'],
		);

		manager.dispose();
	});

	test('150 iids in one project send two requests of at most 100', async () => {
		const runtime = createFakeRuntime();
		const iids = Array.from({ length: 150 }, (_, i) => i + 1);
		const sent = serveGitLab(runtime, new Map([['group/r', mrs(...iids)]]));
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getPullRequestsEtagFieldsResult(
			iids.map(n => ({ owner: 'group', repo: 'r', number: n })),
			{},
		);

		assert.deepEqual(
			sent.map(r => [(r.variables.iids as string[]).length, r.variables.first]),
			[
				[100, 100],
				[50, 50],
			],
		);
		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			iids.map(n => `head-${n}`),
		);

		manager.dispose();
	});

	test('selecting the check rollup sends requests of at most 10 iids, since each resolves every pipeline job', async () => {
		const runtime = createFakeRuntime();
		const iids = Array.from({ length: 25 }, (_, i) => i + 1);
		const sent = serveGitLab(runtime, new Map([['group/r', mrs(...iids)]]));
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getPullRequestsEtagFieldsResult(
			iids.map(n => ({ owner: 'group', repo: 'r', number: n })),
			{ etagIncludes: ['checks'] },
		);

		assert.deepEqual(
			sent.map(r => (r.variables.iids as string[]).length),
			[10, 10, 5],
		);
		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			iids.map(n => `head-${n}`),
		);

		manager.dispose();
	});

	test('a missing project proves all of its targets absent, and a missing iid proves its own', async () => {
		const runtime = createFakeRuntime();
		serveGitLab(
			runtime,
			new Map([
				['group/r', mrs(1)],
				['group/gone', null],
			]),
		);
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'group', repo: 'r', number: 1 },
				{ owner: 'group', repo: 'gone', number: 1 },
				{ owner: 'group', repo: 'r', number: 2 },
				{ owner: 'group', repo: 'gone', number: 2 },
			],
			{},
		);

		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['head-1', undefined, undefined, undefined],
		);

		manager.dispose();
	});

	test('two targets naming the same merge request are both answered', async () => {
		const runtime = createFakeRuntime();
		serveGitLab(runtime, new Map([['group/r', mrs(1)]]));
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'group', repo: 'r', number: 1 },
				{ owner: 'group', repo: 'r', number: 1 },
			],
			{},
		);

		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['head-1', 'head-1'],
		);

		manager.dispose();
	});

	test('a request that fails rejects only its own targets', async () => {
		const runtime = createFakeRuntime();
		serveGitLab(runtime, new Map([['group/r', mrs(1)]]), request =>
			request.variables.fullPath === 'group/broken' ? json(500, { message: 'upstream exploded' }) : undefined,
		);
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'group', repo: 'broken', number: 1 },
				{ owner: 'group', repo: 'r', number: 1 },
				{ owner: 'group', repo: 'broken', number: 2 },
			],
			{},
		);

		assert.deepEqual(
			result?.value?.map(slot => slot.status),
			['rejected', 'fulfilled', 'rejected'],
		);

		manager.dispose();
	});

	for (const [name, reply] of [
		['GraphQL errors', { data: { project: null }, errors: [{ message: 'Timeout on validation of query' }] }],
		['an empty response', {}],
		['a null connection', { data: { project: { mergeRequests: null } } }],
		['a partial page', { data: { project: { mergeRequests: { pageInfo: { hasNextPage: true }, nodes: [] } } } }],
	] as const) {
		test(`${name} rejects the targets instead of proving them absent`, async () => {
			const runtime = createFakeRuntime();
			// A healthy project alongside, since a call whose every slot rejected fails as a whole.
			serveGitLab(runtime, new Map([['group/ok', mrs(1)]]), request =>
				request.variables.fullPath === 'group/r' ? json(200, reply) : undefined,
			);
			const { manager, gl } = await connectedGitLab(runtime);

			const result = await gl.getPullRequestsEtagFieldsResult(
				[
					{ owner: 'group', repo: 'r', number: 1 },
					{ owner: 'group', repo: 'ok', number: 1 },
				],
				{},
			);

			assert.deepEqual(
				result?.value?.map(slot => slot.status),
				['rejected', 'fulfilled'],
			);

			manager.dispose();
		});
	}

	test('a rate-limited request drops its targets with a rate-limit warning, without a full read; others still answer', async () => {
		const runtime = createFakeRuntime();
		const projects: Projects = new Map([
			['group/r', mrs(1)],
			['group/limited', mrs(1)],
		]);
		const sent = serveGitLab(runtime, projects);
		const { manager, gl } = await connectedGitLab(runtime);
		skipCurrentAccount(gl);
		const targets = [
			{ key: 'ok', owner: 'group', repo: 'r', number: 1 },
			{ key: 'limited', owner: 'group', repo: 'limited', number: 1 },
		];
		const first = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: targets,
		});

		sent.length = 0;
		serveGitLab(runtime, projects, request =>
			request.variables.fullPath === 'group/limited'
				? json(429, { message: '429 Too Many Requests' })
				: undefined,
		);
		const second = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
		});

		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged]),
			[['ok', true]],
		);
		assert.equal(second.fetchFailed, true);
		assert.deepEqual(
			second.warnings.map(w => w.kind),
			['rate-limit'],
		);

		manager.dispose();
	});

	test('a request that fails another way falls through to the full read, which answers', async () => {
		const runtime = createFakeRuntime();
		const sent = serveGitLab(runtime, new Map([['group/r', mrs(1)]]), request =>
			request.operation === 'getMergeRequestsEtagFields'
				? json(500, { message: 'upstream exploded' })
				: undefined,
		);
		const { manager, gl } = await connectedGitLab(runtime);
		skipCurrentAccount(gl);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitLab,
			targets: [{ key: 'a', owner: 'group', repo: 'r', number: 1, etag: 'pr1:stale' }],
		});

		assert.deepEqual(
			sent.map(r => r.operation),
			['getMergeRequestsEtagFields', 'getPullRequestForRepo'],
		);
		assert.equal(result.items[0]?.pullRequest?.number, 1);
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('issues: grouped per project, a missing project and a missing iid are absent', async () => {
		const runtime = createFakeRuntime();
		const sent = serveGitLab(
			runtime,
			new Map([
				['group/r', new Map([[1, issueNode(1, {})]])],
				['group/gone', null],
			]),
		);
		const { manager, gl } = await connectedGitLab(runtime);

		const result = await gl.getIssuesEtagFieldsResult(
			[
				{ owner: 'group', repo: 'r', number: 1 },
				{ owner: 'group', repo: 'gone', number: 1 },
				{ owner: 'group', repo: 'r', number: 2 },
			],
			{},
		);

		assert.equal(sent.length, 2);
		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.state),
			['opened', undefined, undefined],
		);

		manager.dispose();
	});

	test('self-managed GitLab inherits the check and asks its own host', async () => {
		const runtime = createFakeRuntime();
		const sent = serveGitLab(runtime, new Map([['group/r', mrs(1)]]));
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com');
		assert.ok(gl != null);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.example.com',
		};

		assert.equal(gl.supportsPullRequestEtags, true);
		assert.equal(gl.supportsIssueEtags, true);
		const result = await gl.getPullRequestsEtagFieldsResult([{ owner: 'group', repo: 'r', number: 1 }], {});

		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['head-1'],
		);
		assert.deepEqual(
			sent.map(r => r.url),
			['https://gitlab.example.com/api/graphql'],
		);

		manager.dispose();
	});
});

suite('GitLab etag check: query text', () => {
	/** Each `$variable` the document declares, and whether its body uses it. */
	function declaredVariables(query: string): { name: string; used: boolean }[] {
		const header = /^query \w+\(([^)]*)\)/.exec(query)?.[1] ?? '';
		const body = query.slice(query.indexOf(')') + 1);
		return Array.from(header.matchAll(/\$(\w+):/g), ([, name]) => ({
			name: name,
			used: new RegExp(`\\$${name}\\b`).test(body),
		}));
	}

	async function sentQuery(
		etagIncludes: readonly PullRequestEtagInclude[] | 'issues',
		issueEtagIncludes: readonly IssueEtagInclude[] = [],
	): Promise<SentRequest> {
		const runtime = createFakeRuntime();
		const sent = serveGitLab(runtime, new Map([['group/r', new Map()]]));
		const { manager, gl } = await connectedGitLab(runtime);
		const coordinates = [
			{ owner: 'group', repo: 'r', number: 7 },
			{ owner: 'group', repo: 'r', number: 8 },
		];
		if (etagIncludes === 'issues') {
			await gl.getIssuesEtagFieldsResult(coordinates, { etagIncludes: issueEtagIncludes });
		} else {
			await gl.getPullRequestsEtagFieldsResult(coordinates, { etagIncludes: etagIncludes });
		}
		manager.dispose();

		assert.equal(sent.length, 1);
		return sent[0];
	}

	for (const kind of ['mergeRequests', 'issues'] as const) {
		test(`${kind}: iids are sent as strings, \`first\` is set, every declared variable is used and every state is asked for`, async () => {
			const request = await sentQuery(kind === 'issues' ? 'issues' : pullRequestEtagIncludes);

			assert.deepEqual(request.variables, { fullPath: 'group/r', iids: ['7', '8'], first: 2 });
			const declared = declaredVariables(request.query);
			assert.deepEqual(
				declared.map(v => v.name),
				['fullPath', 'iids', 'first'],
			);
			for (const variable of declared) {
				assert.ok(variable.used, `$${variable.name} is declared but never used`);
			}
			assert.match(request.query, new RegExp(`\\b${kind}\\(iids: \\$iids, state: all, first: \\$first\\)`));
			assert.match(request.query, /pageInfo \{\s*hasNextPage\s*\}/);
		});
	}

	test('issues select only their change state', async () => {
		const request = await sentQuery('issues');

		assert.match(request.query, /nodes \{\s*iid\s+closedAt\s+updatedAt\s*\}/);
		assert.doesNotMatch(request.query, /\bupvotes\b/);
	});

	test("issues select their upvotes only with 'reactions', once", async () => {
		const request = await sentQuery('issues', ['reactions', 'reactions']);

		assert.match(request.query, /nodes \{\s*iid\s+closedAt\s+updatedAt\s+upvotes\s*\}/);
		for (const variable of declaredVariables(request.query)) {
			assert.ok(variable.used, `$${variable.name} is declared but never used`);
		}
	});

	for (const includes of etagIncludeSets) {
		test(`merge requests select an include's fields only when it is requested (etagIncludes: [${includes.join(', ')}])`, async () => {
			const request = await sentQuery(includes);

			assert.deepEqual(selectedIncludes(request.query), includes);
			assert.match(request.query, /\biid\s+state\s+draft\s+updatedAt\s+diffRefs \{ headSha \}/);
			// Nothing a full row's etag doesn't read.
			for (const field of ['title', 'description', 'author', 'labels', 'assignees', 'diffStatsSummary']) {
				assert.doesNotMatch(request.query, new RegExp(`\\b${field}\\b`), field);
			}
		});
	}
});
