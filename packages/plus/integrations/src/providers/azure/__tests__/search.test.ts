import * as assert from 'node:assert/strict';
import type { AzureWorkItemTypeStates } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderPullRequest } from '../../models.js';
import {
	compareAzurePullRequestSearchPositions,
	isAzureWorkItemSearchFirstPage,
	parseAzurePullRequestSearchCursor,
	parseAzureWorkItemSearchCursor,
	toAzurePullRequestSearchCursorKey,
	toAzurePullRequestSearchFilter,
	toAzureSearchPageSize,
	toAzureWorkItemSearchCursorKey,
	toAzureWorkItemSearchWiql,
} from '../search.js';

/** Only the fields the filter reads; the rest of a provider pull request is irrelevant to it. */
function pr(overrides: Partial<ProviderPullRequest>): ProviderPullRequest {
	const fields: Partial<ProviderPullRequest> = {
		title: 'Title',
		description: null,
		isDraft: false,
		createdDate: new Date('2026-01-10T00:00:00Z'),
		updatedDate: new Date('2026-01-10T00:00:00Z'),
		...overrides,
	};
	return fields as ProviderPullRequest;
}

const workflows: ReadonlyMap<string, AzureWorkItemTypeStates> = new Map([
	[
		'Project',
		{
			types: [
				{
					name: 'Task',
					states: [
						{ name: 'New', category: 'Proposed' },
						{ name: 'Removed', category: 'InProgress' },
						{ name: 'Resolved', category: 'Resolved' },
						{ name: 'Done', category: 'Completed' },
						{ name: 'Descartado', category: 'Removed' },
					],
				},
			],
		},
	],
]);

