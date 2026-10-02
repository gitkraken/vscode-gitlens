import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { PullRequestReviewDecision } from '@gitlens/git/models/pullRequest.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { BatchSlot, PullRequestEtagFields, PullRequestEtagInclude } from '../models/integration.js';
import { pullRequestEtagIncludes } from '../models/integration.js';
import { pullRequestEtag, pullRequestEtagFieldsFromShape } from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { connectedBitbucket } from './sweepHelpers.js';

/**
 * The Bitbucket Cloud cheap etag check: GitLens' own client lists each repository's pull requests by id, up to 50 per
 * request, where the full read sends one GET per pull request through the same client and `fromBitbucketPullRequest`.
 *
 * The correctness core is agreement: each case feeds ONE raw Bitbucket pull request through the integration's real
 * full read and its real cheap read, answering each request at the HTTP level with only the fields that request
 * selected (Bitbucket's partial responses), and compares the etags.
 */

type Json = Record<string, unknown>;

const allStates = ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'];

function user(name: string): Json {
	return {
		type: 'user',
		uuid: `{${name}}`,
		display_name: name,
		nickname: name,
		account_id: `acct-${name}`,
		links: {
			avatar: { href: `https://avatars.example/${name}` },
			html: { href: `https://bitbucket.org/${name}` },
		},
	};
}

function repository(owner: string, repo: string): Json {
	return {
		type: 'repository',
		uuid: `{${owner}-${repo}}`,
		name: repo,
		slug: repo,
		full_name: `${owner}/${repo}`,
		links: { html: { href: `https://bitbucket.org/${owner}/${repo}` } },
	};
}

function participant(
	name: string,
	options: { approved?: boolean; state?: 'approved' | 'changes_requested' | null; participatedOn?: string | null },
	role: 'PARTICIPANT' | 'REVIEWER' = 'REVIEWER',
): Json {
	return {
		type: 'participant',
		user: user(name),
		role: role,
		approved: options.approved ?? false,
		state: options.state ?? null,
		participated_on: options.participatedOn ?? null,
	};
}

/** A pull request as Bitbucket Cloud's single GET answers it, every top-level key included. */
function pr(id: number, overrides: Json = {}, owner = 'o', repo = 'r'): Json {
	return {
		type: 'pullrequest',
		id: id,
		title: `PR ${id}`,
		description: 'Body',
		rendered: {},
		state: 'OPEN',
		draft: false,
		comment_count: 1,
		task_count: 0,
		merge_commit: null,
		close_source_branch: false,
		closed_by: null,
		reason: '',
		author: user('me'),
		created_on: '2026-01-01T00:00:00.000000+00:00',
		updated_on: `2026-01-02T03:04:${String(id % 60).padStart(2, '0')}.123456+00:00`,
		destination: {
			repository: repository(owner, repo),
			branch: { name: 'main' },
			commit: { hash: 'b4se0000b4se' },
		},
		// Bitbucket answers the SHORT (12-character) hash, on the single GET and the list alike.
		source: {
			repository: repository(owner, repo),
			branch: { name: `feature-${id}` },
			commit: { hash: `${String(id).padStart(4, '0')}abcdef01` },
		},
		reviewers: [],
		participants: [],
		links: { html: { href: `https://bitbucket.org/${owner}/${repo}/pull-requests/${id}` } },
		summary: { type: 'rendered', raw: 'Body', markup: 'markdown', html: '<p>Body</p>' },
		queued: false,
		...overrides,
	};
}

/** Repositories by `owner/repo`, each a map of id to pull request, or `null` for a repository Bitbucket 404s. */
type Repositories = Map<string, Map<number, Json> | null>;

interface SentRequest {
	kind: 'list' | 'pr';
	repository: string;
	url: URL;
}

