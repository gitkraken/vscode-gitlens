import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { BatchSlot, IssueEtagFields } from '../models/integration.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { issueEtag, issueEtagFieldsFromShape } from '../reads/etag.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * The Jira Cloud cheap etag check: one bulk fetch (`POST /rest/api/3/issue/bulkfetch`) per site and 100 keys, where
 * the full read sends one `GET /rest/api/2/issue/{key}` per target.
 *
 * The correctness core is agreement: the full row's etag is computed after `fromJiraIssueByKey` and `toIssueShape`,
 * so each case feeds ONE raw Jira issue through the integration's real full read and its real cheap read, answering
 * each request at the HTTP level, and compares the etags. The rest pins the matching rules that keep the check from
 * ever answering a false `unchanged` or a false absence: a bulk fetch silently omits a key it can't find, returns a
 * moved issue under its new key, and answers in its own order.
 */

type RawIssue = Record<string, unknown> & { id: string; key: string; fields: Record<string, unknown> };

const resourceUrl = 'https://example.atlassian.net';

function jiraIssue(
	key: string,
	options?: { id?: string; categoryKey?: string; statusName?: string; updated?: string },
): RawIssue {
	const categoryKey = options?.categoryKey ?? 'new';
	return {
		id: options?.id ?? String(10000 + Number(/\d+$/.exec(key)?.[0] ?? 0)),
		key: key,
		self: `https://api.atlassian.com/ex/jira/site-1/rest/api/2/issue/${key}`,
		fields: {
			assignee: null,
			comment: { total: 0, comments: [] },
			created: '2026-01-01T00:00:00.000+0000',
			creator: null,
			description: 'h2. Details',
			issuetype: { name: 'Task' },
			labels: [],
			project: { id: 'project-1', key: key.split('-')[0], name: 'Project' },
			status: {
				id: `status-${categoryKey}`,
				name: options?.statusName ?? categoryKey,
				statusCategory: { colorName: 'blue-gray', key: categoryKey, name: categoryKey },
			},
			summary: `issue ${key}`,
			updated: options?.updated ?? '2026-01-02T00:00:00.000+0000',
			votes: { votes: 0 },
		},
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

interface RecordedRequest {
	method: string;
	url: string;
	site?: string;
	/** The keys a bulk fetch asked for. */
	keys?: string[];
	/** The key a full read asked for. */
	key?: string;
}

/**
 * A Jira Cloud that answers both reads from the same issues, by site. A key resolves case-insensitively and through
 * `moved` (old key → current key), as Jira resolves both reads; a bulk fetch omits what doesn't resolve and answers in
 * DESCENDING id order (Jira's own order is ascending; either way never the request's), and a full read answers 404.
 * `respond` overrides any request.
 */
function fakeJira(
	runtime: FakeRuntime,
	sites: Record<string, RawIssue[]>,
	options?: {
		moved?: Record<string, string>;
		respond?: (request: RecordedRequest) => Response | undefined;
	},
): RecordedRequest[] {
	const requests: RecordedRequest[] = [];
	const resolve = (site: string, key: string): RawIssue | undefined => {
		const upper = key.toUpperCase();
		const current = options?.moved?.[upper] ?? upper;
		// Both reads also take a numeric issue id in place of a key.
		return sites[site]?.find(i => i.key === current || i.id === key);
	};

	runtime.http.fetch = (input, init) => {
		const url = new URL(input.toString());
		const method = init?.method ?? 'GET';
		const request: RecordedRequest = { method: method, url: url.toString() };
		requests.push(request);

		const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
			issueIdsOrKeys?: string[];
			fields?: string[];
		};
		const bulk = /^\/ex\/jira\/([^/]+)\/rest\/api\/3\/issue\/bulkfetch$/.exec(url.pathname);
		const single = /^\/ex\/jira\/([^/]+)\/rest\/api\/2\/issue\/([^/]+)$/.exec(url.pathname);
		if (bulk != null && method === 'POST') {
			request.site = decodeURIComponent(bulk[1]);
			request.keys = body.issueIdsOrKeys;
		} else if (single != null) {
			request.site = decodeURIComponent(single[1]);
			request.key = decodeURIComponent(single[2]);
		}

		const overridden = options?.respond?.(request);
		if (overridden != null) return Promise.resolve(overridden);

		if (request.keys != null) {
			const fields = body.fields ?? [];
			const found = new Map<string, RawIssue>();
			for (const key of request.keys) {
				const issue = resolve(request.site!, key);
				if (issue != null) {
					found.set(issue.id, issue);
				}
			}
			const issues = [...found.values()]
				.sort((a, b) => Number(b.id) - Number(a.id))
				.map(issue => ({
					id: issue.id,
					key: issue.key,
					self: `https://api.atlassian.com/ex/jira/${request.site}/rest/api/3/issue/${issue.id}`,
					fields: Object.fromEntries(fields.map(f => [f, issue.fields[f]])),
				}));
			return Promise.resolve(
				jsonResponse(200, {
					expand: '',
					issues: issues,
					issueErrors: [],
				}),
			);
		}

		if (request.key != null) {
			const issue = resolve(request.site!, request.key);
			return Promise.resolve(
				issue != null
					? jsonResponse(200, issue)
					: jsonResponse(404, {
							errorMessages: ['Issue does not exist or you do not have permission to see it.'],
							errors: {},
						}),
			);
		}

		return Promise.resolve(jsonResponse(404, { message: `unexpected ${method} ${url.pathname}` }));
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
		domain: 'atlassian.net',
	};
}

async function connectedJira(runtime: FakeRuntime) {
	const manager = createIntegrationManager(runtime);
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = session();
	return { manager: manager, jira: jira };
}

function target(identifier: string, options?: { key?: string; site?: string; etag?: string }) {
	return {
		key: options?.key ?? identifier,
		resourceId: options?.site ?? 'site-1',
		resourceUrl: resourceUrl,
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

const posts = (requests: RecordedRequest[]) => requests.filter(r => r.keys != null);
const gets = (requests: RecordedRequest[]) => requests.filter(r => r.key != null);

/** The etags a full read hands back, by caller key, to send on a second call. */
async function seedEtags(
	manager: ReturnType<typeof createIntegrationManager>,
	targets: ReturnType<typeof target>[],
): Promise<Map<string, string>> {
	const result = await manager.getIssuesBatch({ providerId: IssuesCloudHostIntegrationId.Jira, targets: targets });
	assert.equal(result.fetchFailed, undefined);
	return new Map(result.items.filter(i => i.etag != null).map(i => [i.key, i.etag!]));
}

suite('Jira Cloud cheap etag check', () => {
	suite('agreement: a full read and a bulk fetch of the same issue compute the same etag', () => {
		const cases: { name: string; categoryKey: string; updated: string; closed: boolean }[] = [
			{ name: 'to do', categoryKey: 'new', updated: '2026-01-02T00:00:00.000+0000', closed: false },
			{
				name: 'in progress',
				categoryKey: 'indeterminate',
				updated: '2026-03-04T05:06:07.890+0000',
				closed: false,
			},
			{ name: 'done', categoryKey: 'done', updated: '2026-05-06T07:08:09.000+0000', closed: true },
			{
				name: 'a positive offset',
				categoryKey: 'indeterminate',
				updated: '2026-10-01T12:34:56.789+0200',
				closed: false,
			},
			{ name: 'a negative offset', categoryKey: 'done', updated: '2026-10-01T12:34:56.001-0700', closed: true },
			// Jira's fallback category: `toStatusCategory` reads any unknown key as to do, in both reads.
			{
				name: 'an unknown category',
				categoryKey: 'undefined',
				updated: '2026-02-03T04:05:06.007+0000',
				closed: false,
			},
		];

		for (const c of cases) {
			test(c.name, async () => {
				const runtime = createFakeRuntime();
				const requests = fakeJira(runtime, {
					'site-1': [jiraIssue('ABC-1', { categoryKey: c.categoryKey, updated: c.updated })],
				});
				const { manager, jira } = await connectedJira(runtime);
				const targets = [{ resourceId: 'site-1', identifier: 'ABC-1', resourceUrl: resourceUrl }];

				const [full] = fulfilled<IssueShape | undefined>(
					(await jira.getIssuesByResourceIdBatchResult(targets))?.value,
				);
				const [cheap] = fulfilled<IssueEtagFields | undefined>(
					(await jira.getIssuesEtagFieldsByResourceIdBatchResult(targets, {}))?.value,
				);

				assert.ok(full != null && cheap != null);
				assert.equal(full.closed, c.closed, 'the full read maps the category as expected');
				assert.equal(issueEtag(cheap, []), issueEtag(issueEtagFieldsFromShape(full), []));
				assert.equal(cheap.updatedDate.getTime(), new Date(c.updated).getTime());
				assert.deepEqual(
					requests.map(r => r.method),
					['GET', 'POST'],
				);
				assert.deepEqual(posts(requests)[0].keys, ['ABC-1']);

				manager.dispose();
			});
		}

		test('a changed status or update time changes the etag', async () => {
			const runtime = createFakeRuntime();
			const sites = { 'site-1': [jiraIssue('ABC-1')] };
			fakeJira(runtime, sites);
			const { manager, jira } = await connectedJira(runtime);
			const targets = [{ resourceId: 'site-1', identifier: 'ABC-1', resourceUrl: resourceUrl }];
			const etag = async () => {
				const [fields] = fulfilled((await jira.getIssuesEtagFieldsByResourceIdBatchResult(targets, {}))?.value);
				return issueEtag(fields!, []);
			};

			const before = await etag();
			sites['site-1'] = [jiraIssue('ABC-1', { updated: '2026-01-02T00:00:00.001+0000' })];
			const updated = await etag();
			sites['site-1'] = [jiraIssue('ABC-1', { categoryKey: 'done', updated: '2026-01-02T00:00:00.001+0000' })];
			const closed = await etag();

			assert.notEqual(updated, before);
			assert.notEqual(closed, updated);

			manager.dispose();
		});
	});

	suite('through the manager', () => {
		test('etags from a full read come back unchanged with only bulk fetch POSTs sent', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeJira(runtime, {
				'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2', { categoryKey: 'done' }), jiraIssue('ABC-3')],
			});
			const { manager, jira } = await connectedJira(runtime);
			const targets = [target('ABC-1'), target('ABC-2'), target('ABC-3')];
			const etags = await seedEtags(manager, targets);
			assert.equal(gets(requests).length, 3);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(
				result.items,
				targets.map(t => ({ key: t.key, unchanged: true, etag: etags.get(t.key) })),
			);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				requests.map(r => r.method),
				['POST'],
			);
			assert.deepEqual(posts(requests)[0].keys, ['ABC-1', 'ABC-2', 'ABC-3']);
			assert.equal(getRequestExceptionCount(jira), 0);

			manager.dispose();
		});

		test("'reactions' widens nothing on Jira: the votes its full row carries never fail the check", async () => {
			const runtime = createFakeRuntime();
			const voted = (votes: number): RawIssue => {
				const issue = jiraIssue('ABC-1');
				issue.fields.votes = { votes: votes };
				return issue;
			};
			const sites = { 'site-1': [voted(7)] };
			const requests = fakeJira(runtime, sites);
			const { manager } = await connectedJira(runtime);

			const first = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [target('ABC-1')],
				etagIncludes: ['reactions'],
			});
			// The full row reads the votes into `thumbsUpCount`, which the bulk fetch never selects: they aren't
			// reactions, so neither side's etag reads them.
			assert.equal(first.items[0].issue?.thumbsUpCount, 7);
			assert.match(first.items[0].etag ?? '', /^is1\+reactions:\[.*,null\]$/);
			sites['site-1'] = [voted(8)];
			requests.length = 0;

			const second = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [target('ABC-1', { etag: first.items[0].etag })],
				etagIncludes: ['reactions'],
			});

			assert.deepEqual(second.items, [{ key: 'ABC-1', unchanged: true, etag: first.items[0].etag }]);
			assert.deepEqual(
				requests.map(r => r.method),
				['POST'],
			);

			manager.dispose();
		});

		test('only the issue that moved is read in full, and a target without an etag is read alongside', async () => {
			const runtime = createFakeRuntime();
			const sites = { 'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2'), jiraIssue('ABC-3')] };
			const requests = fakeJira(runtime, sites);
			const { manager } = await connectedJira(runtime);
			const etags = await seedEtags(manager, [target('ABC-1'), target('ABC-2')]);
			sites['site-1'] = [
				jiraIssue('ABC-1'),
				jiraIssue('ABC-2', { categoryKey: 'done', updated: '2026-06-01T00:00:00.000+0000' }),
				jiraIssue('ABC-3'),
			];
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [
					target('ABC-1', { etag: etags.get('ABC-1') }),
					target('ABC-2', { etag: etags.get('ABC-2') }),
					target('ABC-3'),
				],
			});

			const [unchanged, changed, unasked] = result.items;
			assert.deepEqual(unchanged, { key: 'ABC-1', unchanged: true, etag: etags.get('ABC-1') });
			assert.equal(changed.key, 'ABC-2');
			assert.ok(changed.issue != null);
			assert.equal(changed.issue.state, 'closed');
			assert.notEqual(changed.etag, etags.get('ABC-2'));
			assert.equal(changed.etag, issueEtag(issueEtagFieldsFromShape(changed.issue), []));
			assert.equal(unasked.issue?.id, 'ABC-3');
			assert.deepEqual(posts(requests)[0].keys, ['ABC-1', 'ABC-2']);
			assert.deepEqual(
				gets(requests)
					.map(r => r.key)
					.sort(),
				['ABC-2', 'ABC-3'],
			);

			manager.dispose();
		});
	});

	suite('grouping', () => {
		test('sends one bulk fetch per site', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeJira(runtime, {
				'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2')],
				'site-2': [jiraIssue('XYZ-1'), jiraIssue('ABC-1', { id: '20001', categoryKey: 'done' })],
			});
			const { manager } = await connectedJira(runtime);
			const targets = [
				target('ABC-1', { key: 'a1' }),
				target('XYZ-1', { key: 'x1', site: 'site-2' }),
				target('ABC-2', { key: 'a2' }),
				target('ABC-1', { key: 'a1@2', site: 'site-2' }),
			];
			const etags = await seedEtags(manager, targets);
			assert.notEqual(etags.get('a1'), etags.get('a1@2'), 'one key on two sites is two issues');
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.ok(result.items.every(i => i.unchanged));
			assert.deepEqual(
				posts(requests)
					.map(r => [r.site, r.keys])
					.sort(),
				[
					['site-1', ['ABC-1', 'ABC-2']],
					['site-2', ['XYZ-1', 'ABC-1']],
				],
			);
			assert.equal(gets(requests).length, 0);

			manager.dispose();
		});

		test('chunks a site at 100 keys', async () => {
			const runtime = createFakeRuntime();
			const issues = Array.from({ length: 150 }, (_, i) => jiraIssue(`ABC-${i + 1}`));
			const requests = fakeJira(runtime, { 'site-1': issues });
			const { manager } = await connectedJira(runtime);
			const targets = issues.map(i => target(i.key));
			const etags = await seedEtags(manager, targets);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.equal(result.items.length, 150);
			assert.ok(result.items.every(i => i.unchanged));
			assert.deepEqual(
				posts(requests)
					.map(r => r.keys!.length)
					.sort((a, b) => b - a),
				[100, 50],
			);
			assert.equal(gets(requests).length, 0);

			manager.dispose();
		});
	});

	suite('matching', () => {
		test('a key the bulk fetch omits falls through to the full read, whose 404 proves the absence', async () => {
			const runtime = createFakeRuntime();
			const sites: Record<string, RawIssue[]> = { 'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2')] };
			const requests = fakeJira(runtime, sites);
			const { manager, jira } = await connectedJira(runtime);
			const etags = await seedEtags(manager, [target('ABC-1'), target('ABC-2')]);
			sites['site-1'] = [jiraIssue('ABC-1')];
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [target('ABC-1', { etag: etags.get('ABC-1') }), target('ABC-2', { etag: etags.get('ABC-2') })],
			});

			assert.deepEqual(result.items, [
				{ key: 'ABC-1', unchanged: true, etag: etags.get('ABC-1') },
				{ key: 'ABC-2' },
			]);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				gets(requests).map(r => r.key),
				['ABC-2'],
			);
			assert.equal(getRequestExceptionCount(jira), 0, 'an omitted key is not a failure');

			manager.dispose();
		});

		test('a batch whose every key is omitted costs a full read, not a failure', async () => {
			const runtime = createFakeRuntime();
			const sites: Record<string, RawIssue[]> = { 'site-1': [jiraIssue('ABC-1')] };
			const requests = fakeJira(runtime, sites);
			const { manager, jira } = await connectedJira(runtime);
			const etags = await seedEtags(manager, [target('ABC-1')]);
			sites['site-1'] = [];
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [target('ABC-1', { etag: etags.get('ABC-1') })],
			});

			assert.deepEqual(result.items, [{ key: 'ABC-1' }]);
			assert.deepEqual(result.warnings, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				requests.map(r => r.method),
				['POST', 'GET'],
			);
			assert.equal(getRequestExceptionCount(jira), 0);

			manager.dispose();
		});

		test('an issueErrors entry never proves an absence: its key falls through to the full read', async () => {
			// Atlassian documents `issueErrors` as retriable or payload errors only, by issue id rather than key, and
			// says missing or invisible issues are not listed there.
			const runtime = createFakeRuntime();
			const sites: Record<string, RawIssue[]> = {
				'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2', { id: '10002' })],
			};
			const requests = fakeJira(runtime, sites, {
				respond: r =>
					r.keys != null
						? jsonResponse(200, {
								expand: '',
								issues: [],
								issueErrors: [{ id: '10002', errorMessage: 'Retry the request' }],
							})
						: undefined,
			});
			const { manager, jira } = await connectedJira(runtime);
			const etags = await seedEtags(manager, [target('ABC-2')]);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [target('ABC-2', { etag: etags.get('ABC-2') })],
			});

			assert.equal(result.items.length, 1);
			assert.equal(result.items[0].issue?.id, 'ABC-2', 'read in full, never absent');
			assert.equal(result.items[0].etag, etags.get('ABC-2'));
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				requests.map(r => r.method),
				['POST', 'GET'],
			);
			assert.equal(
				getRequestExceptionCount(jira),
				0,
				'the full read that answered resets any strike the check spent',
			);

			manager.dispose();
		});

		test('a key returned under another key (a moved issue) falls through to the full read', async () => {
			const runtime = createFakeRuntime();
			const sites: Record<string, RawIssue[]> = { 'site-1': [jiraIssue('OLD-1', { id: '10500' })] };
			const moved: Record<string, string> = {};
			const requests = fakeJira(runtime, sites, { moved: moved });
			const { manager } = await connectedJira(runtime);
			const etags = await seedEtags(manager, [target('OLD-1')]);
			// Moved to another project, untouched otherwise: same id, same state and update time, new key.
			sites['site-1'] = [{ ...jiraIssue('NEW-5', { id: '10500' }) }];
			moved['OLD-1'] = 'NEW-5';
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [target('OLD-1', { etag: etags.get('OLD-1') })],
			});

			assert.equal(result.items.length, 1);
			assert.equal(result.items[0].unchanged, undefined, 'never unchanged for an issue answering another key');
			assert.equal(result.items[0].issue?.id, 'NEW-5');
			assert.deepEqual(
				requests.map(r => [r.method, r.key ?? r.keys]),
				[
					['POST', ['OLD-1']],
					['GET', 'OLD-1'],
				],
			);

			manager.dispose();
		});

		test('a lowercase key matches its issue, and two spellings of one key share one bulk fetch entry', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeJira(runtime, { 'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2')] });
			const { manager } = await connectedJira(runtime);
			const targets = [target('abc-1', { key: 'lower' }), target('ABC-1', { key: 'upper' }), target('ABC-2')];
			const etags = await seedEtags(manager, targets);
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(
				result.items,
				targets.map(t => ({ key: t.key, unchanged: true, etag: etags.get(t.key) })),
			);
			assert.deepEqual(
				requests.map(r => [r.method, r.keys]),
				[['POST', ['ABC-1', 'ABC-2']]],
			);

			manager.dispose();
		});

		test('a target identified by its numeric id matches its issue by id, and answers unchanged', async () => {
			const runtime = createFakeRuntime();
			const requests = fakeJira(runtime, { 'site-1': [jiraIssue('ABC-1', { id: '10001' }), jiraIssue('ABC-2')] });
			const { manager } = await connectedJira(runtime);
			const targets = [target('10001', { key: 'by-id' }), target('ABC-2')];
			const etags = await seedEtags(manager, targets);
			assert.equal(etags.size, 2, 'the full read takes the id as well');
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(
				result.items,
				targets.map(t => ({ key: t.key, unchanged: true, etag: etags.get(t.key) })),
			);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(
				requests.map(r => [r.method, r.keys]),
				[['POST', ['10001', 'ABC-2']]],
				'no full read',
			);

			manager.dispose();
		});

		test("a key target never matches another issue's id", async () => {
			// A moved issue keeps its id: a key target answered only through the id would be a false `unchanged`.
			const runtime = createFakeRuntime();
			const sites: Record<string, RawIssue[]> = { 'site-1': [jiraIssue('OLD-1', { id: '10500' })] };
			const moved: Record<string, string> = {};
			const requests = fakeJira(runtime, sites, { moved: moved });
			const { manager } = await connectedJira(runtime);
			const targets = [target('OLD-1'), target('10500', { key: 'by-id' })];
			const etags = await seedEtags(manager, targets);
			sites['site-1'] = [jiraIssue('NEW-5', { id: '10500' })];
			moved['OLD-1'] = 'NEW-5';
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(
				result.items.map(i => [i.key, i.unchanged, i.issue?.id]),
				[
					['OLD-1', undefined, 'NEW-5'],
					['by-id', true, undefined],
				],
			);
			assert.deepEqual(
				gets(requests).map(r => r.key),
				['OLD-1'],
			);

			manager.dispose();
		});

		for (const { status, kind } of [
			{ status: 401, kind: 'auth' },
			{ status: 429, kind: 'rate-limit' },
		]) {
			test(`a ${status} on the bulk fetch drops its targets with a ${kind} warning, without a full read`, async () => {
				const runtime = createFakeRuntime();
				let failing = false;
				const requests = fakeJira(
					runtime,
					{ 'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2')] },
					{
						respond: () =>
							failing
								? new Response(JSON.stringify({ message: 'Refused' }), {
										status: status,
										headers: { 'content-type': 'application/json', 'retry-after': '60' },
									})
								: undefined,
					},
				);
				const { manager } = await connectedJira(runtime);
				const targets = [target('ABC-1'), target('ABC-2')];
				const etags = await seedEtags(manager, targets);
				failing = true;
				requests.length = 0;

				const result = await manager.getIssuesBatch({
					providerId: IssuesCloudHostIntegrationId.Jira,
					targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
				});

				assert.deepEqual(result.items, []);
				assert.equal(result.fetchFailed, true);
				assert.ok(result.warnings.length > 0);
				assert.ok(
					result.warnings.every(w => w.kind === kind),
					JSON.stringify(result.warnings),
				);
				assert.equal(posts(requests).length, 1);
				assert.equal(gets(requests).length, 0, 'the full read would only hit the same failure');

				manager.dispose();
			});
		}
	});

	suite('failure budget: the bulk fetch spends a strike only for a refused credential', () => {
		/** A client error is a strike, where provider-apis leaves a server error unbudgeted. */
		const badRequest = (): Response => jsonResponse(400, { errorMessages: ['Bad request'] });

		test('a total outage of a fully etagged batch spends one strike, for the full read every target falls through to', async () => {
			const runtime = createFakeRuntime();
			let failing = false;
			const requests = fakeJira(
				runtime,
				{ 'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2')] },
				{ respond: () => (failing ? badRequest() : undefined) },
			);
			const { manager, jira } = await connectedJira(runtime);
			const targets = [target('ABC-1'), target('ABC-2')];
			const etags = await seedEtags(manager, targets);
			failing = true;
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: targets.map(t => ({ ...t, etag: etags.get(t.key) })),
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([posts(requests).length, gets(requests).length], [1, 2]);
			assert.equal(getRequestExceptionCount(jira), 1, 'the bulk fetch spends none');

			manager.dispose();
		});

		test('a total outage of a mixed batch spends at most two strikes, one per full read', async () => {
			const runtime = createFakeRuntime();
			let failing = false;
			const requests = fakeJira(
				runtime,
				{ 'site-1': [jiraIssue('ABC-1'), jiraIssue('ABC-2'), jiraIssue('ABC-3')] },
				{ respond: () => (failing ? badRequest() : undefined) },
			);
			const { manager, jira } = await connectedJira(runtime);
			const targets = [target('ABC-1'), target('ABC-2')];
			const etags = await seedEtags(manager, targets);
			failing = true;
			requests.length = 0;

			const result = await manager.getIssuesBatch({
				providerId: IssuesCloudHostIntegrationId.Jira,
				targets: [...targets.map(t => ({ ...t, etag: etags.get(t.key) })), target('ABC-3')],
			});

			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, true);
			assert.deepEqual([posts(requests).length, gets(requests).length], [1, 3]);
			assert.equal(getRequestExceptionCount(jira), 2, 'one strike per full read, none for the bulk fetch');

			manager.dispose();
		});
	});

	suite('trackers without the check read in full, exactly as before', () => {
		test('Jira Data Center', async () => {
			const manager = createIntegrationManager(createFakeRuntime());
			const host = 'jira.example.com';
			const jira = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, host)) as IssuesIntegration;
			(jira as unknown as { _session: ProviderAuthenticationSession })._session = {
				...session(),
				type: 'pat',
				domain: host,
			};
			const calls: string[] = [];
			(jira as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
				Promise.resolve({
					getJiraServerIssue: (_t: TokenWithInfo, baseUrl: string, key: string) => {
						calls.push(`getJiraServerIssue ${key}`);
						return Promise.resolve({
							id: `i-${key}`,
							number: key,
							title: key,
							url: `${baseUrl}/browse/${key}`,
							createdDate: new Date(0),
							updatedDate: new Date(0),
							closedDate: null,
							author: null,
							assignees: [],
							labels: [],
						});
					},
				});
			assert.equal(jira.supportsIssueEtagsByResourceId, false);
			const read = (etag?: string) =>
				manager.getIssuesBatch({
					providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
					domain: host,
					targets: [{ key: 'k', resourceId: host, identifier: 'PROJ-1', ...(etag ? { etag: etag } : {}) }],
				});

			const first = await read();
			const second = await read(first.items[0].etag);

			assert.deepEqual(calls, ['getJiraServerIssue PROJ-1', 'getJiraServerIssue PROJ-1']);
			assert.equal(second.items[0].unchanged, undefined);
			assert.equal(second.items[0].issue?.id, 'PROJ-1');
			assert.equal(second.items[0].etag, first.items[0].etag);

			manager.dispose();
		});
	});
});
