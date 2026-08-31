import * as assert from 'assert';
import type { WipRowFitMetrics } from '@gitkraken/commit-graph-ui/wip.js';
import { computeWipRowFit } from '@gitkraken/commit-graph-ui/wip.js';
import { formatDetachedHeadName } from '@gitlens/git/utils/branch.utils.js';
import { buildWipRowInfoByRowSha, shouldIncludeOverviewBarSecondary } from '../wip.utils.js';

const scenarios = [
	{
		name: 'worktrees includes a clean, pushed peer',
		visibility: 'worktrees',
		dirty: false,
		unpushed: false,
		expected: true,
	},
	{ name: 'worktrees includes a dirty peer', visibility: 'worktrees', dirty: true, unpushed: false, expected: true },
	{
		name: 'worktrees includes an unpushed peer',
		visibility: 'worktrees',
		dirty: false,
		unpushed: true,
		expected: true,
	},
	{
		name: 'dirtyWorktrees excludes a clean, pushed peer',
		visibility: 'dirtyWorktrees',
		dirty: false,
		unpushed: false,
		expected: false,
	},
	{
		name: 'dirtyWorktrees includes a dirty peer',
		visibility: 'dirtyWorktrees',
		dirty: true,
		unpushed: false,
		expected: true,
	},
	{
		name: 'dirtyWorktrees includes an unpushed peer',
		visibility: 'dirtyWorktrees',
		dirty: false,
		unpushed: true,
		expected: true,
	},
	{
		name: 'always includes a clean, pushed peer',
		visibility: 'always',
		dirty: false,
		unpushed: false,
		expected: true,
	},
	{ name: 'always includes a dirty peer', visibility: 'always', dirty: true, unpushed: false, expected: true },
	{ name: 'always includes an unpushed peer', visibility: 'always', dirty: false, unpushed: true, expected: true },
	{
		name: 'never excludes a clean, pushed peer',
		visibility: 'never',
		dirty: false,
		unpushed: false,
		expected: false,
	},
	{ name: 'never excludes a dirty peer', visibility: 'never', dirty: true, unpushed: false, expected: false },
	{ name: 'never excludes an unpushed peer', visibility: 'never', dirty: false, unpushed: true, expected: false },
] as const;

suite('shouldIncludeOverviewBarSecondary', () => {
	for (const scenario of scenarios) {
		test(scenario.name, () => {
			assert.strictEqual(
				shouldIncludeOverviewBarSecondary(scenario.visibility, scenario.dirty, scenario.unpushed),
				scenario.expected,
			);
		});
	}
});

suite('computeWipRowFit', () => {
	// pillWidth = 60 (20 chrome + 40 name), fixed = 15 (10 stats + 5 slack) — every scenario below picks
	// `availableWidth` relative to those two constants rather than restating the arithmetic per case.
	const metrics: WipRowFitMetrics = {
		fullLabelWidth: 100,
		shortLabelWidth: 30,
		pillChromeWidth: 20,
		pillNameWidth: 40,
		statsWidth: 10,
		slack: 5,
	};

	test('full label fits: shows it unchanged, pill uncapped', () => {
		// fullLabelWidth + pillWidth + fixed = 100 + 60 + 15 = 175
		assert.deepStrictEqual(computeWipRowFit(175, metrics), { label: undefined, pillMaxWidth: undefined });
	});

	test('full label fits with room to spare', () => {
		assert.deepStrictEqual(computeWipRowFit(200, metrics), { label: undefined, pillMaxWidth: undefined });
	});

	test('full label just misses: swaps to WIP, pill still uncapped', () => {
		// One px short of the full-label threshold (175), but the short-label threshold (30+60+15=105) fits.
		assert.deepStrictEqual(computeWipRowFit(174, metrics), { label: 'WIP', pillMaxWidth: undefined });
	});

	test('short label fits exactly at its own threshold', () => {
		assert.deepStrictEqual(computeWipRowFit(105, metrics), { label: 'WIP', pillMaxWidth: undefined });
	});

	test('short label also misses: caps the pill name to what is left', () => {
		// nameBudget = availableWidth - shortLabelWidth - fixed - pillChromeWidth = 80 - 30 - 15 - 20 = 15
		assert.deepStrictEqual(computeWipRowFit(80, metrics), { label: 'WIP', pillMaxWidth: 15 });
	});

	test('a negative name budget clamps the cap to zero — the name ellipsizes away, never a hard clip', () => {
		// nameBudget = 50 - 30 - 15 - 20 = -15, clamped to 0 (no legibility floor; see the ladder doc).
		assert.deepStrictEqual(computeWipRowFit(50, metrics), { label: 'WIP', pillMaxWidth: 0 });
	});

	test('a positive name budget is used as-is', () => {
		// nameBudget = 90 - 30 - 15 - 20 = 25.
		assert.deepStrictEqual(computeWipRowFit(90, metrics), { label: 'WIP', pillMaxWidth: 25 });
	});

	test('a zero slack/stats row degrades using only the label + pill widths', () => {
		const bare: WipRowFitMetrics = { ...metrics, statsWidth: 0, slack: 0 };
		// fullLabelWidth + pillWidth = 100 + 60 = 160
		assert.deepStrictEqual(computeWipRowFit(160, bare), { label: undefined, pillMaxWidth: undefined });
		assert.deepStrictEqual(computeWipRowFit(159, bare), { label: 'WIP', pillMaxWidth: undefined });
	});
});

