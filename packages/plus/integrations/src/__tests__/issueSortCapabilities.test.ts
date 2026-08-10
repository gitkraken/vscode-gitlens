import * as assert from 'node:assert/strict';
import { compareBy, getIssueComparator as sdkIssueComparator, SUPPORTED_ISSUE_SORTS } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { gitHubIssueSortQualifiers } from '@gitlens/git-github/api/issueSearchQuery.js';
import type { IssueShape, IssueSortField, IssueSorting } from '@gitlens/git/models/issue.js';
import { getIssueComparator } from '@gitlens/git/utils/issue.utils.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { providersMetadata } from '../providers/models.js';
import { issue, withManager } from './issueSortHelpers.js';

/**
 * What this facade DECLARES it can order by, and whether that agrees with the SDK that has to honour it.
 *
 * Apart from the read behaviour (`issueSortReads.test.ts`) because these assert no read at all: they compare two
 * tables and two comparators across a package boundary. When one of these fails the fix is a table or a rule, not
 * a read — and when a read test fails, none of these are suspects.
 */

suite('issue sort capabilities', () => {
	suite('the capability tables', () => {
		// The tables are a PROMISE: every key declared reaches the provider query. The SDK is what translates it, so
		// a key this side declares and that side can't translate doesn't produce a differently-ordered read — it
		// produces an `UnsupportedSortError` after the facade already told the consumer the key was fine. GitHub is
		// the one provider whose translation table lives in this repo, so it is the one this can pin directly.
		test('every GitHub key declared has a qualifier, and every qualifier is declared', async () => {
			await withManager(async manager => {
				const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSorts;
				assert.deepEqual(
					[...declared].sort(),
					Object.keys(gitHubIssueSortQualifiers).sort(),
					'the capability table and the translation table are the same set',
				);
				assert.deepEqual(
					[...manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSearch.sorts].sort(),
					[...declared].sort(),
					'all three GitHub issue surfaces run the same `search`, so all three order the same way',
				);
			});
		});

		// GitHub can order by created/updated/comments/reactions and nothing else. `closed` is the one worth naming:
		// `IssueShape.closedDate` exists, so declaring it looks harmless — but GitHub's search has no such sort, and
		// ordering a page already cut off at the result ceiling does not make it the top N by close date.
		test('GitHub declares no close-date ordering, whatever IssueShape carries', async () => {
			await withManager(async manager => {
				const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).issueSorts;
				assert.equal(declared.includes('closed:desc'), false);
				assert.equal(declared.includes('priority:desc'), false);
			});
		});

		// GitLab's two reads are different APIs, not one narrowed twice: GraphQL has `CLOSED_AT_*` and REST does
		// not, while REST orders by `priority`/`dueDate` that the account-wide merge then cannot honor. Declaring
		// either as the intersection would lose keys a read really has. Asserted in both directions off the SDK
		// so this keeps testing the asymmetry rather than whichever keys it happened to consist of.
		test('GitLab’s repo-scoped and account-wide vocabularies differ in both directions', async () => {
			await withManager(async manager => {
				const { issueSorts, issueSortsAccountWide } = manager.getSupportedFilters(
					GitCloudHostIntegrationId.GitLab,
				);
				assert.equal(issueSorts.includes('closed:asc'), true, 'GraphQL orders by close date');
				assert.equal(issueSortsAccountWide.includes('closed:asc'), false, 'REST has no closed_at');
				assert.equal(
					SUPPORTED_ISSUE_SORTS.gitlabAccountWide.includes('priority:asc'),
					true,
					'REST itself orders by priority',
				);
				assert.equal(
					issueSortsAccountWide.includes('priority:asc'),
					false,
					'but the merge cannot, so the surface must not declare it',
				);
			});
		});

		// Every account-wide read is a union of several queries — GitHub's three `@me` searches, GitLab's one call
		// per relationship, Azure's per-project drains — so it can only order by what a normalized issue carries.
		// Those keys are absent from the table rather than refused at runtime, which is what makes intersecting
		// against the table sufficient for that surface.
		//
		// Asserted with the runtime predicate itself, not a list of the three fields that happen to fail it today:
		// this test exists to catch a key the SDK adds later, and a blacklist can only catch the ones already known
		// to be a problem — which is the one case that needs no test.
		test('no account-wide table declares a key a merge could not honor', async () => {
			await withManager(async manager => {
				for (const providerId of [
					GitCloudHostIntegrationId.GitHub,
					GitCloudHostIntegrationId.GitLab,
					GitCloudHostIntegrationId.AzureDevOps,
				]) {
					for (const sort of manager.getSupportedFilters(providerId).issueSortsAccountWide) {
						assert.notEqual(
							getIssueComparator(sort),
							undefined,
							`'${sort}' is not orderable across a merge, so '${providerId}' must not declare it`,
						);
					}
				}
			});
		});

		// The SDK declares its own merge-filtered GitLab surface, computed from the same GraphQL map by the same
		// rule. Core applies the rule at read time instead (`mergesProviderQueries`), so the two must agree: if
		// they don't, one of the repos is wrong about which keys survive a client-side merge, and the symptom
		// would be core promising a key the SDK's aggregate rejects — the one drift a derived table can't catch,
		// because the aggregate is a surface core never reads from directly.
		test('core’s merge rule computes the same set the SDK’s own aggregate declares', () => {
			const mergeable = SUPPORTED_ISSUE_SORTS.gitlabRepository.filter(sort => getIssueComparator(sort) != null);

			assert.deepEqual([...mergeable].sort(), [...SUPPORTED_ISSUE_SORTS.gitlabAggregate].sort());
		});

		// Linear's two reads are one root `issues` query taking one `sort` argument, so they share a table and it
		// is NOT narrowed by the merge rule: the account-wide read is a single server-ordered query, so nothing
		// merges and `priority`/`dueDate` survive. Filtering it — the reflex, since the read is "my issues" —
		// would drop two keys the server really orders by. Asserted against the SDK rather than a literal so the
		// pin cannot outlive the surface it describes, which is exactly how the previous
		// descending-only assertion became false without failing.
		test('Linear declares one unnarrowed table for both of its reads', async () => {
			await withManager(async manager => {
				const declared = manager.getSupportedFilters(IssuesCloudHostIntegrationId.Linear).issueSorts;
				assert.deepEqual([...declared].sort(), [...SUPPORTED_ISSUE_SORTS.linear].sort());
				assert.equal(declared.includes('priority:desc'), true, 'the single query orders by priority');
				assert.equal(declared.includes('created:asc'), true, 'and in both directions');
			});
		});

		// A provider whose issue read can be ordered at all must be able to serve the facade's own default, or an
		// unordered request would refuse a read that works today.
		test('every declared table can express the default order', async () => {
			for (const [providerId, metadata] of Object.entries(providersMetadata)) {
				for (const [field, table] of [
					['supportedIssueSorts', metadata.supportedIssueSorts],
					['supportedAccountWideIssueSorts', metadata.supportedAccountWideIssueSorts],
				] as const) {
					if (table == null) continue;

					assert.equal(
						table.includes('updated:desc'),
						true,
						`${providerId}.${field} declares keys but not the default`,
					);
				}
			}
		});
	});
});

