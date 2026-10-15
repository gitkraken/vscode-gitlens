import * as assert from 'assert';
import type { AIReviewResult } from '@gitlens/ai/models/results.js';
import {
	countReviewFindingStates,
	emptyReviewSession,
	getClosedFindingIds,
	getReviewFileProgress,
	getReviewProgress,
	getReviewThreadItems,
	getReviewWalkPaths,
	isReviewComplete,
	withFileExcluded,
	withFilesViewed,
	withFindingState,
	withReadingOrder,
} from '../reviewSession.js';

const a = { path: 'src/a.ts', contentId: 'a1' };
const b = { path: 'src/b.ts', contentId: 'b1' };
const c = { path: 'src/c.ts', contentId: undefined };

suite('reviewSession — viewed marks', () => {
	test('a mark holds while the content it was made against is current, and reads as changed after', () => {
		const session = withFilesViewed(emptyReviewSession, [a], true);
		assert.strictEqual(getReviewFileProgress(session, a), 'viewed');
		assert.strictEqual(getReviewFileProgress(session, { ...a, contentId: 'a2' }), 'changed');
		assert.strictEqual(getReviewFileProgress(session, b), 'unviewed');
	});

	test('without a content id on either side the mark is trusted rather than dropped', () => {
		const marked = withFilesViewed(emptyReviewSession, [c], true);
		assert.strictEqual(getReviewFileProgress(marked, { ...c, contentId: 'c1' }), 'viewed');
		const markedWithId = withFilesViewed(emptyReviewSession, [a], true);
		assert.strictEqual(getReviewFileProgress(markedWithId, { ...a, contentId: undefined }), 'viewed');
	});

	test('re-marking a changed file records the new content; un-marking drops it', () => {
		let session = withFilesViewed(emptyReviewSession, [a], true);
		session = withFilesViewed(session, [{ ...a, contentId: 'a2' }], true);
		assert.strictEqual(session.viewed.get(a.path)?.contentId, 'a2');
		session = withFilesViewed(session, [a], false);
		assert.strictEqual(session.viewed.has(a.path), false);
	});

	test('a no-op mark returns the same session so callers can skip the write', () => {
		const session = withFilesViewed(emptyReviewSession, [a], true);
		assert.strictEqual(withFilesViewed(session, [a], true), session);
		assert.strictEqual(withFilesViewed(session, [b], false), session);
		assert.strictEqual(withFileExcluded(session, b.path, false), session);
		assert.strictEqual(withFindingState(session, 'f1', undefined), session);
	});
});

suite('reviewSession — progress', () => {
	test('counts the walk minus set-aside files, with changed files re-queued', () => {
		let session = withFilesViewed(emptyReviewSession, [a, b], true);
		session = withFileExcluded(session, c.path, true);
		const files = [{ ...a, contentId: 'a2' }, b, c];
		const progress = getReviewProgress(session, files);
		assert.deepStrictEqual(progress, { viewed: 1, changed: 1, total: 2 });
		assert.strictEqual(isReviewComplete(progress), false);
		assert.strictEqual(isReviewComplete(getReviewProgress(withFilesViewed(session, files, true), files)), true);
	});

	test('an empty walk is never complete', () => {
		assert.strictEqual(isReviewComplete(getReviewProgress(emptyReviewSession, [])), false);
	});
});

suite('reviewSession — finding states', () => {
	const result = {
		overview: '',
		mode: 'single-pass',
		focusAreas: [
			{
				id: 'area',
				label: 'Area',
				rationale: '',
				severity: 'warning',
				files: [],
				findings: [
					{ id: 'f1', severity: 'critical', title: 'one', description: '' },
					{ id: 'f2', severity: 'warning', title: 'two', description: '' },
					{ id: 'f3', severity: 'suggestion', title: 'three', description: '' },
				],
			},
		],
	} as unknown as AIReviewResult;

	test('open is the default; resolved and dismissed are counted apart and both read as closed', () => {
		let session = withFindingState(emptyReviewSession, 'f1', 'resolved');
		session = withFindingState(session, 'f2', 'dismissed');
		assert.deepStrictEqual(countReviewFindingStates(result, session), { open: 1, resolved: 1, dismissed: 1 });
		assert.deepStrictEqual([...getClosedFindingIds(session)].sort(), ['f1', 'f2']);

		session = withFindingState(session, 'f1', undefined);
		assert.deepStrictEqual(countReviewFindingStates(result, session), { open: 2, resolved: 0, dismissed: 1 });
	});
});

suite('reviewSession — thread projection', () => {
	test('only findings with a file and a line become threads, carrying their session state', () => {
		const result = {
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{
					id: 'area',
					label: 'Area',
					rationale: '',
					severity: 'warning',
					files: [],
					findings: [
						{
							id: 'f1',
							severity: 'critical',
							title: 'one',
							description: 'd1',
							filePath: 'a.ts',
							lineRange: { start: 3, end: 5 },
						},
						{ id: 'f2', severity: 'warning', title: 'two', description: 'd2', filePath: 'a.ts' },
						{
							id: 'f3',
							severity: 'suggestion',
							title: 'three',
							description: 'd3',
							filePath: 'b.ts',
							lineRange: { start: 9, end: 9 },
						},
					],
				},
			],
		} as unknown as AIReviewResult;
		const session = withFindingState(emptyReviewSession, 'f3', 'dismissed');

		assert.deepStrictEqual(getReviewThreadItems(result, session), [
			{
				id: 'f1',
				path: 'a.ts',
				line: 3,
				lineEnd: 5,
				severity: 'critical',
				title: 'one',
				description: 'd1',
				state: 'open',
			},
			{
				id: 'f3',
				path: 'b.ts',
				line: 9,
				lineEnd: 9,
				severity: 'suggestion',
				title: 'three',
				description: 'd3',
				state: 'dismissed',
			},
		]);
		assert.deepStrictEqual(getReviewThreadItems(undefined, session), []);
	});
});

suite('reviewSession — walk order', () => {
	test('tree order by default; a reading order goes first, with the rest after it and set-aside files out', () => {
		const files = [{ path: 'src/z.ts' }, { path: 'src/a.ts' }, { path: 'src/m.ts' }, { path: 'test/t.ts' }];
		assert.deepStrictEqual(getReviewWalkPaths(emptyReviewSession, files), [
			'src/a.ts',
			'src/m.ts',
			'src/z.ts',
			'test/t.ts',
		]);

		let session = withReadingOrder(emptyReviewSession, ['src/m.ts', 'gone.ts', 'src/z.ts']);
		session = withFileExcluded(session, 'test/t.ts', true);
		assert.deepStrictEqual(getReviewWalkPaths(session, files), ['src/m.ts', 'src/z.ts', 'src/a.ts']);

		assert.strictEqual(
			withReadingOrder(session, ['src/m.ts', 'gone.ts', 'src/z.ts']),
			session,
			'an equal order is a no-op',
		);
		assert.strictEqual(withReadingOrder(emptyReviewSession, undefined), emptyReviewSession);
	});
});
