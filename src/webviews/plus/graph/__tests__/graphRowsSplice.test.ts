import * as assert from 'assert';
import type { GitGraphRow, GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import { appendRowsLedger, buildRowsLedger, diffRowsAgainstLedger, fingerprintRow } from '../graphRowsSplice.js';

function row(sha: string, options?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: sha,
		parents: [`p-${sha}`],
		author: 'Tester',
		email: 'test@example.com',
		date: 1000,
		message: `commit ${sha}`,
		type: 'commit-node',
		...options,
	};
}

function rows(count: number, prefix = 'sha'): GitGraphRow[] {
	return Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
}

const opts = { minReused: 2 };

function flagsOf(n: number): GitGraphRowContextFlags {
	return n;
}

suite('graphRowsSplice', () => {
	suite('fingerprintRow', () => {
		test('bare commit rows have no fingerprint', () => {
			assert.strictEqual(fingerprintRow(row('a')), undefined);
		});

		test('ref decorations and non-patchable contexts fingerprint', () => {
			const plain = row('a');
			const withHead = row('a', { heads: [{ name: 'main', isCurrentHead: true }] as GitGraphRow['heads'] });
			const withRowCtx = row('a', { contexts: { row: 'serialized' } });
			assert.notStrictEqual(fingerprintRow(withHead), fingerprintRow(plain));
			assert.notStrictEqual(fingerprintRow(withRowCtx), fingerprintRow(plain));
			assert.notStrictEqual(fingerprintRow(row('a', { contexts: { row: 'other' } })), fingerprintRow(withRowCtx));
		});

		test('flags and reachabilityIndex do NOT fingerprint (they ship as a patch)', () => {
			const plain = row('a');
			assert.strictEqual(fingerprintRow(row('a', { contexts: { reachabilityIndex: 3 } })), fingerprintRow(plain));
			assert.strictEqual(fingerprintRow(row('a', { contexts: { flags: flagsOf(5) } })), fingerprintRow(plain));
			assert.strictEqual(
				fingerprintRow(row('a', { contexts: { flags: flagsOf(5), reachabilityIndex: 3 } })),
				undefined,
			);
		});

		test('work-dir rows fingerprint their date (re-stamped per walk)', () => {
			const a = row('work-dir-changes', { type: 'work-dir-changes', date: 1 });
			const b = row('work-dir-changes', { type: 'work-dir-changes', date: 2 });
			assert.notStrictEqual(fingerprintRow(a), fingerprintRow(b));
		});
	});

	suite('diffRowsAgainstLedger', () => {
		test('prepended commit ships head-only with the suffix reused', () => {
			const prior = rows(10);
			const ledger = buildRowsLedger(prior);
			const next = [row('new0'), ...prior];
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice);
			assert.deepStrictEqual(
				splice.head.map(r => r.sha),
				['new0'],
			);
			assert.strictEqual(splice.reusedStart, 0);
			assert.strictEqual(splice.reusedCount, 10);
			assert.strictEqual(splice.tail, undefined);
			assert.strictEqual(splice.expectedPriorRows, 10);
			assert.strictEqual(splice.firstReusedSha, 'sha0');
			assert.strictEqual(splice.lastReusedSha, 'sha9');
		});

		test('a moved ref breaks the reuse at that row', () => {
			const prior = rows(10);
			const ledger = buildRowsLedger(prior);
			const next = [row('new0'), ...prior];
			next[3] = row('sha2', { heads: [{ name: 'main', isCurrentHead: true }] as GitGraphRow['heads'] });
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice);
			assert.deepStrictEqual(
				splice.head.map(r => r.sha),
				['new0', 'sha0', 'sha1', 'sha2'],
			);
			assert.strictEqual(splice.reusedStart, 3);
			assert.strictEqual(splice.reusedCount, 7);
		});

		test('grown bottom ships the overhang as tail', () => {
			const prior = rows(10);
			const ledger = buildRowsLedger(prior);
			const next = [row('new0'), ...prior, row('deep0'), row('deep1')];
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice);
			assert.deepStrictEqual(
				splice.head.map(r => r.sha),
				['new0'],
			);
			assert.strictEqual(splice.reusedCount, 10);
			assert.deepStrictEqual(
				splice.tail?.map(r => r.sha),
				['deep0', 'deep1'],
			);
		});

		test('cut bottom anchors via the ledger and still reuses', () => {
			const prior = rows(10);
			const ledger = buildRowsLedger(prior);
			const next = [row('new0'), ...prior.slice(0, 9)];
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice);
			assert.strictEqual(splice.reusedStart, 0);
			assert.strictEqual(splice.reusedCount, 9);
			assert.strictEqual(splice.lastReusedSha, 'sha8');
		});

		test('reconstruction equals the fresh rows for every alignment case', () => {
			const prior = rows(12);
			const ledger = buildRowsLedger(prior);
			for (const next of [
				[row('n0'), ...prior],
				[row('n0'), ...prior, row('deep0')],
				[row('n0'), row('n1'), ...prior.slice(0, 10)],
			]) {
				const splice = diffRowsAgainstLedger(next, ledger, opts);
				assert.ok(splice, 'expected a splice');
				const rebuilt = [
					...splice.head,
					...prior.slice(splice.reusedStart, splice.reusedStart + splice.reusedCount),
					...(splice.tail ?? []),
				];
				assert.deepStrictEqual(rebuilt, next);
			}
		});

		test('a sub-1000-row window still splices under the DEFAULT minReused (relative reuse governs, not a flat floor)', () => {
			const prior = rows(490);
			const ledger = buildRowsLedger(prior);
			// 7 new head rows + the full 490-row reused tail = a 497-row window, 490 reused — exactly the
			// shape a flat 1000-row floor used to reject outright (490 < 1000), forcing a full re-render.
			const next = [...rows(7, 'new'), ...prior];
			const splice = diffRowsAgainstLedger(next, ledger); // no options — exercises the real default.
			assert.ok(splice, 'a well-under-1000-row window with majority reuse must still splice');
			assert.strictEqual(splice.reusedCount, 490);
		});

		test('too little reuse ships full rows', () => {
			const prior = rows(10);
			const ledger = buildRowsLedger(prior);
			const next = rows(10, 'other');
			assert.strictEqual(diffRowsAgainstLedger(next, ledger, opts), undefined);
		});

		test('below-threshold reuse ships full rows', () => {
			const prior = rows(4);
			const ledger = buildRowsLedger(prior);
			const next = [...rows(6, 'other'), ...prior.slice(1)];
			// 3 reused of 9 — under the half-of-rows bar.
			assert.strictEqual(diffRowsAgainstLedger(next, ledger, { minReused: 2 }), undefined);
		});

		test('graph-wide flags/reachability changes (branch create) splice with a patch', () => {
			const prior = rows(10).map((r, i) =>
				row(r.sha, { contexts: { flags: flagsOf(1), reachabilityIndex: i % 3 } }),
			);
			const ledger = buildRowsLedger(prior);
			// A new branch flips reachability for EVERY ancestor and unique-to-branch flags for many.
			const next = [
				row('new0', { contexts: { flags: flagsOf(1), reachabilityIndex: 9 } }),
				...prior.map((r, i) => row(r.sha, { contexts: { flags: flagsOf(3), reachabilityIndex: (i % 3) + 5 } })),
			];
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice, 'expected the splice to fire despite graph-wide flags/reach changes');
			assert.strictEqual(splice.reusedCount, 10);
			assert.ok(splice.patch, 'expected a patch');
			assert.deepStrictEqual(splice.patch.flags, new Array<number>(10).fill(3));
			assert.deepStrictEqual(
				splice.patch.reachability,
				Array.from({ length: 10 }, (_, i) => (i % 3) + 5),
			);
		});

		test('unchanged flags/reach ship no patch; partial changes patch sparsely', () => {
			const prior = rows(6).map(r => row(r.sha, { contexts: { flags: flagsOf(1), reachabilityIndex: 2 } }));
			const ledger = buildRowsLedger(prior);

			const same = [
				row('n0'),
				...prior.map(r => row(r.sha, { contexts: { flags: flagsOf(1), reachabilityIndex: 2 } })),
			];
			assert.strictEqual(diffRowsAgainstLedger(same, ledger, opts)!.patch, undefined);

			const partial = [
				row('n0'),
				...prior.map((r, i) =>
					row(r.sha, { contexts: { flags: flagsOf(i === 2 ? 5 : 1), reachabilityIndex: 2 } }),
				),
			];
			const splice = diffRowsAgainstLedger(partial, ledger, opts)!;
			assert.ok(splice.patch);
			assert.deepStrictEqual(splice.patch.flags, [null, null, 5, null, null, null]);
			assert.deepStrictEqual(splice.patch.reachability, [null, null, null, null, null, null]);
		});

		test('changed-to-absent encodes as -1', () => {
			const prior = rows(4).map(r => row(r.sha, { contexts: { flags: flagsOf(1), reachabilityIndex: 2 } }));
			const ledger = buildRowsLedger(prior);
			const next = [row('n0'), ...prior.map(r => row(r.sha, { contexts: { flags: flagsOf(1) } }))];
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice.patch);
			assert.deepStrictEqual(splice.patch.reachability, [-1, -1, -1, -1]);
			assert.deepStrictEqual(splice.patch.flags, [null, null, null, null]);
		});

		test('patch application onto prior rows reproduces the fresh rows exactly', () => {
			const prior = rows(8).map((r, i) => row(r.sha, { contexts: { flags: flagsOf(1), reachabilityIndex: i } }));
			const ledger = buildRowsLedger(prior);
			const next = [
				row('n0', { contexts: { flags: flagsOf(1), reachabilityIndex: 8 } }),
				...prior.map((r, i) => row(r.sha, { contexts: { flags: flagsOf(3), reachabilityIndex: i + 1 } })),
			];
			const splice = diffRowsAgainstLedger(next, ledger, opts)!;
			assert.ok(splice.patch);

			// Mirror the webview reducer: slice the span, apply the patch in place, reassemble.
			const span = prior.slice(splice.reusedStart, splice.reusedStart + splice.reusedCount);
			for (let i = 0; i < span.length; i++) {
				const f = splice.patch.flags[i];
				const r = splice.patch.reachability[i];
				if (f == null && r == null) continue;

				const contexts = (span[i].contexts ??= {});
				if (f != null) {
					contexts.flags = f === -1 ? undefined : f;
				}
				if (r != null) {
					contexts.reachabilityIndex = r === -1 ? undefined : r;
				}
			}
			const rebuilt = [...splice.head, ...span, ...(splice.tail ?? [])];
			assert.deepStrictEqual(rebuilt, next);
		});
	});

	suite('appendRowsLedger', () => {
		test('appends a page after the cursor, mirroring the reducer trim', () => {
			const ledger = buildRowsLedger(rows(5));
			const appended = appendRowsLedger(ledger, 'sha4', rows(3, 'page'));
			assert.deepStrictEqual(appended.shas, ['sha0', 'sha1', 'sha2', 'sha3', 'sha4', 'page0', 'page1', 'page2']);
		});

		test('trims rows below the cursor before appending', () => {
			const ledger = buildRowsLedger(rows(5));
			const appended = appendRowsLedger(ledger, 'sha2', rows(1, 'page'));
			assert.deepStrictEqual(appended.shas, ['sha0', 'sha1', 'sha2', 'page0']);
		});

		test('missing cursor appends after everything (reducer fallthrough)', () => {
			const ledger = buildRowsLedger(rows(2));
			const appended = appendRowsLedger(ledger, 'nope', rows(1, 'page'));
			assert.deepStrictEqual(appended.shas, ['sha0', 'sha1', 'page0']);
		});
	});
});
