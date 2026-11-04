import * as assert from 'node:assert/strict';
import type {
	Account as SdkAccount,
	ActionablePullRequest as SdkActionablePullRequest,
	EnrichedItem as SdkEnrichedItem,
	EnrichedItemsByUniqueId as SdkEnrichedItemsByUniqueId,
	EntityIdentifier as SdkEntityIdentifier,
	PullRequestActionCategory as SdkPullRequestActionCategory,
	PullRequestWithUniqueID as SdkPullRequestWithUniqueID,
} from '@gitkraken/provider-apis';
import {
	GitBuildStatusState as SdkGitBuildStatusState,
	GitPullRequestReviewState as SdkGitPullRequestReviewState,
} from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type {
	ActionablePullRequest,
	ActionablePullRequestAccount,
	ActionablePullRequestCategory,
	ActionablePullRequestEnrichedItem,
	ActionablePullRequestEnrichedItems,
	ActionablePullRequestInput,
} from '../models/actionablePullRequest.js';
import {
	ActionablePullRequestBuildStatusState,
	ActionablePullRequestReviewState,
} from '../models/actionablePullRequest.js';
import type { EntityIdentifier } from '../providers/utils.js';

// Guards the GitLens-neutral copies in `models/actionablePullRequest.ts` (and the neutral `EntityIdentifier`) against
// drift from `@gitkraken/provider-apis`, as `providers/__tests__/enumParity.test.ts` does for the runtime enum copies.
//
// The shape checks are compile-time: a drifted copy makes a `true` below unassignable, so `tsc` (the package build and
// `pnpm run check`) fails. Mocha only runs the bundled output, so each check is also asserted to keep it visible.
//
// The SDK's string enums are nominal, so a copy can never be assignable TO an SDK type. `Unenum` swaps every SDK enum
// for its string values, and the copies must be mutually assignable with that. The SDK type must also be assignable to
// its copy as-is, since that is the direction `toActionablePullRequestInput` and `decodeEntityIdentifier` rely on.

type Unenum<T> = T extends Date
	? T
	: T extends string
		? `${T}`
		: T extends (infer U)[]
			? Unenum<U>[]
			: T extends object
				? { [K in keyof T]: Unenum<T[K]> }
				: T;

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assignable<From, To> = [From] extends [To] ? true : false;

// Mutual assignability cannot see an optional property that one side dropped or added (`{ a?: string }` and `{}` are
// assignable both ways), so each pair is also compared by the set of every property path, nested ones included.
type Paths<T> = T extends Date | string | number | boolean | null | undefined
	? never
	: T extends (infer U)[]
		? Paths<U>
		: T extends object
			? { [K in keyof T & string]: K | `${K}.${Paths<NonNullable<T[K]>>}` }[keyof T & string]
			: never;
type SameKeys<A, B> = MutuallyAssignable<Paths<A>, Paths<B>>;

suite('actionable pull request parity with @gitkraken/provider-apis (drift guard)', () => {
	test('ActionablePullRequestInput mirrors PullRequestWithUniqueID', () => {
		const mirror: MutuallyAssignable<ActionablePullRequestInput, Unenum<SdkPullRequestWithUniqueID>> = true;
		const fromSdk: Assignable<SdkPullRequestWithUniqueID, ActionablePullRequestInput> = true;
		const keys: SameKeys<ActionablePullRequestInput, SdkPullRequestWithUniqueID> = true;
		assert.equal(keys, true);
		assert.equal(mirror, true);
		assert.equal(fromSdk, true);
	});

	test('ActionablePullRequest mirrors ActionablePullRequest', () => {
		const mirror: MutuallyAssignable<ActionablePullRequest, Unenum<SdkActionablePullRequest>> = true;
		const fromSdk: Assignable<SdkActionablePullRequest, ActionablePullRequest> = true;
		const keys: SameKeys<ActionablePullRequest, SdkActionablePullRequest> = true;
		assert.equal(keys, true);
		assert.equal(mirror, true);
		assert.equal(fromSdk, true);
	});

	test('ActionablePullRequestAccount mirrors Account', () => {
		const mirror: MutuallyAssignable<ActionablePullRequestAccount, SdkAccount> = true;
		const keys: SameKeys<ActionablePullRequestAccount, SdkAccount> = true;
		assert.equal(keys, true);
		assert.equal(mirror, true);
	});

	test('ActionablePullRequestCategory mirrors PullRequestActionCategory', () => {
		const mirror: MutuallyAssignable<ActionablePullRequestCategory, SdkPullRequestActionCategory> = true;
		assert.equal(mirror, true);
	});

	test('ActionablePullRequestEnrichedItem(s) mirror EnrichedItem(s)ByUniqueId', () => {
		const item: MutuallyAssignable<ActionablePullRequestEnrichedItem, SdkEnrichedItem> = true;
		const items: MutuallyAssignable<ActionablePullRequestEnrichedItems, SdkEnrichedItemsByUniqueId> = true;
		const itemKeys: SameKeys<ActionablePullRequestEnrichedItem, SdkEnrichedItem> = true;
		const itemsKeys: SameKeys<ActionablePullRequestEnrichedItems, SdkEnrichedItemsByUniqueId> = true;
		assert.equal(itemKeys, true);
		assert.equal(itemsKeys, true);
		assert.equal(item, true);
		assert.equal(items, true);
	});

	test('EntityIdentifier mirrors EntityIdentifier', () => {
		const mirror: MutuallyAssignable<EntityIdentifier, Unenum<SdkEntityIdentifier>> = true;
		const fromSdk: Assignable<SdkEntityIdentifier, EntityIdentifier> = true;
		const keys: SameKeys<EntityIdentifier, SdkEntityIdentifier> = true;
		assert.equal(keys, true);
		assert.equal(mirror, true);
		assert.equal(fromSdk, true);
	});

	test('ActionablePullRequestBuildStatusState has the SDK enum values', () => {
		assert.deepEqual({ ...ActionablePullRequestBuildStatusState }, { ...SdkGitBuildStatusState });
	});

	test('ActionablePullRequestReviewState has the SDK enum values', () => {
		assert.deepEqual({ ...ActionablePullRequestReviewState }, { ...SdkGitPullRequestReviewState });
	});
});
