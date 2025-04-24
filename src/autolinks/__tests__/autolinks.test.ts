import * as assert from 'assert';
import { map } from '../../system/iterable';
import type { Autolink, RefSet } from '../models/autolinks';
import { getAutolinks, getBranchAutolinks } from '../utils/-webview/autolinks.utils';

const mockRefSets = (prefixes: string[] = ['']): RefSet[] =>
	prefixes.map(prefix => [
		{ domain: 'test', icon: '1', id: '1', name: 'test' },
		[
			{
				alphanumeric: false,
				ignoreCase: false,
				prefix: prefix,
				title: 'test',
				url: 'test/<num>',
				description: 'test',
			},
		],
	]);

function assertAutolinks(actual: Map<string, Autolink>, expected: Array<string>): void {
	assert.deepEqual([...map(actual.values(), x => x.url)], expected);
}

suite('Autolinks Test Suite', () => {
	test('Branch name autolinks', () => {
		// Matches under rule 1 (prefixed 2+ digit number followed by end of string)
		assertAutolinks(getBranchAutolinks('feature/PRE-12', mockRefSets(['PRE-'])), ['test/12']);
		// Matches under rule 1 (prefixed 2+ digit number followed by a separator)
		assertAutolinks(getBranchAutolinks('feature/PRE-12.2', mockRefSets(['PRE-'])), ['test/12']);
		// Matches under rule 2 (feature/ followed by a 2+ digit number and nothing after it)
		assertAutolinks(getBranchAutolinks('feature/12', mockRefSets()), ['test/12']);
		// Matches under rule 2 (feature/ followed by a 2+ digit number and a separator after it)
		assertAutolinks(getBranchAutolinks('feature/12.test-bug', mockRefSets()), ['test/12']);
		// Matches under rule 3 (3+ digit issue number preceded by at least two non-slash, non-digit characters)
		assertAutolinks(getBranchAutolinks('feature/PRE-123', mockRefSets()), ['test/123']);
		// Matches under rule 3 (3+ digit issue number followed by at least two non-slash, non-digit characters)
		assertAutolinks(getBranchAutolinks('123abc', mockRefSets()), ['test/123']);
		// Matches under rule 3 (3+ digit issue number is the entire branch name)
		assertAutolinks(getBranchAutolinks('123', mockRefSets()), ['test/123']);
		// Fails all rules because it is a 1 digit number.
		assertAutolinks(getBranchAutolinks('feature/3', mockRefSets([''])), []);
		// Fails all rules because it is a 1 digit number.
		assertAutolinks(getBranchAutolinks('feature/3', mockRefSets(['PRE-'])), []);
		// Fails all rules. In rule 3, fails because one of the two following characters is a number.
		assertAutolinks(getBranchAutolinks('123.2', mockRefSets()), []);
		// Fails all rules. In rule 3, fails because the issue is a full section (a slash before and after it).
		assertAutolinks(getBranchAutolinks('improvement/123/ui-fix', mockRefSets()), []);
		// Fails all rules. 2&3 because the ref is prefixed, and 1 because the branch name doesn't have the ref's prefix.
		assertAutolinks(getBranchAutolinks('123', mockRefSets(['PRE-'])), []);
		// Fails all rules. 2 because the issue is not immediately following the feature/ section, and 3 because it is a full section.
		assertAutolinks(getBranchAutolinks('feature/2-fa/123', mockRefSets([''])), []);
		// Fails all rules. 2 because of non-separator character after issue number, and 3 because it has end-of-string two character after.
		assertAutolinks(getBranchAutolinks('feature/123a', mockRefSets(['PRE-'])), []);
	});

	test('Commit message autolinks', () => {
		assertAutolinks(getAutolinks('test message 123 sd', mockRefSets()), ['test/123']);
	});
});
