import * as assert from 'assert';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { WorktreeTooltipStatsInput } from '../worktreeTooltip.utils.js';
import { getWorktreeTooltipStatsState, shouldRequestWorktreeWipStats } from '../worktreeTooltip.utils.js';

/** A dirty, non-primary, stats-enabled row — the one combination that is supposed to fetch. */
function input(overrides?: Partial<WorktreeTooltipStatsInput>): WorktreeTooltipStatsInput {
	return { path: '/repos/wt-1', hasChanges: true, primary: false, enabled: true, ...overrides };
}

/** The same row with a request outstanding — the only state that may render as loading. */
function pending(overrides?: Partial<WorktreeTooltipStatsInput>) {
	return { ...input(overrides), inFlight: true };
}

/** The same row with no request outstanding: never asked, or asked and already settled. */
function idle(overrides?: Partial<WorktreeTooltipStatsInput>) {
	return { ...input(overrides), inFlight: false };
}

const stats: GitDiffFileStats = { added: 1, changed: 2, deleted: 3 };

suite('Worktree Tooltip Stats Test Suite', () => {
	suite('shouldRequestWorktreeWipStats', () => {
		test('requests for a dirty, non-primary row with stats enabled', () => {
			assert.strictEqual(shouldRequestWorktreeWipStats(input()), true);
		});

		test('requests when the setting has not arrived yet', () => {
			// `undefined` is "config not landed", not "off" — the default is on, so don't suppress the fetch.
			assert.strictEqual(shouldRequestWorktreeWipStats(input({ enabled: undefined })), true);
		});

		test('never requests for a clean row', () => {
			// The regression guard: hovering clean rows must cost nothing, or hover is worse than eager.
			assert.strictEqual(shouldRequestWorktreeWipStats(input({ hasChanges: false })), false);
		});

		test('never requests when clean/dirty is unknown', () => {
			assert.strictEqual(shouldRequestWorktreeWipStats(input({ hasChanges: undefined })), false);
		});

		test('never requests when the setting is off', () => {
			assert.strictEqual(shouldRequestWorktreeWipStats(input({ enabled: false })), false);
		});

		test('never requests for the primary worktree', () => {
			assert.strictEqual(shouldRequestWorktreeWipStats(input({ primary: true })), false);
		});

		test('never requests without a path', () => {
			assert.strictEqual(shouldRequestWorktreeWipStats(input({ path: undefined })), false);
		});
	});

	suite('getWorktreeTooltipStatsState', () => {
		test('shows the breakdown once stats land', () => {
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...pending(), stats: stats }), {
				state: 'stats',
				stats: stats,
			});
		});

		test('shows loading while a requestable row has no stats yet', () => {
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...pending(), stats: undefined }), {
				state: 'loading',
			});
		});

		test('settles to dirty when the fetch resolves with no data', () => {
			// `null` is TERMINAL — a git failure will never produce a later answer, so it must not spin.
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...pending(), stats: null }), { state: 'dirty' });
		});

		test('shows dirty, never loading, when no request is outstanding', () => {
			// The anti-spinner rule. A row that never asks (setting off, primary) and a row whose ask already
			// failed are indistinguishable here by design — both have no entry and nothing coming, and both
			// must land on the terminal line rather than a spinner nothing will ever resolve.
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...idle(), stats: undefined }), { state: 'dirty' });
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...idle({ enabled: false }), stats: undefined }), {
				state: 'dirty',
			});
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...idle({ primary: true }), stats: undefined }), {
				state: 'dirty',
			});
		});

		test('keeps showing a previous answer while a re-ask is in flight', () => {
			// Every tooltip open re-asks, so this is the common case — flickering back to "Loading changes…"
			// on each open would be worse than the staleness the re-ask exists to correct.
			assert.deepStrictEqual(getWorktreeTooltipStatsState({ ...pending(), stats: stats }), {
				state: 'stats',
				stats: stats,
			});
		});

		test('shows dirty rather than an empty pill for a zero-total breakdown', () => {
			// The row's dirty flag went stale between the cheap probe and the status read.
			assert.deepStrictEqual(
				getWorktreeTooltipStatsState({ ...pending(), stats: { added: 0, changed: 0, deleted: 0 } }),
				{ state: 'dirty' },
			);
		});

		test('shows clean for a clean row and never loads', () => {
			// Clean wins even with a request somehow outstanding — there is nothing to break down.
			assert.deepStrictEqual(
				getWorktreeTooltipStatsState({ ...pending({ hasChanges: false }), stats: undefined }),
				{ state: 'clean' },
			);
		});

		test('says nothing when clean/dirty is unknown', () => {
			assert.deepStrictEqual(
				getWorktreeTooltipStatsState({ ...pending({ hasChanges: undefined }), stats: undefined }),
				{ state: 'unknown' },
			);
		});
	});
});
