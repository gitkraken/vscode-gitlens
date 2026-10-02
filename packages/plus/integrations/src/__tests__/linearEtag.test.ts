import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { BatchSlot, IssueEtagFields } from '../models/integration.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { issueEtag, issueEtagFieldsFromShape } from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * The Linear cheap etag check: one `issues` query per team and 50 numbers, where the full read sends provider-apis'
 * `issue(id:)` once per target.
 *
 * The correctness core is agreement: the full row's etag is computed after provider-apis' Linear normalizer and
 * `fromProviderIssue`, so each case feeds ONE raw Linear issue through the integration's real full read and its real
 * cheap read, answering each GraphQL request at the HTTP level, and compares the etags. The rest pins the matching
 * rules that keep the check from ever answering a false `unchanged` or a false absence: the query filters by the
 * team's current key, while the full read also resolves an identifier an issue no longer carries.
 */

type RawIssue = {
	id: string;
	identifier: string;
	number: number;
	title: string;
	url: string;
	createdAt: string;
	updatedAt: string | null;
	archivedAt: string | null;
	description: string | null;
	creator: null;
	assignee: null;
	project: null;
	projectMilestone: null;
	team: { id: string; name: string; key: string; icon: null };
	state: { id: string; name: string; color: string; type: string } | null;
};