suite('buildWipRowInfoByRowSha', () => {
	test('a non-detached primary keeps its name, upstream, and target', () => {
		const byRowSha = buildWipRowInfoByRowSha(
			undefined,
			'wip::/repo',
			{ name: 'feature', sha: 'abc123', upstream: { name: 'origin/feature' } },
			{ sha: 'target-sha', name: 'main' },
			undefined,
		);

		assert.deepStrictEqual(byRowSha.get('wip::/repo'), {
			branchName: 'feature',
			upstreamName: 'origin/feature',
			target: { sha: 'target-sha', name: 'main' },
			tipSha: 'abc123',
			isPrimary: true,
			detached: false,
		});
	});

	test('a detached primary keeps the synthesized name and drops upstream/target', () => {
		const byRowSha = buildWipRowInfoByRowSha(
			undefined,
			'wip::/repo',
			{ name: '(abc1234...)', sha: 'abc1234567', detached: true, upstream: { name: 'origin/feature' } },
			{ sha: 'target-sha', name: 'main' },
			undefined,
		);

		assert.deepStrictEqual(byRowSha.get('wip::/repo'), {
			branchName: '(abc1234...)',
			upstreamName: undefined,
			target: undefined,
			tipSha: 'abc1234567',
			isPrimary: true,
			detached: true,
		});
	});

	test('a peer with no branch derives the detached label from parentSha', () => {
		const byRowSha = buildWipRowInfoByRowSha(
			{ 'wip::/peer': { repoPath: '/peer', parentSha: 'deadbeef1234567', label: 'peer-worktree' } },
			undefined,
			undefined,
			undefined,
			undefined,
		);

		assert.deepStrictEqual(byRowSha.get('wip::/peer'), {
			branchName: formatDetachedHeadName('deadbeef1234567'),
			upstreamName: undefined,
			target: undefined,
			worktreeName: 'peer-worktree',
			tipSha: 'deadbeef1234567',
			isPrimary: false,
			detached: true,
		});
	});

	test('a peer with a branch keeps non-detached behavior unchanged', () => {
		const byRowSha = buildWipRowInfoByRowSha(
			{
				'wip::/peer': {
					repoPath: '/peer',
					parentSha: 'peer-sha',
					label: 'peer-worktree',
					branchRef: '/peer|heads/feature',
				},
			},
			undefined,
			undefined,
			undefined,
			{ '/peer|heads/feature': { mergeTarget: { sha: 'target-sha', name: 'main' } } },
		);

		assert.deepStrictEqual(byRowSha.get('wip::/peer'), {
			branchName: 'feature',
			upstreamName: undefined,
			target: { sha: 'target-sha', name: 'main' },
			worktreeName: 'peer-worktree',
			tipSha: 'peer-sha',
			isPrimary: false,
			detached: false,
		});
	});
});
