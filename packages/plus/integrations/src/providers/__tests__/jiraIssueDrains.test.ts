import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { IssueFilter } from '../../providerFilters.js';
import type { JiraIssuePage } from '../models.js';
import type { JiraDrainOptions, JiraIssuePageFetcher } from '../utils/jiraIssueDrains.js';
import {
	drainJiraIssues,
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

/** How many skipped issues provider-apis' message names before it counts the rest (`MAX_SKIPPED_ISSUES_NAMED`). */
const maxNamed = 10;

/**
 * What provider-apis reports for a page that dropped issues it could not read: a message naming at most ten of them
 * and counting the rest, and `skippedItems` holding every key. `keyless` skips are named by position and have no key.
 * A fresh object per page: the facade marks failures in place, so a page must not share one with another.
 */
function dropped(keys: string[], keyless = 0): CollectionMetadata {
	const entries = [
		...keys.map(key => `${key} (boom)`),
		...Array.from({ length: keyless }, (_, i) => `result ${i + 1} (boom)`),
	];
	const more = entries.length - maxNamed;
	return {
		completeness: 'partial',
		failures: [
			{
				scope: { providerId: 'jira', resourceId: 'site-1' },
				kind: 'provider',
				message: `Skipped Jira issues that could not be read: ${entries.slice(0, maxNamed).join(', ')}${more > 0 ? ` and ${more} more` : ''}.`,
				skippedItems: { keys: keys, total: entries.length, complete: keyless === 0 },
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
			metadata: dropped(['P-2']),
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
					skippedItems: { keys: ['P-2'], total: 1, complete: true },
				},
			],
		});
	});

	test('keeps draining past a page that dropped issues', async () => {
		const { fetchPage, cursors } = pages(
			{ data: [issue('P-1')], hasMore: true, nextCursor: 'c1', metadata: dropped(['P-2']) },
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
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped(['P-1']) },
			{ data: [], hasMore: true, nextCursor: 'c2', metadata: dropped(['P-2']) },
			{ data: [issue('P-3')], hasMore: false, nextCursor: undefined, metadata: dropped(['P-4']) },
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
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped(['P-1', 'P-2']) },
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
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped(['P-1']) },
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
			{ data: [issue('P-3')], hasMore: true, nextCursor: 'c3', metadata: dropped(['P-4']) },
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

const skippedOf = (summary: CollectionMetadata | undefined) => summary?.failures?.map(failure => failure.skippedItems);

