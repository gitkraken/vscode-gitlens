/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/consistent-type-assertions */
import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Range, TextDocument, Uri, WorkspaceEdit } from 'vscode';
import { Position, workspace } from 'vscode';
import type {
	ProcessedRebaseCommandEntry,
	ProcessedRebaseCommitEntry,
	ProcessedRebaseEntry,
} from '../../../git/models/rebase';
import type { MoveEntryParams } from '../protocol';
import { RebaseTodoDocument } from '../rebaseTodoDocument';

/** Creates a minimal mock TextDocument for testing helper methods */
function createMockDocument(content: string = '', version: number = 1): TextDocument {
	const lines = content.split('\n');
	const uri = { toString: () => 'file:///test/git-rebase-todo' } as Uri;

	return {
		uri: uri,
		version: version,
		lineCount: lines.length,
		getText: () => content,
		validateRange: (range: Range): Range => range,
		save: async () => true,
		positionAt: (offset: number) => new Position(0, 0), // Mock if needed
		offsetAt: (position: Position) => 0, // Mock if needed
	} as unknown as TextDocument;
}

/** Creates a mock commit entry for testing */
function createCommitEntry(
	line: number,
	sha: string,
	action: 'pick' | 'squash' | 'fixup' | 'reword' | 'edit' | 'drop' = 'pick',
	updateRefs?: { ref: string; line: number }[],
): ProcessedRebaseCommitEntry {
	return {
		type: 'commit',
		id: sha,
		line: line,
		sha: sha,
		message: `Commit ${sha}`,
		action: action,
		updateRefs: updateRefs,
	};
}

/** Creates a mock command entry for testing */
function createCommandEntry(
	line: number,
	action: 'exec' | 'break' | 'noop',
	command?: string,
): ProcessedRebaseCommandEntry {
	return {
		type: 'command',
		id: `${line}`,
		line: line,
		action: action,
		command: command,
	};
}

