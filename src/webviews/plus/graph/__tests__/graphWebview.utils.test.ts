import * as assert from 'assert';
import { isRepoHostingIntegrationConnected, stripRefsMetadataTypes } from '../graphWebview.utils.js';
import type { GraphRefMetadata } from '../protocol.js';

suite('graphWebview.utils — isRepoHostingIntegrationConnected', () => {
	const repoPath = '/home/user/repo';
	const repoUri = 'file:///home/user/repo';

	test('false when the context is undefined (no connected repos)', () => {
		assert.strictEqual(isRepoHostingIntegrationConnected(undefined, repoPath), false);
	});

	test('false when the connected set is empty', () => {
		assert.strictEqual(isRepoHostingIntegrationConnected([], repoPath), false);
	});

	test('false when repoPath is undefined', () => {
		assert.strictEqual(isRepoHostingIntegrationConnected([repoPath], undefined), false);
	});

	test('true when the repo path is in the set', () => {
		assert.strictEqual(isRepoHostingIntegrationConnected([repoUri, repoPath], repoPath), true);
	});

	test('false when only OTHER repos are connected', () => {
		assert.strictEqual(isRepoHostingIntegrationConnected(['file:///other', '/home/user/other'], repoPath), false);
	});

	// The core of the flicker fix: the context re-publishes a freshly-allocated array on every
	// updateContext(), so the identity differs every time — but the MEMBERSHIP this helper computes is
	// stable across those re-publishes, so a caller comparing successive results skips the no-op resets.
	test('membership is stable across freshly-allocated identical arrays', () => {
		const first = [repoUri, repoPath];
		const second = [repoUri, repoPath]; // same content, different reference (as updateContext produces)
		assert.notStrictEqual(first, second);
		assert.strictEqual(
			isRepoHostingIntegrationConnected(first, repoPath),
			isRepoHostingIntegrationConnected(second, repoPath),
		);
	});

	// A real flip (connect → disconnect) DOES change the computed membership, so the caller still resets.
	test('membership flips when the repo genuinely connects or disconnects', () => {
		assert.strictEqual(isRepoHostingIntegrationConnected(undefined, repoPath), false);
		assert.strictEqual(isRepoHostingIntegrationConnected([repoPath], repoPath), true);
		assert.strictEqual(isRepoHostingIntegrationConnected([], repoPath), false);
	});
});

suite('graphWebview.utils — stripRefsMetadataTypes', () => {
	const upstream = { name: 'main', owner: 'origin', ahead: 3, behind: 1 };
	const pr = [{ hostingServiceType: 'github' as const, id: 42, title: 'PR' }];
	const issue = [{ issueTrackerType: 'github' as const, displayId: '9', id: '9', title: 'Issue' }];

	test('drops the requested types while preserving upstream (hosting flip: pullRequest + issue)', () => {
		const map = new Map<string, GraphRefMetadata>([['a', { upstream: upstream, pullRequest: pr, issue: issue }]]);

		const result = stripRefsMetadataTypes(map, ['pullRequest', 'issue']);

		assert.deepStrictEqual(result.get('a'), { upstream: upstream });
		// Upstream survives by reference — integration flips never touch local-git ahead/behind.
		assert.strictEqual(result.get('a')?.upstream, upstream);
	});

	test('drops only issue on an issue-integration flip (pullRequest + upstream survive)', () => {
		const map = new Map<string, GraphRefMetadata>([['a', { upstream: upstream, pullRequest: pr, issue: issue }]]);

		const result = stripRefsMetadataTypes(map, ['issue']);

		assert.deepStrictEqual(result.get('a'), { upstream: upstream, pullRequest: pr });
	});

	test('re-creates a fresh entry object (copy-on-write) — never mutates the input entry', () => {
		const entry = { upstream: upstream, pullRequest: pr };
		const map = new Map<string, GraphRefMetadata>([['a', entry]]);

		const result = stripRefsMetadataTypes(map, ['pullRequest']);

		assert.notStrictEqual(result.get('a'), entry, 'a changed entry is a new object reference');
		assert.deepStrictEqual(entry, { upstream: upstream, pullRequest: pr }, 'the input entry is untouched');
	});

	test('keeps the SAME reference for entries with no dropped type present', () => {
		const entry = { upstream: upstream };
		const map = new Map<string, GraphRefMetadata>([['a', entry]]);

		const result = stripRefsMetadataTypes(map, ['pullRequest', 'issue']);

		assert.strictEqual(result.get('a'), entry, 'unchanged entries keep their reference');
	});

	test('keeps null entries as-is', () => {
		const map = new Map<string, GraphRefMetadata>([['a', null]]);

		const result = stripRefsMetadataTypes(map, ['pullRequest', 'issue']);

		assert.strictEqual(result.get('a'), null);
	});

	test('drops a present-but-null enrichment key so it re-resolves after the flip', () => {
		// `pullRequest: null` means "resolved to no PR under the old integration"; dropping the KEY forces the
		// webview to re-request it (a null value would otherwise be treated as already-resolved).
		const map = new Map<string, GraphRefMetadata>([['a', { upstream: upstream, pullRequest: null }]]);

		const result = stripRefsMetadataTypes(map, ['pullRequest']);

		assert.deepStrictEqual(result.get('a'), { upstream: upstream });
		assert.strictEqual('pullRequest' in result.get('a')!, false, 'the key is absent, not merely null');
	});
});
