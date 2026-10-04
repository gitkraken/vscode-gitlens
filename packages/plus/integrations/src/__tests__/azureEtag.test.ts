import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import {
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
} from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type {
	BatchSlot,
	IssueEtagFields,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../models/integration.js';
import { pullRequestEtagIncludes, pullRequestRevision } from '../models/integration.js';
import { issueEtag, issueEtagFieldsFromShape, pullRequestEtag, pullRequestEtagFieldsFromShape } from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedAzure, primarySession } from './sweepHelpers.js';

/**
 * The Azure DevOps cheap etag check. Work items: one `GET …/_apis/wit/workitems?ids=…` per project and 200 ids, where
 * the full read sends one `GET …/_apis/wit/workitems/{id}` per target. Pull requests: still one request per target, as
 * Azure DevOps has no read of several by id, but only the pull request GET — not the repository GET provider-apis adds
 * to each for clone URLs.
 *
 * The correctness core is agreement: the full row's etag is computed after provider-apis' Azure DevOps mapping and
 * `fromProviderPullRequest` (or this package's work item conversion and `toIssueShape`), none of which is the identity
 * everywhere — a `notSet` pull request reads as merged, a work item's state comes from its closed date. So each case
 * feeds ONE raw Azure DevOps payload through the integration's real full read and its real cheap read, answering each
 * request at the HTTP level, and compares the etags. The rest pins the matching rules that keep the work item check
 * from ever answering a false `unchanged` or a false absence: Azure silently leaves out ids it can't return, and the
 * route's project doesn't scope the ids.
 */

type Node = Record<string, unknown>;

const projectId = 'b3a1c2d4-0000-4000-8000-000000000001';
const repoId = '9f1e2d3c-0000-4000-8000-000000000002';

function identity(id: string, extra?: Node): Node {
	return {
		displayName: `User ${id}`,
		url: `https://spsprodcus5.vssps.visualstudio.com/A1/_apis/Identities/${id}`,
		_links: { avatar: { href: `https://dev.azure.com/org/_apis/GraphProfile/MemberAvatars/${id}` } },
		id: id,
		uniqueName: `${id}@example.com`,
		imageUrl: `https://dev.azure.com/org/_api/_common/identityImage?id=${id}`,
		descriptor: `aad.${id}`,
		...extra,
	};
}

let reviewerId = 0;
function reviewer(vote: number | undefined, isRequired = true): Node {
	reviewerId++;
	return identity(`reviewer-${reviewerId}`, {
		...(vote !== undefined ? { vote: vote } : {}),
		hasDeclined: false,
		isFlagged: false,
		...(isRequired ? { isRequired: true } : {}),
	});
}

function commit(sha: string): Node {
	return {
		commitId: sha,
		url: `https://dev.azure.com/org/${projectId}/_apis/git/repositories/${repoId}/commits/${sha}`,
	};
}

/** A pull request as `GET …/pullrequests/{id}` returns it, with the keys a live read returned. */
function azurePr(id: number, overrides: Node): Node {
	return {
		repository: {
			id: repoId,
			name: 'r',
			url: `https://dev.azure.com/org/${projectId}/_apis/git/repositories/${repoId}`,
			project: { id: projectId, name: 'proj', state: 'wellFormed', visibility: 'private' },
		},
		pullRequestId: id,
		codeReviewId: id,
		status: 'active',
		createdBy: identity('author'),
		creationDate: `2026-01-02T03:04:${String(id % 60).padStart(2, '0')}.1234567Z`,
		title: `PR ${id}`,
		description: 'body',
		sourceRefName: `refs/heads/feature-${id}`,
		targetRefName: 'refs/heads/main',
		mergeStatus: 'succeeded',
		isDraft: false,
		mergeId: `merge-${id}`,
		lastMergeSourceCommit: commit(`head-${id}`),
		lastMergeTargetCommit: commit(`base-${id}`),
		lastMergeCommit: commit(`merge-${id}`),
		reviewers: [],
		url: `https://dev.azure.com/org/${projectId}/_apis/git/repositories/${repoId}/pullRequests/${id}`,
		_links: {
			self: {
				href: `https://dev.azure.com/org/${projectId}/_apis/git/repositories/${repoId}/pullRequests/${id}`,
			},
		},
		supportsIterations: true,
		artifactId: `vstfs:///Git/PullRequestId/${projectId}%2f${repoId}%2f${id}`,
		...overrides,
	};
}

/** A work item as `GET …/_apis/wit/workitems/{id}?$expand=Links` returns it; `fields` overrides its fields. */
function azureWorkItem(id: number, fields?: Node): Node {
	return {
		id: id,
		rev: 3,
		fields: {
			'System.AreaPath': 'proj',
			'System.TeamProject': 'proj',
			'System.IterationPath': 'proj',
			'System.WorkItemType': 'Task',
			'System.State': 'To Do',
			'System.Reason': 'Added to backlog',
			'System.CreatedDate': '2026-01-01T00:00:00.123Z',
			'System.CreatedBy': identity('author'),
			'System.ChangedDate': `2026-10-02T06:30:${String(id % 60).padStart(2, '0')}.39Z`,
			'System.ChangedBy': identity('author'),
			'System.CommentCount': 0,
			'System.Title': `Work item ${id}`,
			'Microsoft.VSTS.Common.Priority': 2,
			...fields,
		},
		_links: { html: { href: `https://dev.azure.com/org/proj/_workitems/edit/${id}` } },
		url: `https://dev.azure.com/org/${projectId}/_apis/wit/workItems/${id}`,
	};
}

