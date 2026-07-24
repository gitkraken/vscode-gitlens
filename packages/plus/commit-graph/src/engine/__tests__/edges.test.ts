import * as assert from 'assert';
import { __test, buildEdgeHash, collapsedLinkKey, computeEdges } from '../edges.js';
import { computeColumnsAndSegments } from '../layout.js';
import type { CommitKind, GraphRow, Sha } from '../types.js';

function row(sha: Sha, parents: Sha[] = [], kind: CommitKind = 'commit'): GraphRow {
	return { sha: sha, parents: parents, kind: kind, date: 0 };
}

suite('engine/edges computeEdges', () => {
	test('linear history draws a single starting/ending lane on column 0', () => {
		const { rows } = computeColumnsAndSegments([row('A', ['B']), row('B', ['C']), row('C', [])]);
		computeEdges(rows);

		// A starts an edge to B on col 0.
		assert.strictEqual(rows[0].edges[0].starting?.parentSha, 'B');
		assert.strictEqual(rows[0].edges[0].starting?.kind, 'commit');
		// B ends A's edge and starts one to C — same column.
		assert.strictEqual(rows[1].edges[0].ending?.parentSha, 'B');
		assert.strictEqual(rows[1].edges[0].starting?.parentSha, 'C');
		// Nothing extends past column 0.
		assert.deepStrictEqual(
			rows.map(r => r.edgeColumnMax),
			[0, 0, 0],
		);
	});

	test('merge fan roots the second-parent edge on the branch lane', () => {
		const { rows } = computeColumnsAndSegments([
			row('M', ['A', 'B'], 'merge'),
			row('A', ['C']),
			row('B', ['C']),
			row('C', []),
		]);
		computeEdges(rows);

		const m = rows[0];
		assert.strictEqual(m.edges[0].starting?.parentSha, 'A'); // first parent on trunk
		assert.strictEqual(m.edges[1].starting?.parentSha, 'B'); // second parent on its own lane
		assert.strictEqual(m.edgeColumnMax, 1);
	});

	test('unloaded second parent dangles a stub down its held lane', () => {
		const { rows, unloadedColumns } = computeColumnsAndSegments([row('M', ['A', 'Z'], 'merge'), row('A', [])]);
		computeEdges(rows, { unloadedColumns: unloadedColumns });

		// M starts an edge toward the unloaded Z on the reserved column 1.
		assert.strictEqual(rows[0].edges[1].starting?.parentSha, 'Z');
		// The next row keeps that lane alive as a pass-through (the visible stub).
		assert.strictEqual(rows[1].edges[1].passThrough?.parentSha, 'Z');
	});

	test('workdir edges are marked so the renderer can dash them', () => {
		const { rows } = computeColumnsAndSegments([row('W', ['A'], 'workdir'), row('A', [])]);
		computeEdges(rows);
		assert.strictEqual(rows[0].edges[0].starting?.kind, 'workdir');
	});
});

suite('engine/edges buildEdgeHash', () => {
	test('identical edge shapes hash identically (memoization contract)', () => {
		const { rows: a } = computeColumnsAndSegments([row('A', ['B']), row('B', ['C']), row('C', [])]);
		computeEdges(a);
		const { rows: b } = computeColumnsAndSegments([row('X', ['Y']), row('Y', ['Z']), row('Z', [])]);
		computeEdges(b);
		// Two structurally identical linear rows produce the same hash — SVG can be reused.
		assert.strictEqual(
			buildEdgeHash(a[0].edges, a[0].edgeColumnMax, a[0].column),
			buildEdgeHash(b[0].edges, b[0].edgeColumnMax, b[0].column),
		);
	});

	test('different edge shapes hash differently', () => {
		const { rows } = computeColumnsAndSegments([
			row('M', ['A', 'B'], 'merge'),
			row('A', ['C']),
			row('B', ['C']),
			row('C', []),
		]);
		computeEdges(rows);
		const merge = buildEdgeHash(rows[0].edges, rows[0].edgeColumnMax, rows[0].column);
		const plain = buildEdgeHash(rows[1].edges, rows[1].edgeColumnMax, rows[1].column);
		assert.notStrictEqual(merge, plain);
	});

	test('spansHidden changes the hash (dashed vs solid must not collide)', () => {
		const { rows } = computeColumnsAndSegments([row('A', ['B']), row('B', [])]);
		computeEdges(rows, { collapsedLinks: new Set([collapsedLinkKey('A', 'B')]) });
		const withSpan = buildEdgeHash(rows[0].edges, rows[0].edgeColumnMax, rows[0].column);

		const { rows: plainRows } = computeColumnsAndSegments([row('A', ['B']), row('B', [])]);
		computeEdges(plainRows);
		const withoutSpan = buildEdgeHash(plainRows[0].edges, plainRows[0].edgeColumnMax, plainRows[0].column);

		assert.strictEqual(rows[0].edges[0].starting?.spansHidden, true);
		assert.notStrictEqual(withSpan, withoutSpan);
	});
});

suite('engine/edges internals', () => {
	test('edgeColumnMax reports the highest occupied column', () => {
		assert.strictEqual(__test.edgeColumnMax({ 0: {}, 3: {} }), 3);
		assert.strictEqual(__test.edgeColumnMax({}), 0);
	});
});
