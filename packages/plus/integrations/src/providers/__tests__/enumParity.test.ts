import * as assert from 'node:assert/strict';
import {
	EntityIdentifierProviderType as SdkEntityIdentifierProviderType,
	EntityType as SdkEntityType,
	EntityVersion as SdkEntityVersion,
	GitBuildStatusState as SdkGitBuildStatusState,
	GitIssueState as SdkGitIssueState,
	GitPullRequestMergeableState as SdkGitPullRequestMergeableState,
	GitPullRequestReviewState as SdkGitPullRequestReviewState,
	GitPullRequestState as SdkGitPullRequestState,
} from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import {
	GitPullRequestMergeableState as BitbucketServerGitPullRequestMergeableState,
	GitPullRequestReviewState as BitbucketServerGitPullRequestReviewState,
	GitPullRequestState as BitbucketServerGitPullRequestState,
} from '../bitbucket-server/models.js';
import {
	GitBuildStatusState,
	GitIssueState,
	GitPullRequestMergeableState,
	GitPullRequestReviewState,
	GitPullRequestState,
} from '../models.js';
import { EntityIdentifierProviderType, EntityType, EntityVersion } from '../utils.js';

// Guards the runtime enum copies that #5531 duplicated out of `@gitkraken/provider-apis` (to dodge the
// CJS-from-ESM named-export breakage) against silent upstream drift. The type-level aliases keep compiling
// even if a value changes (the const objects cast their literals, e.g. `'OPEN' as GitPullRequestState`), so
// only a runtime deep-equal against the real SDK enums can catch an added/renamed/changed value. The package
// test entrypoint at `scripts/test.mjs` bundles this suite through esbuild, which is why the SDK's CJS named
// exports are available here as runtime values.
//
// Two local copies are intentional subsets, not full mirrors, so they're asserted with
// `assertLocalMatchesSdk` (every local entry must match the SDK; extra SDK members are allowed) rather than
// a bidirectional deep-equal:
// - `utils.ts` `EntityVersion` — the package only ever writes version `1`.
// - `bitbucket-server/models.ts` `GitPullRequestMergeableState` — Bitbucket Server only normalizes to
//   `Unknown`.
type EnumLike = Record<string, string>;

function sortEntries(enumLike: EnumLike): [string, string][] {
	return Object.entries(enumLike).sort(([left], [right]) => left.localeCompare(right));
}

/** Bidirectional parity: the local copy must be a complete, exact mirror of the SDK enum. */
function assertFullMirror(local: EnumLike, sdk: EnumLike, name: string): void {
	assert.deepEqual(
		sortEntries(local),
		sortEntries(sdk),
		`${name} has drifted from @gitkraken/provider-apis (value added, renamed, or changed)`,
	);
}

/** Subset parity: every local entry must exist in the SDK with the same value; extra SDK members are allowed. */
function assertLocalMatchesSdk(local: EnumLike, sdk: EnumLike, name: string): void {
	for (const [key, value] of Object.entries(local)) {
		assert.ok(
			Object.hasOwn(sdk, key),
			`${name}.${key} is missing from @gitkraken/provider-apis (renamed or removed upstream)`,
		);
		assert.equal(sdk[key], value, `${name}.${key} value has drifted from @gitkraken/provider-apis`);
	}
}

suite('provider-apis enum parity (drift guard)', () => {
	suite('providers/models.ts', () => {
		test('GitBuildStatusState mirrors the SDK', () => {
			assertFullMirror(GitBuildStatusState, SdkGitBuildStatusState, 'GitBuildStatusState');
		});

		test('GitIssueState mirrors the SDK', () => {
			assertFullMirror(GitIssueState, SdkGitIssueState, 'GitIssueState');
		});

		test('GitPullRequestState mirrors the SDK', () => {
			assertFullMirror(GitPullRequestState, SdkGitPullRequestState, 'GitPullRequestState');
		});

		test('GitPullRequestReviewState mirrors the SDK', () => {
			assertFullMirror(GitPullRequestReviewState, SdkGitPullRequestReviewState, 'GitPullRequestReviewState');
		});

		test('GitPullRequestMergeableState mirrors the SDK', () => {
			assertFullMirror(
				GitPullRequestMergeableState,
				SdkGitPullRequestMergeableState,
				'GitPullRequestMergeableState',
			);
		});
	});

	suite('providers/utils.ts', () => {
		test('EntityIdentifierProviderType mirrors the SDK', () => {
			assertFullMirror(
				EntityIdentifierProviderType,
				SdkEntityIdentifierProviderType,
				'EntityIdentifierProviderType',
			);
		});

		test('EntityType mirrors the SDK', () => {
			assertFullMirror(EntityType, SdkEntityType, 'EntityType');
		});

		test('EntityVersion is a subset that matches the SDK', () => {
			assertLocalMatchesSdk(EntityVersion, SdkEntityVersion, 'EntityVersion');
		});
	});

	suite('providers/bitbucket-server/models.ts', () => {
		test('GitPullRequestState mirrors the SDK', () => {
			assertFullMirror(BitbucketServerGitPullRequestState, SdkGitPullRequestState, 'GitPullRequestState');
		});

		test('GitPullRequestReviewState mirrors the SDK', () => {
			assertFullMirror(
				BitbucketServerGitPullRequestReviewState,
				SdkGitPullRequestReviewState,
				'GitPullRequestReviewState',
			);
		});

		test('GitPullRequestMergeableState is a subset that matches the SDK', () => {
			assertLocalMatchesSdk(
				BitbucketServerGitPullRequestMergeableState,
				SdkGitPullRequestMergeableState,
				'GitPullRequestMergeableState',
			);
		});
	});
});
