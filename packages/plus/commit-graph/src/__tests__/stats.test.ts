import * as assert from 'assert';
import {
	changesChurnClamp,
	changesMagnitude,
	changesModeOrDefault,
	changesStageForWidth,
	changesTrackWidth,
	computeChangesBarWidths,
	computeChangesBipolarWidths,
	computeChangesRingArcs,
	computeChangesSquares,
	formatChangesFiles,
	formatChangesLines,
} from '../stats.js';

suite('stats — changesModeOrDefault', () => {
	test('known modes pass through', () => {
		assert.strictEqual(changesModeOrDefault('numbers'), 'numbers');
		assert.strictEqual(changesModeOrDefault('squares'), 'squares');
		assert.strictEqual(changesModeOrDefault('bar'), 'bar');
		assert.strictEqual(changesModeOrDefault('bipolar'), 'bipolar');
	});

	test('unknown or missing modes default to bar', () => {
		assert.strictEqual(changesModeOrDefault(undefined), 'bar');
		assert.strictEqual(changesModeOrDefault('graph'), 'bar');
		assert.strictEqual(changesModeOrDefault(''), 'bar');
	});
});

suite('stats — changesMagnitude', () => {
	test('zero or negative churn is zero', () => {
		assert.strictEqual(changesMagnitude(0), 0);
		assert.strictEqual(changesMagnitude(-100), 0);
	});

	test('monotonically increases with churn', () => {
		const a = changesMagnitude(10);
		const b = changesMagnitude(100);
		const c = changesMagnitude(800);
		assert.ok(a < b, `${a} < ${b}`);
		assert.ok(b < c, `${b} < ${c}`);
	});

	test('churn at the clamp is exactly 1', () => {
		assert.strictEqual(changesMagnitude(changesChurnClamp), 1);
	});

	test('churn past the clamp saturates at 1', () => {
		assert.strictEqual(changesMagnitude(changesChurnClamp * 10), 1);
	});
});

suite('stats — computeChangesBarWidths', () => {
	test('zero total: floors at 6px, no NaN', () => {
		const widths = computeChangesBarWidths(0, 0);
		assert.strictEqual(widths.barWidth, 6);
		assert.strictEqual(widths.addedWidth, 0);
		assert.strictEqual(widths.deletedWidth, 0);
		assert.ok(!Number.isNaN(widths.addedWidth) && !Number.isNaN(widths.deletedWidth));
	});

	test('proportional split sums to barWidth', () => {
		const widths = computeChangesBarWidths(300, 100);
		assert.ok(
			Math.abs(widths.addedWidth + widths.deletedWidth - widths.barWidth) < 1e-9,
			`${widths.addedWidth} + ${widths.deletedWidth} ≈ ${widths.barWidth}`,
		);
		assert.ok(widths.addedWidth > widths.deletedWidth);
	});

	test('tiny nonzero churn floors barWidth at 6', () => {
		const widths = computeChangesBarWidths(1, 0);
		assert.strictEqual(widths.barWidth, 6);
	});

	test('churn at/above the clamp saturates barWidth at the full track width', () => {
		assert.strictEqual(computeChangesBarWidths(changesChurnClamp, 0).barWidth, changesTrackWidth);
		assert.strictEqual(computeChangesBarWidths(changesChurnClamp * 4, 0).barWidth, changesTrackWidth);
	});
});

suite('stats — computeChangesSquares', () => {
	test('always returns exactly 5 cells', () => {
		assert.strictEqual(computeChangesSquares(0, 0).length, 5);
		assert.strictEqual(computeChangesSquares(10, 0).length, 5);
		assert.strictEqual(computeChangesSquares(1, 999).length, 5);
	});

	test('additions only fill every cell added', () => {
		const cells = computeChangesSquares(10, 0);
		assert.ok(cells.every(c => c === 'added'));
	});

	test('deletions only fill every cell deleted', () => {
		const cells = computeChangesSquares(0, 10);
		assert.ok(cells.every(c => c === 'deleted'));
	});

	test('balanced additions/deletions produce some of each', () => {
		const cells = computeChangesSquares(50, 50);
		assert.ok(cells.some(c => c === 'added'));
		assert.ok(cells.some(c => c === 'deleted'));
	});

	test('a tiny minority side still gets at least one cell', () => {
		const cells = computeChangesSquares(1, 999);
		assert.ok(
			cells.some(c => c === 'added'),
			'at least one added cell despite dominant deletions',
		);
	});

	test('a tiny minority of deletions still gets at least one cell', () => {
		const cells = computeChangesSquares(900, 60);
		assert.strictEqual(cells.filter(c => c === 'added').length, 4);
		assert.strictEqual(cells.filter(c => c === 'deleted').length, 1);
	});

	test('a near-total majority of additions still leaves one cell for deletions', () => {
		const cells = computeChangesSquares(999, 1);
		assert.strictEqual(cells.filter(c => c === 'added').length, 4);
		assert.strictEqual(cells.filter(c => c === 'deleted').length, 1);
	});

	test('both zero: all cells empty', () => {
		const cells = computeChangesSquares(0, 0);
		assert.ok(cells.every(c => c === 'empty'));
	});
});