/** Bitbucket's partial response: `paths` (each `a.b.c`) picked off `value`, applied to each element of an array. */
function pick(value: unknown, paths: readonly string[][]): unknown {
	if (paths.some(path => path.length === 0)) return value;
	if (Array.isArray(value)) return value.map(v => pick(v, paths));
	if (value == null || typeof value !== 'object') return value;

	const byKey = new Map<string, string[][]>();
	for (const [key, ...rest] of paths) {
		byKey.set(key, [...(byKey.get(key) ?? []), rest]);
	}
	const picked: Json = {};
	for (const [key, rest] of byKey) {
		if (key in value) {
			picked[key] = pick((value as Json)[key], rest);
		}
	}
	return picked;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

const notFound = (): Response => json(404, { type: 'error', error: { message: 'Not Found' } });

/**
 * Answers the full read's single GETs and the cheap read's list from `repositories`. The list answers as Bitbucket
 * does: only the `state`s asked for (OPEN when none is), only the ids in `q`, only the `fields` selected, and a `next`
 * when more match than `pagelen`. `override` may answer a request first.
 */
function serveBitbucket(
	runtime: FakeRuntime,
	repositories: Repositories,
	override?: (request: SentRequest) => Response | undefined,
): SentRequest[] {
	const sent: SentRequest[] = [];
	runtime.http.fetch = input => {
		const url = new URL(input.toString());
		const path = decodeURIComponent(url.pathname).replace(/^\/2\.0/, '');
		const match = /^\/repositories\/([^/]+)\/([^/]+)\/pullrequests(?:\/(\d+))?$/.exec(path);
		if (match == null) return Promise.reject(new Error(`unexpected request: ${url.toString()}`));

		const [, owner, repo, id] = match;
		const request: SentRequest = { kind: id != null ? 'pr' : 'list', repository: `${owner}/${repo}`, url: url };
		sent.push(request);

		const overridden = override?.(request);
		if (overridden != null) return Promise.resolve(overridden);

		const prs = repositories.get(request.repository);
		if (prs == null) return Promise.resolve(notFound());

		if (id != null) {
			const found = prs.get(Number(id));
			return Promise.resolve(found != null ? json(200, found) : notFound());
		}

		const ids = (/^id IN \(([\d,]+)\)$/.exec(url.searchParams.get('q') ?? '')?.[1] ?? '').split(',').map(Number);
		const states = url.searchParams.getAll('state');
		const matched = [...prs.values()].filter(
			p => ids.includes(p.id as number) && (states.length ? states : ['OPEN']).includes(p.state as string),
		);
		const pagelen = Number(url.searchParams.get('pagelen') ?? 10);
		const body: Json = { values: matched.slice(0, pagelen), pagelen: pagelen, page: 1, size: matched.length };
		if (matched.length > pagelen) {
			body.next = `${url.toString()}&page=2`;
		}
		const fields = (url.searchParams.get('fields') ?? '').split(',').map(f => f.split('.'));
		return Promise.resolve(json(200, pick(body, fields)));
	};
	return sent;
}

function fulfilled<T>(slots: BatchSlot<T>[] | undefined): T[] {
	assert.ok(slots != null);
	return slots.map(slot => {
		assert.equal(slot.status, 'fulfilled', slot.status === 'rejected' ? String(slot.reason) : undefined);
		return slot.value;
	});
}

function skipCurrentAccount(bb: GitHostIntegration): void {
	(bb as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
		Promise.resolve(undefined);
}

function getRequestExceptionCount(integration: GitHostIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

function count(sent: readonly SentRequest[], kind: SentRequest['kind']): number {
	return sent.filter(r => r.kind === kind).length;
}

const approvedOn = '2026-01-03T00:00:00.000000+00:00';

const prCases: [string, Json][] = [
	['open', {}],
	['merged', { state: 'MERGED', closed_by: user('me'), merge_commit: { hash: 'merge0000000' } }],
	['declined', { state: 'DECLINED', closed_by: user('me') }],
	['superseded', { state: 'SUPERSEDED', closed_by: user('me') }],
	['draft', { draft: true }],
	['not a draft', { draft: false }],
	['a later updated_on', { updated_on: '2026-05-06T07:08:09.987654+00:00' }],
	['a reviewer nobody heard from', { reviewers: [user('rev')] }],
	['a pending reviewer', { reviewers: [user('rev')], participants: [participant('rev', {})] }],
	[
		'an approval',
		{
			reviewers: [user('rev')],
			participants: [participant('rev', { approved: true, state: 'approved', participatedOn: approvedOn })],
		},
	],
	[
		'changes requested',
		{
			reviewers: [user('rev')],
			participants: [participant('rev', { state: 'changes_requested', participatedOn: approvedOn })],
		},
	],
	['a comment only', { participants: [participant('commenter', { participatedOn: approvedOn }, 'PARTICIPANT')] }],
	[
		'an approval and changes requested',
		{
			reviewers: [user('a'), user('b')],
			participants: [
				participant('a', { approved: true, state: 'approved', participatedOn: approvedOn }),
				participant('b', { state: 'changes_requested', participatedOn: approvedOn }),
			],
		},
	],
	[
		'a declined pull request whose closer was a reviewer',
		{
			state: 'DECLINED',
			closed_by: user('rev'),
			reviewers: [user('rev')],
			participants: [participant('rev', {})],
		},
	],
];

function prRepositories(): Repositories {
	return new Map([['o/r', new Map(prCases.map(([, overrides], i) => [i + 1, pr(i + 1, overrides)]))]]);
}

const prCoordinates = prCases.map((_, i) => ({ owner: 'o', repo: 'r', number: i + 1 }));

/** Every set the agreement is proven for: none, each include alone, and all of them. */
const etagIncludeSets: readonly (readonly PullRequestEtagInclude[])[] = [
	[],
	['mergeable'],
	['reviewDecision'],
	['checks'],
	pullRequestEtagIncludes,
];

function prs(...ids: number[]): Map<number, Json> {
	return new Map(ids.map(id => [id, pr(id)]));
}

suite('Bitbucket Cloud etag agreement: the cheap check and the full read compute the same etag', () => {
	for (const includes of etagIncludeSets) {
		test(`pull requests, every state, draft, update time and review decision (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveBitbucket(runtime, prRepositories());
			const { manager, integration: bb } = await connectedBitbucket(runtime);

			const full = await bb.getPullRequestsBatchResult(prCoordinates);
			const cheap = await bb.getPullRequestsEtagFieldsResult(prCoordinates, { etagIncludes: includes });

			assert.deepEqual([count(sent, 'pr'), count(sent, 'list')], [prCases.length, 1]);
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

	test('each value lands where expected on both paths, and a full row reads no mergeability or rollup', async () => {
		const runtime = createFakeRuntime();
		serveBitbucket(runtime, prRepositories());
		const { manager, integration: bb } = await connectedBitbucket(runtime);

		const cheapRows = fulfilled(
			(await bb.getPullRequestsEtagFieldsResult(prCoordinates, { etagIncludes: pullRequestEtagIncludes }))?.value,
		);
		const fullRows = fulfilled((await bb.getPullRequestsBatchResult(prCoordinates))?.value);
		const byName = (name: string): { fields: PullRequestEtagFields | undefined; shape: PullRequestShape } => {
			const index = prCases.findIndex(([caseName]) => caseName === name);
			const shape = fullRows[index];
			assert.ok(shape != null, name);
			return { fields: cheapRows[index], shape: shape };
		};

		const expectations: [string, keyof PullRequestEtagFields, unknown][] = [
			['open', 'state', 'opened'],
			['merged', 'state', 'merged'],
			['declined', 'state', 'closed'],
			['superseded', 'state', 'closed'],
			['open', 'headSha', '0001abcdef01'],
			['draft', 'isDraft', true],
			['not a draft', 'isDraft', false],
			['open', 'isDraft', false],
			['open', 'mergeableState', undefined],
			['open', 'statusCheckRollupState', undefined],
			['open', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['a reviewer nobody heard from', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['a pending reviewer', 'reviewDecision', PullRequestReviewDecision.ReviewRequired],
			['an approval', 'reviewDecision', PullRequestReviewDecision.Approved],
			['changes requested', 'reviewDecision', PullRequestReviewDecision.ChangesRequested],
			['a comment only', 'reviewDecision', undefined],
			['an approval and changes requested', 'reviewDecision', PullRequestReviewDecision.ChangesRequested],
		];
		for (const [name, field, expected] of expectations) {
			const { fields, shape } = byName(name);
			assert.equal(fields?.[field], expected, `${name}: ${field} (cheap)`);
			assert.equal(pullRequestEtagFieldsFromShape(shape)[field], expected, `${name}: ${field} (full)`);
		}
		const { fields, shape } = byName('a later updated_on');
		assert.equal(fields?.updatedDate.getTime(), Date.parse('2026-05-06T07:08:09.987Z'));
		assert.equal(pullRequestEtagFieldsFromShape(shape).updatedDate.getTime(), fields?.updatedDate.getTime());

		manager.dispose();
	});

	for (const includes of etagIncludeSets) {
		test(`end to end: etags a full read hands back come back unchanged, with only the cheap request sent (etagIncludes: [${includes.join(', ')}])`, async () => {
			const runtime = createFakeRuntime();
			const sent = serveBitbucket(runtime, prRepositories());
			const { manager, integration: bb } = await connectedBitbucket(runtime);
			skipCurrentAccount(bb);
			const targets = prCases.map(([name], i) => ({ key: name, owner: 'o', repo: 'r', number: i + 1 }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: targets,
				etagIncludes: includes,
			});
			const etags = new Map(first.items.map(i => [i.key, i.etag]));
			sent.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => r.kind),
				['list'],
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

	for (const covered of [true, false]) {
		test(`end to end: an approval that leaves updated_on alone is ${covered ? 'noticed, and only that pull request read in full,' : 'unseen'} when the etag ${covered ? 'covers' : "doesn't cover"} the review decision`, async () => {
			const runtime = createFakeRuntime();
			const repositories: Repositories = new Map([
				['o/r', new Map([1, 2].map(id => [id, pr(id, { reviewers: [user('rev')] })]))],
			]);
			const sent = serveBitbucket(runtime, repositories);
			const { manager, integration: bb } = await connectedBitbucket(runtime);
			skipCurrentAccount(bb);
			const includes: PullRequestEtagInclude[] = covered ? ['reviewDecision'] : [];
			const targets = [1, 2].map(n => ({ key: `k${n}`, owner: 'o', repo: 'r', number: n }));

			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: targets,
				etagIncludes: includes,
			});
			repositories.get('o/r')!.set(
				2,
				pr(2, {
					reviewers: [user('rev')],
					participants: [
						participant('rev', { approved: true, state: 'approved', participatedOn: approvedOn }),
					],
				}),
			);
			sent.length = 0;

			const second = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
				etagIncludes: includes,
			});

			assert.deepEqual(
				sent.map(r => (r.kind === 'pr' ? r.url.pathname : r.kind)),
				covered ? ['list', '/2.0/repositories/o/r/pullrequests/2'] : ['list'],
			);
			assert.deepEqual(
				second.items.map(i => [i.key, i.unchanged, i.pullRequest?.reviewDecision]),
				covered
					? [
							['k1', true, undefined],
							['k2', undefined, PullRequestReviewDecision.Approved],
						]
					: [
							['k1', true, undefined],
							['k2', true, undefined],
						],
			);

			manager.dispose();
		});
	}

	test('end to end: a draft toggle that leaves updated_on alone comes back changed, and only that pull request is read in full', async () => {
		const runtime = createFakeRuntime();
		const repositories: Repositories = new Map([['o/r', new Map([1, 2].map(id => [id, pr(id)]))]]);
		const sent = serveBitbucket(runtime, repositories);
		const { manager, integration: bb } = await connectedBitbucket(runtime);
		skipCurrentAccount(bb);
		const targets = [1, 2].map(n => ({ key: `k${n}`, owner: 'o', repo: 'r', number: n }));

		const first = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			targets: targets,
			etagIncludes: [],
		});
		repositories.get('o/r')!.set(2, pr(2, { draft: true }));
		sent.length = 0;

		const second = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
			etagIncludes: [],
		});

		assert.deepEqual(
			sent.map(r => (r.kind === 'pr' ? r.url.pathname : r.kind)),
			['list', '/2.0/repositories/o/r/pullrequests/2'],
		);
		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged, i.pullRequest?.isDraft]),
			[
				['k1', true, undefined],
				['k2', undefined, true],
			],
		);

		manager.dispose();
	});
});

suite('Bitbucket Cloud etag check: requests and slots', () => {
	test('has a cheap check', async () => {
		const { manager, integration: bb } = await connectedBitbucket(createFakeRuntime());

		assert.equal(bb.supportsPullRequestEtags, true);
		assert.equal(bb.supportsIssueEtags, false);

		manager.dispose();
	});

	test('targets are grouped by repository, one request each, and answered in target order', async () => {
		const runtime = createFakeRuntime();
		const sent = serveBitbucket(
			runtime,
			new Map([
				['o/a', new Map([1, 3].map(id => [id, pr(id, {}, 'o', 'a')]))],
				['w/b', new Map([[2, pr(2, {}, 'w', 'b')]])],
			]),
		);
		const { manager, integration: bb } = await connectedBitbucket(runtime);

		const result = await bb.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'o', repo: 'a', number: 1 },
				{ owner: 'w', repo: 'b', number: 2 },
				{ owner: 'o', repo: 'a', number: 3 },
			],
			{},
		);

		assert.deepEqual(
			sent.map(r => [r.repository, r.url.searchParams.get('q')]),
			[
				['o/a', 'id IN (1,3)'],
				['w/b', 'id IN (2)'],
			],
		);
		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['0001abcdef01', '0002abcdef01', '0003abcdef01'],
		);

		manager.dispose();
	});

	test('60 ids in one repository send two requests, of 50 and 10, each paged to its own size', async () => {
		const runtime = createFakeRuntime();
		const ids = Array.from({ length: 60 }, (_, i) => i + 1);
		const sent = serveBitbucket(runtime, new Map([['o/r', prs(...ids)]]));
		const { manager, integration: bb } = await connectedBitbucket(runtime);

		const result = await bb.getPullRequestsEtagFieldsResult(
			ids.map(n => ({ owner: 'o', repo: 'r', number: n })),
			{},
		);

		assert.deepEqual(
			sent.map(r => [
				/^id IN \(([\d,]+)\)$/.exec(r.url.searchParams.get('q') ?? '')?.[1].split(',').length,
				r.url.searchParams.get('pagelen'),
			]),
			[
				[50, '50'],
				[10, '10'],
			],
		);
		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			ids.map(n => `${String(n).padStart(4, '0')}abcdef01`),
		);

		manager.dispose();
	});

	test('an id missing from a complete page is a proven absence, as is every id of a repository that 404s', async () => {
		const runtime = createFakeRuntime();
		serveBitbucket(
			runtime,
			new Map([
				['o/r', prs(1)],
				['o/gone', null],
			]),
		);
		const { manager, integration: bb } = await connectedBitbucket(runtime);

		const result = await bb.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'o', repo: 'r', number: 1 },
				{ owner: 'o', repo: 'gone', number: 1 },
				{ owner: 'o', repo: 'r', number: 2 },
				{ owner: 'o', repo: 'gone', number: 2 },
			],
			{},
		);

		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['0001abcdef01', undefined, undefined, undefined],
		);

		manager.dispose();
	});

	test('end to end: a pull request deleted since its etag is answered absent, without a full read', async () => {
		const runtime = createFakeRuntime();
		const repositories: Repositories = new Map([['o/r', prs(1, 2)]]);
		const sent = serveBitbucket(runtime, repositories);
		const { manager, integration: bb } = await connectedBitbucket(runtime);
		skipCurrentAccount(bb);
		const targets = [1, 2].map(n => ({ key: `k${n}`, owner: 'o', repo: 'r', number: n }));
		const first = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			targets: targets,
		});
		repositories.get('o/r')!.delete(2);
		sent.length = 0;

		const second = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
		});

		assert.deepEqual(
			sent.map(r => r.kind),
			['list'],
		);
		assert.deepEqual(
			second.items.map(i => [i.key, i.unchanged]),
			[
				['k1', true],
				['k2', undefined],
			],
		);
		assert.equal(second.items[1].pullRequest, undefined);

		manager.dispose();
	});

	test('two targets naming the same pull request are both answered', async () => {
		const runtime = createFakeRuntime();
		serveBitbucket(runtime, new Map([['o/r', prs(1)]]));
		const { manager, integration: bb } = await connectedBitbucket(runtime);

		const result = await bb.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'o', repo: 'r', number: 1 },
				{ owner: 'o', repo: 'r', number: 1 },
			],
			{},
		);

		assert.deepEqual(
			fulfilled(result?.value).map(f => f?.headSha),
			['0001abcdef01', '0001abcdef01'],
		);

		manager.dispose();
	});

	for (const [name, reply] of [
		['a page with a `next` link', () => json(200, { values: [], next: 'https://api.bitbucket.org/2.0/next' })],
		['a reply without `values`', () => json(200, { pagelen: 10 })],
		['a 410', () => json(410, { type: 'error', error: { message: 'Gone' } })],
		['a 500', () => json(500, { type: 'error', error: { message: 'Something went wrong' } })],
	] as const) {
		test(`${name} rejects its own targets instead of proving them absent`, async () => {
			const runtime = createFakeRuntime();
			// A healthy repository alongside, since a call whose every slot rejected fails as a whole.
			serveBitbucket(runtime, new Map([['o/ok', prs(1)]]), request =>
				request.repository === 'o/r' ? reply() : undefined,
			);
			const { manager, integration: bb } = await connectedBitbucket(runtime);

			const result = await bb.getPullRequestsEtagFieldsResult(
				[
					{ owner: 'o', repo: 'r', number: 1 },
					{ owner: 'o', repo: 'ok', number: 1 },
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

	test('end to end: a page with a `next` link guesses at neither id, and both fall through to the full read', async () => {
		const runtime = createFakeRuntime();
		const sent = serveBitbucket(runtime, new Map([['o/r', prs(1, 2)]]), request =>
			request.kind === 'list'
				? json(200, {
						// One row of the two, with more to come: the missing one is not proven absent.
						values: [
							{
								id: 1,
								state: 'OPEN',
								updated_on: '2026-01-02T03:04:01Z',
								source: { commit: { hash: 'x' } },
							},
						],
						next: `${request.url.toString()}&page=2`,
					})
				: undefined,
		);
		const { manager, integration: bb } = await connectedBitbucket(runtime);
		skipCurrentAccount(bb);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			targets: [1, 2].map(n => ({ key: `k${n}`, owner: 'o', repo: 'r', number: n, etag: 'pr1:stale' })),
		});

		assert.deepEqual(
			sent.map(r => r.kind),
			['list', 'pr', 'pr'],
		);
		assert.deepEqual(
			result.items.map(i => [i.key, i.pullRequest?.id]),
			[
				['k1', '1'],
				['k2', '2'],
			],
		);

		manager.dispose();
	});

	test('a row missing its participants when the review decision is included rejects only its own target', async () => {
		const runtime = createFakeRuntime();
		serveBitbucket(runtime, new Map([['o/r', prs(1, 2)]]), request => {
			if (request.kind !== 'list') return undefined;

			const row = (id: number): Json => ({
				id: id,
				state: 'OPEN',
				updated_on: '2026-01-02T03:04:01Z',
				source: { commit: { hash: 'x' } },
				reviewers: [],
			});
			return json(200, { values: [{ ...row(1), participants: [] }, row(2)] });
		});
		const { manager, integration: bb } = await connectedBitbucket(runtime);

		const result = await bb.getPullRequestsEtagFieldsResult(
			[1, 2].map(n => ({ owner: 'o', repo: 'r', number: n })),
			{ etagIncludes: ['reviewDecision'] },
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
		test(`a ${status} on the cheap check drops its targets with a '${kind}' warning, without a full read`, async () => {
			const runtime = createFakeRuntime();
			let failing = false;
			const sent = serveBitbucket(runtime, new Map([['o/r', prs(1, 2)]]), request =>
				failing && request.kind === 'list'
					? new Response(JSON.stringify({ type: 'error', error: { message: 'Refused' } }), {
							status: status,
							headers: { 'content-type': 'application/json', 'retry-after': '60' },
						})
					: undefined,
			);
			const { manager, integration: bb } = await connectedBitbucket(runtime);
			skipCurrentAccount(bb);
			const targets = [1, 2].map(n => ({ key: `k${n}`, owner: 'o', repo: 'r', number: n }));
			const first = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: targets,
			});
			failing = true;
			sent.length = 0;

			const result = await manager.getPullRequestsBatch({
				providerId: GitCloudHostIntegrationId.Bitbucket,
				targets: targets.map((t, i) => ({ ...t, etag: first.items[i].etag })),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.ok(result.warnings.length > 0);
			assert.ok(
				result.warnings.every(w => w.kind === kind),
				JSON.stringify(result.warnings),
			);
			assert.deepEqual(
				sent.map(r => r.kind),
				['list'],
				'the full read would only hit the same failure',
			);

			manager.dispose();
		});
	}

	test('a server error on the cheap check falls through to the full read, which answers, with no warning and no strike', async () => {
		const runtime = createFakeRuntime();
		const sent = serveBitbucket(runtime, new Map([['o/r', prs(1)]]), request =>
			request.kind === 'list'
				? json(500, { type: 'error', error: { message: 'Something went wrong' } })
				: undefined,
		);
		const { manager, integration: bb } = await connectedBitbucket(runtime);
		skipCurrentAccount(bb);

		const result = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.Bitbucket,
			targets: [{ key: 'a', owner: 'o', repo: 'r', number: 1, etag: 'pr1:stale' }],
		});

		assert.deepEqual(
			sent.map(r => r.kind),
			['list', 'pr'],
		);
		assert.equal(result.items[0]?.pullRequest?.id, '1');
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);
		assert.equal(getRequestExceptionCount(bb), 0);

		manager.dispose();
	});
});

suite('Bitbucket Cloud etag check: query text', () => {
	async function sentRequest(etagIncludes: readonly PullRequestEtagInclude[]): Promise<URL> {
		const runtime = createFakeRuntime();
		const sent = serveBitbucket(runtime, new Map([['o/r', new Map()]]));
		const { manager, integration: bb } = await connectedBitbucket(runtime);
		await bb.getPullRequestsEtagFieldsResult(
			[
				{ owner: 'o', repo: 'r', number: 7 },
				{ owner: 'o', repo: 'r', number: 8 },
			],
			{ etagIncludes: etagIncludes },
		);
		manager.dispose();

		assert.equal(sent.length, 1);
		return sent[0].url;
	}

	test('lists the repository by id, in every state, paged to the ids asked for', async () => {
		const url = await sentRequest([]);

		assert.equal(url.origin, 'https://api.bitbucket.org');
		assert.equal(url.pathname, '/2.0/repositories/o/r/pullrequests');
		assert.equal(url.searchParams.get('q'), 'id IN (7,8)');
		assert.deepEqual(url.searchParams.getAll('state').toSorted(), allStates.toSorted());
		assert.equal(url.searchParams.get('pagelen'), '2');
	});

	for (const includes of etagIncludeSets) {
		test(`selects only the change state, plus the participants for the review decision (etagIncludes: [${includes.join(', ')}])`, async () => {
			const url = await sentRequest(includes);

			const expected = [
				'values.id',
				'values.state',
				'values.draft',
				'values.updated_on',
				'values.source.commit.hash',
				'next',
			];
			if (includes.includes('reviewDecision')) {
				expected.push(
					'values.participants.approved',
					'values.participants.state',
					'values.participants.participated_on',
					'values.reviewers.uuid',
				);
			}
			assert.deepEqual(url.searchParams.get('fields')?.split(','), expected);
		});
	}
});