/** What the batch read answers for one work item: only the fields it named, and only those the work item has. */
function cheapWorkItem(workItem: Node, fieldNames: readonly string[]): Node {
	const fields = workItem.fields as Node;
	const picked: Node = {};
	for (const name of fieldNames) {
		if (fields[name] != null) {
			picked[name] = fields[name];
		}
	}
	return { id: workItem.id, rev: workItem.rev, fields: picked, url: workItem.url };
}

interface Fixture {
	prs: Map<number, Node>;
	workItems: Map<number, Node>;
	/** Answers the batch read's `value` in reverse order. */
	reversed?: boolean;
}

type RequestKind = 'pr' | 'repository' | 'workItem' | 'workItems';

interface SentRequest {
	kind: RequestKind;
	url: URL;
}

function kindOf(path: string): RequestKind | undefined {
	if (/\/_apis\/git\/repositories\/[^/]+\/pullrequests\/\d+$/.test(path)) return 'pr';
	if (/\/_apis\/git\/repositories\/[^/]+$/.test(path)) return 'repository';
	if (/\/_apis\/wit\/workitems\/\d+$/.test(path)) return 'workItem';
	if (path.endsWith('/_apis/wit/workitems')) return 'workItems';
	return undefined;
}

/**
 * Answers every Azure DevOps request — provider-apis' pull request and repository GETs, the direct work item GET, and
 * the cheap reads — from `fixture`. `override` may answer a request first.
 */
