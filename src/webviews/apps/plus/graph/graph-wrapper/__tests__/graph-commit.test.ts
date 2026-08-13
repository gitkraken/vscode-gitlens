import * as assert from 'assert';
import type { ZoneSpec } from '@gitkraken/commit-graph/view.js';
import type { GitGraphRow } from '@gitlens/git/models/graph.js';
import type {
	GraphColumnSetting,
	GraphColumnsSettings,
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
} from '../../../../../plus/graph/protocol.js';
import type { GraphCommitRef } from '../graph-commit.js';
import { columnsToZones, isRefHidden, toGraphCommit, zonesToColumnsConfig } from '../graph-commit.js';

// A persisted-columns fixture with only the `changes` key — columnsToZones ignores keys with no matching
// default zone. Cast because GraphColumnsSettings is a full Record over every column name.
function changesColumns(setting: GraphColumnSetting): GraphColumnsSettings {
	// A single-key literal can't satisfy the full Record type, so widen via an intermediate.
	const columns = { changes: setting };
	return columns as GraphColumnsSettings;
}

suite('graph-commit — columns ↔ zones mode round-trip', () => {
	test('columnsToZones carries the persisted changes.mode', () => {
		const zones = columnsToZones(changesColumns({ width: 200, isHidden: false, order: 3, mode: 'squares' }));
		assert.strictEqual(zones?.find(z => z.id === 'changes')?.mode, 'squares');
	});

	test('columnsToZones falls back to the default mode when none is persisted', () => {
		const zones = columnsToZones(changesColumns({ width: 200, isHidden: false, order: 3 }));
		assert.strictEqual(zones?.find(z => z.id === 'changes')?.mode, 'bar');
	});

	test('zonesToColumnsConfig writes the zone mode back', () => {
		const zones: ZoneSpec[] = [{ id: 'changes', label: 'Changes', width: 200, minWidth: 50, mode: 'bipolar' }];
		assert.strictEqual(zonesToColumnsConfig(zones).changes?.mode, 'bipolar');
	});

	test('a full round-trip preserves a non-default mode', () => {
		const zones = columnsToZones(changesColumns({ width: 200, isHidden: false, order: 3, mode: 'numbers' }));
		assert.notStrictEqual(zones, undefined);
		assert.strictEqual(zonesToColumnsConfig(zones!).changes?.mode, 'numbers');
	});
});

// Serialized refGROUP context the host ships on `contexts.refGroups[name]` for a grouped ref.
function refGroupContext(webviewItemGroup: string): string {
	return JSON.stringify({
		webviewItemGroup: webviewItemGroup,
		webviewItemGroupValue: { type: 'refGroup', refs: [] },
	});
}

function commitRow(overrides: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: 'abc1234',
		parents: ['def5678'],
		author: 'Author',
		email: 'author@example.com',
		date: 0,
		message: 'a commit',
		kind: 'commit',
		...overrides,
	};
}

// These pin the grouped-pill MERGE, which regressed once before: a grouped pill must expose BOTH the
// branch actions and the refGroup's "Hide" (`gitlens.graph.hideRefGroup`). They now run against the real
// webview-built context rather
// than a stand-in for the host's string, so they also cover the build itself.
suite('graph-commit — branch pill context (grouped ref parity)', () => {
	test('a grouped branch pill MERGES the branch and refGroup contexts', () => {
		// A current branch in sync with its upstream on the same commit ⇒ the host groups local + remote.
		const row = commitRow({
			heads: [
				{
					name: 'main',
					id: 'repo|heads/main',
					isCurrentHead: true,
					upstream: { name: 'origin/main', id: 'repo|remotes/origin/main' },
				},
			],
			contexts: { refGroups: { main: refGroupContext('gitlens:refGroup+current') } },
		});

		const ref = toGraphCommit(row, 7, '/repo').commitRefs.find(r => r.kind === 'head' && r.name === 'main');
		assert.ok(ref?.context != null, 'the head ref should carry a pill context');

		// The pill exposes BOTH the branch `when` keys and the refGroup keys — restoring branch actions
		// (e.g. "Rebase Current Branch onto Upstream…") alongside the refGroup "Hide".
		const ctx = JSON.parse(ref.context);
		assert.ok(ctx.webviewItem.startsWith('gitlens:branch'), 'merged context keeps webviewItem');
		assert.strictEqual(ctx.webviewItemGroup, 'gitlens:refGroup+current', 'merged context keeps webviewItemGroup');
		assert.strictEqual(ctx.webviewItemValue?.type, 'branch');
		assert.strictEqual(ctx.webviewItemGroupValue?.type, 'refGroup');

		// refContext stays the PURE individual (the branch sheet reads it) — no refGroup keys.
		const refCtx = JSON.parse(ref.refContext!);
		assert.ok(refCtx.webviewItem.startsWith('gitlens:branch'));
		assert.strictEqual(refCtx.webviewItemGroup, undefined, 'refContext must not carry refGroup keys');
	});

	test('an ungrouped branch pill context is the individual context (no refGroup keys)', () => {
		const row = commitRow({
			heads: [
				{
					name: 'feature',
					id: 'repo|heads/feature',
					isCurrentHead: false,
					upstream: { name: 'origin/feature', id: 'repo|remotes/origin/feature' },
				},
			],
		});

		const ref = toGraphCommit(row, 7, '/repo').commitRefs.find(r => r.kind === 'head' && r.name === 'feature');
		const ctx = JSON.parse(ref!.context!);
		assert.ok(ctx.webviewItem.startsWith('gitlens:branch'));
		assert.strictEqual(ctx.webviewItemGroup, undefined, 'an ungrouped pill has no refGroup keys');
		// With no group there's nothing to merge, so the pill context IS the individual context.
		assert.strictEqual(ref!.context, ref!.refContext);
	});
});

