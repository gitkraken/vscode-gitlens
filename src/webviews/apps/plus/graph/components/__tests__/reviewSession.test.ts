import * as assert from 'assert';
import type { AIReviewFinding, AIReviewResult } from '@gitlens/ai/models/results.js';
import {
	countReviewFindingStates,
	createReviewComment,
	createReviewFindingIds,
	emptyReviewSession,
	getClosedFindingIds,
	getModelFindings,
	getReviewFileFindings,
	getReviewFileProgress,
	getReviewPanelStatus,
	getReviewProgress,
	getReviewReadingOrder,
	getReviewReadingShortcut,
	getReviewReplies,
	getReviewThreadItems,
	getStaleFindingIds,
	isReviewComplete,
	userFocusAreaId,
	withFileExcluded,
	withFilesViewed,
	withFindingNote,
	withFindingNoteText,
	withFindingsContent,
	withFindingsRequeued,
	withFindingState,
	withoutFindingNote,
	withoutFindings,
	withoutResultFinding,
	withoutReviewComment,
	withReadingOrder,
	withReviewComment,
	withReviewComments,
	withReviewCommentText,
	withReviewFindingIds,
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
		assert.deepStrictEqual(progress, { viewed: 1, changed: 1, requeued: 0, total: 2 });
		assert.strictEqual(isReviewComplete(progress), false);
		assert.strictEqual(isReviewComplete(getReviewProgress(withFilesViewed(session, files, true), files)), true);
	});

	test('an empty walk is never complete', () => {
		assert.strictEqual(isReviewComplete(getReviewProgress(emptyReviewSession, [])), false);
	});
});