function serveAzure(
	runtime: FakeRuntime,
	fixture: Fixture,
	override?: (request: SentRequest) => Response | undefined,
): SentRequest[] {
	const sent: SentRequest[] = [];
	runtime.http.fetch = input => {
		const url = new URL(input.toString());
		const kind = kindOf(url.pathname);
		if (kind == null) return Promise.reject(new Error(`unexpected request: ${url.toString()}`));

		const request = { kind: kind, url: url };
		sent.push(request);

		const overridden = override?.(request);
		if (overridden != null) return Promise.resolve(overridden);

		const id = Number(/\/(\d+)$/.exec(url.pathname)?.[1]);
		switch (kind) {
			case 'pr': {
				const pr = fixture.prs.get(id);
				return Promise.resolve(
					pr != null
						? json(200, pr)
						: json(404, {
								message: `TF401180: The requested pull request was not found.`,
								typeKey: 'GitPullRequestNotFoundException',
							}),
				);
			}
			case 'repository':
				return Promise.resolve(
					json(200, {
						id: repoId,
						name: 'r',
						remoteUrl: 'https://org@dev.azure.com/org/proj/_git/r',
						sshUrl: 'git@ssh.dev.azure.com:v3/org/proj/r',
					}),
				);
			case 'workItem': {
				const workItem = fixture.workItems.get(id);
				return Promise.resolve(
					workItem != null
						? json(200, workItem)
						: json(404, {
								message: `TF401232: Work item ${id} does not exist, or you do not have permissions to read it.`,
								typeKey: 'WorkItemUnauthorizedAccessException',
							}),
				);
			}
			case 'workItems': {
				const fieldNames = url.searchParams.get('fields')?.split(',') ?? [];
				const value = (url.searchParams.get('ids')?.split(',') ?? [])
					.map(i => fixture.workItems.get(Number(i)))
					.filter(w => w != null)
					.map(w => cheapWorkItem(w, fieldNames));
				if (fixture.reversed) {
					value.reverse();
				}
				return Promise.resolve(json(200, { count: value.length, value: value }));
			}
		}
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

function skipCurrentAccount(integration: GitHostIntegration): void {
	(integration as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
		Promise.resolve(undefined);
}

function getRequestExceptionCount(integration: GitHostIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

function count(sent: readonly SentRequest[], kind: RequestKind): number {
	return sent.filter(r => r.kind === kind).length;
}

/** Every set the agreement is proven for: none, each include alone, and all of them. */
const etagIncludeSets: readonly (readonly PullRequestEtagInclude[])[] = [
	[],
	['mergeable'],
	['reviewDecision'],
	['checks'],
	pullRequestEtagIncludes,
];

const prCases: [string, Node][] = [
	['active', {}],
	['draft', { isDraft: true }],
	['completed', { status: 'completed', closedDate: '2026-03-04T05:06:07.123Z' }],
	['abandoned', { status: 'abandoned', closedDate: '2026-03-05T05:06:07.123Z' }],
	// provider-apis has no `notSet` status, and `fromProviderPullRequestState` reads the `undefined` as merged.
	['notSet', { status: 'notSet' }],
	// `closedDate || creationDate`: an empty close time falls back to the creation time.
	['an empty closedDate', { closedDate: '' }],
	['a head commit with no id', { lastMergeSourceCommit: { url: 'https://dev.azure.com/org/commit' } }],
	...['conflicts', 'failure', 'rejectedByPolicy', 'succeeded', 'notSet', 'queued', undefined].map(
		(status): [string, Node] => [`mergeStatus ${status}`, { mergeStatus: status }],
	),
	...[10, 5, 0, -5, -10, undefined, 7].map((vote): [string, Node] => [
		`a required reviewer voting ${vote}`,
		{ reviewers: [reviewer(vote)] },
	]),
	['an optional reviewer voting -10', { reviewers: [reviewer(-10, false)] }],
	['required reviewers voting 10 and -5', { reviewers: [reviewer(10), reviewer(-5)] }],
	['required reviewers voting 5 and 0', { reviewers: [reviewer(5), reviewer(0)] }],
	['a required reviewer voting 10 and an optional one -10', { reviewers: [reviewer(10), reviewer(-10, false)] }],
];

function prFixture(): Fixture {
	return {
		prs: new Map(prCases.map(([, overrides], i) => [i + 1, azurePr(i + 1, overrides)])),
		workItems: new Map(),
	};
}

const prCoordinates = prCases.map((_, i) => ({ owner: 'org', repo: 'r', number: i + 1, project: 'proj' }));

suite('Azure DevOps etag agreement: the cheap check and the full read compute the same etag', () => {
	for (const includes of etagIncludeSets) {
		test(`pull requests, every status, draft, merge status and reviewer vote (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveAzure(runtime, prFixture());
			const { manager, azure } = await connectedAzure(runtime);

			const full = await azure.getPullRequestsBatchResult(prCoordinates);
			assert.equal(count(sent, 'pr'), prCases.length);
			assert.equal(
				count(sent, 'repository'),
				prCases.length,
				'the full read reads the repository per pull request',
			);
			sent.length = 0;

			const cheap = await azure.getPullRequestsEtagFieldsResult(prCoordinates, { etagIncludes: includes });
			assert.deepEqual(
				sent.map(r => r.kind),
				new Array<RequestKind>(prCases.length).fill('pr'),
				'the cheap check reads each pull request, and nothing else',
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

	test('each value lands where expected on both paths, and a full row never carries a check rollup', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, prFixture());
		const { manager, azure } = await connectedAzure(runtime);

		const cheapRows = fulfilled(
			(await azure.getPullRequestsEtagFieldsResult(prCoordinates, { etagIncludes: pullRequestEtagIncludes }))
				?.value,
		);
		const fullRows = fulfilled((await azure.getPullRequestsBatchResult(prCoordinates))?.value);
		const byName = (name: string): { fields: PullRequestEtagFields | undefined; shape: PullRequestShape } => {
			const index = prCases.findIndex(([caseName]) => caseName === name);
			const shape = fullRows[index];
			assert.ok(shape != null, name);
			return { fields: cheapRows[index], shape: shape };
		};

		const expectations: [string, keyof PullRequestEtagFields, unknown][] = [
			['active', 'state', 'opened'],
			['completed', 'state', 'merged'],
			['abandoned', 'state', 'closed'],
			['notSet', 'state', 'merged'],
			['draft', 'isDraft', true],
			['active', 'headSha', 'head-1'],
			['a head commit with no id', 'headSha', ''],
			['active', 'updatedDate', new Date('2026-01-02T03:04:01.1234567Z')],
			['completed', 'updatedDate', new Date('2026-03-04T05:06:07.123Z')],
			['active', 'mergeableState', PullRequestMergeableState.Mergeable],
			['mergeStatus conflicts', 'mergeableState', PullRequestMergeableState.Conflicting],
			['mergeStatus failure', 'mergeableState', PullRequestMergeableState.FailingChecks],
			['mergeStatus rejectedByPolicy', 'mergeableState', PullRequestMergeableState.BlockedByPolicy],
			['mergeStatus queued', 'mergeableState', PullRequestMergeableState.Unknown],
			['mergeStatus undefined', 'mergeableState', PullRequestMergeableState.Unknown],
			['active', 'reviewDecision', undefined],
			['a required reviewer voting 10', 'reviewDecision', PullRequestReviewDecision.Approved],
			['a required reviewer voting 5', 'reviewDecision', PullRequestReviewDecision.Approved],
			['a required reviewer voting 0', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['a required reviewer voting -5', 'reviewDecision', PullRequestReviewDecision.ChangesRequested],
			['a required reviewer voting -10', 'reviewDecision', PullRequestReviewDecision.ChangesRequested],
			['a required reviewer voting undefined', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['a required reviewer voting 7', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['an optional reviewer voting -10', 'reviewDecision', undefined],
			['required reviewers voting 10 and -5', 'reviewDecision', PullRequestReviewDecision.ChangesRequested],
			[
				'a required reviewer voting 10 and an optional one -10',
				'reviewDecision',
				PullRequestReviewDecision.Approved,
			],
		];
		for (const [name, field, expected] of expectations) {
			const { fields, shape } = byName(name);
			assert.deepEqual(fields?.[field], expected, `${name}: ${field} (cheap)`);
			assert.deepEqual(pullRequestEtagFieldsFromShape(shape)[field], expected, `${name}: ${field} (full)`);
		}

		prCases.forEach(([name], i) => {
			assert.equal(cheapRows[i]?.statusCheckRollupState, undefined, `${name} (cheap)`);
			assert.equal(
				pullRequestEtagFieldsFromShape(fullRows[i]!).statusCheckRollupState,
				undefined,
				`${name} (full)`,
			);
		});

		manager.dispose();
	});

	for (const includes of etagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with one pull request GET each and no repository GET (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveAzure(runtime, prFixture());
			const { manager, azure } = await connectedAzure(runtime);
			skipCurrentAccount(azure);
			const targets = prCases.map(([name], i) => ({ key: name, ...prCoordinates[i] }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: targets,
				etagIncludes: includes,
			});
			const etags = new Map(first.items.map(i => [i.key, i.etag]));
			sent.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => r.kind),
				new Array<RequestKind>(prCases.length).fill('pr'),
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

	for (const includes of [[], ['reviewDecision']] as PullRequestEtagInclude[][]) {
		test(`end to end: a vote is noticed, and only that pull request read in full, whether or not the etag covers the review decision (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const fixture = prFixture();
			const sent = serveAzure(runtime, fixture);
			const { manager, azure } = await connectedAzure(runtime);
			skipCurrentAccount(azure);
			const targets = [1, 2, 3].map(n => ({ key: `k${n}`, ...prCoordinates[n - 1] }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: targets,
				etagIncludes: includes,
			});
			// A vote moves no timestamp, but the revision sees the reviewer and their vote, with or without the
			// review decision. The rest of the pull request (the draft case) stays as it was.
			fixture.prs.set(2, azurePr(2, { isDraft: true, reviewers: [reviewer(-10)] }));
			sent.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => [r.kind, r.url.pathname.split('/').at(-1)]),
				[
					['pr', '1'],
					['pr', '2'],
					['pr', '3'],
					['pr', '2'],
					['repository', repoId],
				],
			);
			assert.deepEqual(
				second.items.map(i => [i.key, i.unchanged, i.pullRequest?.reviewDecision]),
				[
					['k1', true, undefined],
					['k2', undefined, PullRequestReviewDecision.ChangesRequested],
					['k3', true, undefined],
				],
			);

			manager.dispose();
		});
	}
});

/**
 * The fields Azure DevOps changes without moving `closedDate || creationDate`, which the etag's `revision` fingerprints.
 * Each case is a whole pull request that differs from {@link revisionBase} in that one way.
 */
const revisionRequired = reviewer(10);
const revisionOptional = reviewer(0, false);
const revisionBase: Node = { reviewers: [revisionRequired, revisionOptional] };
const revisionChanges: [string, Node][] = [
	['only the title', { title: 'Retitled' }],
	['only the description', { description: 'edited body' }],
	['the description cleared', { description: '' }],
	['the description removed', { description: undefined }],
	['only the target branch', { targetRefName: 'refs/heads/release' }],
	['a reviewer added', { reviewers: [revisionRequired, revisionOptional, reviewer(0, false)] }],
	['a reviewer removed', { reviewers: [revisionRequired] }],
	["only an optional reviewer's vote", { reviewers: [revisionRequired, { ...revisionOptional, vote: -10 }] }],
	["only a required reviewer's vote", { reviewers: [{ ...revisionRequired, vote: -5 }, revisionOptional] }],
];

function revisionFixture(changed: boolean): Fixture {
	return {
		prs: new Map(
			revisionChanges.map(([, change], i) => [
				i + 1,
				azurePr(i + 1, changed ? { ...revisionBase, ...change } : revisionBase),
			]),
		),
		workItems: new Map(),
	};
}

const revisionCoordinates = revisionChanges.map((_, i) => ({
	owner: 'org',
	repo: 'r',
	number: i + 1,
	project: 'proj',
}));

suite('Azure DevOps pull request revision', () => {
	for (const includes of etagIncludeSets) {
		test(`a title, description, target branch or reviewer change moves the etag, and both reads agree on it (etagIncludes: [${includes.join(', ')}])`, async () => {
			const etagsOf = async (changed: boolean): Promise<string[]> => {
				const runtime = createFakeRuntime();
				serveAzure(runtime, revisionFixture(changed));
				const { manager, azure } = await connectedAzure(runtime);

				const fullRows = fulfilled((await azure.getPullRequestsBatchResult(revisionCoordinates))?.value);
				const cheapRows = fulfilled(
					(await azure.getPullRequestsEtagFieldsResult(revisionCoordinates, { etagIncludes: includes }))
						?.value,
				);
				manager.dispose();

				return revisionChanges.map(([name], i) => {
					const shape = fullRows[i];
					const fields = cheapRows[i];
					assert.ok(shape != null && fields != null, name);
					assert.match(fields.revision ?? '', /^[0-9a-f]{16}$/, `${name} (cheap)`);
					assert.equal(
						fields.revision,
						pullRequestEtagFieldsFromShape(shape).revision,
						`${name} (changed: ${changed})`,
					);
					const etag = pullRequestEtag(fields, includes);
					assert.equal(etag, pullRequestEtag(pullRequestEtagFieldsFromShape(shape), includes), name);
					return etag;
				});
			};

			const before = await etagsOf(false);
			const after = await etagsOf(true);
			revisionChanges.forEach(([name], i) => assert.notEqual(after[i], before[i], name));
		});
	}

	test('the revision reads the values the full row ends up with', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, {
			prs: new Map([[1, azurePr(1, { ...revisionBase, targetRefName: 'refs/heads/release/1.0' })]]),
			workItems: new Map(),
		});
		const { manager, azure } = await connectedAzure(runtime);

		const [shape] = fulfilled((await azure.getPullRequestsBatchResult([prCoordinates[0]]))?.value);
		const [fields] = fulfilled((await azure.getPullRequestsEtagFieldsResult([prCoordinates[0]], {}))?.value);

		assert.ok(shape != null && fields != null);
		assert.equal(shape.title, 'PR 1');
		assert.equal(shape.body, 'body');
		assert.equal(shape.refs?.base.branch, 'release/1.0');
		assert.deepEqual(
			shape.reviewRequests?.map(r => r.reviewer.id),
			[revisionOptional.id],
		);
		assert.deepEqual(
			shape.latestReviews?.map(r => [r.reviewer.id, r.state]),
			[[revisionRequired.id, PullRequestReviewState.Approved]],
		);
		assert.equal(fields.revision, pullRequestRevision(shape));

		manager.dispose();
	});

	test('end to end: a title-only edit comes back changed and read in full, and an untouched pull request unchanged', async () => {
		const runtime = createFakeRuntime();
		const fixture = prFixture();
		const sent = serveAzure(runtime, fixture);
		const { manager, azure } = await connectedAzure(runtime);
		skipCurrentAccount(azure);
		const targets = [1, 2].map(n => ({ key: `k${n}`, ...prCoordinates[n - 1] }));

		const first = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets,
		});
		fixture.prs.set(1, azurePr(1, { title: 'Retitled' }));
		sent.length = 0;

		const second = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
		});

		assert.deepEqual(
			sent.map(r => [r.kind, r.url.pathname.split('/').at(-1)]),
			[
				['pr', '1'],
				['pr', '2'],
				['pr', '1'],
				['repository', repoId],
			],
		);
		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged, i.pullRequest?.title]),
			[
				['k1', undefined, 'Retitled'],
				['k2', true, undefined],
			],
		);
		assert.notEqual(second.items[0].etag, first.items[0].etag);
		assert.equal(second.items[1].etag, first.items[1].etag);

		manager.dispose();
	});
});

