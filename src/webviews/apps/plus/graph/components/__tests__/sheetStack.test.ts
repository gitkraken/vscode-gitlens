import * as assert from 'assert';
import type { FileChangeListItemDetail } from '../../../../commitDetails/components/gl-details-base.js';
import type { BranchSheetRef } from '../gl-graph-branch-sheet-pane.js';
import type { SheetDescriptor } from '../sheetStack.js';
import {
	popSheet,
	projectCompareSignal,
	pushSheet,
	reduceOnSelectionChange,
	removeKind,
	replaceStack,
	sheetKey,
} from '../sheetStack.js';

function branchDescriptor(overrides?: Partial<BranchSheetRef>, repoPath: string = '/repo'): SheetDescriptor {
	const ref: BranchSheetRef = {
		name: overrides?.name ?? 'main',
		refType: overrides?.refType ?? 'local',
		remote: overrides?.remote ?? null,
		sha: overrides?.sha ?? 'sha-main',
		context: overrides?.context,
	};
	return { kind: 'branch', ref: ref, repoPath: repoPath };
}

function conflictDescriptor(overrides?: Partial<FileChangeListItemDetail>): SheetDescriptor {
	const detail: FileChangeListItemDetail = {
		repoPath: overrides?.repoPath ?? '/repo',
		path: overrides?.path ?? 'file.ts',
		status: overrides?.status ?? 'M',
	};
	return { kind: 'conflict', detail: detail, fileName: 'file.ts' };
}

function rebaseSummaryDescriptor(repoPath: string = '/repo'): SheetDescriptor {
	return { kind: 'rebaseSummary', repoPath: repoPath };
}

function compareDescriptor(): SheetDescriptor {
	return { kind: 'compare' };
}

suite('pushSheet', () => {
	test('appends to a non-empty stack', () => {
		const stack = [branchDescriptor()];
		const result = pushSheet(stack, compareDescriptor());

		assert.deepStrictEqual(result, [branchDescriptor(), compareDescriptor()]);
	});

	test('pushing a descriptor whose key matches the current top replaces the top in place', () => {
		const stack = [branchDescriptor(), rebaseSummaryDescriptor('/repo')];
		const result = pushSheet(stack, rebaseSummaryDescriptor('/repo'));

		assert.strictEqual(result.length, 2);
		assert.deepStrictEqual(result, [branchDescriptor(), rebaseSummaryDescriptor('/repo')]);
	});

	test('pushes onto an empty stack', () => {
		const result = pushSheet([], compareDescriptor());

		assert.deepStrictEqual(result, [compareDescriptor()]);
	});

	test('does not mutate the input array', () => {
		const stack = [branchDescriptor()];
		const snapshot = structuredClone(stack);

		pushSheet(stack, compareDescriptor());

		assert.deepStrictEqual(stack, snapshot);
	});
});

suite('replaceStack', () => {
	test('always yields a single-element array, from an empty stack', () => {
		const result = replaceStack([], compareDescriptor());

		assert.deepStrictEqual(result, [compareDescriptor()]);
	});

	test('always yields a single-element array, from a one-element stack', () => {
		const result = replaceStack([branchDescriptor()], compareDescriptor());

		assert.deepStrictEqual(result, [compareDescriptor()]);
	});

	test('always yields a single-element array, from a multi-element stack', () => {
		const stack = [branchDescriptor(), conflictDescriptor(), rebaseSummaryDescriptor()];
		const result = replaceStack(stack, compareDescriptor());

		assert.deepStrictEqual(result, [compareDescriptor()]);
	});
});

suite('popSheet', () => {
	test('returns the popped top plus a shortened stack', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const result = popSheet(stack);

		assert.deepStrictEqual(result.stack, [branchDescriptor()]);
		assert.deepStrictEqual(result.popped, compareDescriptor());
	});

	test('pop on an empty array returns the same reference and undefined', () => {
		const empty: SheetDescriptor[] = [];
		const result = popSheet(empty);

		assert.strictEqual(result.stack, empty);
		assert.strictEqual(result.popped, undefined);
	});

	test('does not mutate the input array', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const snapshot = structuredClone(stack);

		popSheet(stack);

		assert.deepStrictEqual(stack, snapshot);
	});
});

suite('removeKind', () => {
	test('removes a kind from the middle of a multi-sheet stack', () => {
		const stack = [branchDescriptor(), conflictDescriptor(), compareDescriptor()];
		const result = removeKind(stack, 'conflict');

		assert.deepStrictEqual(result, [branchDescriptor(), compareDescriptor()]);
	});

	test('removing an absent kind returns the same reference', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const result = removeKind(stack, 'rebaseSummary');

		assert.strictEqual(result, stack);
	});

	test('removes multiple entries of the same kind scattered through the stack, preserving order of survivors', () => {
		const stack = [
			branchDescriptor(),
			conflictDescriptor({ path: 'a.ts' }),
			compareDescriptor(),
			conflictDescriptor({ path: 'b.ts' }),
		];
		const result = removeKind(stack, 'conflict');

		assert.deepStrictEqual(result, [branchDescriptor(), compareDescriptor()]);
	});

	test('does not mutate the input array', () => {
		const stack = [branchDescriptor(), conflictDescriptor(), compareDescriptor()];
		const snapshot = structuredClone(stack);

		removeKind(stack, 'conflict');

		assert.deepStrictEqual(stack, snapshot);
	});
});

