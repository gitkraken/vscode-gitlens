import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { RefSet } from '../autolinks';
import { Autolinks } from '../autolinks';

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

suite('Autolinks Test Suite', () => {
	test('Branch name autolinks', () => {
		assert.deepEqual(
			Autolinks._getBranchAutolinks('123', mockRefSets()).map(x => x.url),
			['test/123'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/123', mockRefSets()).map(x => x.url),
			['test/123'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/PRE-123', mockRefSets()).map(x => x.url),
			['test/123'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('123.2', mockRefSets()).map(x => x.url),
			['test/123', 'test/2'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('123', mockRefSets(['PRE-'])).map(x => x.url),
			[],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/123', mockRefSets(['PRE-'])).map(x => x.url),
			[],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/PRE-123', mockRefSets(['PRE-'])).map(x => x.url),
			['test/123'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/PRE-123.2', mockRefSets(['PRE-'])).map(x => x.url),
			['test/123'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/3-123-PRE-123', mockRefSets(['PRE-'])).map(x => x.url),
			['test/123'],
		);
		assert.deepEqual(
			Autolinks._getBranchAutolinks('feature/3-123-PRE-123', mockRefSets(['', 'PRE-'])).map(x => x.url),
			['test/123', 'test/3'],
		);
	});

	test('Commit message autolinks', () => {
		assert.deepEqual(
			[...Autolinks._getAutolinks('test message 123 sd', mockRefSets()).values()].map(x => x.url),
			['test/123'],
		);
	});
});