suite('Azure DevOps etag check: pull request requests and slots', () => {
	test('a pull request Azure says is not found is a proven absence; any other 404 rejects the target', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, { prs: new Map([[1, azurePr(1, {})]]), workItems: new Map() }, request =>
			request.url.pathname.endsWith('/pullrequests/3')
				? new Response('<html><body>Not Found</body></html>', {
						status: 404,
						headers: { 'content-type': 'text/html' },
					})
				: undefined,
		);
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getPullRequestsEtagFieldsResult(
			[1, 2, 3].map(n => ({ owner: 'org', repo: 'r', number: n, project: 'proj' })),
			{},
		);

		assert.deepEqual(
			result?.value?.map(slot => [slot.status, slot.status === 'fulfilled' ? slot.value?.headSha : undefined]),
			[
				['fulfilled', 'head-1'],
				['fulfilled', undefined],
				['rejected', undefined],
			],
		);

		manager.dispose();
	});

	test('the request is the one provider-apis sends for the full read', async () => {
		const runtime = createFakeRuntime();
		const sent = serveAzure(runtime, { prs: new Map([[7, azurePr(7, {})]]), workItems: new Map() });
		const { manager, azure } = await connectedAzure(runtime);

		await azure.getPullRequestsEtagFieldsResult([{ owner: 'org', repo: 'r', number: 7, project: 'proj' }], {});
		await azure.getPullRequestsBatchResult([{ owner: 'org', repo: 'r', number: 7, project: 'proj' }]);

		const [cheap, full] = sent.filter(r => r.kind === 'pr').map(r => r.url.toString());
		assert.equal(cheap, 'https://dev.azure.com/org/proj/_apis/git/repositories/r/pullrequests/7?api-version=6.0');
		assert.equal(cheap, full);

		manager.dispose();
	});

	test('a pull request missing a field provider-apis maps rejects the target rather than matching an etag', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, {
			prs: new Map([
				[1, azurePr(1, {})],
				[2, azurePr(2, { lastMergeTargetCommit: undefined })],
			]),
			workItems: new Map(),
		});
		const { manager, azure } = await connectedAzure(runtime);
		const coordinates = [1, 2].map(n => ({ owner: 'org', repo: 'r', number: n, project: 'proj' }));

		const cheap = await azure.getPullRequestsEtagFieldsResult(coordinates, {});
		const full = await azure.getPullRequestsBatchResult(coordinates);

		assert.deepEqual(
			cheap?.value?.map(slot => slot.status),
			['fulfilled', 'rejected'],
		);
		assert.deepEqual(
			full?.value?.map(slot => slot.status),
			['fulfilled', 'rejected'],
			'the full read fails it too',
		);

		manager.dispose();
	});
});

