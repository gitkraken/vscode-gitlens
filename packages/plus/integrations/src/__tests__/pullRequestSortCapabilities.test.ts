import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { gitHubPullRequestSortQualifiers } from '@gitlens/git-github/api/pullRequestSearchQuery.js';
import { getPullRequestComparator } from '@gitlens/git/utils/pullRequest.utils.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { withManager } from './issueSortHelpers.js';

/**
 * What the filtered PR search DECLARES it can order by, and whether that agrees with the emitter that has to honour
 * it and the comparator that has to re-order the merged page.
 *
 * Kept apart from the read behaviour because these assert no read at all: they compare a capability table against
 * the GitHub translation table and against `getPullRequestComparator`, across a package boundary. Importing
 * `gitHubPullRequestSortQualifiers` from the git-github package here is deliberate — a parity test is the one place
 * the two tables should meet.
 */
suite('pull-request sort capabilities', () => {
	// The capability table is a PROMISE: every key it declares reaches the provider query. GitHub is the one provider
	// whose translation table lives in this repo, so a key declared here that the emitter can't translate would emit
	// a search with no ordering constraint — the failure the ordering contract exists to prevent. Pinned as a set so
	// the capability can't outrun the emitter, nor the emitter list a key the surface won't accept.
	test('every GitHub key declared has a qualifier, and every qualifier is declared', async () => {
		await withManager(manager => {
			const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).pullRequestSearch.sorts;
			assert.deepEqual(
				[...declared].sort(),
				Object.keys(gitHubPullRequestSortQualifiers).sort(),
				'the capability table and the translation table are the same set',
			);
		});
	});

	// The merged relationship × state facets are re-ordered in the facade, so every declared key must be derivable
	// from a `PullRequestShape` — a key with no comparator would leave the union sorted by nothing, an arbitrary
	// subset presented as ordered.
	test('every declared key has a comparator that can order the merged page', async () => {
		await withManager(manager => {
			const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).pullRequestSearch.sorts;
			assert.ok(declared.length > 0, 'GitHub declares a filtered PR search that can be ordered');
			for (const sort of declared) {
				assert.notEqual(
					getPullRequestComparator(sort),
					undefined,
					`'${sort}' is declared but not orderable across a merge`,
				);
			}
		});
	});

	// A usable search must be able to serve the facade's own default, or an unordered request would refuse a read
	// that works today.
	test('the declared table can express the default order', async () => {
		await withManager(manager => {
			const declared = manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub).pullRequestSearch.sorts;
			assert.equal(declared.includes('updated:desc'), true);
		});
	});
});
