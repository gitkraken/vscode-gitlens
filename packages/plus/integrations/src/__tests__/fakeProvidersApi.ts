// Typed replacement for the `stubApi(gh, { ...: Record<string, unknown> })` pattern most of this package's
// facade tests use to fake the `ProvidersApi` a `GitHostIntegration`/`IssuesIntegration` gets from its
// `getProvidersApi()` hook (see models/integration.ts). A `Record<string, unknown>` fake accepts ANY key —
// a typo'd or renamed method (e.g. a rename of `getGitHubOrgsForCurrentUser` on the real `ProvidersApi`)
// still assigns cleanly, and the test just runs against whatever default/`undefined` behavior the untouched
// real method takes instead of failing to compile. Sergei confirmed that looseness was never intentional,
// just the shape the pattern happened to grow into (T4 in the abstraction-layer plan): a rename or
// shape-change on `ProvidersApi` should be a compile error for every fake built on it, not a suite that
// stays green for the wrong reason.
//
// Adopted so far ONLY in facadeBaseCases.test.ts — see that file's `stubApi`/`stubIssuesApi` helpers, which
// still build the untyped fake for the other 8 existing test files in this package. This helper is exported
// for incremental adoption there; migrating them is explicitly out of scope for this change.

import type { ProvidersApi } from '../providers/providersApi.js';

/**
 * Per-method overrides for a fake {@link ProvidersApi}, keyed off the real class so a rename on
 * `ProvidersApi` is a compile error at every fake that still uses the old name — the failure mode this
 * helper exists to kill (`Record<string, unknown>` accepted any key forever).
 *
 * Deliberately key-checked but signature-relaxed: method values are loosened to `(...args) => any` so test
 * fixtures can stay minimal (a fixture that returns just the fields the read path consumes should not have
 * to satisfy the SDK's full parameter/return types). Tightening individual signatures is possible
 * incrementally by narrowing this mapped type per key if a test ever needs it.
 */
export type FakeProvidersApiOverrides = {
	[K in keyof ProvidersApi]?: ProvidersApi[K] extends (...args: never[]) => unknown
		? (...args: any[]) => any
		: ProvidersApi[K];
};

/**
 * Builds a fake {@link ProvidersApi} from a typed set of per-method overrides.
 *
 * `ProvidersApi` is a class with private members (`providers`, `request`, `handleProviderError`, ...), so a
 * plain object literal — no matter how many public methods it fills in — can never structurally satisfy the
 * real class type; some cast past that is unavoidable. This function's return statement is the ONE place in
 * the fake's surface that does it, so every call site that builds `overrides` still gets key-checking
 * against `ProvidersApi`'s real method names (signatures deliberately relaxed — see the type above), without
 * needing its own cast.
 */
export function createFakeProvidersApi(overrides: FakeProvidersApiOverrides): ProvidersApi {
	return overrides as unknown as ProvidersApi;
}

// Self-documenting compile-time inversion (never called — this only has to type-check, per T4's verification
// step of `tsc -b` + the suite): if `FakeProvidersApiOverrides` above is ever loosened back toward
// `Record<string, unknown>`, the misspelled method below starts type-checking cleanly, `@ts-expect-error` has
// no error left to suppress, and `tsc -b` fails — the same signal a real rename on `ProvidersApi` should
// produce for every fake built on this helper.
//
// Verified by temporarily deleting the `@ts-expect-error` line below and re-running `tsc -b`: it fails with
// exactly `TS2561: ... 'getGitHubOrgsForCurrntUser' does not exist in type 'Partial<ProvidersApi>'`.
void createFakeProvidersApi({
	// @ts-expect-error — `getGitHubOrgsForCurrntUser` (missing the "e" in "Current") is not a real ProvidersApi
	// method; `getGitHubOrgsForCurrentUser` is. This must keep erroring for the type-checking above to mean
	// anything.
	getGitHubOrgsForCurrntUser: () => Promise.resolve({ values: [] }),
});
