import * as assert from 'assert';
import type { SearchQuery } from '../../models/search.js';
import {
	areSearchQueriesEqual,
	getSearchQueryComparisonKey,
	parseSearchQuery,
	parseSearchQueryGitCommand,
	parseSearchQueryGitHubCommand,
	rebuildSearchQueryFromParsed,
} from '../search.utils.js';

function q(query: string, overrides?: Partial<SearchQuery>): SearchQuery {
	return { query: query, ...overrides };
}

suite('Search Utils Test Suite', () => {
	suite('parseSearchQuery', () => {
		test('empty string returns empty operations', () => {
			const result = parseSearchQuery(q(''));
			assert.strictEqual(result.operations.size, 0);
			assert.strictEqual(result.errors, undefined);
			assert.strictEqual(result.operatorRanges, undefined);
		});

		test('whitespace-only input returns empty operations', () => {
			const result = parseSearchQuery(q('   '));
			assert.strictEqual(result.operations.size, 0);
		});

		test('plain text defaults to message: operator', () => {
			const result = parseSearchQuery(q('hello'));
			assert.strictEqual(result.operations.size, 1);
			const messages = result.operations.get('message:');
			assert.ok(messages);
			assert.ok(messages.has('hello'));
		});

		test('multiple plain text words are separate message values', () => {
			const result = parseSearchQuery(q('hello world'));
			const messages = result.operations.get('message:');
			assert.ok(messages);
			assert.ok(messages.has('hello'));
			assert.ok(messages.has('world'));
		});

		test('@: operator maps to author:', () => {
			const result = parseSearchQuery(q('@:john'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('john'));
		});

		test('author: long-form operator works', () => {
			const result = parseSearchQuery(q('author:john'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('john'));
		});

		test('#: operator maps to commit:', () => {
			const result = parseSearchQuery(q('#:abc1234'));
			const commits = result.operations.get('commit:');
			assert.ok(commits);
			assert.ok(commits.has('abc1234'));
		});

		test('commit: long-form operator works', () => {
			const result = parseSearchQuery(q('commit:abc1234'));
			const commits = result.operations.get('commit:');
			assert.ok(commits);
			assert.ok(commits.has('abc1234'));
		});

		test('=: operator maps to message:', () => {
			const result = parseSearchQuery(q('=:fix'));
			const messages = result.operations.get('message:');
			assert.ok(messages);
			assert.ok(messages.has('fix'));
		});

		test('~: operator maps to change:', () => {
			const result = parseSearchQuery(q('~:functionName'));
			const changes = result.operations.get('change:');
			assert.ok(changes);
			assert.ok(changes.has('functionName'));
		});

		test('change: long-form operator works', () => {
			const result = parseSearchQuery(q('change:myFunc'));
			const changes = result.operations.get('change:');
			assert.ok(changes);
			assert.ok(changes.has('myFunc'));
		});

		test('?: operator maps to file:', () => {
			const result = parseSearchQuery(q('?:readme.md'));
			const files = result.operations.get('file:');
			assert.ok(files);
			assert.ok(files.has('readme.md'));
		});

		test('file: long-form operator works', () => {
			const result = parseSearchQuery(q('file:readme.md'));
			const files = result.operations.get('file:');
			assert.ok(files);
			assert.ok(files.has('readme.md'));
		});

		test('is: operator maps to type:', () => {
			const result = parseSearchQuery(q('is:stash'));
			const types = result.operations.get('type:');
			assert.ok(types);
			assert.ok(types.has('stash'));
		});

		test('>: operator maps to after:', () => {
			const result = parseSearchQuery(q('>:2024-01-01'));
			const after = result.operations.get('after:');
			assert.ok(after);
			assert.ok(after.has('2024-01-01'));
		});

		test('<: operator maps to before:', () => {
			const result = parseSearchQuery(q('<:2024-12-31'));
			const before = result.operations.get('before:');
			assert.ok(before);
			assert.ok(before.has('2024-12-31'));
		});

		test('since: maps to after:', () => {
			const result = parseSearchQuery(q('since:2024-01-01'));
			const after = result.operations.get('after:');
			assert.ok(after);
			assert.ok(after.has('2024-01-01'));
		});

		test('until: maps to before:', () => {
			const result = parseSearchQuery(q('until:2024-12-31'));
			const before = result.operations.get('before:');
			assert.ok(before);
			assert.ok(before.has('2024-12-31'));
		});

		test('^: operator maps to ref:', () => {
			const result = parseSearchQuery(q('^:main'));
			const refs = result.operations.get('ref:');
			assert.ok(refs);
			assert.ok(refs.has('main'));
		});

		test('quoted values preserve inner spaces', () => {
			const result = parseSearchQuery(q('@:"John Doe"'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('"John Doe"'));
		});

		test('unterminated quote takes the rest of the string', () => {
			const result = parseSearchQuery(q('@:"John Doe'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('"John Doe'));
		});

		test('multiple operators produce multiple operation entries', () => {
			const result = parseSearchQuery(q('@:john ~:fix'));
			assert.strictEqual(result.operations.size, 2);

			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('john'));

			const changes = result.operations.get('change:');
			assert.ok(changes);
			assert.ok(changes.has('fix'));
		});

		test('same operator used twice merges values into one set', () => {
			const result = parseSearchQuery(q('@:alice @:bob'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.strictEqual(authors.size, 2);
			assert.ok(authors.has('alice'));
			assert.ok(authors.has('bob'));
		});

		test('@me is detected as author: with value @me', () => {
			const result = parseSearchQuery(q('@me'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('@me'));
		});

		test('@me generates operatorRange with @me operator', () => {
			const result = parseSearchQuery(q('@me'));
			assert.ok(result.operatorRanges);
			assert.strictEqual(result.operatorRanges.length, 1);
			assert.strictEqual(result.operatorRanges[0].operator, '@me');
			assert.strictEqual(result.operatorRanges[0].start, 0);
			assert.strictEqual(result.operatorRanges[0].end, 3);
		});

		test('full SHA (40 hex chars) is detected as commit:', () => {
			const sha = 'a'.repeat(40);
			const result = parseSearchQuery(q(sha));
			const commits = result.operations.get('commit:');
			assert.ok(commits);
			assert.ok(commits.has(sha));
		});

		test('non-SHA plain text is treated as message:', () => {
			const result = parseSearchQuery(q('notasha'));
			const messages = result.operations.get('message:');
			assert.ok(messages);
			assert.ok(messages.has('notasha'));
		});

		test('mixed operators and plain text', () => {
			const result = parseSearchQuery(q('bugfix @:alice'));
			const messages = result.operations.get('message:');
			assert.ok(messages);
			assert.ok(messages.has('bugfix'));

			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('alice'));
		});

		test('operator with space between operator and value', () => {
			const result = parseSearchQuery(q('@: john'));
			const authors = result.operations.get('author:');
			assert.ok(authors);
			assert.ok(authors.has('john'));
		});

		test('operatorRanges tracks positions for operators', () => {
			const result = parseSearchQuery(q('@:john'));
			assert.ok(result.operatorRanges);
			assert.strictEqual(result.operatorRanges.length, 1);
			assert.strictEqual(result.operatorRanges[0].start, 0);
			assert.strictEqual(result.operatorRanges[0].end, 2);
			assert.strictEqual(result.operatorRanges[0].operator, '@:');
		});

		test('operatorRanges tracks multiple operators at correct positions', () => {
			// "@:alice ~:fix" - @: at 0..2, ~: at 8..10
			const result = parseSearchQuery(q('@:alice ~:fix'));
			assert.ok(result.operatorRanges);
			assert.strictEqual(result.operatorRanges.length, 2);
			assert.strictEqual(result.operatorRanges[0].operator, '@:');
			assert.strictEqual(result.operatorRanges[0].start, 0);
			assert.strictEqual(result.operatorRanges[0].end, 2);
			assert.strictEqual(result.operatorRanges[1].operator, '~:');
			assert.strictEqual(result.operatorRanges[1].start, 8);
			assert.strictEqual(result.operatorRanges[1].end, 10);
		});

		test('plain text without operators has no operatorRanges', () => {
			const result = parseSearchQuery(q('hello world'));
			assert.strictEqual(result.operatorRanges, undefined);
		});

		test('validate mode produces error for operator without value', () => {
			// Operator at end of string with no value: "@:" will match empty-string operator '' (skipped),
			// then try other operators. Actually let's use a query like "message:" with nothing after
			// The parser matches "message:" operator, then value is empty string ''
			const result = parseSearchQuery(q('message:'), true);
			// Value will be empty string which is falsy, so it triggers the validation branch
			assert.ok(result.errors);
			assert.ok(result.errors.length > 0);
		});

		test('quoted plain text (no operator) is treated as message', () => {
			const result = parseSearchQuery(q('"hello world"'));
			const messages = result.operations.get('message:');
			assert.ok(messages);
			assert.ok(messages.has('"hello world"'));
		});
	});

	suite('parseSearchQueryGitCommand', () => {
		test('message query produces --grep args', () => {
			const result = parseSearchQueryGitCommand(q('=:bugfix'), undefined);
			assert.ok(result.args.includes('--grep=bugfix'));
			assert.ok(result.args.includes('--all'));
		});

		test('author query produces --author args', () => {
			const result = parseSearchQueryGitCommand(q('@:alice'), undefined);
			assert.ok(result.args.includes('--author=alice'));
			assert.ok(result.args.includes('--all'));
		});

		test('@me with currentUser resolves to user name', () => {
			const user = { name: 'Alice Smith', email: 'alice@example.com' };
			const result = parseSearchQueryGitCommand(q('@me'), user);
			assert.ok(result.args.includes('--author=Alice Smith'));
		});

		test('@me without currentUser is skipped', () => {
			const result = parseSearchQueryGitCommand(q('@me'), undefined);
			const hasAuthor = result.args.some(a => a.startsWith('--author='));
			assert.strictEqual(hasAuthor, false);
		});

		test('commit/SHA query uses SHA directly without --all', () => {
			const result = parseSearchQueryGitCommand(q('#:abc1234'), undefined);
			assert.ok(result.args.includes('abc1234'));
			assert.ok(!result.args.includes('--all'));
			assert.ok(result.shas);
			assert.ok(result.shas.has('abc1234'));
		});

		test('file query produces pathspec in files array', () => {
			const result = parseSearchQueryGitCommand(q('?:readme.md'), undefined);
			assert.ok(result.filters.files);
			assert.ok(result.files.length > 0);
		});

		test('quoted file preserves exact path', () => {
			const result = parseSearchQueryGitCommand(q('?:"src/index.ts"'), undefined);
			assert.ok(result.filters.files);
			assert.ok(result.files.includes('src/index.ts'));
		});

		test('file with glob pattern uses :(glob) prefix', () => {
			const result = parseSearchQueryGitCommand(q('?:**/*.ts'), undefined);
			assert.ok(result.filters.files);
			assert.ok(result.files.some(f => f.includes(':(glob)')));
		});

		test('simple file name gets wildcard wrapping', () => {
			const result = parseSearchQueryGitCommand(q('?:utils'), undefined);
			assert.ok(result.filters.files);
			assert.ok(result.files.some(f => f.includes('*utils*')));
		});

		test('change query with matchRegex produces -G arg', () => {
			const result = parseSearchQueryGitCommand(q('~:pattern', { matchRegex: true }), undefined);
			assert.ok(result.args.includes('-Gpattern'));
			assert.ok(result.filters.files);
		});

		test('change query without matchRegex produces -S arg', () => {
			const result = parseSearchQueryGitCommand(q('~:pattern'), undefined);
			assert.ok(result.args.includes('-Spattern'));
		});

		test('message query with matchAll adds --all-match', () => {
			const result = parseSearchQueryGitCommand(q('=:fix', { matchAll: true }), undefined);
			assert.ok(result.args.includes('--all-match'));
			assert.ok(result.args.includes('--grep=fix'));
		});

		test('message query adds --fixed-strings by default', () => {
			const result = parseSearchQueryGitCommand(q('=:fix'), undefined);
			assert.ok(result.args.includes('--fixed-strings'));
		});

		test('message query with matchRegex adds --extended-regexp', () => {
			const result = parseSearchQueryGitCommand(q('=:fix', { matchRegex: true }), undefined);
			assert.ok(result.args.includes('--extended-regexp'));
		});

		test('regex with case insensitive adds --regexp-ignore-case', () => {
			const result = parseSearchQueryGitCommand(q('=:fix', { matchRegex: true, matchCase: false }), undefined);
			assert.ok(result.args.includes('--regexp-ignore-case'));
		});

		test('regex with matchCase does not add --regexp-ignore-case', () => {
			const result = parseSearchQueryGitCommand(q('=:fix', { matchRegex: true, matchCase: true }), undefined);
			assert.ok(!result.args.includes('--regexp-ignore-case'));
		});

		test('matchWholeWord + matchRegex wraps value with word boundaries', () => {
			const result = parseSearchQueryGitCommand(
				q('=:fix', { matchWholeWord: true, matchRegex: true }),
				undefined,
			);
			assert.ok(result.args.includes('--grep=\\bfix\\b'));
		});

		test('date operators produce --since and --until', () => {
			const result = parseSearchQueryGitCommand(q('>:2024-01-01 <:2024-12-31'), undefined);
			assert.ok(result.args.includes('--since=2024-01-01'));
			assert.ok(result.args.includes('--until=2024-12-31'));
		});

		test('type:stash adds --no-walk filter', () => {
			const result = parseSearchQueryGitCommand(q('is:stash'), undefined);
			assert.ok(result.args.includes('--no-walk'));
			assert.strictEqual(result.filters.type, 'stash');
		});

		test('type:tip sets filter type to tip', () => {
			const result = parseSearchQueryGitCommand(q('is:tip'), undefined);
			assert.strictEqual(result.filters.type, 'tip');
		});

		test('type:wip sets filter type to wip', () => {
			const result = parseSearchQueryGitCommand(q('is:wip'), undefined);
			assert.strictEqual(result.filters.type, 'wip');
		});

		test('ref: replaces --all with specific ref', () => {
			const result = parseSearchQueryGitCommand(q('^:main'), undefined);
			assert.ok(result.args.includes('main'));
			assert.ok(!result.args.includes('--all'));
			assert.ok(result.filters.refs);
		});

		test('author with leading @ strips it', () => {
			const result = parseSearchQueryGitCommand(q('@:@username'), undefined);
			assert.ok(result.args.includes('--author=username'));
		});

		test('multiple operators combined', () => {
			const result = parseSearchQueryGitCommand(q('@:alice =:bugfix'), undefined);
			assert.ok(result.args.includes('--author=alice'));
			assert.ok(result.args.includes('--grep=bugfix'));
		});
	});

	suite('parseSearchQueryGitHubCommand', () => {
		test('message query produces plain text args', () => {
			const result = parseSearchQueryGitHubCommand(q('=:bugfix'), undefined);
			assert.ok(result.args.includes('bugfix'));
		});

		test('message with spaces uses + separator', () => {
			const result = parseSearchQueryGitHubCommand(q('=:"fix bug"'), undefined);
			assert.ok(result.args.some(a => a.includes('fix+bug')));
		});

		test('author with @ prefix uses author: syntax', () => {
			const result = parseSearchQueryGitHubCommand(q('@:@username'), undefined);
			// @username -> value starts with @ -> strips it -> author:sername
			assert.ok(result.args.some(a => a.startsWith('author:')));
		});

		test('author with email uses author-email: syntax', () => {
			const result = parseSearchQueryGitHubCommand(q('@:alice@example.com'), undefined);
			assert.ok(result.args.some(a => a.startsWith('author-email:')));
		});

		test('author with plain name uses author-name: syntax', () => {
			const result = parseSearchQueryGitHubCommand(q('@:alice'), undefined);
			assert.ok(result.args.some(a => a.startsWith('author-name:')));
		});

		test('@me with currentUser resolves to GitHub username', () => {
			const user = { name: 'Alice Smith', email: 'alice@example.com', username: 'alicegh' };
			const result = parseSearchQueryGitHubCommand(q('@me'), user);
			// @me -> value becomes @alicegh -> starts with @ -> author: syntax
			assert.ok(result.args.some(a => a.startsWith('author:')));
		});

		test('after date with non-YYYY-MM-DD value uses author-date:> syntax', () => {
			const result = parseSearchQueryGitHubCommand(q('>:2weeks'), undefined);
			assert.ok(result.args.some(a => a.startsWith('author-date:>')));
			assert.ok(result.args.includes('author-date:>2weeks'));
		});

		test('before date with non-YYYY-MM-DD value uses author-date:< syntax', () => {
			const result = parseSearchQueryGitHubCommand(q('<:yesterday'), undefined);
			assert.ok(result.args.some(a => a.startsWith('author-date:<')));
			assert.ok(result.args.includes('author-date:<yesterday'));
		});

		test('YYYY-MM-DD dates are excluded from GitHub date args', () => {
			// The implementation skips YYYY-MM-DD formatted dates
			const result = parseSearchQueryGitHubCommand(q('>:2024-01-01'), undefined);
			assert.strictEqual(result.args.length, 0);
		});
	});

	suite('getSearchQueryComparisonKey', () => {
		test('produces a key from query and flags', () => {
			const key = getSearchQueryComparisonKey(q('hello', { matchAll: true, matchCase: true }));
			assert.strictEqual(key, 'hello|AC');
		});

		test('includes all flag indicators', () => {
			const key = getSearchQueryComparisonKey(
				q('test', {
					matchAll: true,
					matchCase: true,
					matchRegex: true,
					matchWholeWord: true,
					naturalLanguage: true,
				}),
			);
			assert.strictEqual(key, 'test|ACRWNL');
		});

		test('no flags produces only pipe separator', () => {
			const key = getSearchQueryComparisonKey(q('test'));
			assert.strictEqual(key, 'test|');
		});
	});

	suite('rebuildSearchQueryFromParsed', () => {
		test('round-trips a simple operator query', () => {
			const parsed = parseSearchQuery(q('@:alice'));
			const rebuilt = rebuildSearchQueryFromParsed(parsed);
			assert.strictEqual(rebuilt, 'author:alice');
		});

		test('round-trips multiple operators', () => {
			const parsed = parseSearchQuery(q('@:alice =:fix'));
			const rebuilt = rebuildSearchQueryFromParsed(parsed);
			// Operations map uses long-form keys, so output uses long-form operators
			assert.ok(rebuilt.includes('author:alice'));
			assert.ok(rebuilt.includes('message:fix'));
		});
	});

	suite('areSearchQueriesEqual', () => {
		test('identical queries are equal', () => {
			const a = q('hello', { matchCase: true });
			const b = q('hello', { matchCase: true });
			assert.strictEqual(areSearchQueriesEqual(a, b), true);
		});

		test('different query strings are not equal', () => {
			assert.strictEqual(areSearchQueriesEqual(q('hello'), q('world')), false);
		});

		test('different flags are not equal', () => {
			assert.strictEqual(areSearchQueriesEqual(q('hello', { matchCase: true }), q('hello')), false);
		});

		test('both undefined are equal', () => {
			assert.strictEqual(areSearchQueriesEqual(undefined, undefined), true);
		});

		test('one undefined is not equal', () => {
			assert.strictEqual(areSearchQueriesEqual(q('hello'), undefined), false);
			assert.strictEqual(areSearchQueriesEqual(undefined, q('hello')), false);
		});

		test('same reference is equal', () => {
			const a = q('hello');
			assert.strictEqual(areSearchQueriesEqual(a, a), true);
		});
	});
});