suite('reviewSession — re-queued for findings', () => {
	const finding = (id: string, ...paths: string[]) => ({
		id: id,
		severity: 'warning',
		title: id,
		description: '',
		...(paths.length > 1
			? { filePath: paths[0], locations: paths.map(p => ({ filePath: p })) }
			: { filePath: paths[0] }),
	});
	const resultOf = (...findings: ReturnType<typeof finding>[]) =>
		({
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{ id: 'area', label: 'Area', rationale: '', severity: 'warning', files: [], findings: findings },
			],
		}) as unknown as AIReviewResult;

	test('a viewed file that gains an open finding goes back in the queue; marking it again takes it out', () => {
		const viewed = withFilesViewed(emptyReviewSession, [a, b], true);
		const session = withFindingsRequeued(viewed, undefined, resultOf(finding('f1', a.path), finding('f2', c.path)));
		assert.strictEqual(getReviewFileProgress(session, a), 'requeued');
		assert.strictEqual(getReviewFileProgress(session, b), 'viewed', 'no finding on it');
		assert.strictEqual(getReviewFileProgress(session, c), 'unviewed', 'never viewed — nothing to re-queue');
		const progress = getReviewProgress(session, [a, b, c]);
		assert.deepStrictEqual(progress, { viewed: 1, changed: 0, requeued: 1, total: 3 });

		const again = withFilesViewed(session, [a], true);
		assert.strictEqual(getReviewFileProgress(again, a), 'viewed');
		assert.strictEqual(again.viewed.get(a.path)?.requeued, undefined);
		assert.strictEqual(withFilesViewed(session, [a], false).viewed.has(a.path), false, 'un-marking drops it too');
	});

	test('a re-run that finds the same thing in a file re-queues nothing, even under another id', () => {
		const viewed = withFilesViewed(emptyReviewSession, [a, b], true);
		const earlier = resultOf({ ...finding('area-1-f1', a.path), title: 'Unhandled promise' });
		const again = resultOf(
			{ ...finding('area-2-f3', a.path), title: ' unhandled promise ' },
			{ ...finding('area-1-f1', b.path), title: 'Signal ignored' },
		);
		const session = withFindingsRequeued(viewed, earlier, again);
		assert.strictEqual(getReviewFileProgress(session, a), 'viewed', 'the same finding, renumbered');
		assert.strictEqual(getReviewFileProgress(session, b), 'requeued', 'an id seen before, but somewhere else');
	});

	test('a change to the content wins over new findings', () => {
		const session = withFindingsRequeued(
			withFilesViewed(emptyReviewSession, [a], true),
			undefined,
			resultOf(finding('f1', a.path)),
		);
		assert.strictEqual(getReviewFileProgress(session, { ...a, contentId: 'a2' }), 'changed');
	});

	test('only findings new to the file count — not ones it had, closed ones, or the reader’s own', () => {
		const viewed = withFilesViewed(emptyReviewSession, [a, b, c], true);
		const prev = resultOf(finding('f1', a.path));
		const dismissed = withFindingState(viewed, 'f2', 'dismissed');
		const next = {
			...resultOf(finding('f1', a.path), finding('f2', b.path)),
			focusAreas: [
				...resultOf(finding('f1', a.path), finding('f2', b.path)).focusAreas,
				{
					id: userFocusAreaId,
					label: '',
					rationale: '',
					severity: 'suggestion',
					files: [],
					findings: [createReviewComment('u1', { path: c.path, line: 1, lineEnd: 1 }, 'mine')],
				},
			],
		} as unknown as AIReviewResult;
		assert.strictEqual(
			withFindingsRequeued(dismissed, prev, next),
			dismissed,
			'nothing new and open — same session',
		);

		// A finding that was there reaches one more file: that file is new to it
		const spread = withFindingsRequeued(viewed, prev, resultOf(finding('f1', a.path, c.path)));
		assert.strictEqual(getReviewFileProgress(spread, a), 'viewed');
		assert.strictEqual(getReviewFileProgress(spread, c), 'requeued');
	});

	test('a file already re-queued, or set aside, changes nothing more', () => {
		const once = withFindingsRequeued(
			withFilesViewed(emptyReviewSession, [a], true),
			undefined,
			resultOf(finding('f1', a.path)),
		);
		assert.strictEqual(withFindingsRequeued(once, undefined, resultOf(finding('f9', a.path))), once);
		assert.strictEqual(
			withFindingsRequeued(emptyReviewSession, undefined, resultOf(finding('f1', a.path))),
			emptyReviewSession,
		);

		const excluded = withFileExcluded(once, a.path, true);
		assert.deepStrictEqual(getReviewProgress(excluded, [a]), { viewed: 0, changed: 0, requeued: 0, total: 0 });
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

	test('open is the default; a dismissed finding reads as closed until reopened', () => {
		let session = withFindingState(emptyReviewSession, 'f1', 'dismissed');
		session = withFindingState(session, 'f2', 'dismissed');
		assert.deepStrictEqual(countReviewFindingStates(result, session), { open: 1, dismissed: 2 });
		assert.deepStrictEqual([...getClosedFindingIds(session)].sort(), ['f1', 'f2']);

		session = withFindingState(session, 'f1', undefined);
		assert.deepStrictEqual(countReviewFindingStates(result, session), { open: 2, dismissed: 1 });
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

		let session = withFindingState(emptyReviewSession, 'f2', 'dismissed');
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
		let session = withFindingState(emptyReviewSession, 'f2', 'dismissed');
		session = withFindingState(session, 'f5', 'dismissed');
		// f1 is open but has no line — the closed f2 still names where to land
		assert.deepStrictEqual(getReviewFileFindings(result, session).get('src/a.ts'), {
			open: 1,
			closed: 2,
			severity: 'warning',
			target: { start: 10, end: 12 },
		});
	});

	test('a finding with several places marks each of its files once', () => {
		const multi = {
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
							id: 'm',
							severity: 'warning',
							title: 'copied',
							description: '',
							filePath: 'src/a.ts',
							lineRange: { start: 5, end: 6 },
							locations: [
								{ filePath: 'src/a.ts', lineRange: { start: 5, end: 6 } },
								{ filePath: 'src/a.ts', lineRange: { start: 50, end: 51 } },
								{ filePath: 'src/b.ts', lineRange: { start: 9, end: 9 } },
							],
						},
					],
				},
			],
		} as unknown as AIReviewResult;
		assert.deepStrictEqual(
			[...getReviewFileFindings(multi, emptyReviewSession).entries()],
			[
				['src/a.ts', { open: 1, closed: 0, severity: 'warning', target: { start: 5, end: 6 } }],
				['src/b.ts', { open: 1, closed: 0, severity: 'warning', target: { start: 9, end: 9 } }],
			],
		);
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
		assert.deepStrictEqual(
			session.notes.get('f1')?.map(({ id: _, ...note }) => note),
			[
				{ author: 'user', text: 'not a bug here', at: 1 },
				{ author: 'agent', text: 'it is — see the caller', at: 2 },
			],
		);
		const ids = session.notes.get('f1')!.map(n => n.id ?? '');
		assert.ok(ids.every(id => id !== '') && ids[0] !== ids[1], 'each note gets an id of its own');

		const edited = withFindingNoteText(session, 'f1', ids[0], ' not a bug, see the caller ');
		assert.deepStrictEqual(
			edited.notes.get('f1')?.map(n => [n.id, n.text]),
			[
				[ids[0], 'not a bug, see the caller'],
				[ids[1], 'it is — see the caller'],
			],
		);
		assert.strictEqual(withFindingNoteText(edited, 'f1', ids[0], '  '), edited);

		const without = withoutFindingNote(session, 'f1', ids[0]);
		assert.deepStrictEqual(
			without.notes.get('f1')?.map(n => n.text),
			['it is — see the caller'],
		);
		assert.strictEqual(withoutFindingNote(without, 'f1', 'nope'), without);
		assert.strictEqual(withoutFindingNote(without, 'f1', ids[1]).notes.has('f1'), false);

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
						{
							id: 'f4',
							severity: 'warning',
							title: 'four',
							description: 'd4',
							filePath: 'a.ts',
							lineRange: { start: 20, end: 21 },
							locations: [
								{ filePath: 'a.ts', lineRange: { start: 20, end: 21 } },
								{ filePath: 'c.ts', lineRange: { start: 2, end: 2 } },
								{ filePath: 'd.ts' },
							],
						},
					],
				},
			],
		} as unknown as AIReviewResult;
		let session = withFindingState(emptyReviewSession, 'f3', 'dismissed');
		session = withFindingNote(session, 'f3', { id: 'n1', author: 'user', text: 'intended', at: 7 });

		assert.deepStrictEqual(getReviewThreadItems(result, session), [
			{
				id: 'f1',
				findingId: 'f1',
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
				findingId: 'f3',
				path: 'b.ts',
				line: 9,
				lineEnd: 9,
				severity: 'suggestion',
				title: 'three',
				description: 'd3',
				state: 'dismissed',
				notes: [{ id: 'n1', author: 'user', text: 'intended', at: 7 }],
			},
			// One finding, a thread at each of its places that has lines — all the one finding's
			{
				id: 'f4',
				findingId: 'f4',
				path: 'a.ts',
				line: 20,
				lineEnd: 21,
				severity: 'warning',
				title: 'four',
				description: 'd4',
				state: 'open',
			},
			{
				id: 'f4#1',
				findingId: 'f4',
				path: 'c.ts',
				line: 2,
				lineEnd: 2,
				severity: 'warning',
				title: 'four',
				description: 'd4',
				state: 'open',
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

	test("a plan's groups keep their order, and the files in each go as its pane shows them", () => {
		// Orient listed the group's files its own way; the pane shows the folder first, then by name
		const plan = [
			'src/app.ts',
			'contributions.json',
			'l10n/bundle.l10n.json',
			'l10n/bundle.l10n.es.json',
			'package.nls.json',
			'package.nls.es.json',
			'CHANGELOG.md',
		];
		const files = plan.map(p => ({ path: p }));
		const session = withReadingOrder(emptyReviewSession, plan);
		const shown = [
			'src/app.ts',
			'l10n/bundle.l10n.es.json',
			'l10n/bundle.l10n.json',
			'contributions.json',
			'package.nls.es.json',
			'package.nls.json',
			'CHANGELOG.md',
		];
		assert.deepStrictEqual(getReviewReadingOrder(session, files, shown), shown);

		// The last group's pane hasn't said its order yet: the groups before follow theirs, it keeps the plan's
		assert.deepStrictEqual(getReviewReadingOrder(session, files, shown.slice(0, 4)), [
			'src/app.ts',
			'l10n/bundle.l10n.es.json',
			'l10n/bundle.l10n.json',
			'contributions.json',
			'package.nls.json',
			'package.nls.es.json',
			'CHANGELOG.md',
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

suite("reviewSession — the reader's own comments", () => {
	const place = { path: 'src/a.ts', line: 3, lineEnd: 4 };

	test('a comment is a finding of the reader: no title, its text the description, at the lines it was written on', () => {
		const session = withReviewComment(emptyReviewSession, createReviewComment('user-1', place, '  why here?  '));
		assert.deepStrictEqual(session.comments, [
			{
				id: 'user-1',
				severity: 'suggestion',
				title: '',
				description: 'why here?',
				filePath: 'src/a.ts',
				lineRange: { start: 3, end: 4 },
				source: 'user',
			},
		]);
		assert.strictEqual(withReviewComment(session, createReviewComment('user-2', place, ' ')), session);
		assert.strictEqual(withReviewComment(session, createReviewComment('user-1', place, 'again')), session);
	});

	test('editing keeps the place; an emptied edit changes nothing; removing takes the state and notes along', () => {
		let session = withReviewComment(emptyReviewSession, createReviewComment('user-1', place, 'why here?'));
		session = withReviewCommentText(session, 'user-1', 'why here, not in the caller?');
		assert.strictEqual(session.comments?.[0].description, 'why here, not in the caller?');
		assert.strictEqual(withReviewCommentText(session, 'user-1', '  '), session);

		session = withFindingState(session, 'user-1', 'dismissed');
		session = withFindingNote(session, 'user-1', { author: 'agent', text: 'moved it', at: 1 });
		const removed = withoutReviewComment(session, 'user-1');
		assert.strictEqual(removed.comments, undefined);
		assert.strictEqual(removed.findingStates.has('user-1'), false);
		assert.strictEqual(removed.notes.has('user-1'), false);
	});

	test("discarding the AI's findings keeps the reader's comments with their states and notes", () => {
		let session = withReviewComment(emptyReviewSession, createReviewComment('user-1', place, 'why here?'));
		session = withFindingState(session, 'user-1', 'dismissed');
		session = withFindingState(session, 'f1', 'dismissed');
		session = withFindingNote(session, 'user-1', { author: 'user', text: 'done', at: 1 });
		session = withFindingNote(session, 'f1', { author: 'user', text: 'intended', at: 2 });

		const cleared = withoutFindings(session);
		assert.deepStrictEqual([...cleared.findingStates], [['user-1', 'dismissed']]);
		assert.deepStrictEqual([...cleared.notes.keys()], ['user-1']);
		assert.strictEqual(cleared.comments, session.comments);
	});

	test('the comments join the result as an area of their own, first, and stand alone without a run', () => {
		const result = {
			overview: 'o',
			mode: 'single-pass',
			focusAreas: [{ id: 'area', label: 'Area', rationale: '', severity: 'warning', files: [], findings: [] }],
		} as unknown as AIReviewResult;
		assert.strictEqual(withReviewComments(result, emptyReviewSession), result);

		const session = withReviewComment(emptyReviewSession, createReviewComment('user-1', place, 'why here?'));
		const merged = withReviewComments(result, session)!;
		assert.deepStrictEqual(
			merged.focusAreas.map(a => a.id),
			[userFocusAreaId, 'area'],
		);
		assert.deepStrictEqual(merged.focusAreas[0].files, ['src/a.ts']);
		assert.strictEqual(withReviewComments(result, session), merged, 'the same inputs give the same result');

		const alone = withReviewComments(undefined, session)!;
		assert.deepStrictEqual(
			alone.focusAreas.map(a => a.id),
			[userFocusAreaId],
		);
		assert.deepStrictEqual(
			getReviewThreadItems(alone, session).map(i => [i.id, i.source, i.line, i.lineEnd]),
			[['user-1', 'user', 3, 4]],
		);
	});

	test('replies on the AI findings join the area too — the area shows up for them alone', () => {
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
					findings: [{ id: 'f1', severity: 'warning', title: 'one', description: '', filePath: 'src/a.ts' }],
				},
			],
		} as unknown as AIReviewResult;
		let session = withFindingNote(emptyReviewSession, 'f1', { author: 'agent', text: 'confirmed', at: 1 });
		assert.strictEqual(withReviewComments(result, session), result, "an agent's note is not the reader's");

		session = withFindingNote(session, 'f1', { author: 'user', text: 'fixed in the caller', at: 2 });
		const merged = withReviewComments(result, session)!;
		assert.deepStrictEqual(
			merged.focusAreas.map(a => [a.id, a.findings?.length]),
			[
				[userFocusAreaId, 0],
				['area', 1],
			],
		);
		assert.deepStrictEqual(
			getReviewReplies(merged, session).map(r => [r.finding.id, r.note.text]),
			[['f1', 'fixed in the caller']],
		);
	});

	test("a failed run shows its error even when the reader's comments make a result", () => {
		const session = withReviewComment(emptyReviewSession, createReviewComment('user-1', place, 'why here?'));
		const failed = { error: { message: 'rate limited' } };

		const withComments = withReviewComments(undefined, session);
		assert.strictEqual(getReviewPanelStatus('error', failed, withComments, undefined), 'error');
		assert.strictEqual(
			getReviewPanelStatus('error', failed, withReviewComments(undefined, emptyReviewSession), undefined),
			'error',
			'without comments, as before',
		);
	});

	test('a run that answered shows it, with or without comments; a fetch error only without anything to show', () => {
		const result = {
			overview: 'o',
			mode: 'single-pass',
			focusAreas: [{ id: 'area', label: 'Area', rationale: '', severity: 'warning', files: [], findings: [] }],
		} as unknown as AIReviewResult;
		const session = withReviewComment(emptyReviewSession, createReviewComment('user-1', place, 'why here?'));

		assert.strictEqual(
			getReviewPanelStatus('complete', { result: result }, withReviewComments(result, session), undefined),
			'ready',
		);
		assert.strictEqual(
			getReviewPanelStatus(undefined, undefined, withReviewComments(undefined, session), 'stale'),
			'ready',
			"the reader's comments win over an older fetch error",
		);
		assert.strictEqual(getReviewPanelStatus(undefined, undefined, undefined, 'stale'), 'error');
		assert.strictEqual(getReviewPanelStatus(undefined, undefined, undefined, undefined), 'idle');
	});

	test('a run in flight or stepped back from ignores what the entry holds', () => {
		const failed = { error: { message: 'rate limited' } };
		assert.strictEqual(getReviewPanelStatus('generating', failed, undefined, undefined), 'loading');
		assert.strictEqual(getReviewPanelStatus('backed', failed, undefined, undefined), 'idle');
	});
});

suite('reviewSession — removing a finding', () => {
	test('a finding leaves the result; an area it leaves empty goes with it', () => {
		const result = {
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{
					id: 'a',
					label: 'A',
					rationale: '',
					severity: 'warning',
					files: [],
					findings: [{ id: 'f1' }, { id: 'f2' }],
				},
				{ id: 'b', label: 'B', rationale: '', severity: 'warning', files: [], findings: [{ id: 'f3' }] },
			],
		} as unknown as AIReviewResult;
		assert.deepStrictEqual(
			withoutResultFinding(result, 'f1').focusAreas.map(a => [a.id, a.findings?.map(f => f.id)]),
			[
				['a', ['f2']],
				['b', ['f3']],
			],
		);
		assert.deepStrictEqual(
			withoutResultFinding(result, 'f3').focusAreas.map(a => a.id),
			['a'],
		);
		assert.strictEqual(withoutResultFinding(result, 'nope'), result);
	});
});

suite('reviewSession — findings on changed files', () => {
	const findings = [
		{ id: 'f1', severity: 'warning', title: 'one', description: '', filePath: 'src/a.ts' },
		{
			id: 'f2',
			severity: 'critical',
			title: 'two',
			description: '',
			filePath: 'src/b.ts',
			locations: [{ filePath: 'src/b.ts' }, { filePath: 'src/a.ts' }],
		},
		{ id: 'f3', severity: 'suggestion', title: 'three', description: '', filePath: 'src/c.ts' },
		{ id: 'f4', severity: 'suggestion', title: 'general', description: '' },
		{ id: 'u1', severity: 'suggestion', title: '', description: 'mine', filePath: 'src/a.ts', source: 'user' },
	] as const;
	const result = {
		overview: '',
		mode: 'single-pass',
		focusAreas: [{ id: 'area', label: 'Area', rationale: '', severity: 'warning', files: [], findings: findings }],
	} as unknown as AIReviewResult;
	const recorded = withFindingsContent(undefined, result.focusAreas[0].findings, [a, b, c])!;

	test('records the content of each AI finding’s files, leaving out the reader’s comments and unknown content', () => {
		assert.deepStrictEqual([...recorded.keys()], ['f1', 'f2']);
		assert.deepStrictEqual(
			[...recorded.get('f2')!],
			[
				['src/b.ts', 'b1'],
				['src/a.ts', 'a1'],
			],
		);
	});

	test('nothing is stale while the files are as they were', () => {
		assert.strictEqual(getStaleFindingIds(result, recorded, [a, b, c]).size, 0);
	});

	test('a finding is stale once any file it points at moved on', () => {
		const a2 = { path: 'src/a.ts', contentId: 'a2' };
		assert.deepStrictEqual([...getStaleFindingIds(result, recorded, [a2, b, c])], ['f1', 'f2']);

		const b2 = { path: 'src/b.ts', contentId: 'b2' };
		assert.deepStrictEqual([...getStaleFindingIds(result, recorded, [a, b2, c])], ['f2']);
	});

	test('an unknown side leaves the finding as it was', () => {
		// No current content id, or the file gone from the scope
		assert.strictEqual(
			getStaleFindingIds(result, recorded, [{ path: 'src/a.ts', contentId: undefined }, b]).size,
			0,
		);
		assert.strictEqual(getStaleFindingIds(result, recorded, [b]).size, 0);
		// Nothing recorded at all
		assert.strictEqual(getStaleFindingIds(result, undefined, [{ path: 'src/a.ts', contentId: 'a2' }]).size, 0);
	});

	test('a later report of a finding replaces its record; nothing to add keeps the same record', () => {
		const a2 = { path: 'src/a.ts', contentId: 'a2' };
		const again = withFindingsContent(recorded, [findings[0]], [a2, b]);
		assert.notStrictEqual(again, recorded);
		assert.deepStrictEqual([...again!.get('f1')!], [['src/a.ts', 'a2']]);
		assert.deepStrictEqual([...getStaleFindingIds(result, again, [a2, b, c])], ['f2']);

		assert.strictEqual(withFindingsContent(recorded, [findings[3], findings[4]], [a, b]), recorded);
		assert.strictEqual(withFindingsContent(recorded, [], [a, b]), recorded);
		assert.strictEqual(withFindingsContent(recorded, [findings[0]], undefined), recorded);
	});
});

suite('reviewSession — finding ids', () => {
	const finding = (id: string, title: string, path?: string, extra?: Partial<AIReviewFinding>): AIReviewFinding => ({
		id: id,
		severity: 'warning',
		title: title,
		description: '',
		filePath: path,
		...extra,
	});

	test('a finding the same as an earlier one takes its id — same files and title, lines aside — any other a fresh one', () => {
		const previous = [finding('f-1', 'Leaks the handle', 'a.ts', { lineRange: { start: 3, end: 3 } })];
		const withId = createReviewFindingIds(previous, []);

		const again = withId(finding('area-2-f1', ' leaks the HANDLE ', 'a.ts', { lineRange: { start: 9, end: 9 } }));
		assert.strictEqual(again.id, 'f-1');
		const elsewhere = withId(finding('area-1-f1', 'Leaks the handle', 'b.ts'));
		assert.ok(/^f-[0-9a-f]{8}$/.test(elsewhere.id), elsewhere.id);
	});

	test('each earlier finding is claimed once, so two alike stay two', () => {
		const previous = [finding('f-1', 'dup', 'a.ts'), finding('f-2', 'dup', 'a.ts')];
		const withId = createReviewFindingIds(previous, []);
		const ids = [1, 2, 3].map(i => withId(finding(`area-1-f${i}`, 'dup', 'a.ts')).id);
		assert.deepStrictEqual(ids.slice(0, 2), ['f-1', 'f-2']);
		assert.ok(!['f-1', 'f-2'].includes(ids[2]));
	});

	test("the model's and the agent's findings never take each other's ids; the reader's comments are left alone", () => {
		const previous = [finding('f-1', 'same', 'a.ts'), finding('c-1', '', 'a.ts', { source: 'user' })];
		const withId = createReviewFindingIds(previous, []);
		assert.notStrictEqual(withId(finding('agent-1', 'same', 'a.ts', { source: 'agent' })).id, 'f-1');
		const comment = finding('user-1', '', 'a.ts', { source: 'user' });
		assert.strictEqual(withId(comment), comment);
	});

	test('an id the review holds is neither claimed nor handed out', () => {
		const withId = createReviewFindingIds([finding('f-1', 'opened', 'a.ts')], ['f-1']);
		assert.notStrictEqual(withId(finding('area-1-f1', 'opened', 'a.ts')).id, 'f-1');
	});

	test('a stand-in title matches by the description instead', () => {
		const previous = [finding('f-1', 'Finding', 'a.ts', { titleIsFallback: true, description: 'first' })];
		const withId = createReviewFindingIds(previous, []);
		const other = finding('x', 'Finding', 'a.ts', { titleIsFallback: true, description: 'second' });
		assert.notStrictEqual(withId(other).id, 'f-1');
		const same = finding('y', 'Finding', 'a.ts', { titleIsFallback: true, description: 'first' });
		assert.strictEqual(withId(same).id, 'f-1');
	});

	test("a result gets ids for the model's findings only; with none it stays the same result", () => {
		const result = {
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{
					id: 'area-1',
					label: '',
					rationale: '',
					severity: 'warning',
					files: [],
					findings: [finding('area-1-f1', 'one', 'a.ts')],
				},
				{
					id: 'agent',
					label: '',
					rationale: '',
					severity: 'warning',
					files: [],
					findings: [finding('f-agent', 'two', 'a.ts', { source: 'agent' })],
				},
			],
		} as unknown as AIReviewResult;
		const next = withReviewFindingIds(result, [], []);
		assert.ok(next.focusAreas[0].findings![0].id.startsWith('f-'));
		assert.strictEqual(next.focusAreas[1], result.focusAreas[1]);

		const empty = {
			overview: '',
			mode: 'two-pass',
			focusAreas: [result.focusAreas[1]],
		} as unknown as AIReviewResult;
		assert.strictEqual(withReviewFindingIds(empty, [], []), empty);
		assert.deepStrictEqual(
			getModelFindings([result, next], [finding('f-old', 'old', 'c.ts')]).map(f => f.id),
			['area-1-f1', next.focusAreas[0].findings![0].id, 'f-old'],
		);
	});
});