const workItemCases: [string, Node][] = [
	['To Do', {}],
	['Doing', { 'System.State': 'Doing' }],
	['Done', { 'System.State': 'Done', 'Microsoft.VSTS.Common.ClosedDate': '2026-10-02T06:31:00.12Z' }],
	// `toIssueShape` reads the closed date, never the state's name: both paths must agree this one reads open.
	['Done without a closed date', { 'System.State': 'Done' }],
	['a closed date Azure would never send', { 'Microsoft.VSTS.Common.ClosedDate': '2026-02-30T00:00:00Z' }],
	['a later ChangedDate', { 'System.ChangedDate': '2026-10-03T07:08:09.1234567Z' }],
	// Azure compares project names case-insensitively, and so does the full read.
	['its project spelled in another case', { 'System.TeamProject': 'PROJ' }],
];

function workItemFixture(): Fixture {
	return {
		prs: new Map(),
		workItems: new Map(workItemCases.map(([, fields], i) => [i + 1, azureWorkItem(i + 1, fields)])),
	};
}

const workItemCoordinates = workItemCases.map((_, i) => ({ owner: 'org', repo: '', number: i + 1, project: 'proj' }));

suite('Azure DevOps work item etag agreement', () => {
	test('every state category computes the same etag on the cheap check and the full read', async () => {
		const runtime = createFakeRuntime();
		const sent = serveAzure(runtime, workItemFixture());
		const { manager, azure } = await connectedAzure(runtime);

		const fullRows = fulfilled<IssueShape | undefined>(
			(await azure.getIssuesBatchResult(workItemCoordinates))?.value,
		);
		assert.equal(count(sent, 'workItem'), workItemCases.length);
		sent.length = 0;

		const cheapRows = fulfilled<IssueEtagFields | undefined>(
			(await azure.getIssuesEtagFieldsResult(workItemCoordinates, {}))?.value,
		);
		assert.deepEqual(
			sent.map(r => r.kind),
			['workItems'],
		);

		workItemCases.forEach(([name], i) => {
			const shape = fullRows[i];
			const fields = cheapRows[i];
			assert.ok(shape != null && fields != null, name);
			assert.equal(issueEtag(fields, []), issueEtag(issueEtagFieldsFromShape(shape), []), name);
		});
		assert.deepEqual(
			cheapRows.map(f => f?.state),
			['opened', 'opened', 'closed', 'opened', 'opened', 'opened', 'opened'],
		);

		manager.dispose();
	});

	test('end to end: etags a full read hands back come back unchanged, with only the cheap read sent', async () => {
		const runtime = createFakeRuntime();
		const sent = serveAzure(runtime, workItemFixture());
		const { manager } = await connectedAzure(runtime);
		const targets = workItemCases.map(([name], i) => ({ key: name, ...workItemCoordinates[i] }));

		const first = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets,
		});
		sent.length = 0;
		const second = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
		});

		assert.deepEqual(
			sent.map(r => r.kind),
			['workItems'],
		);
		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged]),
			workItemCases.map(([name]) => [name, true]),
		);

		manager.dispose();
	});
});

