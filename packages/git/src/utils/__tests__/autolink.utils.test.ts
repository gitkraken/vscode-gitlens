import * as assert from 'assert';
import type { CacheableAutolinkReference, DynamicAutolinkReference, RefSet } from '../../models/autolink.js';
import {
	ensureCachedBranchNameRegexes,
	ensureCachedRegex,
	getAutolinks,
	getBranchAutolinks,
} from '../autolink.utils.js';

function makeRef(overrides?: Partial<CacheableAutolinkReference>): CacheableAutolinkReference {
	return {
		prefix: 'JIRA-',
		url: 'https://jira.example.com/browse/JIRA-<num>',
		alphanumeric: false,
		ignoreCase: false,
		title: undefined,
		...overrides,
	};
}

suite('Autolink Utils Test Suite', () => {
	suite('ensureCachedRegex', () => {
		test('creates regex that matches prefix followed by digits in plaintext', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'plaintext');

			assert.ok(ref.messageRegex != null);
			const match = ref.messageRegex.exec('Fixes JIRA-123');
			assert.ok(match != null, 'Should match JIRA-123');
			assert.strictEqual(match[3], '123');
		});

		test('matches prefix at start of string', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'plaintext');

			const match = ref.messageRegex.exec('JIRA-456 is done');
			assert.ok(match != null, 'Should match at start of string');
			assert.strictEqual(match[3], '456');
		});

		test('matches prefix after opening brackets', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'plaintext');

			for (const opener of ['(', '[', '{']) {
				ref.messageRegex.lastIndex = 0;
				const match = ref.messageRegex.exec(`${opener}JIRA-99)`);
				assert.ok(match != null, `Should match after '${opener}'`);
				assert.strictEqual(match[3], '99');
			}
		});

		test('numeric-only ref does not match alphabetic characters', () => {
			const ref = makeRef({ alphanumeric: false });
			ensureCachedRegex(ref, 'plaintext');

			const match = ref.messageRegex.exec('JIRA-abc');
			assert.strictEqual(match, null, 'Should not match alphabetic id with alphanumeric: false');
		});

		test('alphanumeric ref matches alphabetic and mixed ids', () => {
			const ref = makeRef({ alphanumeric: true });
			ensureCachedRegex(ref, 'plaintext');

			const match = ref.messageRegex.exec('JIRA-abc');
			assert.ok(match != null, 'Should match alphabetic id with alphanumeric: true');
			assert.strictEqual(match[3], 'abc');

			ref.messageRegex.lastIndex = 0;
			const match2 = ref.messageRegex.exec('JIRA-a1b2');
			assert.ok(match2 != null, 'Should match mixed id');
			assert.strictEqual(match2[3], 'a1b2');
		});

		test('ignoreCase creates case-insensitive regex', () => {
			const ref = makeRef({ ignoreCase: true });
			ensureCachedRegex(ref, 'plaintext');

			assert.ok(ref.messageRegex.flags.includes('i'), 'Regex should have the i flag');
			const match = ref.messageRegex.exec('jira-123');
			assert.ok(match != null, 'Should match lowercase prefix');
		});

		test('case-sensitive regex does not match wrong case', () => {
			const ref = makeRef({ ignoreCase: false });
			ensureCachedRegex(ref, 'plaintext');

			assert.ok(!ref.messageRegex.flags.includes('i'), 'Regex should not have the i flag');
			const match = ref.messageRegex.exec('jira-123');
			assert.strictEqual(match, null, 'Should not match lowercase with ignoreCase: false');
		});

		test('html output format populates messageHtmlRegex', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'html');

			assert.ok(ref.messageHtmlRegex != null, 'Should have messageHtmlRegex');
			assert.strictEqual(ref.messageRegex, undefined, 'Should not have messageRegex');
			assert.strictEqual(ref.messageMarkdownRegex, undefined, 'Should not have messageMarkdownRegex');
		});

		test('markdown output format populates messageMarkdownRegex', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'markdown');

			assert.ok(ref.messageMarkdownRegex != null, 'Should have messageMarkdownRegex');
			assert.strictEqual(ref.messageRegex, undefined, 'Should not have messageRegex');
			assert.strictEqual(ref.messageHtmlRegex, undefined, 'Should not have messageHtmlRegex');
		});

		test('caches regex on repeated calls (same reference returned)', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'plaintext');
			const first = ref.messageRegex;

			ensureCachedRegex(ref, 'plaintext');
			const second = ref.messageRegex;

			assert.strictEqual(first, second, 'Should return the same cached regex instance');
		});

		test('each output format has its own cached regex', () => {
			const ref = makeRef();
			ensureCachedRegex(ref, 'plaintext');
			ensureCachedRegex(ref, 'html');
			ensureCachedRegex(ref, 'markdown');

			assert.ok(ref.messageRegex != null);
			assert.ok(ref.messageHtmlRegex != null);
			assert.ok(ref.messageMarkdownRegex != null);
			assert.notStrictEqual(ref.messageRegex, ref.messageHtmlRegex);
			assert.notStrictEqual(ref.messageRegex, ref.messageMarkdownRegex);
		});
	});

	suite('ensureCachedBranchNameRegexes', () => {
		test('matches single-digit issues with configured hyphen and underscore prefixes', () => {
			for (const [prefix, id] of [
				['PROJ_', '1'],
				['PROJ-', '9'],
			]) {
				const refs: RefSet[] = [
					[undefined, [makeRef({ prefix: prefix, url: 'https://jira.example.com/browse/PROJ-<num>' })]],
				];
				for (const branch of [`${prefix}${id}`, `feature/${prefix}${id}-description`]) {
					const links = [...getBranchAutolinks(branch, refs).values()];
					assert.strictEqual(links.length, 1, branch);
					assert.strictEqual(links[0].id, id, branch);
					assert.strictEqual(links[0].url, `https://jira.example.com/browse/PROJ-${id}`, branch);
				}
				for (const branch of [`feature/${prefix}`, `feature/${prefix}${id}x`, 'feature/OTHER-1']) {
					assert.strictEqual(getBranchAutolinks(branch, refs).size, 0, branch);
				}
			}
		});

		test('preserves minimum digits and false-positive guards for unprefixed branches', () => {
			const refs: RefSet[] = [[undefined, [makeRef({ prefix: '' })]]];
			for (const branch of ['1', '12', 'feature/1', 'fix-9', 'feature/12x', 'a12b', 'release/1.2']) {
				assert.strictEqual(getBranchAutolinks(branch, refs).size, 0, branch);
			}
			for (const branch of ['feature/12', 'fix-99-description', '123', 'work123']) {
				assert.strictEqual(getBranchAutolinks(branch, refs).size, 1, branch);
			}
		});

		test('treats configured prefixes as literal text, including regex metacharacters', () => {
			const ref = makeRef({ prefix: '[OPS.+-' });
			const refs: RefSet[] = [[undefined, [ref]]];
			assert.strictEqual(getBranchAutolinks('feature/[OPS.+-12', refs).size, 1);
			assert.strictEqual(getBranchAutolinks('feature/OPSxx-12', refs).size, 0);
			assert.strictEqual(getBranchAutolinks('feature/[OPS.+-1', refs).size, 1);
			assert.strictEqual(getBranchAutolinks('feature/OPSxx-1', refs).size, 0);
		});

		test('creates regexes for a ref with a prefix', () => {
			const ref = makeRef({ prefix: 'JIRA-' });
			ensureCachedBranchNameRegexes(ref);

			assert.ok(ref.branchNameRegexes != null);
			assert.ok(ref.branchNameRegexes.length > 0);
		});

		test('matches prefix followed by digits in branch name', () => {
			const ref = makeRef({ prefix: 'JIRA-' });
			ensureCachedBranchNameRegexes(ref);

			const match = 'feature/JIRA-123-description'.match(ref.branchNameRegexes[0]);
			assert.ok(match != null, 'Should match JIRA-123 in branch name');
			assert.strictEqual(match.groups?.issueKeyNumber, '123');
		});

		test('matches prefix at start of branch name', () => {
			const ref = makeRef({ prefix: 'JIRA-' });
			ensureCachedBranchNameRegexes(ref);

			const match = 'JIRA-456-some-work'.match(ref.branchNameRegexes[0]);
			assert.ok(match != null, 'Should match prefix at start of branch name');
			assert.strictEqual(match.groups?.issueKeyNumber, '456');
		});

		test('creates fallback regexes for empty prefix', () => {
			const ref = makeRef({ prefix: '' });
			ensureCachedBranchNameRegexes(ref);

			assert.ok(ref.branchNameRegexes != null);
			// Empty prefix uses keyword-based and digit-based fallback regexes
			assert.ok(ref.branchNameRegexes.length > 1, 'Should have multiple fallback regexes');
		});

		test('caches branch name regexes on repeated calls', () => {
			const ref = makeRef({ prefix: 'JIRA-' });
			ensureCachedBranchNameRegexes(ref);
			const first = ref.branchNameRegexes;

			ensureCachedBranchNameRegexes(ref);
			const second = ref.branchNameRegexes;

			assert.strictEqual(first, second, 'Should return the same cached array');
		});
	});

	suite('getAutolinks', () => {
		test('limits static materialization and resets the cached regex for the next call', () => {
			const ref = makeRef();
			let materialized = 0;
			Object.defineProperty(ref, 'title', {
				get: () => {
					materialized++;
					return undefined;
				},
			});
			const refs: RefSet[] = [[undefined, [ref]]];
			const message = Array.from({ length: 10000 }, (_, i) => `JIRA-${i + 1}`).join(' ');
			assert.deepStrictEqual([...getAutolinks(message, refs, { maxResults: 2 }).keys()], ['1', '2']);
			assert.strictEqual(materialized, 2, 'the limit is applied while constructing results');
			assert.strictEqual(ref.messageRegex?.lastIndex, 0);
			assert.strictEqual(getAutolinks(message, refs).size, 10000);
		});

		test('shares the limit across reference sets and accepts an empty budget', () => {
			const refs: RefSet[] = [
				[undefined, [makeRef()]],
				[undefined, [makeRef({ prefix: 'OPS-' })]],
			];
			assert.deepStrictEqual([...getAutolinks('JIRA-1 OPS-2 OPS-3', refs, { maxResults: 2 }).keys()], ['1', '2']);
			assert.strictEqual(getAutolinks('JIRA-1', refs, { maxResults: 0 }).size, 0);
			assert.strictEqual(getAutolinks('JIRA-1 JIRA-2', refs, { maxResults: 1.9 }).size, 1);
		});

		test('counts dynamic entries toward the total result budget', () => {
			const dynamic: DynamicAutolinkReference = {
				parse: (_, autolinks) => {
					autolinks.set('1', { ...makeRef(), id: '1' });
				},
			};
			const refs: RefSet[] = [[undefined, [dynamic, makeRef()]]];
			assert.deepStrictEqual([...getAutolinks('JIRA-2 JIRA-3', refs, { maxResults: 2 }).keys()], ['1', '2']);
			assert.deepStrictEqual([...getAutolinks('JIRA-2', refs, { maxResults: 1 }).keys()], ['1']);
		});

		test('lets an opaque dynamic callback finish even when it exceeds the result budget', () => {
			const dynamic: DynamicAutolinkReference = {
				parse: (_, autolinks) => {
					for (const id of ['1', '2', '3']) {
						autolinks.set(id, { ...makeRef(), id: id });
					}
				},
			};
			const refs: RefSet[] = [[undefined, [dynamic, makeRef()]]];
			assert.deepStrictEqual([...getAutolinks('JIRA-4', refs, { maxResults: 2 }).keys()], ['1', '2', '3']);
			assert.deepStrictEqual([...getAutolinks('JIRA-4', refs).keys()], ['1', '2', '3', '4']);
		});

		test('extracts autolink from commit message', () => {
			const ref = makeRef();
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getAutolinks('Fixes JIRA-123', refsets);

			assert.strictEqual(result.size, 1);
			const autolink = result.get('123');
			assert.ok(autolink != null);
			assert.strictEqual(autolink.id, '123');
			assert.strictEqual(autolink.prefix, 'JIRA-');
			assert.strictEqual(autolink.url, 'https://jira.example.com/browse/JIRA-123');
		});

		test('extracts multiple matches from the same message', () => {
			const ref = makeRef();
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getAutolinks('Fixes JIRA-100 and JIRA-200', refsets);

			assert.strictEqual(result.size, 2);
			assert.ok(result.has('100'));
			assert.ok(result.has('200'));
		});

		test('returns empty map when no matches found', () => {
			const ref = makeRef();
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getAutolinks('No links here', refsets);

			assert.strictEqual(result.size, 0);
		});

		test('extracts alphanumeric ids when enabled', () => {
			const ref = makeRef({ alphanumeric: true });
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getAutolinks('See JIRA-abc123', refsets);

			assert.strictEqual(result.size, 1);
			const autolink = result.get('abc123');
			assert.ok(autolink != null);
			assert.strictEqual(autolink.id, 'abc123');
		});

		test('replaces <num> in url and title', () => {
			const ref = makeRef({
				title: 'Issue <num>',
				description: 'Ticket <num> details',
			});
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getAutolinks('Fixes JIRA-42', refsets);

			const autolink = result.get('42');
			assert.ok(autolink != null);
			assert.strictEqual(autolink.url, 'https://jira.example.com/browse/JIRA-42');
			assert.strictEqual(autolink.title, 'Issue 42');
			assert.strictEqual(autolink.description, 'Ticket 42 details');
		});

		test('attaches provider to extracted autolinks', () => {
			const ref = makeRef();
			const provider = { id: 'jira', name: 'Jira', domain: 'jira.example.com', icon: 'jira' };
			const refsets: RefSet[] = [[provider, [ref]]];

			const result = getAutolinks('JIRA-55', refsets);

			const autolink = result.get('55');
			assert.ok(autolink != null);
			assert.deepStrictEqual(autolink.provider, provider);
		});

		test('skips refs with referenceType set to branch', () => {
			const ref = makeRef({ referenceType: 'branch' });
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getAutolinks('JIRA-10', refsets);

			assert.strictEqual(result.size, 0, 'Should skip branch-only refs');
		});
	});

	suite('getBranchAutolinks', () => {
		test('extracts autolink from branch name with prefix after directory separator', () => {
			const ref = makeRef();
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getBranchAutolinks('feature/JIRA-789-description', refsets);

			assert.strictEqual(result.size, 1);
			const entries = [...result.values()];
			assert.strictEqual(entries[0].id, '789');
			assert.strictEqual(entries[0].url, 'https://jira.example.com/browse/JIRA-789');
		});

		test('extracts autolink from start of branch name', () => {
			const ref = makeRef();
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getBranchAutolinks('JIRA-42-hotfix', refsets);

			assert.strictEqual(result.size, 1);
			const entries = [...result.values()];
			assert.strictEqual(entries[0].id, '42');
		});

		test('returns empty map when no matches found', () => {
			const ref = makeRef();
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getBranchAutolinks('feature/no-issue-here', refsets);

			assert.strictEqual(result.size, 0);
		});

		test('skips refs with type pullrequest', () => {
			const ref = makeRef({ type: 'pullrequest' });
			const refsets: RefSet[] = [[undefined, [ref]]];

			const result = getBranchAutolinks('feature/JIRA-100-work', refsets);

			assert.strictEqual(result.size, 0, 'Should skip pullrequest-type refs');
		});

		test('returns first match only (stops after first hit)', () => {
			const ref1 = makeRef({ prefix: 'JIRA-' });
			const ref2 = makeRef({ prefix: 'GH-', url: 'https://github.com/issues/<num>' });
			const refsets: RefSet[] = [[undefined, [ref1, ref2]]];

			const result = getBranchAutolinks('feature/JIRA-10-GH-20', refsets);

			assert.strictEqual(result.size, 1, 'Should return only the first match');
		});

		test('prioritizes provider when priorityProviderIds is specified', () => {
			const ghProvider = { id: 'github', name: 'GitHub', domain: 'github.com', icon: 'github' };
			const jiraProvider = { id: 'jira', name: 'Jira', domain: 'jira.example.com', icon: 'jira' };
			const ghRef = makeRef({ prefix: 'GH-', url: 'https://github.com/issues/<num>' });
			const jiraRef = makeRef({ prefix: 'JIRA-' });
			const refsets: RefSet[] = [
				[jiraProvider, [jiraRef]],
				[ghProvider, [ghRef]],
			];

			const result = getBranchAutolinks('feature/JIRA-10-GH-20', refsets, ['github']);

			assert.strictEqual(result.size, 1);
			const entries = [...result.values()];
			assert.strictEqual(entries[0].provider?.id, 'github', 'Should prefer the prioritized provider');
		});
	});
});