suite('Azure work item search WIQL', () => {
	test('defaults to open work items in the whole collection, ordered by last change with a total tiebreaker', () => {
		assert.equal(
			toAzureWorkItemSearchWiql(undefined, 'updated:desc', undefined, workflows),
			"SELECT [System.Id] FROM WorkItems WHERE (([System.TeamProject] = 'Project' AND [System.WorkItemType] = 'Task' AND [System.State] IN ('New', 'Removed'))) ORDER BY [System.ChangedDate] Desc, [System.Id] Desc",
		);
	});

	test('ORs relationships in one group, so a work item matching two is one row', () => {
		const wiql = toAzureWorkItemSearchWiql(
			{ relationships: ['authored', 'assigned', 'authored'] },
			'created:asc',
			undefined,
			workflows,
		);
		assert.match(wiql, /AND \(\[System\.CreatedBy\] = @Me OR \[System\.AssignedTo\] = @Me\) ORDER BY/);
		assert.match(wiql, /ORDER BY \[System\.CreatedDate\] Asc, \[System\.Id\] Desc$/);
	});

	test('bounds the collection query by project names and escapes every literal', () => {
		const wiql = toAzureWorkItemSearchWiql(
			{
				state: 'all',
				text: " it's broken ",
				labels: ["O'Brien", 'Web'],
				updatedAfter: '2026-02-01',
				createdAfter: '2026-01-15',
			},
			'title:asc',
			["Payments & Billing's", 'Web API'],
		);
		assert.equal(
			wiql,
			"SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] IN ('Payments & Billing''s', 'Web API') AND [System.Title] Contains 'it''s broken' AND [System.Tags] Contains 'O''Brien' AND [System.Tags] Contains 'Web' AND [System.ChangedDate] >= '2026-02-01T00:00:00Z' AND [System.CreatedDate] >= '2026-01-15T00:00:00Z' ORDER BY [System.Title] Asc, [System.Id] Desc",
		);
	});

	test('selects all terminal categories, including Removed without requiring a terminal date', () => {
		assert.match(
			toAzureWorkItemSearchWiql(
				{ state: 'closed', relationships: ['unassigned'] },
				'updated:desc',
				undefined,
				workflows,
			),
			/WHERE \(\(\[System\.TeamProject\] = 'Project' AND \[System\.WorkItemType\] = 'Task' AND \[System\.State\] IN \('Resolved', 'Done', 'Descartado'\)\)\) AND \(\[System\.AssignedTo\] = ''\)/,
		);
	});

	test('refuses a relationship, sort or date it cannot express rather than widening the query', () => {
		assert.throws(() =>
			toAzureWorkItemSearchWiql({ relationships: ['mentioned'] }, 'updated:desc', undefined, workflows),
		);
		assert.throws(() => toAzureWorkItemSearchWiql(undefined, 'priority:desc', undefined, workflows));
		for (const date of ['2026-02-30', '02/01/2026', "2026-01-01' OR 1=1 OR '"]) {
			assert.throws(
				() => toAzureWorkItemSearchWiql({ updatedAfter: date }, 'updated:desc', undefined, workflows),
				date,
			);
		}
	});

	test('selects nothing when no workflow states match, and refuses missing or incomplete metadata', () => {
		assert.match(
			toAzureWorkItemSearchWiql(undefined, 'updated:desc', undefined, new Map()),
			/WHERE \[System.Id\] = 0 ORDER BY/,
		);
		assert.throws(() => toAzureWorkItemSearchWiql(undefined, 'updated:desc', undefined));
		for (const workflow of [
			{ types: [{ name: 'Task' }] },
			{ types: [], metadata: { completeness: 'partial' as const } },
			{ types: [{ name: 'Task', states: [{ name: 'Mystery', category: 'Unknown' }] }] },
		]) {
			assert.throws(() =>
				toAzureWorkItemSearchWiql(undefined, 'updated:desc', undefined, new Map([['Project', workflow]])),
			);
		}
	});

	test('keeps state names scoped to their project and type, escaping metadata literals', () => {
		const scoped = new Map([
			["A's", { types: [{ name: "Bug's", states: [{ name: "Can't do", category: 'Removed' }] }] }],
			['B', { types: [{ name: 'Task', states: [{ name: "Can't do", category: 'InProgress' }] }] }],
		]);
		const wiql = toAzureWorkItemSearchWiql({ state: 'closed' }, 'updated:desc', undefined, scoped);
		assert.match(
			wiql,
			/\[System.TeamProject\] = 'A''s' AND \[System.WorkItemType\] = 'Bug''s' AND \[System.State\] IN \('Can''t do'\)/,
		);
		assert.doesNotMatch(wiql, /TeamProject\] = 'B'/);
		assert.doesNotMatch(wiql, /ClosedDate|ResolvedDate/);
	});

	test('binds a cursor to its query and refuses a foreign or malformed one', () => {
		const wiql = toAzureWorkItemSearchWiql(undefined, 'updated:desc', undefined, workflows);
		const key = toAzureWorkItemSearchCursorKey('Collection', wiql);
		assert.notEqual(key, toAzureWorkItemSearchCursorKey('Other', wiql));
		assert.deepEqual(
			parseAzureWorkItemSearchCursor(JSON.stringify({ key: key, snapshot: 's', offset: 100, page: 2 }), key, 100),
			{ key: key, snapshot: 's', offset: 100, page: 2 },
		);
		assert.equal(parseAzureWorkItemSearchCursor(undefined, key, 100), undefined);
		for (const cursor of [
			'{',
			JSON.stringify({ key: 'other', snapshot: 's', offset: 1, page: 2 }),
			JSON.stringify({ key: key }),
			JSON.stringify({ key: key, offset: 1, page: 2 }),
			JSON.stringify({ key: key, snapshot: 's', offset: -1, page: 2 }),
		]) {
			assert.throws(() => parseAzureWorkItemSearchCursor(cursor, key, 100), cursor);
		}
	});

	test('honors the facade page marker as a position with no snapshot, page 1 being no cursor', () => {
		const key = toAzureWorkItemSearchCursorKey('Collection', 'wiql');
		assert.equal(parseAzureWorkItemSearchCursor(JSON.stringify({ value: 1, type: 'page' }), key, 50), undefined);
		assert.equal(isAzureWorkItemSearchFirstPage(undefined), true);
		assert.equal(isAzureWorkItemSearchFirstPage(JSON.stringify({ value: 1, type: 'page' })), true);
		assert.equal(isAzureWorkItemSearchFirstPage(JSON.stringify({ value: 2, type: 'page' })), false);
		assert.equal(
			isAzureWorkItemSearchFirstPage(JSON.stringify({ key: key, snapshot: 's', offset: 1, page: 2 })),
			false,
		);
		assert.deepEqual(parseAzureWorkItemSearchCursor(JSON.stringify({ value: 3, type: 'page' }), key, 50), {
			key: key,
			offset: 100,
			page: 3,
		});
	});
});

