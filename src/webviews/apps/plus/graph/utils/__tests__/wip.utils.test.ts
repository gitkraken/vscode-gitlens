import * as assert from 'assert';
import { shouldIncludeOverviewBarSecondary } from '../wip.utils.js';

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
