import * as assert from 'assert';
import type { RemotesUrlsConfig } from '../../../../../config.js';
import type { RemoteRuleDraft } from '../../actions.js';
import { findEntryIndex, isEntryLive, isPersistable, projectEntry, urlsComplete } from '../settings-remotes.utils.js';

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

/**
 * `isEntryLive` reads a persisted config entry (no matcher-mode marker) and reports
 * whether it actually resolves in the consumer. It's what lets the editor tell the
 * truth when an in-progress edit is invalid: if the SAVED entry is still live, the
 * old matcher stays in effect, so the body says "unsaved" rather than "ignored".
 */
suite('settings — Custom Remotes editor live-entry predicate', () => {
	test('a saved entry with a matcher stays live even when the editing draft cleared it', () => {
		// The draft may be mid-clear/invalid, but the SAVED entry still resolves links
		assert.strictEqual(isEntryLive({ type: 'GitHub', domain: 'git.corp.com' }), true);
	});

	test('a regex-matcher entry is live', () => {
		assert.strictEqual(isEntryLive({ type: 'GitHub', regex: String.raw`\bgit\.corp\.com\b` }), true);
	});

	test('an entry with no matcher is not live', () => {
		assert.strictEqual(isEntryLive({ type: 'GitHub' }), false);
	});

	test('a type: Custom entry with a complete urls block is live', () => {
		assert.strictEqual(isEntryLive({ type: 'Custom', domain: 'git.corp.com', urls: completeUrls() }), true);
	});

	test('a type: Custom entry with an incomplete urls block is not live', () => {
		const { fileRange: _fileRange, ...incomplete } = completeUrls();
		assert.strictEqual(
			isEntryLive({ type: 'Custom', domain: 'git.corp.com', urls: incomplete as unknown as RemotesUrlsConfig }),
			false,
		);
	});

	test('a type: Custom entry with no urls block is not live', () => {
		assert.strictEqual(isEntryLive({ type: 'Custom', domain: 'git.corp.com' }), false);
	});

	test('an undefined entry (brand-new row) is not live', () => {
		assert.strictEqual(isEntryLive(undefined), false);
	});
});

/**
 * `findEntryIndex` relocates an open draft after an external `settings.json` edit
 * shifts the `remotes` array, so a later commit rewrites the entry we were editing
 * instead of whatever slid into its old index. Deep-equality is key-order-insensitive
 * so a hand-edit that merely reorders keys doesn't read as a different entry.
 */
suite('settings — Custom Remotes editor baseline relocation', () => {
	test('finds the baseline at a shifted index', () => {
		const baseline: RemoteRuleDraft = { type: 'GitHub', domain: 'git.corp.com' };
		const entries: RemoteRuleDraft[] = [
			{ type: 'GitLab', domain: 'gitlab.corp.com' },
			{ type: 'GitHub', domain: 'git.corp.com' },
		];
		assert.strictEqual(findEntryIndex(entries, baseline), 1);
	});

	test('matches regardless of key order (external hand-edit reordered keys)', () => {
		const baseline: RemoteRuleDraft = { type: 'GitHub', domain: 'git.corp.com', name: 'Corp' };
		const entries: RemoteRuleDraft[] = [{ name: 'Corp', domain: 'git.corp.com', type: 'GitHub' }];
		assert.strictEqual(findEntryIndex(entries, baseline), 0);
	});

	test('returns -1 when the baseline entry is gone (removed/changed externally)', () => {
		const baseline: RemoteRuleDraft = { type: 'GitHub', domain: 'git.corp.com' };
		const entries: RemoteRuleDraft[] = [{ type: 'GitLab', domain: 'gitlab.corp.com' }];
		assert.strictEqual(findEntryIndex(entries, baseline), -1);
	});

	test('returns -1 for an undefined baseline (nothing to relocate)', () => {
		const entries: RemoteRuleDraft[] = [{ type: 'GitHub', domain: 'git.corp.com' }];
		assert.strictEqual(findEntryIndex(entries, undefined), -1);
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
