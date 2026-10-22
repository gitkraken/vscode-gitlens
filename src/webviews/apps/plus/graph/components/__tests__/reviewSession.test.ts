import * as assert from 'assert';
import type { AIReviewResult } from '@gitlens/ai/models/results.js';
import {
	countReviewFindingStates,
	emptyReviewSession,
	getClosedFindingIds,
	getReviewFileFindings,
	getReviewFileProgress,
	getReviewProgress,
	getReviewReadingOrder,
	getReviewReadingShortcut,
	getReviewThreadItems,
	isReviewComplete,
	withFileExcluded,
	withFilesViewed,
	withFindingNote,
	withFindingState,
	withoutFindings,
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

suite('reviewSession — findings by file', () => {
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
					{ id: 'f1', severity: 'warning', title: 'one', description: '', filePath: 'src/a.ts' },
					{
						id: 'f2',
						severity: 'critical',
						title: 'two',
						description: '',
						filePath: 'src/a.ts',
						lineRange: { start: 10, end: 12 },
					},
					{
						id: 'f3',
						severity: 'suggestion',
						title: 'three',
						description: '',
						filePath: 'src/b.ts',
						lineRange: { start: 3, end: 3 },
					},
					{ id: 'f4', severity: 'critical', title: 'general', description: '' },
				],
			},
			{
				id: 'area2',
				label: 'Area 2',
				rationale: '',
				severity: 'suggestion',
				files: [],
				findings: [
					{
						id: 'f5',
						severity: 'suggestion',
						title: 'five',
						description: '',
						filePath: 'src/a.ts',
						lineRange: { start: 40, end: 41 },
					},
				],
			},
		],
	} as unknown as AIReviewResult;

	test('counts open and closed per file across areas, keeps the worst open severity, skips general findings', () => {
		let byPath = getReviewFileFindings(result, emptyReviewSession);
		assert.deepStrictEqual(
			[...byPath.entries()],
			[
				['src/a.ts', { open: 3, closed: 0, severity: 'critical', target: { start: 10, end: 12 } }],
				['src/b.ts', { open: 1, closed: 0, severity: 'suggestion', target: { start: 3, end: 3 } }],
			],
		);

		let session = withFindingState(emptyReviewSession, 'f2', 'resolved');
		byPath = getReviewFileFindings(result, session);
		assert.deepStrictEqual(byPath.get('src/a.ts'), {
			open: 2,
			closed: 1,
			severity: 'warning',
			target: { start: 40, end: 41 },
		});

		session = withFindingState(session, 'f3', 'dismissed');
		byPath = getReviewFileFindings(result, session);
		assert.deepStrictEqual(byPath.get('src/b.ts'), { open: 0, closed: 1, target: { start: 3, end: 3 } });
	});

	test('the target is the first open finding with a line; with none open, the first finding with a line', () => {
		let session = withFindingState(emptyReviewSession, 'f2', 'resolved');
		session = withFindingState(session, 'f5', 'dismissed');
		// f1 is open but has no line — the closed f2 still names where to land
		assert.deepStrictEqual(getReviewFileFindings(result, session).get('src/a.ts'), {
			open: 1,
			closed: 2,
			severity: 'warning',
			target: { start: 10, end: 12 },
		});
	});

	test('no result means no marks', () => {
		assert.strictEqual(getReviewFileFindings(undefined, emptyReviewSession).size, 0);
	});
});

suite('reviewSession — notes', () => {
	test('notes append in order, blank ones are ignored, and discarding the findings drops them with the states', () => {
		let session = withFindingNote(emptyReviewSession, 'f1', { author: 'user', text: '  ', at: 1 });
		assert.strictEqual(session, emptyReviewSession);

		session = withFindingNote(session, 'f1', { author: 'user', text: ' not a bug here ', at: 1 });
		session = withFindingNote(session, 'f1', { author: 'agent', text: 'it is — see the caller', at: 2 });
		session = withFindingState(session, 'f1', 'dismissed');
		assert.deepStrictEqual(session.notes.get('f1'), [
			{ author: 'user', text: 'not a bug here', at: 1 },
			{ author: 'agent', text: 'it is — see the caller', at: 2 },
		]);

		const cleared = withoutFindings(session);
		assert.strictEqual(cleared.notes.size, 0);
		assert.strictEqual(cleared.findingStates.size, 0);
		assert.strictEqual(withoutFindings(cleared), cleared);
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
		let session = withFindingState(emptyReviewSession, 'f3', 'dismissed');
		session = withFindingNote(session, 'f3', { author: 'user', text: 'intended', at: 7 });

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
				notes: [{ author: 'user', text: 'intended', at: 7 }],
			},
		]);
		assert.deepStrictEqual(getReviewThreadItems(undefined, session), []);
	});
});

suite('reviewSession — walk order', () => {
	test('tree order by default; a reading order goes first, with the rest after it and set-aside files out', () => {
		const files = [{ path: 'src/z.ts' }, { path: 'src/a.ts' }, { path: 'src/m.ts' }, { path: 'test/t.ts' }];
		assert.deepStrictEqual(getReviewReadingOrder(emptyReviewSession, files), [
			'src/a.ts',
			'src/m.ts',
			'src/z.ts',
			'test/t.ts',
		]);

		let session = withReadingOrder(emptyReviewSession, ['src/m.ts', 'gone.ts', 'src/z.ts']);
		session = withFileExcluded(session, 'test/t.ts', true);
		assert.deepStrictEqual(getReviewReadingOrder(session, files), ['src/m.ts', 'src/z.ts', 'src/a.ts']);

		assert.strictEqual(
			withReadingOrder(session, ['src/m.ts', 'gone.ts', 'src/z.ts']),
			session,
			'an equal order is a no-op',
		);
		assert.strictEqual(withReadingOrder(emptyReviewSession, undefined), emptyReviewSession);
	});

	test("getReviewReadingOrder follows the tree's rendered order for what the plan doesn't place", () => {
		const files = [{ path: 'CHANGELOG.md' }, { path: 'src/b.ts' }, { path: 'src/a/x.ts' }, { path: 'src/c.ts' }];
		const tree = ['src/a/x.ts', 'src/b.ts', 'src/c.ts', 'CHANGELOG.md'];
		assert.deepStrictEqual(getReviewReadingOrder(emptyReviewSession, files, tree), tree);

		const session = withReadingOrder(emptyReviewSession, ['src/c.ts']);
		assert.deepStrictEqual(getReviewReadingOrder(session, files, tree), [
			'src/c.ts',
			'src/a/x.ts',
			'src/b.ts',
			'CHANGELOG.md',
		]);

		// A file the tree has not rendered yet trails, by path
		assert.deepStrictEqual(getReviewReadingOrder(emptyReviewSession, files, ['src/c.ts', 'src/b.ts']), [
			'src/c.ts',
			'src/b.ts',
			'CHANGELOG.md',
			'src/a/x.ts',
		]);
	});

	test("getReviewReadingShortcut names the keymap's chord for each step, and nothing when shortcuts are off", () => {
		assert.strictEqual(getReviewReadingShortcut('alternate', 'next', true), '⌥]');
		assert.strictEqual(getReviewReadingShortcut('alternate', 'previous', false), 'Alt+[');
		assert.strictEqual(getReviewReadingShortcut('chorded', 'markViewed', true), '⌘⌥G V');
		assert.strictEqual(getReviewReadingShortcut('chorded', 'next', false), 'Ctrl+Shift+G ]');
		assert.strictEqual(getReviewReadingShortcut('none', 'next', true), undefined);
		assert.strictEqual(getReviewReadingShortcut(undefined, 'next', true), undefined);
	});
});