suite('reduceOnSelectionChange', () => {
	test('branch root + belongsToBranch true -> same reference, even with sheets stacked above', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const result = reduceOnSelectionChange(stack, () => true);

		assert.strictEqual(result, stack);
	});

	test('branch root + belongsToBranch false -> clears the whole stack, including sheets stacked above', () => {
		const stack = [branchDescriptor(), conflictDescriptor(), compareDescriptor()];
		const result = reduceOnSelectionChange(stack, () => false);

		assert.deepStrictEqual(result, []);
	});

	test('conflict root -> same reference regardless of callback result', () => {
		const stack = [conflictDescriptor()];

		assert.strictEqual(
			reduceOnSelectionChange(stack, () => true),
			stack,
		);
		assert.strictEqual(
			reduceOnSelectionChange(stack, () => false),
			stack,
		);
	});

	test('rebaseSummary root -> same reference regardless of callback result', () => {
		const stack = [rebaseSummaryDescriptor()];

		assert.strictEqual(
			reduceOnSelectionChange(stack, () => true),
			stack,
		);
		assert.strictEqual(
			reduceOnSelectionChange(stack, () => false),
			stack,
		);
	});

	test('compare root -> same reference regardless of callback result', () => {
		const stack = [compareDescriptor()];

		assert.strictEqual(
			reduceOnSelectionChange(stack, () => true),
			stack,
		);
		assert.strictEqual(
			reduceOnSelectionChange(stack, () => false),
			stack,
		);
	});

	test('empty stack -> same reference', () => {
		const empty: SheetDescriptor[] = [];
		const result = reduceOnSelectionChange(empty, () => false);

		assert.strictEqual(result, empty);
	});

	test('does not mutate the input array', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const snapshot = structuredClone(stack);

		reduceOnSelectionChange(stack, () => true);

		assert.deepStrictEqual(stack, snapshot);
	});
});

suite('projectCompareSignal', () => {
	test('open + no compare present -> replaces the whole stack with a single-entry compare, even from a non-empty stack', () => {
		const stack = [branchDescriptor(), conflictDescriptor()];
		const result = projectCompareSignal(stack, true);

		assert.deepStrictEqual(result, [compareDescriptor()]);
	});

	test('open + compare present anywhere -> same reference', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const result = projectCompareSignal(stack, true);

		assert.strictEqual(result, stack);
	});

	test('closed + compare present -> removed, preserving order of survivors', () => {
		const stack = [branchDescriptor(), compareDescriptor(), conflictDescriptor()];
		const result = projectCompareSignal(stack, false);

		assert.deepStrictEqual(result, [branchDescriptor(), conflictDescriptor()]);
	});

	test('closed + none present -> same reference', () => {
		const stack = [branchDescriptor(), conflictDescriptor()];
		const result = projectCompareSignal(stack, false);

		assert.strictEqual(result, stack);
	});

	test('idempotent: applying twice with the same open value yields reference equality on the second call', () => {
		const stack = [branchDescriptor()];
		const first = projectCompareSignal(stack, true);
		const second = projectCompareSignal(first, true);

		assert.strictEqual(second, first);
	});

	test('idempotent when closed: applying twice with the same open value yields reference equality on the second call', () => {
		const stack = [branchDescriptor(), compareDescriptor()];
		const first = projectCompareSignal(stack, false);
		const second = projectCompareSignal(first, false);

		assert.strictEqual(second, first);
	});
});

suite('sheetKey', () => {
	test('two structurally-equal descriptors, separately constructed, produce equal keys', () => {
		assert.strictEqual(sheetKey(branchDescriptor()), sheetKey(branchDescriptor()));
	});

	test('keys differ across different kinds', () => {
		assert.notStrictEqual(sheetKey(branchDescriptor()), sheetKey(compareDescriptor()));
	});

	test('keys differ across two branch descriptors with different name', () => {
		assert.notStrictEqual(
			sheetKey(branchDescriptor({ name: 'main' })),
			sheetKey(branchDescriptor({ name: 'dev' })),
		);
	});

	test('keys differ across two branch descriptors with different refType', () => {
		assert.notStrictEqual(
			sheetKey(branchDescriptor({ refType: 'local' })),
			sheetKey(branchDescriptor({ refType: 'remote' })),
		);
	});

	test('keys differ across two branch descriptors with different remote', () => {
		assert.notStrictEqual(
			sheetKey(branchDescriptor({ remote: null })),
			sheetKey(branchDescriptor({ remote: 'origin' })),
		);
	});

	test('the key is identical for two branch descriptors that differ only in context and/or sha', () => {
		const a = branchDescriptor({ context: 'ctx-a', sha: 'sha-a' });
		const b = branchDescriptor({ context: 'ctx-b', sha: 'sha-b' });

		assert.strictEqual(sheetKey(a), sheetKey(b));
	});

	test('keys differ for identically named branches in different repositories', () => {
		const a = branchDescriptor(undefined, '/repo-a');
		const b = branchDescriptor(undefined, '/repo-b');

		assert.notStrictEqual(sheetKey(a), sheetKey(b));
	});

	test('field values containing a would-be delimiter cannot collide across field boundaries', () => {
		// Under a '|'-joined key these two produce the same string: 'conflict|/r|a|b'.
		const a = conflictDescriptor({ repoPath: '/r|a', path: 'b' });
		const b = conflictDescriptor({ repoPath: '/r', path: 'a|b' });

		assert.notStrictEqual(sheetKey(a), sheetKey(b));
	});
});
