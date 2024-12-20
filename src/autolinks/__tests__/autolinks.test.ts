import * as assert from 'assert';
import { suite, test } from 'mocha';
import { map } from '../../system/iterable';
import type { Autolink, RefSet } from '../autolinks.utils';
import { getAutolinks, getBranchAutolinks } from '../autolinks.utils';

const mockRefSets = (prefixes: string[] = ['']): RefSet[] =>
	prefixes.map(prefix => [
		{ domain: 'test', icon: '1', id: '1', name: 'test' },
		[
			{
				alphanumeric: false,
				ignoreCase: false,
				prefix: prefix,
				title: 'test',
				url: '<num>',
				description: 'test',
			},
		],
	]);

function assertAutolinks(actual: Map<string, Autolink>, expected: Array<string>): void {
	assert.deepEqual([...map(actual.values(), x => x.url)], expected);
}

suite('Autolinks Test Suite', () => {
	test('Branch name autolinks', () => {
		assertAutolinks(getBranchAutolinks('123', mockRefSets()), ['123']);
		assertAutolinks(getBranchAutolinks('feature/123', mockRefSets()), ['123']);
		assertAutolinks(getBranchAutolinks('feature/PRE-123', mockRefSets()), ['123']);
		assertAutolinks(getBranchAutolinks('123.2', mockRefSets()), ['123']);
		assertAutolinks(getBranchAutolinks('123', mockRefSets(['PRE-'])), []);
		assertAutolinks(getBranchAutolinks('feature/123', mockRefSets(['PRE-'])), []);
		assertAutolinks(getBranchAutolinks('feature/2-fa/123', mockRefSets([''])), ['123', '2']);
		assertAutolinks(getBranchAutolinks('feature/2-fa/123', mockRefSets([''])), ['123', '2']);
		assertAutolinks(getBranchAutolinks('feature/2-fa/3', mockRefSets([''])), ['3', '2']);
		assertAutolinks(getBranchAutolinks('feature/PRE-123', mockRefSets(['PRE-'])), ['123']);
		assertAutolinks(getBranchAutolinks('feature/PRE-123.2', mockRefSets(['PRE-'])), ['123']);
		assertAutolinks(getBranchAutolinks('feature/3-123-PRE-123', mockRefSets(['PRE-'])), ['123']);
		assertAutolinks(
			getBranchAutolinks('feature/3-123-PRE-123', mockRefSets(['', 'PRE-'])),

			['123', '3'],
		);
	});

	test('Commit message autolinks', () => {
		assertAutolinks(getAutolinks('test message 123 sd', mockRefSets()), ['123']);
	});

	/**
	 * 16.1.1^ - improved branch name autolinks matching
	 */
	test('Improved branch name autolinks matching', () => {
		// skip branch names chunks matching '^release(?=(-(?<number-chunk>))$` or other release-like values
		// skip pair in case of double chunk
		assertAutolinks(getBranchAutolinks('folder/release/16/issue-1', mockRefSets([''])), ['1']);
		assertAutolinks(getBranchAutolinks('folder/release/16.1/issue-1', mockRefSets([''])), ['1']);
		assertAutolinks(getBranchAutolinks('folder/release/16.1.1/1', mockRefSets([''])), ['1']);
		// skip one in case of single chunk
		assertAutolinks(getBranchAutolinks('folder/release-16/1', mockRefSets([''])), ['1']);
		assertAutolinks(getBranchAutolinks('folder/release-16.1/1', mockRefSets([''])), ['1']);
		assertAutolinks(getBranchAutolinks('folder/release-16.1.2/1', mockRefSets([''])), ['1']);

		/**
		 * Added chunk matching logic for non-prefixed numbers:
		 * 		- XX - is more likely issue number
		 * 		- XX.XX - is less likely issue number, but still possible
		 * 		- XX.XX.XX - is more likely not issue number
		 */
		assertAutolinks(getBranchAutolinks('some-issue-in-release-2024', mockRefSets([''])), ['2024']);
		assertAutolinks(getBranchAutolinks('some-issue-in-release-2024.1', mockRefSets([''])), ['2024']);
		assertAutolinks(getBranchAutolinks('some-issue-in-release-2024.1.1', mockRefSets([''])), []);

		assertAutolinks(getBranchAutolinks('folder/release-notes-16-1', mockRefSets([''])), ['16']);
		assertAutolinks(getBranchAutolinks('folder/16-1-release-notes', mockRefSets([''])), ['16']);

		// considered the distance from the edges of the chunk as a priority sign
		assertAutolinks(getBranchAutolinks('folder/16-content-1-content', mockRefSets([''])), ['16', '1']);
		assertAutolinks(getBranchAutolinks('folder/content-1-content-16', mockRefSets([''])), ['16', '1']);

		// the chunk that is more close to the end is more likely actual issue number
		assertAutolinks(getBranchAutolinks('1-epic-folder/10-issue/100-subissue', mockRefSets([''])), [
			'100',
			'10',
			'1',
		]);
	});
});
