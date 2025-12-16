import * as assert from 'assert';
import type { RebaseTodoEntry } from '../../../models/rebase';
import { formatRebaseTodoEntryLine, formatUpdateRefLine, processRebaseEntries } from '../rebase.parsing.utils';

suite('Rebase Parsing Utils Test Suite', () => {
	suite('processRebaseEntries', () => {
		test('attaches update-ref entries to preceding commits with line numbers', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'pick', sha: 'abc1234', message: 'First commit' },
				{ line: 1, action: 'update-ref', ref: 'refs/heads/feature-a' },
				{ line: 2, action: 'pick', sha: 'def5678', message: 'Second commit' },
				{ line: 3, action: 'update-ref', ref: 'refs/heads/feature-b' },
			];

			const result = processRebaseEntries(entries);

			assert.strictEqual(result.entries.length, 2, 'Should have 2 processed entries (commits only)');
			assert.strictEqual(result.preservesMerges, false);

			// First commit should have feature-a update-ref attached
			const firstCommit = result.entries[0];
			assert.strictEqual(firstCommit.type, 'commit');
			assert.strictEqual(firstCommit.sha, 'abc1234');
			assert.strictEqual(firstCommit.updateRefs?.length, 1);
			assert.strictEqual(firstCommit.updateRefs?.[0].ref, 'refs/heads/feature-a');
			assert.strictEqual(firstCommit.updateRefs?.[0].line, 1);

			// Second commit should have feature-b update-ref attached
			const secondCommit = result.entries[1];
			assert.strictEqual(secondCommit.type, 'commit');
			assert.strictEqual(secondCommit.sha, 'def5678');
			assert.strictEqual(secondCommit.updateRefs?.length, 1);
			assert.strictEqual(secondCommit.updateRefs?.[0].ref, 'refs/heads/feature-b');
			assert.strictEqual(secondCommit.updateRefs?.[0].line, 3);
		});

		test('attaches multiple update-refs to the same commit', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'pick', sha: 'abc1234', message: 'First commit' },
				{ line: 1, action: 'update-ref', ref: 'refs/heads/feature-a' },
				{ line: 2, action: 'update-ref', ref: 'refs/heads/feature-b' },
				{ line: 3, action: 'update-ref', ref: 'refs/heads/feature-c' },
				{ line: 4, action: 'pick', sha: 'def5678', message: 'Second commit' },
			];

			const result = processRebaseEntries(entries);

			assert.strictEqual(result.entries.length, 2);

			const firstCommit = result.entries[0];
			assert.strictEqual(firstCommit.type, 'commit');
			if (firstCommit.type !== 'commit') throw new Error('Expected commit');
			assert.strictEqual(firstCommit.updateRefs?.length, 3, 'Should have 3 update-refs');
			assert.strictEqual(firstCommit.updateRefs?.[0].ref, 'refs/heads/feature-a');
			assert.strictEqual(firstCommit.updateRefs?.[0].line, 1);
			assert.strictEqual(firstCommit.updateRefs?.[1].ref, 'refs/heads/feature-b');
			assert.strictEqual(firstCommit.updateRefs?.[1].line, 2);
			assert.strictEqual(firstCommit.updateRefs?.[2].ref, 'refs/heads/feature-c');
			assert.strictEqual(firstCommit.updateRefs?.[2].line, 3);

			const secondCommit = result.entries[1];
			assert.strictEqual(secondCommit.type, 'commit');
			if (secondCommit.type !== 'commit') throw new Error('Expected commit');
			assert.strictEqual(secondCommit.updateRefs, undefined, 'Second commit should have no update-refs');
		});

		test('handles commits without update-refs', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'pick', sha: 'abc1234', message: 'First commit' },
				{ line: 1, action: 'pick', sha: 'def5678', message: 'Second commit' },
				{ line: 2, action: 'update-ref', ref: 'refs/heads/feature-a' },
			];

			const result = processRebaseEntries(entries);

			assert.strictEqual(result.entries.length, 2);

			const firstCommit = result.entries[0];
			assert.strictEqual(firstCommit.type, 'commit');
			if (firstCommit.type === 'commit') {
				assert.strictEqual(firstCommit.updateRefs, undefined, 'First commit should have no update-refs');
			}

			const secondCommit = result.entries[1];
			assert.strictEqual(secondCommit.type, 'commit');
			if (secondCommit.type === 'commit') {
				assert.strictEqual(secondCommit.updateRefs?.length, 1);
				assert.strictEqual(secondCommit.updateRefs?.[0].ref, 'refs/heads/feature-a');
			}
		});

		test('ignores update-ref entries without preceding commit', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'update-ref', ref: 'refs/heads/orphan' },
				{ line: 1, action: 'pick', sha: 'abc1234', message: 'First commit' },
			];

			const result = processRebaseEntries(entries);

			assert.strictEqual(result.entries.length, 1);
			const entry = result.entries[0];
			assert.strictEqual(entry.type, 'commit');
			if (entry.type === 'commit') {
				assert.strictEqual(entry.updateRefs, undefined);
			}
		});
	});

	suite('formatUpdateRefLine', () => {
		test('formats update-ref line correctly', () => {
			assert.strictEqual(formatUpdateRefLine('refs/heads/feature-a'), 'update-ref refs/heads/feature-a');
			assert.strictEqual(formatUpdateRefLine('refs/heads/main'), 'update-ref refs/heads/main');
		});
	});

	suite('formatRebaseTodoEntryLine', () => {
		test('formats commit entry correctly', () => {
			const result = formatRebaseTodoEntryLine({
				type: 'commit',
				id: 'abc1234',
				line: 0,
				action: 'pick',
				sha: 'abc1234',
				message: 'Test commit',
			});
			assert.strictEqual(result, 'pick abc1234 Test commit');
		});

		test('formats commit entry with flag correctly', () => {
			const result = formatRebaseTodoEntryLine({
				type: 'commit',
				id: 'abc1234',
				line: 0,
				action: 'fixup',
				sha: 'abc1234',
				message: 'Test commit',
				flag: '-c',
			});
			assert.strictEqual(result, 'fixup -c abc1234 Test commit');
		});

		test('overrides action when specified', () => {
			const result = formatRebaseTodoEntryLine(
				{
					type: 'commit',
					id: 'abc1234',
					line: 0,
					action: 'squash',
					sha: 'abc1234',
					message: 'Test commit',
				},
				'pick',
			);
			assert.strictEqual(result, 'pick abc1234 Test commit');
		});
	});

	suite('reordering with update-refs', () => {
		/**
		 * Helper to simulate reordering entries and generate new file content.
		 * This mirrors the logic in rebaseWebviewProvider.rewriteEntries()
		 */
		function generateReorderedContent(
			entries: ReturnType<typeof processRebaseEntries>['entries'],
			newOrder: number[],
		): string {
			const reordered = newOrder.map(i => entries[i]);
			const lines: string[] = [];

			for (const entry of reordered) {
				lines.push(formatRebaseTodoEntryLine(entry));
				if (entry.type === 'commit' && entry.updateRefs?.length) {
					for (const updateRef of entry.updateRefs) {
						lines.push(formatUpdateRefLine(updateRef.ref));
					}
				}
			}

			return lines.join('\n');
		}

		test('update-refs follow their commit when reordered', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'pick', sha: 'abc1234', message: 'First commit' },
				{ line: 1, action: 'update-ref', ref: 'refs/heads/feature-a' },
				{ line: 2, action: 'pick', sha: 'def5678', message: 'Second commit' },
				{ line: 3, action: 'update-ref', ref: 'refs/heads/feature-b' },
			];

			const processed = processRebaseEntries(entries);

			// Original order: [first + feature-a, second + feature-b]
			// New order: swap - [second + feature-b, first + feature-a]
			const reordered = generateReorderedContent(processed.entries, [1, 0]);

			const expectedLines = [
				'pick def5678 Second commit',
				'update-ref refs/heads/feature-b',
				'pick abc1234 First commit',
				'update-ref refs/heads/feature-a',
			];
			assert.strictEqual(reordered, expectedLines.join('\n'));
		});

		test('multiple update-refs stay attached to their commit when moved', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'pick', sha: 'abc1234', message: 'First commit' },
				{ line: 1, action: 'update-ref', ref: 'refs/heads/feature-a' },
				{ line: 2, action: 'update-ref', ref: 'refs/heads/feature-b' },
				{ line: 3, action: 'pick', sha: 'def5678', message: 'Second commit' },
			];

			const processed = processRebaseEntries(entries);

			// Move first commit (with 2 update-refs) after second
			const reordered = generateReorderedContent(processed.entries, [1, 0]);

			const expectedLines = [
				'pick def5678 Second commit',
				'pick abc1234 First commit',
				'update-ref refs/heads/feature-a',
				'update-ref refs/heads/feature-b',
			];
			assert.strictEqual(reordered, expectedLines.join('\n'));
		});

		test('commits without update-refs reorder correctly alongside commits with update-refs', () => {
			const entries: RebaseTodoEntry[] = [
				{ line: 0, action: 'pick', sha: 'abc1234', message: 'First (no refs)' },
				{ line: 1, action: 'pick', sha: 'def5678', message: 'Second (has ref)' },
				{ line: 2, action: 'update-ref', ref: 'refs/heads/feature-x' },
				{ line: 3, action: 'pick', sha: 'ghi9012', message: 'Third (no refs)' },
			];

			const processed = processRebaseEntries(entries);

			// Reverse order: [third, second + ref, first]
			const reordered = generateReorderedContent(processed.entries, [2, 1, 0]);

			const expectedLines = [
				'pick ghi9012 Third (no refs)',
				'pick def5678 Second (has ref)',
				'update-ref refs/heads/feature-x',
				'pick abc1234 First (no refs)',
			];
			assert.strictEqual(reordered, expectedLines.join('\n'));
		});
	});
});
