import * as assert from 'assert';
import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { TemplateResult } from 'lit';
import type { GraphCommitRef } from '../../graph-commit.js';
import { isUpstreamRemoteOf, pickGhostRef, sortRowRefs } from '../../graph-commit.js';
import type { ParsedRef } from '../refAdornmentProvider.js';
import { promotePinned, refPillKey } from '../refAdornmentProvider.js';
import type { WipStats } from '../wipStatsAdornmentProvider.js';
import { createWipStatsAdornmentProvider } from '../wipStatsAdornmentProvider.js';

const repo = 'repo';
const headId = (name: string) => `${repo}|heads/${name}`;
const remoteId = (owner: string, name: string) => `${repo}|remotes/${owner}/${name}`;

function head(name: string, extra?: Partial<GraphCommitRef>): GraphCommitRef {
	return { kind: 'head', name: name, id: headId(name), ...extra };
}

/** A local branch tracking `owner/name` — both halves of the link, as the host ships them. */
function trackedHead(name: string, owner: string, upstreamName?: string): GraphCommitRef {
	const remoteName = upstreamName ?? name;
	return head(name, { upstreamName: `${owner}/${remoteName}`, upstreamId: remoteId(owner, remoteName) });
}

function remote(owner: string, name: string, extra?: Partial<GraphCommitRef>): GraphCommitRef {
	return { kind: 'remote', name: name, owner: owner, id: remoteId(owner, name), ...extra };
}

function tag(name: string): GraphCommitRef {
	return { kind: 'tag', name: name, id: `${repo}|tags/${name}` };
}

/** `kind:owner/name` labels for readable assertions. */
function keys(refs: readonly GraphCommitRef[]): string[] {
	return refs.map(r => refPillKey(r));
}

suite('graph ref ordering — sortRowRefs tiers', () => {
	test('orders the full tier ladder regardless of input order', () => {
		// One ref per tier 0-7, fed in deliberately scrambled order. Names are chosen so alphabetical
		// order would NOT reproduce the expected result — only the tiers can.
		const refs = [
			tag('v1'),
			remote('origin', 'zremote'),
			head('zlocal'),
			remote('origin', 'wt'),
			head('main', { isDefault: true }),
			{ ...trackedHead('current', 'origin'), current: true },
			remote('origin', 'current'),
			{ ...trackedHead('wt', 'origin'), worktreeId: 'wt1' },
		];

		assert.deepStrictEqual(keys(sortRowRefs(refs)), [
			'head:current', // 0 — the current checkout
			'remote:origin/current', // 1 — its upstream
			'head:wt', // 2 — checked out in another worktree
			'remote:origin/wt', // 3 — that worktree branch's upstream
			'head:main', // 4 — the default branch
			'head:zlocal', // 5 — a plain local
			'remote:origin/zremote', // 6 — a plain remote
			'tag:v1', // 7 — tags last
		]);
	});

	test('a remote-only default branch outranks a plain local', () => {
		const refs = [head('feature'), remote('origin', 'main', { isDefault: true })];
		assert.deepStrictEqual(keys(sortRowRefs(refs)), ['remote:origin/main', 'head:feature']);
	});

	test('degraded rows (no upstream/worktree/default flags) fall through to local → remote → tag', () => {
		// What the GitHub/virtual provider ships: kind + name only.
		const refs: GraphCommitRef[] = [
			{ kind: 'tag', name: 'v1' },
			{ kind: 'remote', name: 'foo', owner: 'origin' },
			{ kind: 'head', name: 'zzz' },
		];
		assert.deepStrictEqual(keys(sortRowRefs(refs)), ['head:zzz', 'remote:origin/foo', 'tag:v1']);
	});

	test('is a no-op for a single ref', () => {
		const refs = [head('solo')];
		assert.deepStrictEqual(keys(sortRowRefs(refs)), ['head:solo']);
	});
});

