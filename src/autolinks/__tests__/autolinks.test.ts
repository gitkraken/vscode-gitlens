import * as assert from 'assert';
import { suite, test } from 'mocha';
import { map } from '../../system/iterable';
import type { Autolink, RefSet } from '../autolinks.utils';
import { calculatePriority, getAutolinks, getBranchAutolinks } from '../autolinks.utils';

const mockRefSets = (prefixes: string[] = [''], title = 'test'): RefSet[] =>
	prefixes.map(prefix => [
		{ domain: 'test', icon: '1', id: '1', name: 'test' },
		[
			{
				alphanumeric: false,
				ignoreCase: false,
				prefix: prefix,
				title: title,
				url: '<num>',
				description: 'test',
			},
		],
	]);

function assertAutolinks(actual: Map<string, Autolink>, expected: Array<string>, message: string): void {
	assert.deepEqual([...map(actual.values(), x => x.url)], expected, message);
}

suite('Autolinks Test Suite', () => {
	test('Branch name autolinks', () => {
		assertAutolinks(getBranchAutolinks('123', mockRefSets()), ['123'], 'test-1');
		assertAutolinks(getBranchAutolinks('feature/123', mockRefSets()), ['123'], 'test-2');
		assertAutolinks(getBranchAutolinks('feature/PRE-123', mockRefSets()), ['123'], 'test-3');
		assertAutolinks(getBranchAutolinks('123.2', mockRefSets()), ['123'], 'test-4');
		assertAutolinks(getBranchAutolinks('123', mockRefSets(['PRE-'])), [], 'test-5');
		assertAutolinks(getBranchAutolinks('feature/123', mockRefSets(['PRE-'])), [], 'test-6');
		assertAutolinks(getBranchAutolinks('feature/2-fa/123', mockRefSets([''])), ['123', '2'], 'test-7');
		assertAutolinks(getBranchAutolinks('feature/2-fa/123', mockRefSets([''])), ['123', '2'], 'test-8');
		assertAutolinks(getBranchAutolinks('feature/2-fa/3', mockRefSets([''])), ['3', '2'], 'test-9');
		assertAutolinks(getBranchAutolinks('feature/PRE-123', mockRefSets(['PRE-'])), ['123'], 'test-10');
		assertAutolinks(getBranchAutolinks('feature/PRE-123.2', mockRefSets(['PRE-'])), ['123'], 'test-11');
		assertAutolinks(getBranchAutolinks('feature/3-123-PRE-123', mockRefSets(['PRE-'])), ['123'], 'test-12');
		assertAutolinks(
			getBranchAutolinks('feature/3-123-PRE-123', mockRefSets(['', 'PRE-'])),

			['123', '3'],
			'test-13',
		);
	});

	test('Commit message autolinks', () => {
		assertAutolinks(getAutolinks('test message 123 sd', mockRefSets()), ['123'], 'test-14');
	});

	test('Test autolink priority comparation', () => {
		assert.equal(calculatePriority('1', 0, '1', 1) > calculatePriority('1', 0, '1', 0), true, 'test-15');
		assert.equal(calculatePriority('1', 0, '1', 2) > calculatePriority('1', 1, '1', 0), true, 'test-16');
		assert.equal(calculatePriority('1', 0, '1', 2) > calculatePriority('1', 0, '1.1', 2), true, 'test-17');
		assert.equal(calculatePriority('2', 0, '2', 2) > calculatePriority('1', 0, '1', 2), true, 'test-19');
	});
	/**
	 * 16.1.1^ - improved branch name autolinks matching
	 */
	test('Improved branch name autolinks matching', () => {
		// skip branch names chunks matching '^release(?=(-(?<number-chunk>))$` or other release-like values
		// skip pair in case of double chunk
		assertAutolinks(getBranchAutolinks('folder/release/16/issue-1', mockRefSets([''])), ['1'], 'test-20');
		assertAutolinks(getBranchAutolinks('folder/release/16.1/issue-1', mockRefSets([''])), ['1'], 'test-21');
		assertAutolinks(getBranchAutolinks('folder/release/16.1.1/1', mockRefSets([''])), ['1'], 'test-22');
		assertAutolinks(getBranchAutolinks('release-2024', mockRefSets([''])), [], 'test-23');
		assertAutolinks(getBranchAutolinks('v-2024', mockRefSets([''])), [], 'test-24');
		assertAutolinks(getBranchAutolinks('v2024', mockRefSets([''])), [], 'test-25');
		// cannot be definitely handled
		assertAutolinks(getBranchAutolinks('some-issue-in-release-2024', mockRefSets([''])), ['2024'], 'test-26');
		assertAutolinks(getBranchAutolinks('folder/release-notes-16-1', mockRefSets([''])), ['16'], 'test-27');
		assertAutolinks(getBranchAutolinks('folder/16-1-release-notes', mockRefSets([''])), ['16'], 'test-28');
		// skip next in case of single chunk
		assertAutolinks(getBranchAutolinks('folder/release-16/1', mockRefSets([''])), ['1'], 'test-29');
		assertAutolinks(getBranchAutolinks('folder/release-16.1/1', mockRefSets([''])), ['1'], 'test-30');
		assertAutolinks(getBranchAutolinks('folder/release-16.1.2/1', mockRefSets([''])), ['1'], 'test-31');

		/**
		 * Added chunk matching logic for non-prefixed numbers:
		 * 		- XX - is more likely issue number
		 * 		- XX.XX - is less likely issue number, but still possible
		 * 		- XX.XX.XX - is more likely not issue number: seems like a date or version number
		 */
		assertAutolinks(getBranchAutolinks('issue-2024', mockRefSets([''])), ['2024'], 'test-32');
		assertAutolinks(getBranchAutolinks('issue-2024.1', mockRefSets([''])), ['2024'], 'test-33');
		assertAutolinks(getBranchAutolinks('issue-2024.1.1', mockRefSets([''])), [], 'test-34');

		// the chunk that is more close to the end is more likely actual issue number
		assertAutolinks(
			getBranchAutolinks('1-epic-folder/10-issue/100-subissue', mockRefSets([''])),
			['100', '10', '1'],
			'test-35',
		);

		// ignore numbers from title
		assertAutolinks(
			getBranchAutolinks('folder/100-content-content-16', mockRefSets([''], '100-content-content')),
			['16'],
			'test-36',
		);
		assertAutolinks(
			getBranchAutolinks('folder/100-content-content-16', mockRefSets([''], 'content-content-16')),
			['100'],
			'test-37',
		);

		// consider edge distance and issue key length to sort
		assertAutolinks(
			getBranchAutolinks('2-some-issue-in-release-2024', mockRefSets([''])),
			['2024', '2'],
			'test-38',
		);
		assertAutolinks(
			getBranchAutolinks('2024-some-issue-in-release-2', mockRefSets([''])),
			['2024', '2'],
			'test-39',
		);
		assertAutolinks(
			getBranchAutolinks('some-2-issue-in-release-2024', mockRefSets([''])),
			['2024', '2'],
			'test-40',
		);
		assertAutolinks(
			getBranchAutolinks('4048-issue-in-release-2024.1', mockRefSets([''])),
			['4048', '2024'],
			'test-41',
		);
		// less numbers - more likely issue key
		assertAutolinks(getBranchAutolinks('1-issue-in-release-2024.1', mockRefSets([''])), ['1', '2024'], 'test-42');
	});
});
