import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderScopeFailure } from '../../collectionMetadata.js';
import { IssueFilter } from '../../providerFilters.js';
import type { JiraIssuePage } from '../models.js';
import type { JiraDrainOptions, JiraIssuePageFetcher } from '../utils/jiraIssueDrains.js';
import {
	drainJiraIssues,
	parseSkippedJiraIssues,
	readUserScopedJiraIssues,
	searchJiraProjectIssues,
	summarizePageMetadata,
} from '../utils/jiraIssueDrains.js';
import { createProviderIssue, jiraIntegration } from './fixtures.js';

/**
 * Pins that a Jira search page's SDK metadata survives the drains (gitkraken/vscode-gitlens#5992). provider-apis
 * drops an issue it can't normalize and reports it as a `partial` page with a `provider` failure (GKDEV-3652); the
 * drains used to keep only `data`, so the issue vanished with no warning.
 */

const options: JiraDrainOptions = {
	maxPages: 3,
	failureScope: { providerId: 'jira', resourceId: 'site-1', projectId: 'PROJ' },
	providerName: 'Jira',
};

/** A fresh object per page: the facade marks failures in place, so a page must not share one with another. */
function dropped(keys: string): CollectionMetadata {
	return {
		completeness: 'partial',
		failures: [
			{
				scope: { providerId: 'jira', resourceId: 'site-1' },
				kind: 'provider',
				message: `Skipped Jira issues that could not be read: ${keys}.`,
			},
		],
	};
}

function issue(key: string, projectId = 'p1') {
	return createProviderIssue({
		id: `id-${key}`,
		number: key,
		project: { id: projectId, name: projectId, resourceId: 'site-1', namespace: null },
	} as Parameters<typeof createProviderIssue>[0]);
}

function pages(...results: (JiraIssuePage | Error)[]): { fetchPage: JiraIssuePageFetcher; cursors: unknown[] } {
	const cursors: unknown[] = [];
	return {
		cursors: cursors,
		fetchPage: (_scope, cursor) => {
			cursors.push(cursor);
			const result = results[cursors.length - 1];
			return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
		},
	};
}