suite('IssueSorting', () => {
	test('is the cross product of its fields and its two directions', () => {
		const sorts: IssueSorting[] = ['created:asc', 'created:desc', 'dueDate:asc', 'title:desc'];
		for (const sort of sorts) {
			const [field, direction] = sort.split(':');
			assert.ok(field.length > 0);
			assert.ok(direction === 'asc' || direction === 'desc');
		}
	});
});

suite('the comparator this repo keeps a copy of', () => {
	/** The `IssueShape` properties the comparator reads, and the value types they hold. */
	type OrderableKey = 'createdDate' | 'updatedDate' | 'closedDate' | 'commentsCount' | 'thumbsUpCount' | 'title';
	type OrderableValue = number | Date | string;

	/**
	 * Which `IssueShape` property each sort field reads, and two ordered values for it.
	 *
	 * The property name is spelled out rather than derived, because it IS the thing that has to agree: this
	 * repo's field names are its own (`commentsCount`, `thumbsUpCount`) and the SDK's are different
	 * (`commentCount`, `upvoteCount`), so the shared part is the RULE, not the shape. Each row builds both
	 * comparators over the same property, which is what makes the comparison meaningful.
	 */
	const orderableFields: { field: IssueSortField; key: OrderableKey; low: OrderableValue; high: OrderableValue }[] = [
		{ field: 'created', key: 'createdDate', low: new Date('2020-01-01Z'), high: new Date('2020-06-01Z') },
		{ field: 'updated', key: 'updatedDate', low: new Date('2020-01-01Z'), high: new Date('2020-06-01Z') },
		{ field: 'closed', key: 'closedDate', low: new Date('2020-01-01Z'), high: new Date('2020-06-01Z') },
		{ field: 'comments', key: 'commentsCount', low: 1, high: 5 },
		{ field: 'reactions', key: 'thumbsUpCount', low: 1, high: 5 },
		{ field: 'title', key: 'title', low: 'a', high: 'b' },
	];

	/**
	 * An issue carrying one value on one property.
	 *
	 * `undefined` for the missing case rather than an absent key: that is the shape this repo produces, and the
	 * missing case is the half of the rule a naive sign flip gets wrong.
	 */
	function shaped(key: OrderableKey, value: OrderableValue | undefined): IssueShape {
		return { ...issue('x', {}), [key]: value };
	}

	for (const { field, key, low, high } of orderableFields) {
		for (const direction of ['asc', 'desc'] as const) {
			test(`orders ${field}:${direction} exactly as the SDK's shared rule does`, () => {
				const ours = getIssueComparator(`${field}:${direction}`);
				const theirs = compareBy<IssueShape>(item => item[key], direction);
				assert.ok(ours != null);

				// Every pairing that the rule decides differently: both present either way round, both equal, one
				// missing on each side, and both missing — which is the case that must compare EQUAL rather than
				// producing `NaN`, and the case a sign flip would move to the front when ascending.
				const pairs: [OrderableValue | undefined, OrderableValue | undefined][] = [
					[low, high],
					[high, low],
					[low, low],
					[undefined, high],
					[high, undefined],
					[undefined, undefined],
				];
				for (const [left, right] of pairs) {
					const a = shaped(key, left);
					const b = shaped(key, right);
					assert.equal(
						Math.sign(ours(a, b)),
						Math.sign(theirs(a, b)),
						`${field}:${direction} disagreed on (${String(left)}, ${String(right)})`,
					);
				}
			});
		}
	}

	// A field added to one comparator and not the other is the drift that matters most: this repo would accept a
	// merged read the SDK's own merges reject, or refuse one they honour. Comparing which keys yield a comparator
	// catches it without either side importing the other's issue shape.
	test('derives a comparator for exactly the keys the SDK does', () => {
		const fields: IssueSortField[] = [
			'created',
			'updated',
			'closed',
			'resolved',
			'comments',
			'reactions',
			'priority',
			'dueDate',
			'title',
		];

		for (const field of fields) {
			for (const direction of ['asc', 'desc'] as const) {
				const sort = `${field}:${direction}` satisfies IssueSorting;
				assert.equal(
					getIssueComparator(sort) != null,
					sdkIssueComparator(sort) != null,
					`'${sort}' is derivable on one side only`,
				);
			}
		}
	});
});
