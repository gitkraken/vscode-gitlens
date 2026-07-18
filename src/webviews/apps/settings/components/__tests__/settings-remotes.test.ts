import * as assert from 'assert';
import type { RemotesUrlsConfig } from '../../../../../config.js';
import { isPersistable, projectEntry, urlsComplete } from '../settings-remotes.js';

/**
 * The Custom Remotes editor (#5392 Doc C) mirrors the autolinks editor's
 * write-and-warn persistence model: `projectEntry`/`isPersistable` are the
 * correctness core — they guarantee the editor never writes an entry the
 * permissive `custom.ts` consumer would silently drop (no matcher, or an
 * incomplete `urls` block for `type: Custom`), and never writes a
 * schema-invalid explicit-`null` matcher (the inactive matcher is omitted
 * entirely, not nulled). These are pure functions, so they're covered
 * directly rather than through the rendered component.
 */
suite('settings — Custom Remotes editor entry projection', () => {
	suite('projectEntry', () => {
		test('a domain-mode draft yields a domain entry with no regex key', () => {
			const entry = projectEntry({ type: 'GitHub', matcherMode: 'domain', domain: 'git.example.com' });
			assert.strictEqual(entry.domain, 'git.example.com');
			assert.ok(!('regex' in entry), 'a domain-mode entry must not carry a regex key');
		});

		test('a regex-mode draft yields a regex entry with no domain key', () => {
			const entry = projectEntry({
				type: 'GitHub',
				matcherMode: 'regex',
				regex: String.raw`\bgit\.example\.com\b`,
			});
			assert.strictEqual(entry.regex, String.raw`\bgit\.example\.com\b`);
			assert.ok(!('domain' in entry), 'a regex-mode entry must not carry a domain key');
		});

		test('includes name when set', () => {
			const entry = projectEntry({
				type: 'GitHub',
				matcherMode: 'domain',
				domain: 'git.example.com',
				name: 'My Host',
			});
			assert.strictEqual(entry.name, 'My Host');
		});

		test('omits the default "https" protocol', () => {
			const entry = projectEntry({
				type: 'GitHub',
				matcherMode: 'domain',
				domain: 'git.example.com',
				protocol: 'https',
			});
			assert.ok(!('protocol' in entry), 'the default protocol must not be persisted');
		});

		test('includes a non-default protocol', () => {
			const entry = projectEntry({
				type: 'GitHub',
				matcherMode: 'domain',
				domain: 'git.example.com',
				protocol: 'ssh',
			});
			assert.strictEqual(entry.protocol, 'ssh');
		});

		test('includes ignoreSSLErrors when set', () => {
			const entry = projectEntry({
				type: 'GitHub',
				matcherMode: 'domain',
				domain: 'git.example.com',
				ignoreSSLErrors: true,
			});
			assert.strictEqual(entry.ignoreSSLErrors, true);
		});

		test('a type: Custom draft with urls keeps the urls block', () => {
			const urls = completeUrls();
			const entry = projectEntry({
				type: 'Custom',
				matcherMode: 'domain',
				domain: 'git.example.com',
				urls: urls,
			});
			assert.strictEqual(entry.urls, urls);
		});

		test('a non-Custom draft omits urls even when present', () => {
			const urls = completeUrls();
			const entry = projectEntry({
				type: 'GitHub',
				matcherMode: 'domain',
				domain: 'git.example.com',
				urls: urls,
			});
			assert.ok(!('urls' in entry), 'a non-Custom entry must never carry a urls block');
		});
	});

	suite('isPersistable', () => {
		test('no matcher (empty domain in domain-mode) is not persistable', () => {
			assert.strictEqual(isPersistable({ type: 'GitHub', matcherMode: 'domain', domain: '' }), false);
		});

		test('a domain present on a non-Custom draft is persistable', () => {
			assert.strictEqual(
				isPersistable({ type: 'GitHub', matcherMode: 'domain', domain: 'git.example.com' }),
				true,
			);
		});

		test('a regex present on a non-Custom draft is persistable', () => {
			assert.strictEqual(isPersistable({ type: 'GitHub', matcherMode: 'regex', regex: '.*' }), true);
		});

		test('a non-compiling regex is still persistable (write-and-warn)', () => {
			assert.strictEqual(isPersistable({ type: 'GitHub', matcherMode: 'regex', regex: '[' }), true);
		});

		test('a type: Custom draft with an incomplete urls block is not persistable', () => {
			const { fileRange: _fileRange, ...incomplete } = completeUrls();
			assert.strictEqual(
				isPersistable({
					type: 'Custom',
					matcherMode: 'domain',
					domain: 'git.example.com',
					urls: incomplete as unknown as RemotesUrlsConfig,
				}),
				false,
			);
		});

		test('a type: Custom draft with all 9 required urls fields is persistable', () => {
			assert.strictEqual(
				isPersistable({
					type: 'Custom',
					matcherMode: 'domain',
					domain: 'git.example.com',
					urls: completeUrls(),
				}),
				true,
			);
		});
	});

	// Sanity check on the fixture helper itself, so a future edit to
	// `requiredUrlFields` in the source can't silently desync from this test's assumptions.
	test('urlsComplete recognizes the fixture as complete', () => {
		assert.strictEqual(urlsComplete(completeUrls()), true);
	});
});

/** A `urls` block with all 9 schema-required fields populated. */
function completeUrls(): RemotesUrlsConfig {
	return {
		repository: 'https://example.com/repository',
		branches: 'https://example.com/branches',
		branch: 'https://example.com/branch',
		commit: 'https://example.com/commit',
		file: 'https://example.com/file',
		fileInBranch: 'https://example.com/fileInBranch',
		fileInCommit: 'https://example.com/fileInCommit',
		fileLine: 'https://example.com/fileLine',
		fileRange: 'https://example.com/fileRange',
	};
}