suite('drainJiraIssues page metadata', () => {
	test('keeps the siblings of a dropped issue and reports the drop under the drain scope', async () => {
		const { fetchPage } = pages({
			data: [issue('P-1'), issue('P-3')],
			hasMore: false,
			nextCursor: undefined,
			metadata: dropped('P-2 (boom)'),
		});

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.deepEqual(
			drain.issues.map(i => i.number),
			['P-1', 'P-3'],
		);
		assert.equal(drain.status, 'incomplete');
		assert.deepEqual(drain.metadata, {
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'site-1', projectId: 'PROJ' },
					kind: 'provider',
					message: 'Skipped Jira issues that could not be read: P-2 (boom).',
					unreadableItems: { keys: ['P-2'], complete: true },
				},
			],
		});
	});

	test('keeps draining past a page that dropped issues', async () => {
		const { fetchPage, cursors } = pages(
			{ data: [issue('P-1')], hasMore: true, nextCursor: 'c1', metadata: dropped('P-2 (boom)') },
			{ data: [issue('P-3')], hasMore: false, nextCursor: undefined },
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.deepEqual(cursors, [undefined, 'c1']);
		assert.deepEqual(
			drain.issues.map(i => i.number),
			['P-1', 'P-3'],
		);
		assert.equal(drain.status, 'incomplete');
		assert.equal(drain.metadata?.failures?.length, 1);
	});

	test('reports a run of pages that dropped issues once, not once per page', async () => {
		// GKDEV-3653: every page of the project unreadable comes back empty and partial, each naming its own keys.
		const { fetchPage } = pages(
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped('P-1 (boom)') },
			{ data: [], hasMore: true, nextCursor: 'c2', metadata: dropped('P-2 (boom)') },
			{ data: [issue('P-3')], hasMore: false, nextCursor: undefined, metadata: dropped('P-4 (boom)') },
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.deepEqual(
			drain.issues.map(i => i.number),
			['P-3'],
		);
		assert.deepEqual(
			drain.metadata?.failures?.map(f => [f.scope, f.message]),
			[
				[
					{ providerId: 'jira', resourceId: 'site-1', projectId: 'PROJ' },
					'Skipped Jira issues that could not be read: P-1 (boom). Issues on 2 more pages could not be read either.',
				],
			],
		);
	});

	test('serves a clean drain without metadata', async () => {
		const { fetchPage } = pages(
			{ data: [issue('P-1')], hasMore: true, nextCursor: 'c1' },
			{ data: [issue('P-2')], hasMore: false, nextCursor: undefined },
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.equal(drain.status, 'complete');
		assert.equal(drain.metadata, undefined);
	});

	test('a page that reported complete metadata leaves the drain complete', async () => {
		const { fetchPage } = pages({
			data: [issue('P-1')],
			hasMore: false,
			nextCursor: undefined,
			metadata: { completeness: 'complete' },
		});

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.equal(drain.status, 'complete');
		assert.equal(drain.metadata, undefined);
	});

	test('keeps the failure of an all-unreadable page when the next page throws', async () => {
		// GKDEV-3653's shape: a page whose every issue was unreadable comes back empty but partial, cursor kept.
		const { fetchPage } = pages(
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped('P-1 (boom), P-2 (boom)') },
			new Error('socket hang up'),
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.deepEqual(drain.issues, []);
		assert.equal(drain.status, 'incomplete');
		assert.deepEqual(
			drain.metadata?.failures?.map(f => f.message),
			['Skipped Jira issues that could not be read: P-1 (boom), P-2 (boom).', 'socket hang up'],
		);
	});

	test('an all-unreadable page is not served as an empty project by a later empty-failure', async () => {
		const { fetchPage } = pages(
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped('P-1 (boom)') },
			new Error('project gone'),
		);
		let emptyFailures = 0;

		const drain = await drainJiraIssues(
			fetchPage,
			{},
			{
				...options,
				isEmptyFailure: () => {
					emptyFailures++;
					return true;
				},
			},
		);

		assert.equal(emptyFailures, 1, 'the empty-failure hook still runs, so its stale caches are dropped');
		assert.equal(drain.status, 'incomplete');
		assert.deepEqual(
			drain.metadata?.failures?.map(f => f.message),
			['Skipped Jira issues that could not be read: P-1 (boom).'],
			'the gone project is not reported as a failure of its own',
		);
	});

	test('still throws a first-page failure', async () => {
		const { fetchPage } = pages(new Error('401'));

		await assert.rejects(drainJiraIssues(fetchPage, {}, options), /401/);
	});

	test('a dropped issue on the last allowed page is incomplete, not a backstop a narrower scope would fix', async () => {
		const { fetchPage } = pages(
			{ data: [issue('P-1')], hasMore: true, nextCursor: 'c1' },
			{ data: [issue('P-2')], hasMore: true, nextCursor: 'c2' },
			{ data: [issue('P-3')], hasMore: true, nextCursor: 'c3', metadata: dropped('P-4 (boom)') },
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.equal(drain.issues.length, 3);
		assert.equal(drain.status, 'incomplete');
		assert.deepEqual(
			drain.metadata?.failures?.map(f => f.message),
			['Skipped Jira issues that could not be read: P-4 (boom).'],
		);
		assert.deepEqual(
			drain.metadata?.omissions,
			[{ kind: 'pagination-incomplete', scope: options.failureScope }],
			'the pages past the backstop are reported too, not only the dropped issue',
		);
	});

	test('the backstop still reports backstop on clean pages', async () => {
		const { fetchPage } = pages(
			{ data: [issue('P-1')], hasMore: true, nextCursor: 'c1' },
			{ data: [issue('P-2')], hasMore: true, nextCursor: 'c2' },
			{ data: [issue('P-3')], hasMore: true, nextCursor: 'c3' },
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.equal(drain.status, 'backstop');
		assert.equal(drain.metadata, undefined);
	});
});

suite('summarizePageMetadata', () => {
	test('reports the pages of one scope that dropped issues as one failure, naming the first page', () => {
		const summary = summarizePageMetadata([dropped('P-1 (boom)'), dropped('P-2 (boom)'), dropped('P-3 (boom)')]);

		assert.deepEqual(summary, {
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'site-1' },
					kind: 'provider',
					message:
						'Skipped Jira issues that could not be read: P-1 (boom). Issues on 2 more pages could not be read either.',
					unreadableItems: { keys: ['P-1', 'P-2', 'P-3'], complete: true },
				},
			],
		});
	});

	test("names every page's keys, complete only when every page named all of its own", () => {
		const summary = summarizePageMetadata([dropped('P-1 (boom), P-2 (boom)'), dropped('P-3 (boom) and 4 more')]);

		assert.deepEqual(
			summary?.failures?.map(f => (f as ProviderScopeFailure).unreadableItems),
			[{ keys: ['P-1', 'P-2', 'P-3'], complete: false }],
		);
	});

	test('keeps a single page and separate scopes as they are', () => {
		const other: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ scope: { providerId: 'jira', resourceId: 'site-2' }, kind: 'provider', message: 'Other.' }],
		};

		assert.deepEqual(summarizePageMetadata([dropped('P-1 (boom)')]), {
			completeness: 'partial',
			failures: [{ ...dropped('P-1 (boom)').failures![0], unreadableItems: { keys: ['P-1'], complete: true } }],
		});
		// A page failure that names no dropped issues is not passed off as one, nor grouped with one of the same scope.
		const sameScope: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ scope: { providerId: 'jira', resourceId: 'site-1' }, kind: 'provider', message: 'Other.' }],
		};
		assert.deepEqual(
			summarizePageMetadata([dropped('P-1 (boom)'), sameScope])?.failures?.map(f => [
				f.message,
				(f as ProviderScopeFailure).unreadableItems,
			]),
			[
				['Skipped Jira issues that could not be read: P-1 (boom).', { keys: ['P-1'], complete: true }],
				['Other.', undefined],
			],
		);
		assert.deepEqual(
			summarizePageMetadata([dropped('P-1 (boom)'), other])?.failures?.map(f => [
				f.message,
				(f as ProviderScopeFailure).unreadableItems,
			]),
			[
				['Skipped Jira issues that could not be read: P-1 (boom).', { keys: ['P-1'], complete: true }],
				['Other.', undefined],
			],
		);
		assert.equal(summarizePageMetadata([]), undefined);
		assert.deepEqual(summarizePageMetadata([{ completeness: 'partial' }]), { completeness: 'partial' });
	});
});

