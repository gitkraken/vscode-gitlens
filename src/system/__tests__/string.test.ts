/* eslint-disable @typescript-eslint/require-await */
import * as assert from 'assert';
import { iterateAsyncByDelimiter, iterateByDelimiter } from '../string';

suite('String Delimiter Iteration Test Suite', () => {
	suite('iterateByDelimiter - Basic Functionality', () => {
		test('handles string input', () => {
			const data = 'line1\nline2\nline3';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles string with no delimiter', () => {
			const data = 'single line';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['single line']);
		});

		test('handles empty string', () => {
			const data = '';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, []);
		});

		test('handles string ending with delimiter', () => {
			const data = 'line1\nline2\n';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2']);
		});

		test('handles string starting with delimiter', () => {
			const data = '\nline1\nline2';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['', 'line1', 'line2']);
		});

		test('handles consecutive delimiters', () => {
			const data = 'line1\n\n\nline2';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', '', '', 'line2']);
		});

		test('handles multi-character delimiter', () => {
			const data = 'item1||item2||item3';
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['item1', 'item2', 'item3']);
		});

		test('handles null byte delimiter (git log format)', () => {
			const data = 'commit1\x00author\x00commit2\x00author2';
			const result = Array.from(iterateByDelimiter(data, '\x00'));
			assert.deepStrictEqual(result, ['commit1', 'author', 'commit2', 'author2']);
		});
	});

	suite('iterateByDelimiter - Array Input', () => {
		test('handles simple array input', () => {
			const data = ['line1\nline', '2\nline3'];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles array with delimiter spanning chunks', () => {
			const data = ['item1||it', 'em2||item3'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['item1', 'item2', 'item3']);
		});

		test('handles array with empty chunks', () => {
			const data = ['line1\n', '', 'line2\n', '', 'line3'];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles array with single chunk', () => {
			const data = ['line1\nline2\nline3'];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles array with delimiter at chunk boundaries', () => {
			const data = ['line1\n', 'line2\n', 'line3'];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles array with partial delimiter at end', () => {
			const data = ['line1\nline2\nli', 'ne3'];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles empty array', () => {
			const data: string[] = [];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, []);
		});
	});

	suite('iterateByDelimiter - Generic Iterable', () => {
		test('handles generator iterable', () => {
			function* gen() {
				yield 'line1\nli';
				yield 'ne2\n';
				yield 'line3';
			}
			const result = Array.from(iterateByDelimiter(gen(), '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles custom iterable', () => {
			const customIterable = {
				[Symbol.iterator]: function* () {
					yield 'a\nb';
					yield '\nc';
					yield '\nd';
				},
			};
			const result = Array.from(iterateByDelimiter(customIterable, '\n'));
			assert.deepStrictEqual(result, ['a', 'b', 'c', 'd']);
		});

		test('handles Set as iterable', () => {
			const data = new Set(['line1\nli', 'ne2\nline', '3']);
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});
	});

	suite('iterateByDelimiter - Chunking Edge Cases', () => {
		test('delimiter split exactly across two chunks', () => {
			const data = ['abc|', '|def'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['abc', 'def'], 'Should handle delimiter split across chunks');
		});

		test('delimiter split across three chunks', () => {
			const data = ['a|', '|', 'b'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b'], 'Should handle 3-chunk delimiter');
		});

		test('partial delimiter at end then different delimiter', () => {
			const data = ['a||b|', 'c||d'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b|c', 'd'], 'Single | should not be treated as delimiter');
		});

		test('delimiter character appears but not complete delimiter', () => {
			const data = ['item1|item', '2||item3'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['item1|item2', 'item3']);
		});

		test('multiple delimiters spanning chunks', () => {
			const data = ['a||b|', '|c||d|', '|e'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b', 'c', 'd', 'e']);
		});

		test('chunk boundaries align with delimiter boundaries', () => {
			const data = ['a||', 'b||', 'c'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b', 'c']);
		});

		test('first chunk is just delimiter', () => {
			const data = ['||', 'a||b'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['', 'a', 'b']);
		});

		test('last chunk is just delimiter', () => {
			const data = ['a||b', '||'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b']);
		});

		test('realistic git commit message with linebreaks across chunks', () => {
			const data = [
				'commit abc123\x00author John ',
				'Doe <john@example.com>\x00date 202',
				'4-01-01\x00message Fix crit',
				'ical bug\x00M\x00src/file.ts\x00',
			];
			const result = Array.from(iterateByDelimiter(data, '\x00'));
			assert.deepStrictEqual(result, [
				'commit abc123',
				'author John Doe <john@example.com>',
				'date 2024-01-01',
				'message Fix critical bug',
				'M',
				'src/file.ts',
			]);
		});
	});

	suite('iterateByDelimiter - Edge Cases', () => {
		test('handles very long strings', () => {
			const data = Array(1000).fill('line').join('\n');
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.strictEqual(result.length, 1000);
		});

		test('handles delimiter longer than chunks', () => {
			const data = ['a', '|', '|', 'b'];
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b']);
		});

		test('handles single character chunks', () => {
			const data = ['a', '\n', 'b', '\n', 'c'];
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['a', 'b', 'c']);
		});

		test('handles only delimiters', () => {
			const data = '\n\n\n';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['', '', '']);
		});

		test('handles no matching delimiter', () => {
			const data = 'no delimiter here';
			const result = Array.from(iterateByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['no delimiter here']);
		});

		test('handles unicode characters', () => {
			const data = '🎉\n✨\n🚀';
			const result = Array.from(iterateByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['🎉', '✨', '🚀']);
		});

		test('handles tab delimiter', () => {
			const data = 'col1\tcol2\tcol3';
			const result = Array.from(iterateByDelimiter(data, '\t'));
			assert.deepStrictEqual(result, ['col1', 'col2', 'col3']);
		});
	});

	suite('iterateAsyncByDelimiter - Basic Functionality', () => {
		// Helper to convert async iterable to array
		async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
			const result: T[] = [];
			for await (const item of iterable) {
				result.push(item);
			}
			return result;
		}

		// Helper to create async iterable from array
		async function* asyncGen(items: string[]): AsyncGenerator<string> {
			for (const item of items) {
				yield item;
			}
		}

		test('handles simple async iterable', async () => {
			const data = asyncGen(['line1\nline2\nline3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles async iterable with no delimiter', async () => {
			const data = asyncGen(['single line']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['single line']);
		});

		test('handles async iterable with empty string', async () => {
			const data = asyncGen(['']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, []);
		});

		test('handles async iterable ending with delimiter', async () => {
			const data = asyncGen(['line1\nline2\n']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2']);
		});

		test('handles async iterable starting with delimiter', async () => {
			const data = asyncGen(['\nline1\nline2']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['', 'line1', 'line2']);
		});

		test('handles consecutive delimiters', async () => {
			const data = asyncGen(['line1\n\n\nline2']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', '', '', 'line2']);
		});

		test('handles multi-character delimiter', async () => {
			const data = asyncGen(['item1||item2||item3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['item1', 'item2', 'item3']);
		});

		test('handles null byte delimiter (git log format)', async () => {
			const data = asyncGen(['commit1\x00author\x00commit2\x00author2']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\x00'));
			assert.deepStrictEqual(result, ['commit1', 'author', 'commit2', 'author2']);
		});
	});

	suite('iterateAsyncByDelimiter - Multiple Chunks', () => {
		async function* asyncGen(items: string[]): AsyncGenerator<string> {
			for (const item of items) {
				yield item;
			}
		}

		async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
			const result: T[] = [];
			for await (const item of iterable) {
				result.push(item);
			}
			return result;
		}

		test('handles multiple chunks', async () => {
			const data = asyncGen(['line1\nline', '2\nline3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles delimiter spanning chunks', async () => {
			const data = asyncGen(['item1||it', 'em2||item3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['item1', 'item2', 'item3']);
		});

		test('handles empty chunks', async () => {
			const data = asyncGen(['line1\n', '', 'line2\n', '', 'line3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles delimiter at chunk boundaries', async () => {
			const data = asyncGen(['line1\n', 'line2\n', 'line3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles partial delimiter at end', async () => {
			const data = asyncGen(['line1\nline2\nli', 'ne3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['line1', 'line2', 'line3']);
		});

		test('handles delimiter split exactly across two chunks', async () => {
			const data = asyncGen(['abc|', '|def']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['abc', 'def']);
		});

		test('handles delimiter split across three chunks', async () => {
			const data = asyncGen(['a|', '|', 'b']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b']);
		});

		test('handles partial delimiter at end then different delimiter', async () => {
			const data = asyncGen(['a||b|', 'c||d']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b|c', 'd']);
		});

		test('handles multiple delimiters spanning chunks', async () => {
			const data = asyncGen(['a||b|', '|c||d|', '|e']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b', 'c', 'd', 'e']);
		});

		test('handles chunk boundaries align with delimiter boundaries', async () => {
			const data = asyncGen(['a||', 'b||', 'c']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b', 'c']);
		});

		test('handles first chunk is just delimiter', async () => {
			const data = asyncGen(['||', 'a||b']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['', 'a', 'b']);
		});

		test('handles last chunk is just delimiter', async () => {
			const data = asyncGen(['a||b', '||']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b']);
		});

		test('handles realistic git commit message with linebreaks across chunks', async () => {
			const data = asyncGen([
				'commit abc123\x00author John ',
				'Doe <john@example.com>\x00date 202',
				'4-01-01\x00message Fix crit',
				'ical bug\x00M\x00src/file.ts\x00',
			]);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\x00'));
			assert.deepStrictEqual(result, [
				'commit abc123',
				'author John Doe <john@example.com>',
				'date 2024-01-01',
				'message Fix critical bug',
				'M',
				'src/file.ts',
			]);
		});
	});

	suite('iterateAsyncByDelimiter - Edge Cases', () => {
		async function* asyncGen(items: string[]): AsyncGenerator<string> {
			for (const item of items) {
				yield item;
			}
		}

		async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
			const result: T[] = [];
			for await (const item of iterable) {
				result.push(item);
			}
			return result;
		}

		test('handles very long data', async () => {
			const data = asyncGen([Array(1000).fill('line').join('\n')]);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.strictEqual(result.length, 1000);
		});

		test('handles delimiter longer than chunks', async () => {
			const data = asyncGen(['a', '|', '|', 'b']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['a', 'b']);
		});

		test('handles single character chunks', async () => {
			const data = asyncGen(['a', '\n', 'b', '\n', 'c']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['a', 'b', 'c']);
		});

		test('handles only delimiters', async () => {
			const data = asyncGen(['\n\n\n']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['', '', '']);
		});

		test('handles no matching delimiter', async () => {
			const data = asyncGen(['no delimiter here']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '||'));
			assert.deepStrictEqual(result, ['no delimiter here']);
		});

		test('handles unicode characters', async () => {
			const data = asyncGen(['🎉\n✨\n🚀']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, ['🎉', '✨', '🚀']);
		});

		test('handles tab delimiter', async () => {
			const data = asyncGen(['col1\tcol2\tcol3']);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\t'));
			assert.deepStrictEqual(result, ['col1', 'col2', 'col3']);
		});

		test('handles empty async iterable', async () => {
			const data = asyncGen([]);
			const result = await collectAsync(iterateAsyncByDelimiter(data, '\n'));
			assert.deepStrictEqual(result, []);
		});
	});
});