suite('RebaseTodoDocument Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let applyEditStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		applyEditStub = sandbox.stub(workspace, 'applyEdit').resolves(true);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('calculateMoveTargetIndex', () => {
		test('returns target index for relative move up', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: -1, relative: true };

			const result = doc.calculateMoveTargetIndex(params, 2, 5);

			assert.strictEqual(result, 1);
		});

		test('returns target index for relative move down', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: 1, relative: true };

			const result = doc.calculateMoveTargetIndex(params, 2, 5);

			assert.strictEqual(result, 3);
		});

		test('returns null for relative move beyond top boundary', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: -1, relative: true };

			const result = doc.calculateMoveTargetIndex(params, 0, 5);

			assert.strictEqual(result, null);
		});

		test('returns null for relative move beyond bottom boundary', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: 1, relative: true };

			const result = doc.calculateMoveTargetIndex(params, 4, 5);

			assert.strictEqual(result, null);
		});

		test('returns target index for absolute move (drag)', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: 3, relative: false };

			const result = doc.calculateMoveTargetIndex(params, 1, 5);

			assert.strictEqual(result, 3);
		});

		test('returns null for absolute move to same position', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: 2, relative: false };

			const result = doc.calculateMoveTargetIndex(params, 2, 5);

			assert.strictEqual(result, null);
		});

		test('handles relative move by multiple positions', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const params: MoveEntryParams = { id: 'a', to: -2, relative: true };

			const result = doc.calculateMoveTargetIndex(params, 3, 5);

			assert.strictEqual(result, 1);
		});
	});

	suite('wouldLeaveSquashAsOldest', () => {
		test('returns false when move keeps pick as oldest', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const entries: ProcessedRebaseEntry[] = [
				createCommitEntry(0, 'abc', 'pick'),
				createCommitEntry(1, 'def', 'squash'),
				createCommitEntry(2, 'ghi', 'pick'),
			];

			// Move ghi from index 2 to index 1 - abc (pick) stays oldest
			const result = doc.wouldLeaveSquashAsOldest(entries, 2, 1);

			assert.strictEqual(result, false);
		});

		test('returns true when move would make squash oldest', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const entries: ProcessedRebaseEntry[] = [
				createCommitEntry(0, 'abc', 'pick'),
				createCommitEntry(1, 'def', 'squash'),
				createCommitEntry(2, 'ghi', 'pick'),
			];

			// Move abc (pick) from index 0 to index 2 - def (squash) becomes oldest
			const result = doc.wouldLeaveSquashAsOldest(entries, 0, 2);

			assert.strictEqual(result, true);
		});

		test('returns true when move would make fixup oldest', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const entries: ProcessedRebaseEntry[] = [
				createCommitEntry(0, 'abc', 'pick'),
				createCommitEntry(1, 'def', 'fixup'),
				createCommitEntry(2, 'ghi', 'pick'),
			];

			// Move abc (pick) from index 0 to index 2 - def (fixup) becomes oldest
			const result = doc.wouldLeaveSquashAsOldest(entries, 0, 2);

			assert.strictEqual(result, true);
		});

		test('returns false when all entries are pick', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const entries: ProcessedRebaseEntry[] = [
				createCommitEntry(0, 'abc', 'pick'),
				createCommitEntry(1, 'def', 'pick'),
				createCommitEntry(2, 'ghi', 'pick'),
			];

			const result = doc.wouldLeaveSquashAsOldest(entries, 0, 2);

			assert.strictEqual(result, false);
		});

		test('returns false when moving squash away from oldest position', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const entries: ProcessedRebaseEntry[] = [
				createCommitEntry(0, 'abc', 'squash'),
				createCommitEntry(1, 'def', 'pick'),
				createCommitEntry(2, 'ghi', 'pick'),
			];

			// Move squash from index 0 to index 2 - def (pick) becomes oldest
			const result = doc.wouldLeaveSquashAsOldest(entries, 0, 2);

			assert.strictEqual(result, false);
		});

		test('returns false when swapping adjacent entries keeps pick oldest', () => {
			const doc = new RebaseTodoDocument(createMockDocument());
			const entries: ProcessedRebaseEntry[] = [
				createCommitEntry(0, 'abc', 'pick'),
				createCommitEntry(1, 'def', 'pick'),
			];

			// Swap adjacent picks - still pick oldest
			const result = doc.wouldLeaveSquashAsOldest(entries, 0, 1);

			assert.strictEqual(result, false);
		});
	});

	suite('moveEntry', () => {
		test('moves entry down correctly (inserts then deletes)', async () => {
			const doc = new RebaseTodoDocument(createMockDocument('pick 1\npick 2\npick 3'));
			const entry = createCommitEntry(0, '1');
			const target = createCommitEntry(2, '3');

			await doc.moveEntry(entry, target, false, false);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);
			// 1 insert + 1 delete
			assert.strictEqual(edits.length, 2);
			// Moving down: insert at target line (2), delete at source (0)
			// Actually logic says: insertLine = targetEntry.line = 2 (if not dropAtEnd/relative)
			// Wait, if moving 0 to 2 (absolute), we insert BEFORE 2.
			// Logic: const insertLine = isDropAtEnd || isRelativeMove ? targetEndLine : targetEntry.line;
			// Here isAbsolute -> isDropAtEnd=false, isRelativeMove=false. So insertLine = 2.

			// Check types of edits. We can't easily check `newText` without logic, but we can check range.
			const insertEdit = edits.find(e => e.newText !== '');
			const deleteEdit = edits.find(e => e.newText === '');

			assert.ok(insertEdit, 'Should have insert edit');
			assert.ok(deleteEdit, 'Should have delete edit');
			assert.strictEqual(insertEdit?.range.start.line, 2);
			assert.strictEqual(deleteEdit?.range.start.line, 0);
		});

		test('moves entry up correctly (deletes then inserts)', async () => {
			const doc = new RebaseTodoDocument(createMockDocument('pick 1\npick 2\npick 3'));
			const entry = createCommitEntry(2, '3');
			const target = createCommitEntry(0, '1');

			await doc.moveEntry(entry, target, false, false);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);
			assert.strictEqual(edits.length, 2);

			const insertEdit = edits.find(e => e.newText !== '');
			const deleteEdit = edits.find(e => e.newText === '');

			assert.ok(insertEdit, 'Should have insert edit');
			assert.ok(deleteEdit, 'Should have delete edit');
			// Moving up: delete at source (2), insert at target (0)
			assert.strictEqual(deleteEdit?.range.start.line, 2);
			assert.strictEqual(insertEdit?.range.start.line, 0);
		});

		test('moves commit with single update-ref down (includes ref in insert)', async () => {
			// Line 0: pick 1, Line 1: update-ref feature-a, Line 2: pick 2
			const doc = new RebaseTodoDocument(
				createMockDocument('pick 1 Commit 1\nupdate-ref refs/heads/feature-a\npick 2 Commit 2'),
			);
			const entry = createCommitEntry(0, '1', 'pick', [{ ref: 'refs/heads/feature-a', line: 1 }]);
			const target = createCommitEntry(2, '2');

			await doc.moveEntry(entry, target, false, false);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			assert.ok(insertEdit, 'Should have insert edit');
			// Insert text should include both commit and update-ref
			assert.ok(insertEdit?.newText.includes('pick 1 Commit 1'), 'Should include commit line');
			assert.ok(insertEdit?.newText.includes('update-ref refs/heads/feature-a'), 'Should include update-ref');
		});

		test('moves commit with update-ref up (delete range spans both lines)', async () => {
			// Line 0: pick 1, Line 1: pick 2, Line 2: update-ref feature-b
			const doc = new RebaseTodoDocument(
				createMockDocument('pick 1 Commit 1\npick 2 Commit 2\nupdate-ref refs/heads/feature-b'),
			);
			const entry = createCommitEntry(1, '2', 'pick', [{ ref: 'refs/heads/feature-b', line: 2 }]);
			const target = createCommitEntry(0, '1');

			await doc.moveEntry(entry, target, false, false);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const deleteEdit = edits.find(e => e.newText === '');
			assert.ok(deleteEdit, 'Should have delete edit');
			// Delete range should span from line 1 to line 3 (entry + update-ref)
			assert.strictEqual(deleteEdit?.range.start.line, 1);
			assert.strictEqual(deleteEdit?.range.end.line, 3);
		});

		test('moves commit with multiple update-refs (includes all refs)', async () => {
			const doc = new RebaseTodoDocument(
				createMockDocument(
					'pick 1 Commit 1\nupdate-ref refs/heads/a\nupdate-ref refs/heads/b\npick 2 Commit 2',
				),
			);
			const entry = createCommitEntry(0, '1', 'pick', [
				{ ref: 'refs/heads/a', line: 1 },
				{ ref: 'refs/heads/b', line: 2 },
			]);
			const target = createCommitEntry(3, '2');

			await doc.moveEntry(entry, target, false, false);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			const deleteEdit = edits.find(e => e.newText === '');

			// Insert should have all 3 lines
			assert.ok(insertEdit?.newText.includes('update-ref refs/heads/a'));
			assert.ok(insertEdit?.newText.includes('update-ref refs/heads/b'));

			// Delete range: lines 0-3 (3 lines total)
			assert.strictEqual(deleteEdit?.range.start.line, 0);
			assert.strictEqual(deleteEdit?.range.end.line, 3);
		});

		test('moves past target with update-refs (respects targetEndLine)', async () => {
			// Target has update-ref, moving down with relative=true should insert after target's refs
			const doc = new RebaseTodoDocument(
				createMockDocument('pick 1 Commit 1\npick 2 Commit 2\nupdate-ref refs/heads/feature'),
			);
			const entry = createCommitEntry(0, '1');
			const target = createCommitEntry(1, '2', 'pick', [{ ref: 'refs/heads/feature', line: 2 }]);

			// isRelativeMove=true means insert AFTER target (at targetEndLine=3)
			await doc.moveEntry(entry, target, false, true);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			// Should insert at line 3 (after target's update-ref)
			assert.strictEqual(insertEdit?.range.start.line, 3);
		});

		test('isDropAtEnd inserts after target', async () => {
			const doc = new RebaseTodoDocument(createMockDocument('pick 1\npick 2\npick 3'));
			const entry = createCommitEntry(0, '1');
			const target = createCommitEntry(2, '3');

			await doc.moveEntry(entry, target, true, false); // isDropAtEnd=true

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			// isDropAtEnd=true means insert at targetEndLine (3)
			assert.strictEqual(insertEdit?.range.start.line, 3);
		});

		test('isRelativeMove inserts after target', async () => {
			const doc = new RebaseTodoDocument(createMockDocument('pick 1\npick 2\npick 3'));
			const entry = createCommitEntry(0, '1');
			const target = createCommitEntry(1, '2');

			await doc.moveEntry(entry, target, false, true); // isRelativeMove=true

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			// isRelativeMove=true means insert at targetEndLine (2)
			assert.strictEqual(insertEdit?.range.start.line, 2);
		});

		test('moves command entry (exec)', async () => {
			const doc = new RebaseTodoDocument(createMockDocument('pick 1 Commit 1\nexec npm test\npick 2 Commit 2'));
			const entry = createCommandEntry(1, 'exec', 'npm test');
			const target = createCommitEntry(2, '2');

			await doc.moveEntry(entry, target, false, false);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			assert.ok(insertEdit?.newText.includes('exec npm test'));
		});

		test('moves break command entry', async () => {
			const doc = new RebaseTodoDocument(createMockDocument('pick 1 Commit 1\nbreak\npick 2 Commit 2'));
			const entry = createCommandEntry(1, 'break');
			const target = createCommitEntry(0, '1');

			await doc.moveEntry(entry, target, false, false);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const insertEdit = edits.find(e => e.newText !== '');
			assert.ok(insertEdit?.newText.includes('break'));
			assert.strictEqual(insertEdit?.range.start.line, 0);
		});
	});

	suite('changeActions', () => {
		test('prevents squash on oldest commit (resets to pick)', async () => {
			const content = 'pick abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			await doc.changeActions([{ sha: 'abc', action: 'squash' }]);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			assert.strictEqual(edits.length, 1);
			// Oldest entry should stay 'pick' even when squash requested
			assert.strictEqual(edits[0].newText, 'pick abc Commit 1');
		});

		test('allows changing action for non-oldest commit', async () => {
			const content = 'pick abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			await doc.changeActions([{ sha: 'def', action: 'squash' }]);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			assert.strictEqual(edits.length, 1);
			assert.ok(edits[0].newText.startsWith('squash'));
		});

		test('changes multiple actions in one call', async () => {
			const content = 'pick abc Commit 1\npick def Commit 2\npick ghi Commit 3';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			await doc.changeActions([
				{ sha: 'def', action: 'squash' },
				{ sha: 'ghi', action: 'fixup' },
			]);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			assert.strictEqual(edits.length, 2);
		});

		test('preserves fixup flags (-c)', async () => {
			const content = 'pick abc Commit 1\nfixup -c def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			// Change def to reword (should preserve the -c flag... wait, actually
			// looking at the code, it only preserves flag for the SAME action type)
			// Let's test keeping fixup with flag
			await doc.changeActions([{ sha: 'def', action: 'fixup' }]);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			// Should preserve the -c flag
			assert.ok(edits[0].newText.includes('-c'), 'Should preserve -c flag');
		});

		test('does nothing for empty changes array', async () => {
			const content = 'pick abc Commit 1';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			await doc.changeActions([]);

			assert.strictEqual(applyEditStub.called, false);
		});
	});

	suite('reorderEntries', () => {
		test('reorders entries with full content replacement', async () => {
			const content = 'pick abc Commit 1\npick def Commit 2\npick ghi Commit 3';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const newOrder: ProcessedRebaseEntry[] = [
				createCommitEntry(2, 'ghi'),
				createCommitEntry(0, 'abc'),
				createCommitEntry(1, 'def'),
			];

			await doc.reorderEntries(newOrder);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			assert.strictEqual(edits.length, 1);
			// Should replace entire range with new order
			const newText = edits[0].newText;
			const lines = newText.split('\n');
			assert.ok(lines[0].includes('ghi'), 'First line should be ghi');
			assert.ok(lines[1].includes('abc'), 'Second line should be abc');
			assert.ok(lines[2].includes('def'), 'Third line should be def');
		});

		test('reorders entries with update-refs following their commits', async () => {
			const content =
				'pick abc Commit 1\nupdate-ref refs/heads/feature-a\npick def Commit 2\nupdate-ref refs/heads/feature-b';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const newOrder: ProcessedRebaseEntry[] = [
				createCommitEntry(2, 'def', 'pick', [{ ref: 'refs/heads/feature-b', line: 3 }]),
				createCommitEntry(0, 'abc', 'pick', [{ ref: 'refs/heads/feature-a', line: 1 }]),
			];

			await doc.reorderEntries(newOrder);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const newText = edits[0].newText;
			const lines = newText.split('\n');

			// def should come first, followed by its update-ref
			assert.ok(lines[0].includes('def'));
			assert.ok(lines[1].includes('feature-b'));
			// abc should come second, followed by its update-ref
			assert.ok(lines[2].includes('abc'));
			assert.ok(lines[3].includes('feature-a'));
		});

		test('reorders with fixOldestCommit override', async () => {
			const content = 'pick abc Commit 1\nsquash def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			// Reorder so squash becomes oldest
			const squashEntry = createCommitEntry(1, 'def', 'squash');
			const newOrder: ProcessedRebaseEntry[] = [squashEntry, createCommitEntry(0, 'abc')];

			// Pass fixOldestCommit to override the squash to pick
			await doc.reorderEntries(newOrder, squashEntry);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const newText = edits[0].newText;
			const lines = newText.split('\n');

			// First line should be pick (overridden from squash)
			assert.ok(lines[0].startsWith('pick'), 'Oldest should be pick, not squash');
			assert.ok(lines[0].includes('def'));
		});

		test('includes command entries in reorder', async () => {
			const content = 'pick abc Commit 1\nexec npm test\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const newOrder: ProcessedRebaseEntry[] = [
				createCommitEntry(2, 'def'),
				createCommandEntry(1, 'exec', 'npm test'),
				createCommitEntry(0, 'abc'),
			];

			await doc.reorderEntries(newOrder);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const newText = edits[0].newText;
			const lines = newText.split('\n');

			assert.ok(lines[0].includes('def'));
			assert.ok(lines[1].includes('exec'));
			assert.ok(lines[2].includes('abc'));
		});

		test('warns: comments between entries are lost during reorder (current limitation)', async () => {
			const content = 'pick abc Commit 1\n# I am a comment\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const newOrder: ProcessedRebaseEntry[] = [createCommitEntry(2, 'def'), createCommitEntry(0, 'abc')];

			await doc.reorderEntries(newOrder);

			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			const newText = edits[0].newText;
			// The comment line was at index 1. range is 0 to 2.
			// newText is generated from newOrder only.
			assert.ok(!newText.includes('# I am a comment'), 'Comments are currently lost during reorder');
		});
	});

	suite('ensureValidOldestAction', () => {
		test('changes squash to pick for oldest commit', async () => {
			const content = 'squash abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const oldestCommit = createCommitEntry(0, 'abc', 'squash');
			await doc.ensureValidOldestAction(oldestCommit);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			assert.strictEqual(edits.length, 1);
			assert.ok(edits[0].newText.startsWith('pick'));
		});

		test('changes fixup to pick for oldest commit', async () => {
			const content = 'fixup abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const oldestCommit = createCommitEntry(0, 'abc', 'fixup');
			await doc.ensureValidOldestAction(oldestCommit);

			assert.strictEqual(applyEditStub.calledOnce, true);
			const edit: WorkspaceEdit = applyEditStub.firstCall.args[0];
			const edits = edit.get(doc.uri);

			assert.ok(edits[0].newText.startsWith('pick'));
		});

		test('does nothing for pick action', async () => {
			const content = 'pick abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const oldestCommit = createCommitEntry(0, 'abc', 'pick');
			await doc.ensureValidOldestAction(oldestCommit);

			assert.strictEqual(applyEditStub.called, false);
		});

		test('does nothing for reword action', async () => {
			const content = 'reword abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const oldestCommit = createCommitEntry(0, 'abc', 'reword');
			await doc.ensureValidOldestAction(oldestCommit);

			assert.strictEqual(applyEditStub.called, false);
		});

		test('does nothing for edit action', async () => {
			const content = 'edit abc Commit 1\npick def Commit 2';
			const doc = new RebaseTodoDocument(createMockDocument(content));

			const oldestCommit = createCommitEntry(0, 'abc', 'edit');
			await doc.ensureValidOldestAction(oldestCommit);

			assert.strictEqual(applyEditStub.called, false);
		});
	});
});