suite('readUserScopedJiraIssues page metadata', () => {
	test('a relationship whose page dropped an issue makes the read truncated and keeps the failure', async () => {
		const fetchPage: JiraIssuePageFetcher = scope =>
			Promise.resolve(
				scope.authorLogin != null
					? { data: [issue('P-1')], hasMore: false, nextCursor: undefined, metadata: dropped('P-9 (boom)') }
					: { data: [issue('P-2')], hasMore: false, nextCursor: undefined },
			);

		const read = await readUserScopedJiraIssues(
			fetchPage,
			[IssueFilter.Author, IssueFilter.Assignee],
			{ userField: 'acct-1', mention: 'Me' },
			options,
		);

		assert.deepEqual(read.issues.map(i => i.number).sort(), ['P-1', 'P-2']);
		assert.equal(read.truncated, true);
		assert.equal(read.metadata?.completeness, 'partial');
		assert.deepEqual(
			read.metadata?.failures?.map(f => f.message),
			['Skipped Jira issues that could not be read: P-9 (boom).'],
		);
	});
});

suite('searchJiraProjectIssues page metadata', () => {
	const identities = { userField: 'acct-1', mention: 'Me' };

	test('splits a clean search back by project', async () => {
		const fetchPage: JiraIssuePageFetcher = () =>
			Promise.resolve({ data: [issue('A-1', 'p1'), issue('B-1', 'p2')], hasMore: false, nextCursor: undefined });

		const split = await searchJiraProjectIssues(
			fetchPage,
			['p1', 'p2'],
			undefined,
			identities,
			options,
			jiraIntegration,
		);

		assert.deepEqual(
			split?.map(issues => issues.map(i => i.id)),
			[['A-1'], ['B-1']],
		);
	});

	test('declines a search whose page dropped an issue, so its projects are read one by one', async () => {
		// The dropped issue belongs to one of the projects, but the search can't say which.
		const fetchPage: JiraIssuePageFetcher = () =>
			Promise.resolve({
				data: [issue('A-1', 'p1'), issue('B-1', 'p2')],
				hasMore: false,
				nextCursor: undefined,
				metadata: dropped('A-2 (boom)'),
			});

		const split = await searchJiraProjectIssues(
			fetchPage,
			['p1', 'p2'],
			undefined,
			identities,
			options,
			jiraIntegration,
		);

		assert.equal(split, undefined);
	});
});