suite('graph ref ordering — tie-breaks', () => {
	test('tags collate numerically, so v1.9.0 precedes v1.10.0', () => {
		const refs = [tag('v10.0.0'), tag('v1.10.0'), tag('v2.0.0'), tag('v1.9.0')];
		assert.deepStrictEqual(
			sortRowRefs(refs).map(r => r.name),
			['v1.9.0', 'v1.10.0', 'v2.0.0', 'v10.0.0'],
		);
	});

	test('same-named remotes from different owners tie-break on owner', () => {
		const refs = [remote('upstream', 'foo'), remote('origin', 'foo')];
		assert.deepStrictEqual(keys(sortRowRefs(refs)), ['remote:origin/foo', 'remote:upstream/foo']);
	});

	test('ties break on the bare name, never the rendered label', () => {
		// With `showRemoteNames` on, the labels would be `origin/abc` / `origin/xyz`; the bare names decide,
		// so the order is identical either way (the sort no longer sees the setting at all).
		const refs = [remote('origin', 'xyz'), remote('origin', 'abc')];
		assert.deepStrictEqual(keys(sortRowRefs(refs)), ['remote:origin/abc', 'remote:origin/xyz']);
	});
});

suite('graph ref ordering — upstream pairing', () => {
	test('pairs an UNTRACKED local with its same-named remote on the same commit', () => {
		const local = head('foo');
		const origin = remote('origin', 'foo');
		assert.strictEqual(isUpstreamRemoteOf(origin, local), true);
	});

	test('does not pair an untracked local with a differently-named remote', () => {
		assert.strictEqual(isUpstreamRemoteOf(remote('origin', 'bar'), head('foo')), false);
	});

	test('configured tracking wins — a local tracking upstream/foo is not hijacked by origin/foo', () => {
		const local = trackedHead('foo', 'upstream');
		assert.strictEqual(isUpstreamRemoteOf(remote('upstream', 'foo'), local), true);
		assert.strictEqual(isUpstreamRemoteOf(remote('origin', 'foo'), local), false);
	});

	test('matches by full owner/name when the remote carries no id (legacy rows)', () => {
		const local = { ...head('foo'), upstreamName: 'origin/foo', upstreamId: undefined };
		const legacyRemote: GraphCommitRef = { kind: 'remote', name: 'foo', owner: 'origin' };
		assert.strictEqual(isUpstreamRemoteOf(legacyRemote, local), true);
	});

	test('a head is never the upstream of anything, and a tag never pairs', () => {
		assert.strictEqual(isUpstreamRemoteOf(head('foo'), head('foo')), false);
		assert.strictEqual(isUpstreamRemoteOf(tag('foo'), head('foo')), false);
		assert.strictEqual(isUpstreamRemoteOf(remote('origin', 'foo'), undefined), false);
	});
});

suite('graph ref ordering — promotePinned', () => {
	const parsed: ParsedRef[] = [
		{ kind: 'head', name: 'main', current: true },
		{ kind: 'remote', name: 'main', owner: 'origin' },
		{ kind: 'tag', name: 'v1' },
	];

	test('moves the pinned ref to the front', () => {
		assert.deepStrictEqual(keys(promotePinned(parsed, 'tag:v1')), ['tag:v1', 'head:main', 'remote:origin/main']);
	});

	test('is a no-op when nothing is pinned, the pin is absent, or it is already primary', () => {
		assert.deepStrictEqual(keys(promotePinned(parsed, undefined)), keys(parsed));
		assert.deepStrictEqual(keys(promotePinned(parsed, 'head:nope')), keys(parsed));
		assert.deepStrictEqual(keys(promotePinned(parsed, 'head:main')), keys(parsed));
	});

	test('distinguishes a local from the remote it tracks (both are named `main`)', () => {
		assert.deepStrictEqual(keys(promotePinned(parsed, 'remote:origin/main'))[0], 'remote:origin/main');
	});
});

suite('graph ref ordering — pickGhostRef', () => {
	test('returns the same ref the pill would make primary', () => {
		const refs = [tag('v1'), remote('origin', 'zremote'), head('zlocal'), head('main', { isDefault: true })];
		const ghost = pickGhostRef(refs, undefined, undefined, undefined);
		assert.strictEqual(refPillKey(ghost!), refPillKey(sortRowRefs(refs)[0]));
		assert.strictEqual(ghost!.name, 'main');
	});

	test('skips hidden refs and falls to the next-ranked visible one', () => {
		const refs = [head('feature'), tag('v1')];
		const ghost = pickGhostRef(refs, { heads: true }, undefined, undefined);
		assert.strictEqual(ghost?.name, 'v1');
	});

	test('returns undefined when every ref is hidden', () => {
		const refs = [head('feature'), tag('v1')];
		assert.strictEqual(pickGhostRef(refs, { heads: true, tags: true }, undefined, undefined), undefined);
	});

	test('returns undefined for a row with no refs', () => {
		assert.strictEqual(pickGhostRef([], undefined, undefined, undefined), undefined);
		assert.strictEqual(pickGhostRef(undefined, undefined, undefined, undefined), undefined);
	});
});