suite('Azure search page size', () => {
	test('clamps a finite size and takes the default for anything else', () => {
		assert.equal(toAzureSearchPageSize(undefined, 50, 100), 50);
		assert.equal(toAzureSearchPageSize(20.7, 50, 100), 20);
		assert.equal(toAzureSearchPageSize(0, 50, 100), 1);
		assert.equal(toAzureSearchPageSize(500, 50, 100), 100);
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			assert.equal(toAzureSearchPageSize(value, 50, 100), 50, String(value));
		}
	});
});

suite('Azure pull request search filter', () => {
	test('matches text in the title or description, case-insensitively', () => {
		const matches = toAzurePullRequestSearchFilter({ text: '  Login ' });
		assert.equal(matches(pr({ title: 'Fix LOGIN flow' })), true);
		assert.equal(matches(pr({ description: 'touches the login page' })), true);
		assert.equal(matches(pr({ title: 'Unrelated' })), false);
	});

	test('treats draft false as its own request', () => {
		assert.equal(toAzurePullRequestSearchFilter({ draft: false })(pr({ isDraft: true })), false);
		assert.equal(toAzurePullRequestSearchFilter({ draft: true })(pr({ isDraft: true })), true);
		assert.equal(toAzurePullRequestSearchFilter(undefined)(pr({ isDraft: true })), true);
	});

	test('applies both dates from UTC midnight inclusive', () => {
		const matches = toAzurePullRequestSearchFilter({ createdAfter: '2026-01-10', updatedAfter: '2026-01-11' });
		assert.equal(matches(pr({ updatedDate: new Date('2026-01-11T00:00:00Z') })), true);
		assert.equal(matches(pr({ updatedDate: new Date('2026-01-10T23:59:59Z') })), false);
		assert.equal(
			matches(pr({ createdDate: new Date('2026-01-09T23:59:59Z'), updatedDate: new Date('2026-02-01Z') })),
			false,
		);
	});

	test('orders totally, breaking date ties by identity in both directions', () => {
		const a = { time: 1, identity: 'a' };
		const b = { time: 1, identity: 'b' };
		const c = { time: 2, identity: 'a' };
		assert.deepEqual(
			[c, b, a].sort((x, y) => compareAzurePullRequestSearchPositions(x, y, 'updated:asc')),
			[a, b, c],
		);
		assert.deepEqual(
			[a, b, c].sort((x, y) => compareAzurePullRequestSearchPositions(x, y, 'created:desc')),
			[c, a, b],
		);
	});

	test('fingerprints queries with a 64-bit hash', () => {
		assert.match(toAzurePullRequestSearchCursorKey({ org: 'Collection' }), /^[0-9a-f]{16}$/);
		assert.match(toAzureWorkItemSearchCursorKey('Collection', 'wiql'), /^[0-9a-f]{16}$/);
	});

	test('binds a keyset cursor to its query and drain', () => {
		const key = toAzurePullRequestSearchCursorKey({ org: 'Collection', sort: 'updated:desc' });
		assert.notEqual(key, toAzurePullRequestSearchCursorKey({ org: 'Collection', sort: 'created:desc' }));
		const after = { time: 5, identity: 'repository:1:pull-request:2' };
		assert.deepEqual(
			parseAzurePullRequestSearchCursor(JSON.stringify({ key: key, drain: 'd', page: 3, after: after }), key),
			{ key: key, drain: 'd', page: 3, after: after },
		);
		for (const cursor of [
			{ key: 'other', drain: 'd', page: 3, after: after },
			{ key: key, page: 3, after: after },
			{ key: key, drain: 'd', page: 3 },
		]) {
			assert.throws(() => parseAzurePullRequestSearchCursor(JSON.stringify(cursor), key), JSON.stringify(cursor));
		}
	});
});