suite('parseSkippedJiraIssues', () => {
	const prefix = 'Skipped Jira issues that could not be read: ';
	const cases: [string, string | undefined, { keys: string[]; complete: boolean } | undefined][] = [
		['one key', `${prefix}P-1 (boom).`, { keys: ['P-1'], complete: true }],
		[
			'reasons holding parentheses and commas of their own',
			`${prefix}P-1 (Cannot read properties of null (reading 'assignee')), P-2 (a, b (c, d)).`,
			// `b (` inside a reason opens an entry as far as the list can tell: named too, which is harmless.
			{ keys: ['P-1', 'P-2', 'b'], complete: true },
		],
		['a list cut at ten', `${prefix}P-1 (boom), P-2 (boom) and 3 more.`, { keys: ['P-1', 'P-2'], complete: false }],
		['an issue named by its position', `${prefix}result 4 (boom), P-2 (boom).`, { keys: ['P-2'], complete: false }],
		['a repeated key', `${prefix}P-1 (boom), P-1 (bang).`, { keys: ['P-1'], complete: true }],
		['a key of a custom pattern', `${prefix}ab_1-22 (boom).`, { keys: ['ab_1-22'], complete: true }],
		// A reason can hold anything, its parentheses unbalanced included: each place an entry can open counts as one,
		// so a skipped issue is never lost inside an earlier reason, at worst a key that only a reason named is added.
		[
			'reasons whose parentheses do not balance',
			`${prefix}A-1 (Unexpected '(' in field), A-2 (bad value)).`,
			{ keys: ['A-1', 'A-2'], complete: true },
		],
		['a reason naming a key', `${prefix}P-1 (see, P-9 (x)).`, { keys: ['P-1', 'P-9'], complete: true }],
		['no entry at the start', `${prefix}oops, P-2 (bang).`, { keys: ['P-2'], complete: false }],
		['a separator at the start', `${prefix}, P-1 (boom).`, { keys: ['P-1'], complete: false }],
		['an unnamed entry', `${prefix}P-1 (boom),  (bang).`, { keys: ['P-1'], complete: false }],
		// Accepted: another separator reads as part of a reason, as a reason can hold anything. The real-SDK read in
		// jiraServerSdkReads.test.ts is what catches provider-apis changing its form.
		['another separator', `${prefix}P-1 (boom); P-2 (bang).`, { keys: ['P-1'], complete: true }],
		['no final period', `${prefix}P-1 (boom)`, { keys: ['P-1'], complete: false }],
		['an empty list', `${prefix}.`, { keys: [], complete: false }],
		['a reason ending like the count', `${prefix}P-1 (boom and 2 more).`, { keys: ['P-1'], complete: true }],
		['another message', 'Request failed (500)', undefined],
		['no message', undefined, undefined],
	];
	for (const [name, message, expected] of cases) {
		test(name, () => {
			assert.deepEqual(parseSkippedJiraIssues(message), expected);
		});
	}
});

suite('readUserScopedJiraIssues cut beside a skipped issue (#6011)', () => {
	test('a relationship stopped at the backstop records its cut beside a sibling that skipped an issue', async () => {
		let page = 0;
		const fetchPage: JiraIssuePageFetcher = scope =>
			Promise.resolve(
				scope.assigneeLogins != null
					? { data: [issue(`P-${++page}`)], hasMore: true, nextCursor: `c${page}` }
					: { data: [], hasMore: false, nextCursor: undefined, metadata: dropped('P-9 (boom)') },
			);

		const read = await readUserScopedJiraIssues(
			fetchPage,
			[IssueFilter.Assignee, IssueFilter.Mention],
			{ userField: 'acct-1', mention: 'Me' },
			options,
		);

		assert.equal(read.truncated, true);
		assert.deepEqual(read.metadata?.omissions, [{ kind: 'pagination-incomplete', scope: options.failureScope }]);
		assert.deepEqual(
			read.metadata?.failures?.map(f => (f as ProviderScopeFailure).unreadableItems),
			[{ keys: ['P-9'], complete: true }],
		);
	});

	test('a relationship stopped at the backstop alone is reported as that cut, not as a failure', async () => {
		let page = 0;
		const fetchPage: JiraIssuePageFetcher = () =>
			Promise.resolve({ data: [issue(`P-${++page}`)], hasMore: true, nextCursor: `c${page}` });

		const read = await readUserScopedJiraIssues(
			fetchPage,
			[IssueFilter.Assignee],
			{ userField: 'acct-1', mention: 'Me' },
			options,
		);

		assert.equal(read.truncated, true);
		assert.deepEqual(read.metadata, {
			completeness: 'partial',
			omissions: [{ kind: 'pagination-incomplete', scope: options.failureScope }],
		});
	});

	test('a skip and a backstop in one drain stay apart: only the skip is unreadable', async () => {
		let page = 0;
		const fetchPage: JiraIssuePageFetcher = () =>
			Promise.resolve({
				data: [issue(`P-${++page}`)],
				hasMore: true,
				nextCursor: `c${page}`,
				...(page === 1 ? { metadata: dropped('P-9 (boom)') } : {}),
			});

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.equal(drain.status, 'incomplete');
		assert.deepEqual(
			drain.metadata?.failures?.map(f => [f.message, (f as ProviderScopeFailure).unreadableItems]),
			[['Skipped Jira issues that could not be read: P-9 (boom).', { keys: ['P-9'], complete: true }]],
		);
		assert.deepEqual(drain.metadata?.omissions, [{ kind: 'pagination-incomplete', scope: options.failureScope }]);
	});
});
