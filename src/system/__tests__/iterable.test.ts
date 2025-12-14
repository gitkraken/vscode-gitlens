import * as assert from 'assert';
import {
	chunk,
	chunkByStringLength,
	concat,
	filter,
	filterMap,
	flatMap,
	join,
	map,
	skip,
	take,
	union,
} from '../iterable';

suite('Iterable Test Suite', () => {
	suite('join', () => {
		test('joins array with delimiter', () => {
			assert.strictEqual(join([1, 2, 3], ','), '1,2,3');
			assert.strictEqual(join([1, 2, 3], ''), '123');
		});

		test('handles empty arrays', () => {
			assert.strictEqual(join([], ''), '');
			assert.strictEqual(join([], ','), '');
		});

		test('handles single element', () => {
			assert.strictEqual(join([1], ''), '1');
			assert.strictEqual(join([1], ','), '1');
		});
	});

	suite('chunk', () => {
		test('chunks array into fixed-size chunks', () => {
			const result = Array.from(chunk([1, 2, 3, 4, 5], 2));
			assert.deepStrictEqual(result, [[1, 2], [3, 4], [5]]);
		});

		test('handles exact divisions', () => {
			const result = Array.from(chunk([1, 2, 3, 4], 2));
			assert.deepStrictEqual(result, [
				[1, 2],
				[3, 4],
			]);
		});

		test('handles chunk size larger than array', () => {
			const result = Array.from(chunk([1, 2], 5));
			assert.deepStrictEqual(result, [[1, 2]]);
		});

		test('handles empty array', () => {
			const result = Array.from(chunk([], 2));
			assert.deepStrictEqual(result, []);
		});

		test('handles single element', () => {
			const result = Array.from(chunk([1], 2));
			assert.deepStrictEqual(result, [[1]]);
		});

		test('creates iterator that can be reused', () => {
			const chunked = chunk([1, 2, 3, 4], 2);
			const result1 = Array.from(chunked);
			const result2 = Array.from(chunked);
			assert.deepStrictEqual(result1, [
				[1, 2],
				[3, 4],
			]);
			assert.deepStrictEqual(result2, []); // Iterator is consumed
		});
	});

	suite('chunkByStringLength', () => {
		test('chunks strings by total length', () => {
			const result = Array.from(chunkByStringLength(['a', 'bb', 'ccc', 'dddd'], 4));
			assert.deepStrictEqual(result, [['a', 'bb'], ['ccc'], ['dddd']]);
		});

		test('handles strings that exactly match max length', () => {
			const result = Array.from(chunkByStringLength(['abc', 'def', 'ghi'], 6));
			assert.deepStrictEqual(result, [['abc', 'def'], ['ghi']]);
		});

		test('handles empty array', () => {
			const result = Array.from(chunkByStringLength([], 10));
			assert.deepStrictEqual(result, []);
		});

		test('handles single long string', () => {
			const result = Array.from(chunkByStringLength(['verylongstring'], 5));
			assert.deepStrictEqual(result, [['verylongstring']]);
		});
	});

	suite('concat', () => {
		test('concatenates multiple arrays', () => {
			const result = Array.from(concat([1, 2], [3, 4], [5, 6]));
			assert.deepStrictEqual(result, [1, 2, 3, 4, 5, 6]);
		});

		test('handles empty arrays', () => {
			const result = Array.from(concat([], [1, 2], []));
			assert.deepStrictEqual(result, [1, 2]);
		});

		test('handles all empty arrays', () => {
			const result = Array.from(concat([], [], []));
			assert.deepStrictEqual(result, []);
		});

		test('handles single array', () => {
			const result = Array.from(concat([1, 2, 3]));
			assert.deepStrictEqual(result, [1, 2, 3]);
		});

		test('works with iterables', () => {
			const gen = function* () {
				yield 1;
				yield 2;
			};
			const result = Array.from(concat(gen(), [3, 4]));
			assert.deepStrictEqual(result, [1, 2, 3, 4]);
		});
	});

	suite('filter', () => {
		test('filters array by predicate', () => {
			const result = Array.from(filter([1, 2, 3, 4, 5], n => n % 2 === 0));
			assert.deepStrictEqual(result, [2, 4]);
		});

		test('filters out null and undefined without predicate', () => {
			const result = Array.from(filter([1, null, 2, undefined, 3, null]));
			assert.deepStrictEqual(result, [1, 2, 3]);
		});

		test('handles empty array', () => {
			const result = Array.from(filter([], n => n > 0));
			assert.deepStrictEqual(result, []);
		});

		test('handles no matches', () => {
			const result = Array.from(filter([1, 2, 3], n => n > 10));
			assert.deepStrictEqual(result, []);
		});

		test('handles all matches', () => {
			const result = Array.from(filter([1, 2, 3], n => n > 0));
			assert.deepStrictEqual(result, [1, 2, 3]);
		});

		test('supports type guards', () => {
			interface Cat {
				type: 'cat';
				meow: () => void;
			}
			interface Dog {
				type: 'dog';
				bark: () => void;
			}
			const animals: (Cat | Dog)[] = [
				{ type: 'cat', meow: () => {} },
				{ type: 'dog', bark: () => {} },
				{ type: 'cat', meow: () => {} },
			];
			const cats = Array.from(filter(animals, (a): a is Cat => a.type === 'cat'));
			assert.strictEqual(cats.length, 2);
			assert.strictEqual(cats[0].type, 'cat');
		});
	});

	suite('filterMap', () => {
		test('filters and maps in one pass', () => {
			const result = Array.from(filterMap([1, 2, 3, 4, 5], n => (n % 2 === 0 ? n * 2 : null)));
			assert.deepStrictEqual(result, [4, 8]);
		});

		test('handles all null results', () => {
			const result = Array.from(filterMap([1, 2, 3], () => null));
			assert.deepStrictEqual(result, []);
		});

		test('handles all valid results', () => {
			const result = Array.from(filterMap([1, 2, 3], n => n * 2));
			assert.deepStrictEqual(result, [2, 4, 6]);
		});

		test('handles empty array', () => {
			const result = Array.from(filterMap([], n => n));
			assert.deepStrictEqual(result, []);
		});
	});

	suite('flatMap', () => {
		test('maps and flattens nested arrays', () => {
			const result = Array.from(flatMap([1, 2, 3], n => [n, n * 2]));
			assert.deepStrictEqual(result, [1, 2, 2, 4, 3, 6]);
		});

		test('handles empty results', () => {
			const result = Array.from(flatMap([1, 2, 3], n => (n % 2 === 0 ? [n] : [])));
			assert.deepStrictEqual(result, [2]);
		});

		test('handles empty array', () => {
			const result = Array.from(flatMap([], n => [n]));
			assert.deepStrictEqual(result, []);
		});

		test('works with complex nesting', () => {
			const result = Array.from(flatMap(['a', 'b'], char => char.repeat(3).split('')));
			assert.deepStrictEqual(result, ['a', 'a', 'a', 'b', 'b', 'b']);
		});
	});

	suite('map', () => {
		test('maps array elements', () => {
			const result = Array.from(map([1, 2, 3], n => n * 2));
			assert.deepStrictEqual(result, [2, 4, 6]);
		});

		test('handles empty array', () => {
			const result = Array.from(map([], n => n * 2));
			assert.deepStrictEqual(result, []);
		});

		test('transforms types', () => {
			const result = Array.from(map([1, 2, 3], n => n.toString()));
			assert.deepStrictEqual(result, ['1', '2', '3']);
		});

		test('works with objects', () => {
			const objects = [{ x: 1 }, { x: 2 }, { x: 3 }];
			const result = Array.from(map(objects, obj => obj.x * 2));
			assert.deepStrictEqual(result, [2, 4, 6]);
		});
	});

	suite('skip', () => {
		test('skips first N elements', () => {
			const result = Array.from(skip([1, 2, 3, 4, 5], 2));
			assert.deepStrictEqual(result, [3, 4, 5]);
		});

		test('handles skip count equal to array length', () => {
			const result = Array.from(skip([1, 2, 3], 3));
			assert.deepStrictEqual(result, []);
		});

		test('handles skip count greater than array length', () => {
			const result = Array.from(skip([1, 2], 5));
			assert.deepStrictEqual(result, []);
		});

		test('handles skip count of 0', () => {
			const result = Array.from(skip([1, 2, 3], 0));
			assert.deepStrictEqual(result, [1, 2, 3]);
		});

		test('handles empty array', () => {
			const result = Array.from(skip([], 2));
			assert.deepStrictEqual(result, []);
		});
	});

	suite('take', () => {
		test('takes first N elements', () => {
			const result = Array.from(take([1, 2, 3, 4, 5], 3));
			assert.deepStrictEqual(result, [1, 2, 3]);
		});

		test('handles take count equal to array length', () => {
			const result = Array.from(take([1, 2, 3], 3));
			assert.deepStrictEqual(result, [1, 2, 3]);
		});

		test('handles take count greater than array length', () => {
			const result = Array.from(take([1, 2], 5));
			assert.deepStrictEqual(result, [1, 2]);
		});

		test('handles take count of 0', () => {
			const result = Array.from(take([1, 2, 3], 0));
			assert.deepStrictEqual(result, []);
		});

		test('handles empty array', () => {
			const result = Array.from(take([], 2));
			assert.deepStrictEqual(result, []);
		});

		test('early termination optimization', () => {
			let count = 0;
			const gen = function* () {
				for (let i = 0; i < 100; i++) {
					count++;
					yield i;
				}
			};
			const result = Array.from(take(gen(), 5));
			assert.deepStrictEqual(result, [0, 1, 2, 3, 4]);
			assert.strictEqual(count, 5); // Should only iterate 5 times
		});
	});

	suite('union', () => {
		test('unions multiple arrays', () => {
			const result = Array.from(union([1, 2], [3, 4], [5, 6]));
			assert.deepStrictEqual(result, [1, 2, 3, 4, 5, 6]);
		});

		test('handles undefined sources', () => {
			const result = Array.from(union([1, 2], undefined, [3, 4]));
			assert.deepStrictEqual(result, [1, 2, 3, 4]);
		});

		test('handles all undefined', () => {
			const result = Array.from(union(undefined, undefined));
			assert.deepStrictEqual(result, []);
		});

		test('handles empty arrays', () => {
			const result = Array.from(union([], [1, 2], []));
			assert.deepStrictEqual(result, [1, 2]);
		});
	});

	suite('chained operations', () => {
		test('filter + map + take', () => {
			const result = Array.from(
				take(
					map(
						filter([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n => n % 2 === 0),
						n => n * 2,
					),
					3,
				),
			);
			assert.deepStrictEqual(result, [4, 8, 12]);
		});

		test('skip + take (pagination)', () => {
			const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
			const page1 = Array.from(take(skip(items, 0), 3));
			const page2 = Array.from(take(skip(items, 3), 3));
			const page3 = Array.from(take(skip(items, 6), 3));
			assert.deepStrictEqual(page1, [1, 2, 3]);
			assert.deepStrictEqual(page2, [4, 5, 6]);
			assert.deepStrictEqual(page3, [7, 8, 9]);
		});

		test('flatMap + filter + map', () => {
			const result = Array.from(
				map(
					filter(
						flatMap(['hello', 'world'], word => word.split('')),
						char => char !== 'o',
					),
					char => char.toUpperCase(),
				),
			);
			assert.deepStrictEqual(result, ['H', 'E', 'L', 'L', 'W', 'R', 'L', 'D']);
		});

		test('concat + filter + chunk', () => {
			const result = Array.from(
				chunk(Array.from(filter(concat([1, 2, 3], [4, 5, 6], [7, 8, 9]), n => n % 2 === 1)), 2),
			);
			assert.deepStrictEqual(result, [[1, 3], [5, 7], [9]]);
		});
	});

	suite('iterator behavior', () => {
		test('iterators are lazy', () => {
			let evaluatedCount = 0;
			const gen = function* () {
				for (let i = 0; i < 100; i++) {
					evaluatedCount++;
					yield i;
				}
			};

			const filtered = filter(gen(), n => n % 2 === 0);
			const mapped = map(filtered, n => n * 2);
			const taken = take(mapped, 3);

			assert.strictEqual(evaluatedCount, 0, 'Should not evaluate until consumed');

			const result = Array.from(taken);

			assert.deepStrictEqual(result, [0, 4, 8]);
			assert.ok(evaluatedCount < 100, 'Should only evaluate needed items');
		});

		test('iterators can be converted to arrays', () => {
			const filtered = filter([1, 2, 3, 4], n => n > 2);
			const asArray = Array.from(filtered);
			assert.deepStrictEqual(asArray, [3, 4]);
		});

		test('iterators work with for...of', () => {
			const results: number[] = [];
			for (const n of map([1, 2, 3], n => n * 2)) {
				results.push(n);
			}
			assert.deepStrictEqual(results, [2, 4, 6]);
		});

		test('iterators work with spread operator', () => {
			const mapped = map([1, 2, 3], n => n * 2);
			const result = [...mapped];
			assert.deepStrictEqual(result, [2, 4, 6]);
		});
	});
});