suite('Azure DevOps etag check: work item requests and matching', () => {
	function workItems(...ids: number[]): Map<number, Node> {
		return new Map(ids.map(id => [id, azureWorkItem(id)]));
	}

	async function seedEtags(
		manager: Awaited<ReturnType<typeof connectedAzure>>['manager'],
		targets: { key: string; owner: string; repo: string; number: number; project: string }[],
	): Promise<Map<string, string | undefined>> {
		const first = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets,
		});
		return new Map(first.items.map(i => [i.key, i.etag]));
	}

	function target(n: number, project = 'proj', owner = 'org') {
		return { key: `k${n}`, owner: owner, repo: '', number: n, project: project };
	}

	test('the request asks the project for every id at once, for only the change state, omitting what it cannot return', async () => {
		const runtime = createFakeRuntime();
		const sent = serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 3) });
		const { manager, azure } = await connectedAzure(runtime);

		await azure.getIssuesEtagFieldsResult(
			[1, 3].map(n => ({ owner: 'org', repo: '', number: n, project: 'proj' })),
			{},
		);

		assert.equal(sent.length, 1);
		assert.equal(
			sent[0].url.toString(),
			'https://dev.azure.com/org/proj/_apis/wit/workitems?ids=1,3&fields=System.TeamProject,System.ChangedDate,Microsoft.VSTS.Common.ClosedDate&errorPolicy=omit&api-version=6.0',
		);

		manager.dispose();
	});

	test('a work item answered out of order is matched by id', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 2, 3), reversed: true });
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getIssuesEtagFieldsResult(
			[1, 2, 3].map(n => ({ owner: 'org', repo: '', number: n, project: 'proj' })),
			{},
		);

		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.updatedDate.toISOString()),
			['2026-10-02T06:30:01.390Z', '2026-10-02T06:30:02.390Z', '2026-10-02T06:30:03.390Z'],
		);

		manager.dispose();
	});

	test('a dropped id rejects only its own slot, never proving it absent', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, { prs: new Map(), workItems: workItems(1) });
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getIssuesEtagFieldsResult(
			[1, 999].map(n => ({ owner: 'org', repo: '', number: n, project: 'proj' })),
			{},
		);

		assert.deepEqual(
			result?.value?.map(slot => slot.status),
			['fulfilled', 'rejected'],
		);

		manager.dispose();
	});

	test('end to end: a dropped id falls through to the full read, whose not-found proves it absent', async () => {
		const runtime = createFakeRuntime();
		const fixture: Fixture = { prs: new Map(), workItems: workItems(1, 2) };
		const sent = serveAzure(runtime, fixture);
		const { manager } = await connectedAzure(runtime);
		const targets = [target(1), target(2)];
		const etags = await seedEtags(manager, targets);
		fixture.workItems.delete(2);
		sent.length = 0;

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
		});

		assert.deepEqual(
			sent.map(r => [r.kind, r.url.searchParams.get('ids') ?? r.url.pathname.split('/').at(-1)]),
			[
				['workItems', '1,2'],
				['workItem', '2'],
			],
		);
		assert.deepEqual(result.items, [{ key: 'k1', unchanged: true, etag: etags.get('k1') }, { key: 'k2' }]);
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('end to end: a batch whose every id was dropped costs a full read, not a failure', async () => {
		const runtime = createFakeRuntime();
		const fixture: Fixture = { prs: new Map(), workItems: workItems(1, 2) };
		const sent = serveAzure(runtime, fixture, request =>
			request.kind === 'workItems' ? json(200, { count: 0, value: [] }) : undefined,
		);
		const { manager, azure } = await connectedAzure(runtime);

		const cheap = await azure.getIssuesEtagFieldsResult(
			[1, 2].map(n => ({ owner: 'org', repo: '', number: n, project: 'proj' })),
			{},
		);
		assert.deepEqual(cheap?.value, undefined, 'the check declines rather than failing every slot');
		assert.equal(cheap?.error, undefined);

		const targets = [target(1), target(2)];
		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map(t => ({ ...t, etag: 'is1:stale' })),
		});

		assert.deepEqual(
			sent.map(r => r.kind),
			['workItems', 'workItems', 'workItem', 'workItem'],
		);
		assert.deepEqual(
			result.items.map(i => [i.key, i.issue?.id]),
			[
				['k1', '1'],
				['k2', '2'],
			],
		);
		assert.deepEqual(result.warnings, []);

		manager.dispose();
	});

	test('end to end: a work item in another project falls through to the full read, which fails it', async () => {
		const runtime = createFakeRuntime();
		const fixture: Fixture = { prs: new Map(), workItems: workItems(1, 2) };
		const sent = serveAzure(runtime, fixture);
		const { manager } = await connectedAzure(runtime);
		const targets = [target(1), target(2)];
		const etags = await seedEtags(manager, targets);
		fixture.workItems.set(2, azureWorkItem(2, { 'System.TeamProject': 'other' }));
		sent.length = 0;

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
		});

		assert.deepEqual(
			sent.map(r => r.kind),
			['workItems', 'workItem'],
		);
		assert.deepEqual(result.items, [{ key: 'k1', unchanged: true, etag: etags.get('k1') }]);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0]?.message ?? '', /project 'other'/);

		manager.dispose();
	});

	test('250 ids in one project send two requests of at most 200, and every id is answered', async () => {
		const runtime = createFakeRuntime();
		const ids = Array.from({ length: 250 }, (_, i) => i + 1);
		const sent = serveAzure(runtime, { prs: new Map(), workItems: workItems(...ids) });
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getIssuesEtagFieldsResult(
			ids.map(n => ({ owner: 'org', repo: '', number: n, project: 'proj' })),
			{},
		);

		assert.deepEqual(
			sent.map(r => r.url.searchParams.get('ids')?.split(',').length),
			[200, 50],
		);
		assert.equal(fulfilled(result?.value).filter(f => f?.state === 'opened').length, 250);

		manager.dispose();
	});

	test('targets are grouped by organization and project, and two naming one work item ask for it once', async () => {
		const runtime = createFakeRuntime();
		const sent = serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 2, 3) });
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getIssuesEtagFieldsResult(
			[
				{ owner: 'org', repo: '', number: 1, project: 'proj' },
				{ owner: 'org', repo: '', number: 2, project: 'other' },
				{ owner: 'org', repo: '', number: 1, project: 'proj' },
				{ owner: 'org2', repo: '', number: 3, project: 'proj' },
			],
			{},
		);

		assert.deepEqual(
			sent.map(r => [r.url.pathname, r.url.searchParams.get('ids')]),
			[
				['/org/proj/_apis/wit/workitems', '1'],
				['/org/other/_apis/wit/workitems', '2'],
				['/org2/proj/_apis/wit/workitems', '3'],
			],
		);
		assert.deepEqual(
			result?.value?.map(slot => slot.status),
			// Work item 2 is in `proj`, not `other`.
			['fulfilled', 'rejected', 'fulfilled', 'fulfilled'],
		);

		manager.dispose();
	});

	test('a request that fails rejects only its own targets', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 2) }, request =>
			request.url.pathname.startsWith('/org/broken/') ? json(500, { message: 'upstream exploded' }) : undefined,
		);
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getIssuesEtagFieldsResult(
			[
				{ owner: 'org', repo: '', number: 1, project: 'broken' },
				{ owner: 'org', repo: '', number: 2, project: 'proj' },
			],
			{},
		);

		assert.deepEqual(
			result?.value?.map(slot => slot.status),
			['rejected', 'fulfilled'],
		);

		manager.dispose();
	});

	test('a work item without a change date rejects its target', async () => {
		const runtime = createFakeRuntime();
		serveAzure(runtime, { prs: new Map(), workItems: workItems(1) }, request =>
			request.kind === 'workItems'
				? json(200, {
						count: 2,
						value: [
							cheapWorkItem(azureWorkItem(1), ['System.TeamProject', 'System.ChangedDate']),
							{ id: 2, rev: 1, fields: { 'System.TeamProject': 'proj' } },
						],
					})
				: undefined,
		);
		const { manager, azure } = await connectedAzure(runtime);

		const result = await azure.getIssuesEtagFieldsResult(
			[1, 2].map(n => ({ owner: 'org', repo: '', number: n, project: 'proj' })),
			{},
		);

		assert.deepEqual(
			result?.value?.map(slot => slot.status),
			['fulfilled', 'rejected'],
		);

		manager.dispose();
	});

	for (const { status, kind } of [
		{ status: 401, kind: 'auth' },
		{ status: 429, kind: 'rate-limit' },
	]) {
		test(`a ${status} on the work item read drops its targets with a ${kind} warning, without a full read`, async () => {
			const runtime = createFakeRuntime();
			let failing = false;
			const sent = serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 2) }, request =>
				failing && request.kind === 'workItems'
					? new Response(JSON.stringify({ message: 'Refused' }), {
							status: status,
							headers: { 'content-type': 'application/json', 'retry-after': '60' },
						})
					: undefined,
			);
			const { manager } = await connectedAzure(runtime);
			const targets = [target(1), target(2)];
			const etags = await seedEtags(manager, targets);
			failing = true;
			sent.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.ok(result.warnings.length > 0);
			assert.ok(
				result.warnings.every(w => w.kind === kind),
				JSON.stringify(result.warnings),
			);
			assert.equal(count(sent, 'workItems'), 1);
			assert.equal(count(sent, 'workItem'), 0, 'the full read would only hit the same failure');

			manager.dispose();
		});
	}

	for (const order of ['limited first', 'omitted first'] as const) {
		test(`one project's rate limit drops only its own targets, and another's omitted id is still read in full (${order})`, async () => {
			const runtime = createFakeRuntime();
			const fixture: Fixture = {
				prs: new Map(),
				workItems: new Map([
					[1, azureWorkItem(1, { 'System.TeamProject': 'limited' })],
					[2, azureWorkItem(2)],
				]),
			};
			let failing = false;
			const sent = serveAzure(runtime, fixture, request =>
				failing && request.url.pathname.startsWith('/org/limited/')
					? new Response(JSON.stringify({ message: 'Too many requests' }), {
							status: 429,
							headers: { 'content-type': 'application/json', 'retry-after': '60' },
						})
					: undefined,
			);
			const { manager } = await connectedAzure(runtime);
			const limited = target(1, 'limited');
			const omitted = target(2);
			const targets = order === 'limited first' ? [limited, omitted] : [omitted, limited];
			const etags = await seedEtags(manager, targets);
			// Deleted since: the check leaves it out, and only the full read's not-found proves it absent.
			fixture.workItems.delete(2);
			failing = true;
			sent.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(result.items, [{ key: 'k2' }], 'the omitted id is proven absent; the limited one dropped');
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(
				result.warnings.map(w => w.kind),
				['rate-limit'],
			);
			assert.equal(count(sent, 'workItems'), 2, 'one check request per project');
			assert.deepEqual(
				sent.filter(r => r.kind === 'workItem').map(r => r.url.pathname),
				['/org/proj/_apis/wit/workitems/2'],
				'the rate-limited target is never read in full against the same limit',
			);

			manager.dispose();
		});
	}

	test('a total outage of a fully etagged batch spends one strike, for the full read every target falls through to', async () => {
		const runtime = createFakeRuntime();
		let failing = false;
		const sent = serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 2) }, () =>
			// A client error is a strike, where provider-apis leaves a server error unbudgeted.
			failing ? json(400, { message: 'Bad request' }) : undefined,
		);
		const { manager, azure } = await connectedAzure(runtime);
		const targets = [target(1), target(2)];
		const etags = await seedEtags(manager, targets);
		failing = true;
		sent.length = 0;

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.deepEqual([count(sent, 'workItems'), count(sent, 'workItem')], [1, 2]);
		assert.equal(getRequestExceptionCount(azure), 1, 'the cheap check spends none');

		manager.dispose();
	});

	test('every target refused by its own project, for a credential that checks out, is scoped and dropped', async () => {
		const runtime = createFakeRuntime();
		let failing = false;
		const sent = serveAzure(runtime, { prs: new Map(), workItems: workItems(1, 2) }, request =>
			failing && request.kind === 'workItems' ? json(403, { message: 'Access denied' }) : undefined,
		);
		const { manager, azure } = await connectedAzure(runtime);
		const probes = { count: 0 };
		(azure as unknown as { validateCredential: () => Promise<void> }).validateCredential = () => {
			probes.count++;
			return Promise.resolve();
		};
		const targets = [target(1), target(2, 'proj', 'org2')];
		const etags = await seedEtags(manager, targets);
		failing = true;
		sent.length = 0;

		const result = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.ok(
			result.warnings.length > 0 && result.warnings.every(w => w.kind === 'auth' && w.scope != null),
			JSON.stringify(result.warnings),
		);
		assert.equal(probes.count, 1, 'the credential is confirmed once, as before');
		assert.equal(count(sent, 'workItem'), 0, 'a full read would be refused again');
		assert.equal(getRequestExceptionCount(azure), 0);

		manager.dispose();
	});
});