suite('stats — computeChangesBipolarWidths', () => {
	test('zero additions/deletions: both widths zero', () => {
		const widths = computeChangesBipolarWidths(0, 0);
		assert.strictEqual(widths.addedWidth, 0);
		assert.strictEqual(widths.deletedWidth, 0);
	});

	test('clamps each side at the half-track width', () => {
		const half = changesTrackWidth / 2;
		const widths = computeChangesBipolarWidths(changesChurnClamp * 4, changesChurnClamp * 4);
		assert.strictEqual(widths.addedWidth, half);
		assert.strictEqual(widths.deletedWidth, half);
	});
});

suite('stats — formatChangesFiles', () => {
	test('renders small counts verbatim', () => {
		assert.strictEqual(formatChangesFiles(1), '1');
		assert.strictEqual(formatChangesFiles(999), '999');
	});

	test('caps at 999+', () => {
		assert.strictEqual(formatChangesFiles(1000), '999+');
		assert.strictEqual(formatChangesFiles(50_000), '999+');
	});
});

suite('stats — changesStageForWidth', () => {
	test('boundaries pick the wider stage at the threshold', () => {
		assert.strictEqual(changesStageForWidth(110), 'full');
		assert.strictEqual(changesStageForWidth(109), 'compact');
		assert.strictEqual(changesStageForWidth(76), 'compact');
		assert.strictEqual(changesStageForWidth(75), 'mini');
		assert.strictEqual(changesStageForWidth(44), 'mini');
		assert.strictEqual(changesStageForWidth(43), 'icon');
	});

	test('wide stays full, hairline stays icon', () => {
		assert.strictEqual(changesStageForWidth(200), 'full');
		assert.strictEqual(changesStageForWidth(0), 'icon');
	});
});

suite('stats — formatChangesLines', () => {
	test('exact when not compact, regardless of size', () => {
		assert.strictEqual(formatChangesLines(0, false), '0');
		assert.strictEqual(formatChangesLines(1840, false), '1840');
		assert.strictEqual(formatChangesLines(123_456, false), '123456');
	});

	test('compact keeps sub-thousand counts exact', () => {
		assert.strictEqual(formatChangesLines(0, true), '0');
		assert.strictEqual(formatChangesLines(999, true), '999');
	});

	test('compact abbreviates thousands with a trimmed decimal', () => {
		assert.strictEqual(formatChangesLines(1000, true), '1k');
		assert.strictEqual(formatChangesLines(1840, true), '1.8k');
		assert.strictEqual(formatChangesLines(5500, true), '5.5k');
	});

	test('compact drops the decimal at ten thousand and up', () => {
		assert.strictEqual(formatChangesLines(12_000, true), '12k');
		assert.strictEqual(formatChangesLines(123_400, true), '123k');
	});
});

suite('stats — computeChangesRingArcs', () => {
	test('zero churn: no sweep (add ends at 0, del starts at 360)', () => {
		const arcs = computeChangesRingArcs(0, 0);
		assert.strictEqual(arcs.addDeg, 0);
		assert.strictEqual(arcs.delFromDeg, 360);
	});

	test('additions only: deletions arc is empty', () => {
		const arcs = computeChangesRingArcs(changesChurnClamp, 0);
		assert.strictEqual(arcs.addDeg, 360);
		assert.strictEqual(arcs.delFromDeg, 360);
	});

	test('deletions only: additions arc is empty', () => {
		const arcs = computeChangesRingArcs(0, changesChurnClamp);
		assert.strictEqual(arcs.addDeg, 0);
		assert.strictEqual(arcs.delFromDeg, 0);
	});

	test('mixed: total-churn sweep split by ratio, deletions on the far side of the axis', () => {
		const arcs = computeChangesRingArcs(300, 100);
		const sweep = changesMagnitude(400) * 360;
		const addDeg = sweep * 0.75;
		assert.ok(Math.abs(arcs.addDeg - addDeg) < 1e-9, `${arcs.addDeg} ≈ ${addDeg}`);
		assert.ok(Math.abs(360 - arcs.delFromDeg - sweep * 0.25) < 1e-9);
		// sweep is total-churn scaled (like bar), not each side independently
		assert.ok(Math.abs(arcs.addDeg + (360 - arcs.delFromDeg) - sweep) < 1e-9);
	});

	test('sweep saturates at a full circle past the clamp', () => {
		const arcs = computeChangesRingArcs(changesChurnClamp * 4, 0);
		assert.strictEqual(arcs.addDeg, 360);
	});
});
