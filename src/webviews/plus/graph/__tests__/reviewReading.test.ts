import * as assert from 'assert';
import { getReviewStepTarget } from '../reviewReading.js';

suite('getReviewStepTarget', () => {
	const paths = ['a', 'b', 'c', 'd'];
	const cases: {
		name: string;
		paths?: string[];
		from: string;
		direction: 1 | -1;
		viewed: string[];
		inListOrder?: boolean;
		expected: string | undefined;
	}[] = [
		{ name: 'next passes viewed files by', from: 'a', direction: 1, viewed: ['b'], expected: 'c' },
		{ name: 'previous passes them by, looping', from: 'a', direction: -1, viewed: ['d'], expected: 'c' },
		{ name: 'next loops past the end', from: 'd', direction: 1, viewed: ['a'], expected: 'b' },
		{ name: 'in list order when asked', from: 'a', direction: 1, viewed: ['b'], inListOrder: true, expected: 'b' },
		{
			name: 'in list order once every other file is viewed',
			from: 'a',
			direction: 1,
			viewed: ['b', 'c', 'd'],
			expected: 'b',
		},
		{ name: 'in list order once all are viewed', from: 'b', direction: -1, viewed: paths, expected: 'a' },
		{
			name: 'nowhere to go from the only file',
			paths: ['a'],
			from: 'a',
			direction: 1,
			viewed: [],
			expected: undefined,
		},
	];

	for (const c of cases) {
		test(c.name, () => {
			const list = c.paths ?? paths;
			assert.strictEqual(
				getReviewStepTarget(list, list.indexOf(c.from), c.direction, new Set(c.viewed), c.inListOrder ?? false),
				c.expected,
			);
		});
	}
});