// These belong with the wip-stats provider, but live here because the unit harness bundles each test
// file standalone — a second bundle pulling in `code-icon` (via the stats components) double-registers it.
function wipRow(sha: string, kind: ProcessedGraphRow['kind'] = 'workdir'): ProcessedGraphRow {
	return { sha: sha, parents: [], kind: kind, column: 0, edges: {}, edgeColumnMax: 0 };
}

function wipProvider(entries: [string, WipStats][]) {
	return createWipStatsAdornmentProvider({ statsBySha: new Map(entries) });
}

/** Both states render the same `<gl-wip-stats>` element, so they differ in the template's VALUES, not its
 *  static strings. Also pins that the provider resolves SYNCHRONOUSLY — `resolveRowAdornments` discards a
 *  promised result, so an async return would silently render nothing rather than fail. */
function resolvedValues(result: TemplateResult | null | Promise<TemplateResult | null>): unknown[] | null {
	assert.ok(!(result instanceof Promise), 'the wip-stats provider must resolve synchronously');
	return result == null ? null : [...result.values];
}

// The three states, and specifically that the last two are DISTINCT. Collapsing "not measured" and
// "measured clean" into the same empty render is the bug this suite exists for: a clean worktree then looks
// identical to one whose stats never arrived, which is what made the check disappear when the graph moved
// off the legacy renderer.
suite('wipStatsAdornmentProvider — the three WIP states', () => {
	test('a row with no stats yet contributes nothing at all', () => {
		// Not "renders empty" — it must not contribute, so the row isn't marked dynamic and cached wrong.
		assert.strictEqual(wipProvider([]).provideRowAdornment(wipRow('wip::/repo')), undefined);
	});

	test('a non-workdir row never contributes', () => {
		assert.strictEqual(
			wipProvider([['abc', { added: 3 }]]).provideRowAdornment(wipRow('abc', 'commit')),
			undefined,
		);
	});

	test('resolving with no stats renders nothing — loading must never draw a state', () => {
		assert.strictEqual(wipProvider([]).resolveAdornment(wipRow('wip::/repo'), undefined), null);
	});

	// THE regression: this returned null before, so a measured-clean worktree drew nothing at all.
	test('a measured-clean worktree still renders — zeros are a result, not an absence', () => {
		const stats: WipStats = { added: 0, modified: 0, deleted: 0, renamed: 0 };
		const values = resolvedValues(wipProvider([]).resolveAdornment(wipRow('wip::/repo'), stats));
		assert.ok(values != null, 'clean must render the check pill, not nothing');
		assert.ok(
			values.includes(0),
			'the zero counts must be passed through so the component can tell clean from unknown',
		);
	});

	test('a dirty worktree passes its counts through', () => {
		const stats: WipStats = { added: 2, modified: 1, deleted: 3, renamed: 0 };
		const values = resolvedValues(wipProvider([]).resolveAdornment(wipRow('wip::/repo'), stats));
		assert.ok(values != null);
		assert.ok(values.includes(2) && values.includes(1) && values.includes(3), `got ${JSON.stringify(values)}`);
	});

	// A rename is ONE modified file, not an add plus a delete — counting it twice would overstate the
	// magnitude, and `<commit-stats>` has no rename slot to put it in.
	test('renames fold into modified rather than splitting into add + delete', () => {
		const stats: WipStats = { added: 0, modified: 1, deleted: 0, renamed: 2 };
		const values = resolvedValues(wipProvider([]).resolveAdornment(wipRow('wip::/repo'), stats));
		assert.ok(values != null);
		assert.ok(values.includes(3), `modified should be 1 + 2 renames; got ${JSON.stringify(values)}`);
	});

	suite('a11y', () => {
		test('clean is announced rather than silent', () => {
			const said = wipProvider([]).describeForA11y?.(wipRow('wip::/repo'), { added: 0, modified: 0 });
			assert.strictEqual(said, 'no working changes');
		});

		test('absent stats stay silent, so "loading" is not announced as "clean"', () => {
			assert.strictEqual(wipProvider([]).describeForA11y?.(wipRow('wip::/repo'), undefined), null);
		});

		test('dirty lists its counts', () => {
			assert.strictEqual(
				wipProvider([]).describeForA11y?.(wipRow('wip::/repo'), { added: 2, deleted: 1 }),
				'2 added, 1 deleted',
			);
		});
	});
});
