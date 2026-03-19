import * as assert from 'assert';
import type { GitBranch } from '../../models/branch.js';
import type { GitContributor } from '../../models/contributor.js';
import { sortBranches, sortContributors } from '../sorting.js';

function mockBranch(
	overrides: Partial<Pick<GitBranch, 'id' | 'name' | 'current' | 'date' | 'remote' | 'starred' | 'upstream'>>,
): GitBranch {
	return {
		id: 'repo|local|branch',
		name: 'branch',
		current: false,
		date: undefined,
		remote: false,
		starred: false,
		upstream: undefined,
		...overrides,
	} as unknown as GitBranch;
}

function mockContributor(
	overrides: Partial<
		Pick<GitContributor, 'name' | 'username' | 'current' | 'contributionCount' | 'latestCommitDate' | 'stats'>
	>,
): GitContributor {
	return {
		name: 'Unknown',
		username: undefined,
		current: false,
		contributionCount: 0,
		latestCommitDate: undefined,
		stats: undefined,
		...overrides,
	} as unknown as GitContributor;
}

function names(branches: GitBranch[]): string[] {
	return branches.map(b => b.name);
}

function contribNames(contributors: GitContributor[]): string[] {
	return contributors.map(c => c.name);
}

suite('Sorting Utils Test Suite', () => {
	suite('sortBranches', () => {
		const jan1 = new Date('2025-01-01');
		const feb1 = new Date('2025-02-01');
		const mar1 = new Date('2025-03-01');

		test('default sort (date:desc) orders newest first', () => {
			const branches = [
				mockBranch({ name: 'old', date: jan1 }),
				mockBranch({ name: 'new', date: mar1 }),
				mockBranch({ name: 'mid', date: feb1 }),
			];

			const result = sortBranches(branches);
			assert.deepStrictEqual(names(result), ['new', 'mid', 'old']);
		});

		test('date:asc orders oldest first', () => {
			const branches = [
				mockBranch({ name: 'new', date: mar1 }),
				mockBranch({ name: 'old', date: jan1 }),
				mockBranch({ name: 'mid', date: feb1 }),
			];

			const result = sortBranches(branches, { orderBy: 'date:asc' });
			assert.deepStrictEqual(names(result), ['old', 'mid', 'new']);
		});

		test('name:asc sorts alphabetically', () => {
			const branches = [
				mockBranch({ name: 'cherry' }),
				mockBranch({ name: 'apple' }),
				mockBranch({ name: 'banana' }),
			];

			const result = sortBranches(branches, { orderBy: 'name:asc' });
			assert.deepStrictEqual(names(result), ['apple', 'banana', 'cherry']);
		});

		test('name:desc sorts reverse alphabetically', () => {
			const branches = [
				mockBranch({ name: 'apple' }),
				mockBranch({ name: 'cherry' }),
				mockBranch({ name: 'banana' }),
			];

			const result = sortBranches(branches, { orderBy: 'name:desc' });
			assert.deepStrictEqual(names(result), ['cherry', 'banana', 'apple']);
		});

		test('current branch sorts first regardless of date', () => {
			const branches = [
				mockBranch({ name: 'newer', date: mar1, current: false }),
				mockBranch({ name: 'current', date: jan1, current: true }),
				mockBranch({ name: 'mid', date: feb1, current: false }),
			];

			const result = sortBranches(branches);
			assert.strictEqual(result[0].name, 'current');
		});

		test('current branch sorts first regardless of name', () => {
			const branches = [
				mockBranch({ name: 'aaa', current: false }),
				mockBranch({ name: 'zzz', current: true }),
				mockBranch({ name: 'mmm', current: false }),
			];

			const result = sortBranches(branches, { orderBy: 'name:asc' });
			assert.strictEqual(result[0].name, 'zzz');
		});

		test('current priority can be disabled', () => {
			const branches = [
				mockBranch({ name: 'newer', date: mar1, current: false }),
				mockBranch({ name: 'current', date: jan1, current: true }),
			];

			const result = sortBranches(branches, { current: false });
			assert.strictEqual(result[0].name, 'newer');
		});

		test('starred branches sort before non-starred', () => {
			const branches = [
				mockBranch({ name: 'unstarred', date: mar1, starred: false }),
				mockBranch({ name: 'starred', date: jan1, starred: true }),
			];

			const result = sortBranches(branches);
			assert.strictEqual(result[0].name, 'starred');
		});

		test('current branch sorts before starred branch', () => {
			const branches = [
				mockBranch({ name: 'starred', starred: true, current: false, date: mar1 }),
				mockBranch({ name: 'current', starred: false, current: true, date: jan1 }),
			];

			const result = sortBranches(branches);
			assert.strictEqual(result[0].name, 'current');
			assert.strictEqual(result[1].name, 'starred');
		});

		test('groupByType places local branches before remote branches', () => {
			const branches = [
				mockBranch({ name: 'origin/remote-branch', remote: true, date: mar1 }),
				mockBranch({ name: 'local-branch', remote: false, date: jan1 }),
			];

			const result = sortBranches(branches, { groupByType: true });
			assert.strictEqual(result[0].name, 'local-branch');
			assert.strictEqual(result[1].name, 'origin/remote-branch');
		});

		test('groupByType disabled allows date ordering across local and remote', () => {
			const branches = [
				mockBranch({ name: 'local-old', remote: false, date: jan1 }),
				mockBranch({ name: 'origin/remote-new', remote: true, date: mar1 }),
			];

			const result = sortBranches(branches, { groupByType: false });
			assert.strictEqual(result[0].name, 'origin/remote-new');
			assert.strictEqual(result[1].name, 'local-old');
		});

		test('missing upstream branches sort to top when missingUpstream is enabled', () => {
			const branches = [
				mockBranch({ name: 'normal', date: mar1 }),
				mockBranch({
					name: 'missing',
					date: jan1,
					upstream: { name: 'origin/missing', missing: true, state: { ahead: 0, behind: 0 } },
				}),
			];

			// missingUpstream flag in comparator gives missing branches -1 (sorts first)
			const result = sortBranches(branches, { missingUpstream: true, current: false });
			assert.strictEqual(result[0].name, 'missing');
			assert.strictEqual(result[1].name, 'normal');
		});

		test('missing upstream has no effect when missingUpstream option is falsy', () => {
			const branches = [
				mockBranch({
					name: 'missing',
					date: mar1,
					upstream: { name: 'origin/missing', missing: true, state: { ahead: 0, behind: 0 } },
				}),
				mockBranch({ name: 'normal', date: jan1 }),
			];

			const result = sortBranches(branches, { missingUpstream: false });
			assert.strictEqual(result[0].name, 'missing');
		});

		test('name:asc prioritizes main, master, develop branches', () => {
			const branches = [
				mockBranch({ name: 'zebra' }),
				mockBranch({ name: 'main' }),
				mockBranch({ name: 'alpha' }),
				mockBranch({ name: 'develop' }),
				mockBranch({ name: 'master' }),
			];

			const result = sortBranches(branches, { orderBy: 'name:asc', current: false });
			// main, master, develop should come before alphabetical others
			const mainIdx = names(result).indexOf('main');
			const masterIdx = names(result).indexOf('master');
			const developIdx = names(result).indexOf('develop');
			const alphaIdx = names(result).indexOf('alpha');
			const zebraIdx = names(result).indexOf('zebra');

			assert.ok(mainIdx < alphaIdx, 'main should come before alpha');
			assert.ok(masterIdx < alphaIdx, 'master should come before alpha');
			assert.ok(developIdx < alphaIdx, 'develop should come before alpha');
			assert.ok(mainIdx < zebraIdx, 'main should come before zebra');
		});

		test('sort priority order: missing upstream > current > starred > groupByType > date', () => {
			const branches = [
				mockBranch({ name: 'newest-date', date: mar1 }),
				mockBranch({ name: 'starred-branch', date: feb1, starred: true }),
				mockBranch({ name: 'current-branch', date: jan1, current: true }),
				mockBranch({
					name: 'missing-upstream',
					date: jan1,
					upstream: { name: 'origin/gone', missing: true, state: { ahead: 0, behind: 0 } },
				}),
			];

			// Comparator chain: missingUpstream → current → starred → groupByType → date
			// Each tier gets -1 (sorts first) when its condition is true
			const result = sortBranches(branches, { missingUpstream: true });
			assert.strictEqual(result[0].name, 'missing-upstream');
			assert.strictEqual(result[1].name, 'current-branch');
			assert.strictEqual(result[2].name, 'starred-branch');
			assert.strictEqual(result[3].name, 'newest-date');
		});
	});

	suite('sortContributors', () => {
		test('default sort (count:desc) orders highest count first', () => {
			const contributors = [
				mockContributor({ name: 'Low', contributionCount: 5 }),
				mockContributor({ name: 'High', contributionCount: 100 }),
				mockContributor({ name: 'Mid', contributionCount: 50 }),
			];

			const result = sortContributors(contributors);
			assert.deepStrictEqual(contribNames(result), ['High', 'Mid', 'Low']);
		});

		test('date:desc orders most recent first', () => {
			const contributors = [
				mockContributor({ name: 'Old', latestCommitDate: new Date('2024-01-01') }),
				mockContributor({ name: 'New', latestCommitDate: new Date('2025-06-01') }),
				mockContributor({ name: 'Mid', latestCommitDate: new Date('2025-03-01') }),
			];

			const result = sortContributors(contributors, { orderBy: 'date:desc' });
			assert.deepStrictEqual(contribNames(result), ['New', 'Mid', 'Old']);
		});

		test('name:asc orders alphabetically', () => {
			const contributors = [
				mockContributor({ name: 'Charlie', contributionCount: 1 }),
				mockContributor({ name: 'Alice', contributionCount: 1 }),
				mockContributor({ name: 'Bob', contributionCount: 1 }),
			];

			const result = sortContributors(contributors, { orderBy: 'name:asc' });
			assert.deepStrictEqual(contribNames(result), ['Alice', 'Bob', 'Charlie']);
		});

		test('current contributor sorts first regardless of count', () => {
			const contributors = [
				mockContributor({ name: 'HighCount', contributionCount: 100, current: false }),
				mockContributor({ name: 'CurrentUser', contributionCount: 1, current: true }),
			];

			const result = sortContributors(contributors);
			assert.strictEqual(result[0].name, 'CurrentUser');
		});

		test('current priority can be disabled', () => {
			const contributors = [
				mockContributor({ name: 'HighCount', contributionCount: 100, current: false }),
				mockContributor({ name: 'CurrentUser', contributionCount: 1, current: true }),
			];

			const result = sortContributors(contributors, { current: undefined as unknown as true });
			// With current disabled (falsy), the sort should use count only
			// Note: the type requires `true` but we test the runtime behavior
			assert.strictEqual(result[0].name, 'HighCount');
		});
	});
});