function linearIssue(
	identifier: string,
	options?: { type?: string | null; updatedAt?: string | null; archivedAt?: string | null },
): RawIssue {
	const [key, number] = identifier.split('-');
	const type = options?.type === undefined ? 'unstarted' : options.type;
	return {
		id: `lin-${identifier}`,
		identifier: identifier,
		number: Number(number),
		title: `issue ${identifier}`,
		url: `https://linear.app/acme/issue/${identifier}/issue`,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: options?.updatedAt === undefined ? '2026-01-02T00:00:00.000Z' : options.updatedAt,
		archivedAt: options?.archivedAt ?? null,
		description: 'Details',
		creator: null,
		assignee: null,
		project: null,
		projectMilestone: null,
		team: { id: `team-${key}`, name: key, key: key, icon: null },
		state: type != null ? { id: `state-${type}`, name: type, color: '#000000', type: type } : null,
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

interface RecordedRequest {
	query: string;
	variables: Record<string, unknown>;
	authorization: string | undefined;
	/** The identifier a full read asked for. */
	identifier?: string;
	/** The team key a cheap check asked for. */
	teamKey?: string;
	/** The numbers a cheap check asked for. */
	numbers?: number[];
}

/** Whether `query` selects `field` on a line of its own, as both the SDK and the cheap check format a selection. */
function selects(query: string, field: string): boolean {
	return new RegExp(`(^|\\n)\\s*${field}\\s*(\\{|\\n)`).test(query);
}

/**
 * A Linear workspace that answers both reads from the same issues. A full read resolves an identifier
 * case-insensitively and through `aliases` (an identifier the issue no longer carries → its current one), as Linear's
 * `issue(id:)` does, and answers `null` for one it can't find. A cheap check answers the issues of the team key it was
 * given whose numbers it was asked for, with only the fields it selected, in REVERSE order. `respond` overrides any
 * request.
 */
function fakeLinear(
	runtime: FakeRuntime,
	issues: RawIssue[],
	options?: {
		aliases?: Record<string, string>;
		respond?: (request: RecordedRequest) => Response | undefined;
	},
): RecordedRequest[] {
	const requests: RecordedRequest[] = [];
	runtime.http.fetch = (input, init) => {
		const url = new URL(input.toString());
		if (url.toString() !== 'https://api.linear.app/graphql' || init?.method !== 'POST') {
			return Promise.resolve(jsonResponse(404, { message: `unexpected ${init?.method} ${url.toString()}` }));
		}

		const { query, variables = {} } = JSON.parse(init.body as string) as {
			query: string;
			variables?: Record<string, unknown>;
		};
		const headers = new Headers(init.headers);
		const request: RecordedRequest = {
			query: query,
			variables: variables,
			authorization: headers.get('Authorization') ?? undefined,
		};
		if (query.includes('query GetIssue(')) {
			request.identifier = variables.identifier as string;
		} else if (query.includes('query GetIssuesEtagFields(')) {
			request.teamKey = variables.teamKey as string;
			request.numbers = variables.numbers as number[];
		} else {
			throw new Error(`unexpected Linear query: ${query}`);
		}
		requests.push(request);

		const overridden = options?.respond?.(request);
		if (overridden != null) return Promise.resolve(overridden);

		if (request.identifier != null) {
			const asked = request.identifier.toUpperCase();
			const current = options?.aliases?.[asked] ?? asked;
			const issue = issues.find(i => i.identifier === current) ?? null;
			return Promise.resolve(jsonResponse(200, { data: { issue: issue } }));
		}

		const nodes = issues
			.filter(i => i.team.key === request.teamKey && request.numbers!.includes(i.number))
			.reverse()
			.map(i => {
				const node: Record<string, unknown> = {};
				for (const field of ['identifier', 'number', 'updatedAt', 'archivedAt'] as const) {
					if (selects(query, field)) {
						node[field] = i[field];
					}
				}
				if (selects(query, 'state')) {
					node.state = i.state != null ? { type: i.state.type } : null;
				}
				return node;
			});
		return Promise.resolve(
			jsonResponse(200, { data: { issues: { pageInfo: { hasNextPage: false }, nodes: nodes } } }),
		);
	};
	return requests;
}

function session(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'primary', label: 'primary' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'linear.app',
	};
}

async function connectedLinear(runtime: FakeRuntime) {
	const manager = createIntegrationManager(runtime);
	const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
	(linear as unknown as { _session: ProviderAuthenticationSession })._session = session();
	return { manager: manager, linear: linear };
}

function target(identifier: string, options?: { key?: string; workspace?: string; etag?: string }) {
	return {
		key: options?.key ?? identifier,
		resourceId: options?.workspace ?? 'workspace-1',
		identifier: identifier,
		...(options?.etag != null ? { etag: options.etag } : {}),
	};
}

function getRequestExceptionCount(integration: IssuesIntegration): number {
	return (integration as unknown as { requestExceptionCount: number }).requestExceptionCount;
}

function fulfilled<T>(slots: BatchSlot<T>[] | undefined): T[] {
	assert.ok(slots != null, 'the read answered');
	return slots.map(slot => {
		if (slot.status === 'rejected') throw new assert.AssertionError({ message: String(slot.reason) });

		return slot.value;
	});
}

const cheapChecks = (requests: RecordedRequest[]) => requests.filter(r => r.numbers != null);
const fullReads = (requests: RecordedRequest[]) => requests.filter(r => r.identifier != null);
const kinds = (requests: RecordedRequest[]) => requests.map(r => (r.numbers != null ? 'cheap' : 'full'));

/** The etags a full read hands back, by caller key, to send on a second call. */
async function seedEtags(
	manager: ReturnType<typeof createIntegrationManager>,
	targets: ReturnType<typeof target>[],
): Promise<Map<string, string>> {
	const result = await manager.getIssuesBatch({ providerId: IssuesCloudHostIntegrationId.Linear, targets: targets });
	assert.equal(result.fetchFailed, undefined);
	return new Map(result.items.filter(i => i.etag != null).map(i => [i.key, i.etag!]));
}

suite('Linear cheap etag check', () => {
	suite('agreement: a full read and a cheap check of the same issue compute the same etag', () => {
		const cases: {
			name: string;
			type: string | null;
			updatedAt: string;
			archivedAt?: string;
			closed: boolean;
		}[] = [
			{ name: 'backlog', type: 'backlog', updatedAt: '2026-01-02T00:00:00.000Z', closed: false },
			{ name: 'unstarted', type: 'unstarted', updatedAt: '2026-02-03T04:05:06.007Z', closed: false },
			{ name: 'started', type: 'started', updatedAt: '2026-03-04T05:06:07.890Z', closed: false },
			{ name: 'completed', type: 'completed', updatedAt: '2026-05-06T07:08:09.000Z', closed: true },
			{ name: 'canceled', type: 'canceled', updatedAt: '2026-10-01T12:34:56.789Z', closed: true },
			{ name: 'triage', type: 'triage', updatedAt: '2026-10-01T23:59:59.999Z', closed: false },
			// provider-apis maps an archived issue's `archivedAt` to `closedDate`, which closes it whatever its state.
			{
				name: 'archived while started',
				type: 'started',
				updatedAt: '2026-04-05T06:07:08.009Z',
				archivedAt: '2026-04-06T00:00:00.000Z',
				closed: true,
			},
			{
				name: 'archived once completed',
				type: 'completed',
				updatedAt: '2026-04-05T06:07:08.010Z',
				archivedAt: '2026-04-07T00:00:00.000Z',
				closed: true,
			},
			{ name: 'no state', type: null, updatedAt: '2026-06-07T08:09:10.011Z', closed: false },
		];

		for (const c of cases) {
			test(c.name, async () => {
				const runtime = createFakeRuntime();
				const requests = fakeLinear(runtime, [
					linearIssue('ENG-1', { type: c.type, updatedAt: c.updatedAt, archivedAt: c.archivedAt }),
				]);
				const { manager, linear } = await connectedLinear(runtime);
				const targets = [{ resourceId: 'workspace-1', identifier: 'ENG-1' }];

				const [full] = fulfilled<IssueShape | undefined>(
					(await linear.getIssuesByResourceIdBatchResult(targets))?.value,
				);
				const [cheap] = fulfilled<IssueEtagFields | undefined>(
					(await linear.getIssuesEtagFieldsByResourceIdBatchResult(targets, {}))?.value,
				);

				assert.ok(full != null && cheap != null);
				assert.equal(full.closed, c.closed, 'the full read maps the state as expected');
				assert.equal(issueEtag(cheap, []), issueEtag(issueEtagFieldsFromShape(full), []));
				assert.equal(cheap.updatedDate.getTime(), new Date(c.updatedAt).getTime());
				assert.deepEqual(kinds(requests), ['full', 'cheap']);
				assert.deepEqual(cheapChecks(requests)[0].numbers, [1]);
				assert.equal(cheapChecks(requests)[0].teamKey, 'ENG');

				manager.dispose();
			});
		}

		test('a changed state, update time or archival changes the etag', async () => {
			const runtime = createFakeRuntime();
			const issues = [linearIssue('ENG-1')];
			fakeLinear(runtime, issues);
			const { manager, linear } = await connectedLinear(runtime);
			const targets = [{ resourceId: 'workspace-1', identifier: 'ENG-1' }];
			const etag = async () => {
				const [fields] = fulfilled(
					(await linear.getIssuesEtagFieldsByResourceIdBatchResult(targets, {}))?.value,
				);
				return issueEtag(fields!, []);
			};

			const before = await etag();
			issues[0] = linearIssue('ENG-1', { updatedAt: '2026-01-02T00:00:00.001Z' });
			const updated = await etag();
			issues[0] = linearIssue('ENG-1', { type: 'completed', updatedAt: '2026-01-02T00:00:00.001Z' });
			const completed = await etag();
			issues[0] = linearIssue('ENG-1', {
				archivedAt: '2026-01-03T00:00:00.000Z',
				updatedAt: '2026-01-02T00:00:00.001Z',
			});
			const archived = await etag();

			assert.notEqual(updated, before);
			assert.notEqual(completed, updated);
			assert.notEqual(archived, updated);

			manager.dispose();
		});

		test('an issue without an update time falls through rather than matching a fallback date', async () => {
			const runtime = createFakeRuntime();
			fakeLinear(runtime, [linearIssue('ENG-1', { updatedAt: null })]);
			const { manager, linear } = await connectedLinear(runtime);

			const slots = (
				await linear.getIssuesEtagFieldsByResourceIdBatchResult(
					[{ resourceId: 'workspace-1', identifier: 'ENG-1' }],
					{},
				)
			)?.value;

			assert.ok(slots != null);
			assert.equal(slots.length, 1);
			assert.equal(slots[0].status, 'rejected');

			manager.dispose();
		});
	});

	suite('through the manager', () => {
		test('etags from a full read come back unchanged with only the cheap query sent', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeLinear(runtime, [
				linearIssue('ENG-1'),
				linearIssue('ENG-2', { type: 'completed' }),
				linearIssue('ENG-3', { type: 'started', archivedAt: '2026-01-05T00:00:00.000Z' }),
			]);
			const { manager, linear } = await connectedLinear(runtime);
			const targets = [target('ENG-1'), target('ENG-2'), target('ENG-3')];
			const etags = await seedEtags(manager, targets);
			assert.equal(fullReads(requests).length, 3);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(
				result.items,
				targets.map(t => ({ key: t.key, unchanged: true, etag: etags.get(t.key) })),
			);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(kinds(requests), ['cheap']);
			assert.deepEqual(cheapChecks(requests)[0].numbers, [1, 2, 3]);
			assert.equal(getRequestExceptionCount(linear), 0);

			manager.dispose();
		});

		test('only the issue that changed is read in full, and a target without an etag is read alongside', async () => {
			const runtime = createFakeRuntime();
			const issues = [linearIssue('ENG-1'), linearIssue('ENG-2'), linearIssue('ENG-3')];
			const requests = fakeLinear(runtime, issues);
			const { manager } = await connectedLinear(runtime);
			const etags = await seedEtags(manager, [target('ENG-1'), target('ENG-2')]);
			issues[1] = linearIssue('ENG-2', { type: 'canceled', updatedAt: '2026-06-01T00:00:00.000Z' });
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: [
					target('ENG-1', { etag: etags.get('ENG-1') }),
					target('ENG-2', { etag: etags.get('ENG-2') }),
					target('ENG-3'),
				],
			});

			const [unchanged, changed, unasked] = result.items;
			assert.deepEqual(unchanged, { key: 'ENG-1', unchanged: true, etag: etags.get('ENG-1') });
			assert.equal(changed.key, 'ENG-2');
			assert.ok(changed.issue != null);
			assert.equal(changed.issue.state, 'closed');
			assert.notEqual(changed.etag, etags.get('ENG-2'));
			assert.equal(changed.etag, issueEtag(issueEtagFieldsFromShape(changed.issue), []));
			assert.equal(unasked.issue?.id, 'ENG-3');
			assert.deepEqual(cheapChecks(requests)[0].numbers, [1, 2]);
			assert.deepEqual(
				fullReads(requests)
					.map(r => r.identifier)
					.sort(),
				['ENG-2', 'ENG-3'],
			);

			manager.dispose();
		});
	});

	suite('grouping', () => {
		test('sends one query per team', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeLinear(runtime, [
				linearIssue('ENG-1'),
				linearIssue('ENG-2'),
				linearIssue('OPS-1', { type: 'completed' }),
			]);
			const { manager } = await connectedLinear(runtime);
			const targets = [target('ENG-1'), target('OPS-1'), target('ENG-2')];
			const etags = await seedEtags(manager, targets);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.ok(result.items.every(i => i.unchanged));
			assert.deepEqual(
				cheapChecks(requests)
					.map(r => [r.teamKey, r.numbers])
					.sort(),
				[
					['ENG', [1, 2]],
					['OPS', [1]],
				],
			);
			assert.equal(fullReads(requests).length, 0);

			manager.dispose();
		});

		test('chunks a team at 50 numbers', async () => {
			const runtime = createFakeRuntime();
			const issues = Array.from({ length: 60 }, (_, i) => linearIssue(`ENG-${i + 1}`));
			const requests = fakeLinear(runtime, issues);
			const { manager } = await connectedLinear(runtime);
			const targets = issues.map(i => target(i.identifier));
			const etags = await seedEtags(manager, targets);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.equal(result.items.length, 60);
			assert.ok(result.items.every(i => i.unchanged));
			assert.deepEqual(
				cheapChecks(requests)
					.map(r => r.numbers!.length)
					.sort((a, b) => b - a),
				[50, 10],
			);
			assert.equal(fullReads(requests).length, 0);

			manager.dispose();
		});

		test('a lowercase identifier matches its issue, and two spellings of one issue share one number', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeLinear(runtime, [linearIssue('ENG-1'), linearIssue('ENG-2')]);
			const { manager } = await connectedLinear(runtime);
			const targets = [target('eng-1', { key: 'lower' }), target('ENG-1', { key: 'upper' }), target('ENG-2')];
			const etags = await seedEtags(manager, targets);
			assert.equal(etags.size, 3);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(
				result.items,
				targets.map(t => ({ key: t.key, unchanged: true, etag: etags.get(t.key) })),
			);
			assert.deepEqual(
				requests.map(r => [r.teamKey, r.numbers]),
				[['ENG', [1, 2]]],
			);

			manager.dispose();
		});
	});

	suite('matching', () => {
		test('a number the query omits falls through to the full read, whose missing issue proves the absence', async () => {
			const runtime = createFakeRuntime();
			const issues = [linearIssue('ENG-1'), linearIssue('ENG-2')];
			const requests = fakeLinear(runtime, issues);
			const { manager, linear } = await connectedLinear(runtime);
			const etags = await seedEtags(manager, [target('ENG-1'), target('ENG-2')]);
			issues.pop();
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: [target('ENG-1', { etag: etags.get('ENG-1') }), target('ENG-2', { etag: etags.get('ENG-2') })],
			});

			assert.deepEqual(result.items, [
				{ key: 'ENG-1', unchanged: true, etag: etags.get('ENG-1') },
				{ key: 'ENG-2' },
			]);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				fullReads(requests).map(r => r.identifier),
				['ENG-2'],
			);
			assert.equal(getRequestExceptionCount(linear), 0, 'an omitted number is not a failure');

			manager.dispose();
		});

		test('a batch whose every number is omitted costs a full read, not a failure', async () => {
			const runtime = createFakeRuntime();
			const issues = [linearIssue('ENG-1')];
			const requests = fakeLinear(runtime, issues);
			const { manager, linear } = await connectedLinear(runtime);
			const etags = await seedEtags(manager, [target('ENG-1')]);
			issues.length = 0;
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: [target('ENG-1', { etag: etags.get('ENG-1') })],
			});

			assert.deepEqual(result.items, [{ key: 'ENG-1' }]);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(kinds(requests), ['cheap', 'full']);
			assert.equal(getRequestExceptionCount(linear), 0);

			manager.dispose();
		});

		test('an identifier the issue no longer carries falls through to the full read, never unchanged', async () => {
			// The team was renamed (or the issue moved teams): the full read still resolves the old identifier, while
			// the query filters by the team's current key and leaves it out.
			const runtime = createFakeRuntime();
			const issues = [linearIssue('OLD-7')];
			const aliases: Record<string, string> = {};
			const requests = fakeLinear(runtime, issues, { aliases: aliases });
			const { manager } = await connectedLinear(runtime);
			const etags = await seedEtags(manager, [target('OLD-7')]);
			issues[0] = { ...linearIssue('NEW-7'), id: 'lin-OLD-7' };
			aliases['OLD-7'] = 'NEW-7';
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Linear,
				targets: [target('OLD-7', { etag: etags.get('OLD-7') })],
			});

			assert.equal(result.items.length, 1);
			assert.equal(result.items[0].unchanged, undefined);
			assert.equal(result.items[0].issue?.id, 'NEW-7', 'read in full, never absent');
			assert.deepEqual(
				requests.map(r => [r.teamKey ?? r.identifier, r.numbers]),
				[
					['OLD', [7]],
					['OLD-7', undefined],
				],
			);

			manager.dispose();
		});

		for (const identifier of ['ENG1', 'ENG-', 'ENG-1a', 'ENG_1', 'ENG-01']) {
			test(`a malformed identifier (${identifier}) falls through to the full read`, async () => {
				const runtime = createFakeRuntime();
				const requests = fakeLinear(runtime, [linearIssue('ENG-1'), linearIssue('ENG-2')]);
				const { manager } = await connectedLinear(runtime);
				const etags = await seedEtags(manager, [target('ENG-2')]);
				requests.length = 0;

				const alone = await manager.getIssuesBatch({
					providerId: IssuesCloudHostIntegrationId.Linear,
					targets: [target(identifier, { etag: etags.get('ENG-2') })],
				});

				assert.deepEqual(alone.items, [{ key: identifier }], 'the full read decides');
				assert.deepEqual(alone.warnings, []);
				assert.deepEqual(kinds(requests), ['full'], 'a check with nothing to ask declines');
				requests.length = 0;

				const mixed = await manager.getIssuesBatch({
					providerId: IssuesCloudHostIntegrationId.Linear,
					targets: [
						target(identifier, { etag: etags.get('ENG-2') }),
						target('ENG-2', { etag: etags.get('ENG-2') }),
					],
				});

				assert.deepEqual(mixed.items, [
					{ key: identifier },
					{ key: 'ENG-2', unchanged: true, etag: etags.get('ENG-2') },
				]);
				assert.deepEqual(
					requests.map(r => r.identifier ?? r.numbers),
					[[2], identifier],
				);

				manager.dispose();
			});
		}

		for (const { name, respond } of [
			{
				name: 'a GraphQL error',
				respond: () => jsonResponse(200, { data: null, errors: [{ message: 'Something went wrong' }] }),
			},
			{
				name: 'a next page',
				respond: () => jsonResponse(200, { data: { issues: { pageInfo: { hasNextPage: true }, nodes: [] } } }),
			},
		]) {
			test(`${name} rejects the whole query, and its targets fall through to the full read`, async () => {
				const runtime = createFakeRuntime();
				let failing = false;
				const requests = fakeLinear(runtime, [linearIssue('ENG-1'), linearIssue('ENG-2')], {
					respond: r => (failing && r.numbers != null ? respond() : undefined),
				});
				const { manager } = await connectedLinear(runtime);
				const targets = [target('ENG-1'), target('ENG-2')];
				const etags = await seedEtags(manager, targets);
				failing = true;
				requests.length = 0;

				const result = await manager.getIssuesBatch({
					providerId: IssuesCloudHostIntegrationId.Linear,
					targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				});

				assert.deepEqual(
					result.items.map(i => [i.key, i.unchanged, i.issue?.id, i.etag]),
					targets.map(t => [t.key, undefined, t.identifier, etags.get(t.key)]),
				);
				assert.deepEqual(result.warnings, []);
				assert.equal(result.fetchFailed, undefined);
				assert.equal(cheapChecks(requests).length, 1);
				assert.equal(fullReads(requests).length, 2);

				manager.dispose();
			});
		}

		for (const { name, status, body, kind } of [
			{
				name: 'a rate limit',
				status: 400,
				body: { errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] },
				kind: 'rate-limit',
			},
			{
				name: 'a rate limit reported with a 200',
				status: 200,
				body: { data: null, errors: [{ message: 'Rate limit exceeded', extensions: { code: 'RATELIMITED' } }] },
				kind: 'rate-limit',
			},
			{ name: 'a refused credential', status: 401, body: { message: 'Unauthorized' }, kind: 'auth' },
		]) {
			test(`${name} drops the targets with its ${kind} warning, without a full read`, async () => {
				const runtime = createFakeRuntime();
				let failing = false;
				const requests = fakeLinear(runtime, [linearIssue('ENG-1'), linearIssue('ENG-2')], {
					respond: () => (failing ? jsonResponse(status, body) : undefined),
				});
				const { manager } = await connectedLinear(runtime);
				const targets = [target('ENG-1'), target('ENG-2')];
				const etags = await seedEtags(manager, targets);
				failing = true;
				requests.length = 0;

				const result = await manager.getIssuesBatch({
					providerId: IssuesCloudHostIntegrationId.Linear,
					targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.ok(result.warnings.length > 0);
				assert.ok(
					result.warnings.every(w => w.kind === kind),
					JSON.stringify(result.warnings),
				);
				assert.equal(cheapChecks(requests).length, 1);
				assert.equal(fullReads(requests).length, 0, 'the full read would only hit the same failure');

				manager.dispose();
			});
		}
	});

	suite('the request', () => {
		test('asks for archived issues, uses every variable it declares, and sends the token as provider-apis does', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeLinear(runtime, [linearIssue('ENG-1')]);
			const { manager, linear } = await connectedLinear(runtime);
			const targets = [{ resourceId: 'workspace-1', identifier: 'ENG-1' }];

			await linear.getIssuesByResourceIdBatchResult(targets);
			await linear.getIssuesEtagFieldsByResourceIdBatchResult(targets, {});

			const [full, cheap] = requests;
			assert.match(cheap.query, /\bincludeArchived:\s*true\b/);

			const header = /query\s+\w+\s*\(([^)]*)\)/.exec(cheap.query);
			assert.ok(header != null, 'the query declares its variables');
			const declared = Array.from(header[1].matchAll(/\$(\w+)\s*:/g), m => m[1]);
			assert.deepEqual(declared.sort(), Object.keys(cheap.variables).sort(), 'every sent variable is declared');
			const body = cheap.query.slice(header.index + header[0].length);
			for (const name of declared) {
				assert.match(body, new RegExp(`\\$${name}\\b`), `$${name} is used`);
			}

			for (const field of ['number', 'updatedAt', 'archivedAt', 'state', 'type']) {
				assert.ok(selects(cheap.query, field), `selects ${field}`);
			}

			assert.equal(full.authorization, 'tok');
			assert.equal(cheap.authorization, full.authorization, 'the same Authorization header as the full read');

			manager.dispose();
		});
	});
});