suite('Azure DevOps Server etag check', () => {
	test('inherits the check and asks its own host, below the collection', async () => {
		const runtime = createFakeRuntime();
		const sent = serveAzure(runtime, {
			prs: new Map([[1, azurePr(1, {})]]),
			workItems: new Map([[7, azureWorkItem(7)]]),
		});
		const manager = createIntegrationManager(runtime);
		const server = await manager.get(GitSelfManagedHostIntegrationId.AzureDevOpsServer, 'ado.example.com');
		assert.ok(server != null);
		(server as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'ado.example.com',
		};

		assert.equal(server.supportsPullRequestEtags, true);
		assert.equal(server.supportsIssueEtags, true);
		const prs = await server.getPullRequestsEtagFieldsResult(
			[{ owner: 'DefaultCollection', repo: 'r', number: 1, project: 'proj' }],
			{},
		);
		const issues = await server.getIssuesEtagFieldsResult(
			[{ owner: 'DefaultCollection', repo: '', number: 7, project: 'proj' }],
			{},
		);

		assert.deepEqual(
			fulfilled(prs?.value).map(f => f?.headSha),
			['head-1'],
		);
		assert.match(
			fulfilled(prs?.value)[0]?.revision ?? '',
			/^[0-9a-f]{16}$/,
			'a Server pull request has a revision too',
		);
		assert.deepEqual(
			fulfilled(issues?.value).map(f => f?.state),
			['opened'],
		);
		assert.deepEqual(
			sent.map(r => `${r.url.origin}${r.url.pathname}`),
			[
				'https://ado.example.com/DefaultCollection/proj/_apis/git/repositories/r/pullrequests/1',
				'https://ado.example.com/DefaultCollection/proj/_apis/wit/workitems',
			],
		);

		manager.dispose();
	});
});