function commitRef(overrides: Partial<GraphCommitRef> & Pick<GraphCommitRef, 'kind' | 'name'>): GraphCommitRef {
	return { id: `${overrides.owner ?? ''}/${overrides.name}:${overrides.kind}`, ...overrides };
}

/** An `excludeRefs` entry hiding `ref` by id. */
function excludeById(ref: GraphCommitRef): GraphExcludeRefs {
	return { [ref.id!]: { id: ref.id!, name: ref.name, type: ref.kind, owner: ref.owner } };
}

function wildcardExclude(owner: string, except?: string[]): GraphExcludeRefs {
	return {
		[`wildcard:${owner}`]: { id: `wildcard:${owner}`, name: '*', type: 'remote', owner: owner, except: except },
	};
}

suite('isRefHidden', () => {
	test('the current head is never hidden', () => {
		const ref = commitRef({ kind: 'head', name: 'main', current: true });

		assert.strictEqual(isRefHidden(ref, { heads: true }, excludeById(ref)), false);
	});

	test('a plain id entry hides only that ref', () => {
		const hidden = commitRef({ kind: 'remote', name: 'main', owner: 'origin' });
		const sibling = commitRef({ kind: 'remote', name: 'dev', owner: 'origin' });
		const excludeRefs = excludeById(hidden);

		assert.strictEqual(isRefHidden(hidden, undefined, excludeRefs), true);
		assert.strictEqual(isRefHidden(sibling, undefined, excludeRefs), false);
	});

	test('a whole-remote wildcard hides a sibling remote ref of the same owner (different id)', () => {
		const ref = commitRef({ kind: 'remote', name: 'dev', owner: 'origin' });

		assert.strictEqual(isRefHidden(ref, undefined, wildcardExclude('origin')), true);
	});

	test('a whole-remote wildcard leaves a different owner unaffected', () => {
		const ref = commitRef({ kind: 'remote', name: 'dev', owner: 'upstream' });

		assert.strictEqual(isRefHidden(ref, undefined, wildcardExclude('origin')), false);
	});

	test('a whole-remote wildcard hides a tracked upstream, unlike the type-level toggle', () => {
		const ref = commitRef({ kind: 'remote', name: 'main', owner: 'origin' });
		const downstreams: GraphDownstreams = { 'origin/main': ['feature'] };
		const excludeTypes: GraphExcludeTypes = { remotes: true };

		// The type toggle alone excepts a tracked upstream…
		assert.strictEqual(isRefHidden(ref, excludeTypes, undefined, downstreams), false);
		// …but the wildcard hides it regardless.
		assert.strictEqual(isRefHidden(ref, excludeTypes, wildcardExclude('origin'), downstreams), true);
	});

	test('a wildcard exception un-hides just that branch', () => {
		const excepted = commitRef({ kind: 'remote', name: 'dev', owner: 'origin', id: 'origin/dev:remote' });

		assert.strictEqual(isRefHidden(excepted, undefined, wildcardExclude('origin', ['origin/dev:remote'])), false);
	});

	test('a wildcard exception leaves a non-excepted sibling hidden', () => {
		const excepted = commitRef({ kind: 'remote', name: 'dev', owner: 'origin', id: 'origin/dev:remote' });
		const sibling = commitRef({ kind: 'remote', name: 'main', owner: 'origin', id: 'origin/main:remote' });
		const excludeRefs = wildcardExclude('origin', ['origin/dev:remote']);

		assert.strictEqual(isRefHidden(excepted, undefined, excludeRefs), false);
		assert.strictEqual(isRefHidden(sibling, undefined, excludeRefs), true);
	});

	test('a ref with no id under a wildcard stays hidden regardless of exceptions', () => {
		const ref = commitRef({ kind: 'remote', name: 'dev', owner: 'origin', id: undefined });

		assert.strictEqual(isRefHidden(ref, undefined, wildcardExclude('origin', ['some-other-id'])), true);
	});
});

// `kind` is the producer's label carried through untouched — what the commit IS. It is deliberately NOT
// re-derived from the parent count: first-parent mode truncates a merge's parents to one, so counting would
// report every merge as an ordinary commit. The topological question lives with the engine, which counts
// `parents` directly (see `layout.ts`); these two must not be conflated back together.
suite('graph-commit — kind carries the producer label, not a parent count', () => {
	function row(overrides: Partial<GitGraphRow>): GitGraphRow {
		const base: GitGraphRow = {
			sha: 'aaaaaaa',
			parents: ['bbbbbbb'],
			author: 'Ada',
			email: 'ada@example.com',
			date: 1,
			message: 'm',
			kind: 'commit',
		};
		return { ...base, ...overrides };
	}

	test('an ordinary merge is a merge', () => {
		assert.strictEqual(toGraphCommit(row({ kind: 'merge', parents: ['b', 'c'] })).kind, 'merge');
	});

	// The regression this pins: re-deriving from `parents.length` here reported every merge as a commit
	// whenever `graph.onlyFollowFirstParent` was on — no merge glyph, no `dimMergeCommits`, and "Commit"
	// instead of "Merge commit" to a screen reader.
	test('a first-parent-truncated merge is still a merge', () => {
		assert.strictEqual(toGraphCommit(row({ kind: 'merge', parents: ['b'] })).kind, 'merge');
	});

	test('every kind is carried through verbatim', () => {
		assert.strictEqual(toGraphCommit(row({ kind: 'commit', parents: ['b'] })).kind, 'commit');
		assert.strictEqual(toGraphCommit(row({ kind: 'stash', parents: ['b'] })).kind, 'stash');
		assert.strictEqual(toGraphCommit(row({ kind: 'workdir', parents: [] })).kind, 'workdir');
	});
});