suite('summarizePageMetadata', () => {
	test('reports the pages of one scope that dropped issues as one failure, naming the first page', () => {
		const summary = summarizePageMetadata([dropped(['P-1']), dropped(['P-2']), dropped(['P-3'])]);

		assert.deepEqual(summary, {
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'site-1' },
					kind: 'provider',
					message:
						'Skipped Jira issues that could not be read: P-1 (boom). Issues on 2 more pages could not be read either.',
					skippedItems: { keys: ['P-1', 'P-2', 'P-3'], total: 3, complete: true },
				},
			],
		});
	});

	test("names every page's keys in order, complete only when every page named all of its own", () => {
		const summary = summarizePageMetadata([dropped(['P-1', 'P-2']), dropped([], 1), dropped(['P-2', 'P-3'])]);

		assert.deepEqual(skippedOf(summary), [{ keys: ['P-1', 'P-2', 'P-3'], total: 5, complete: false }]);
	});

	test('names every key of a page that skipped more than ten, past the ten its message names', () => {
		const keys = Array.from({ length: 25 }, (_, i) => `P-${i + 1}`);
		const page = dropped(keys);

		assert.match(
			page.failures![0].message!,
			/P-10 \(boom\) and 15 more\.$/,
			'the message is capped, as the SDK caps it',
		);
		assert.deepEqual(skippedOf(summarizePageMetadata([page])), [{ keys: keys, total: 25, complete: true }]);
	});

	test('reports a skip with no key as incomplete', () => {
		assert.deepEqual(skippedOf(summarizePageMetadata([dropped([], 1)])), [{ keys: [], total: 1, complete: false }]);
	});

	test('takes the keys from skippedItems, never from the message', () => {
		const summary = summarizePageMetadata([
			{
				completeness: 'partial',
				failures: [
					{
						scope: { providerId: 'jira', resourceId: 'site-1' },
						kind: 'provider',
						message: 'Skipped Jira issues that could not be read: P-1 (see, P-9 (x)).',
						skippedItems: { keys: ['P-1'], total: 1, complete: true },
					},
				],
			},
		]);

		assert.deepEqual(skippedOf(summary), [{ keys: ['P-1'], total: 1, complete: true }]);
	});

	test('does not take a provider failure without skippedItems for a skip, whatever its message says', () => {
		const summary = summarizePageMetadata([
			{
				completeness: 'partial',
				failures: [
					{
						scope: { providerId: 'jira', resourceId: 'site-1' },
						kind: 'provider',
						message: 'Skipped Jira issues that could not be read: P-1 (boom).',
					},
				],
			},
		]);

		assert.deepEqual(skippedOf(summary), [undefined]);
	});

	test('keeps a failure that reports skipped items apart from one that does not, whatever their messages', () => {
		const message = 'Skipped Jira issues that could not be read: P-1 (boom).';
		const unknown: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ scope: { providerId: 'jira', resourceId: 'site-1' }, kind: 'provider', message: message }],
		};

		const summary = summarizePageMetadata([dropped(['P-1']), unknown, dropped(['P-2'])]);

		assert.deepEqual(
			summary?.failures?.map(f => [f.message, f.skippedItems]),
			[
				[
					`${message} Issues on 1 more page could not be read either.`,
					{ keys: ['P-1', 'P-2'], total: 2, complete: true },
				],
				[message, undefined],
			],
		);
	});

	test('keeps a single page and separate scopes as they are', () => {
		const other: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ scope: { providerId: 'jira', resourceId: 'site-2' }, kind: 'provider', message: 'Other.' }],
		};

		assert.deepEqual(summarizePageMetadata([dropped(['P-1'])]), {
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'site-1' },
					kind: 'provider',
					message: 'Skipped Jira issues that could not be read: P-1 (boom).',
					skippedItems: { keys: ['P-1'], total: 1, complete: true },
				},
			],
		});
		// A page failure that names no dropped issues is not passed off as one, nor grouped with one of the same scope.
		const sameScope: CollectionMetadata = {
			completeness: 'partial',
			failures: [{ scope: { providerId: 'jira', resourceId: 'site-1' }, kind: 'provider', message: 'Other.' }],
		};
		assert.deepEqual(
			summarizePageMetadata([dropped(['P-1']), sameScope])?.failures?.map(f => [f.message, f.skippedItems]),
			[
				[
					'Skipped Jira issues that could not be read: P-1 (boom).',
					{ keys: ['P-1'], total: 1, complete: true },
				],
				['Other.', undefined],
			],
		);
		assert.deepEqual(
			summarizePageMetadata([dropped(['P-1']), other])?.failures?.map(f => [f.message, f.skippedItems]),
			[
				[
					'Skipped Jira issues that could not be read: P-1 (boom).',
					{ keys: ['P-1'], total: 1, complete: true },
				],
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
					? { data: [issue('P-1')], hasMore: false, nextCursor: undefined, metadata: dropped(['P-9']) }
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
				metadata: dropped(['A-2']),
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

suite('readUserScopedJiraIssues cut beside a skipped issue (#6011)', () => {
	test('a relationship stopped at the backstop records its cut beside a sibling that skipped an issue', async () => {
		let page = 0;
		const fetchPage: JiraIssuePageFetcher = scope =>
			Promise.resolve(
				scope.assigneeLogins != null
					? { data: [issue(`P-${++page}`)], hasMore: true, nextCursor: `c${page}` }
					: { data: [], hasMore: false, nextCursor: undefined, metadata: dropped(['P-9']) },
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
			read.metadata?.failures?.map(f => f.skippedItems),
			[{ keys: ['P-9'], total: 1, complete: true }],
		);
	});

	test('the same skip reported by every relationship is merged and counted once', async () => {
		// The assignee, author and mention searches overlap: the same unreadable P-9 comes back from each.
		const fetchPage: JiraIssuePageFetcher = () =>
			Promise.resolve({ data: [], hasMore: false, nextCursor: undefined, metadata: dropped(['P-9']) });

		const read = await readUserScopedJiraIssues(
			fetchPage,
			[IssueFilter.Assignee, IssueFilter.Author, IssueFilter.Mention],
			{ userField: 'acct-1', mention: 'Me' },
			options,
		);

		assert.deepEqual(
			read.metadata?.failures?.map(f => [f.message, f.skippedItems]),
			[['Skipped Jira issues that could not be read: P-9 (boom).', { keys: ['P-9'], total: 1, complete: true }]],
		);
	});

	test('relationships that split the same skipped issues over different pages merge into one failure', async () => {
		// The assignee search skips P-9 and P-10 on its first page; the author search skips P-9 on its first page and
		// P-10 on its second. The messages differ (and the second names more pages), the issues are the same.
		const fetchPage: JiraIssuePageFetcher = (scope, cursor) =>
			Promise.resolve(
				scope.assigneeLogins != null
					? { data: [], hasMore: false, nextCursor: undefined, metadata: dropped(['P-9', 'P-10']) }
					: cursor == null
						? { data: [], hasMore: true, nextCursor: 'c1', metadata: dropped(['P-9']) }
						: { data: [], hasMore: false, nextCursor: undefined, metadata: dropped(['P-10']) },
			);

		const read = await readUserScopedJiraIssues(
			fetchPage,
			[IssueFilter.Assignee, IssueFilter.Author],
			{ userField: 'acct-1', mention: 'Me' },
			options,
		);

		assert.deepEqual(
			read.metadata?.failures?.map(f => [f.message, f.skippedItems]),
			[
				[
					'Skipped Jira issues that could not be read: P-9 (boom), P-10 (boom).',
					{ keys: ['P-9', 'P-10'], total: 2, complete: true },
				],
			],
		);
	});

	test('the merged failure keeps the message that names more keys, whichever relationship comes first', async () => {
		// The author search skips only P-9; the assignee search skips P-9 and P-10: the text must cover both.
		const fetchPage: JiraIssuePageFetcher = scope =>
			Promise.resolve({
				data: [],
				hasMore: false,
				nextCursor: undefined,
				metadata: scope.assigneeLogins != null ? dropped(['P-9', 'P-10']) : dropped(['P-9']),
			});

		for (const filters of [
			[IssueFilter.Assignee, IssueFilter.Author],
			[IssueFilter.Author, IssueFilter.Assignee],
		]) {
			const read = await readUserScopedJiraIssues(
				fetchPage,
				filters,
				{ userField: 'acct-1', mention: 'Me' },
				options,
			);

			assert.deepEqual(
				read.metadata?.failures?.map(f => [f.message, f.skippedItems]),
				[
					[
						'Skipped Jira issues that could not be read: P-9 (boom), P-10 (boom).',
						{ keys: ['P-9', 'P-10'], total: 2, complete: true },
					],
				],
				filters.join(', '),
			);
		}
	});

	test('the branches of a relationship that report the same text with and without skippedItems stay apart', async () => {
		// The same message, so the failures dedupe by kind, scope and message alone: the one that doesn't say which
		// issues it skipped must survive beside the one that does, or the read would pass for fully accounted for.
		const unknown: CollectionMetadata = {
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'site-1' },
					kind: 'provider',
					message: 'Skipped Jira issues that could not be read: P-9 (boom).',
				},
			],
		};
		for (const [withKeys, without] of [
			[IssueFilter.Author, IssueFilter.Assignee],
			[IssueFilter.Assignee, IssueFilter.Author],
		] as const) {
			const fetchPage: JiraIssuePageFetcher = scope =>
				Promise.resolve({
					data: [],
					hasMore: false,
					nextCursor: undefined,
					metadata:
						(withKeys === IssueFilter.Author ? scope.authorLogin : scope.assigneeLogins) != null
							? dropped(['P-9'])
							: structuredClone(unknown),
				});

			const read = await readUserScopedJiraIssues(
				fetchPage,
				[withKeys, without],
				{ userField: 'acct-1', mention: 'Me' },
				options,
			);

			assert.deepEqual(
				read.metadata?.failures?.map(f => f.skippedItems).sort((a, b) => Number(a == null) - Number(b == null)),
				[{ keys: ['P-9'], total: 1, complete: true }, undefined],
				`${withKeys} reports its skip, ${without} says nothing of which issues`,
			);
		}
	});

	test('a drain whose pages report the same text with and without skippedItems keeps both', async () => {
		const unknown = (): CollectionMetadata => ({
			completeness: 'partial',
			failures: [
				{
					scope: { providerId: 'jira', resourceId: 'site-1' },
					kind: 'provider',
					message: 'Skipped Jira issues that could not be read: P-9 (boom).',
				},
			],
		});
		const { fetchPage } = pages(
			{ data: [], hasMore: true, nextCursor: 'c1', metadata: dropped(['P-9']) },
			{ data: [], hasMore: false, nextCursor: undefined, metadata: unknown() },
		);

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.deepEqual(
			drain.metadata?.failures?.map(f => f.skippedItems),
			[{ keys: ['P-9'], total: 1, complete: true }, undefined],
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
				...(page === 1 ? { metadata: dropped(['P-9']) } : {}),
			});

		const drain = await drainJiraIssues(fetchPage, {}, options);

		assert.equal(drain.status, 'incomplete');
		assert.deepEqual(
			drain.metadata?.failures?.map(f => [f.message, f.skippedItems]),
			[['Skipped Jira issues that could not be read: P-9 (boom).', { keys: ['P-9'], total: 1, complete: true }]],
		);
		assert.deepEqual(drain.metadata?.omissions, [{ kind: 'pagination-incomplete', scope: options.failureScope }]);
	});
});
