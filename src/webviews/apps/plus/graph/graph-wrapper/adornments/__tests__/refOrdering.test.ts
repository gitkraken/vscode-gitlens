import * as assert from 'assert';
import type { GraphCommitRef } from '../../graph-commit.js';
import { isUpstreamRemoteOf, pickGhostRef, sortRowRefs } from '../../graph-commit.js';
import type { ParsedRef } from '../refAdornmentProvider.js';
import { promotePinned, refPillKey } from '../refAdornmentProvider.js';

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
	test('matches the tracked remote by id, never a same-named remote from another owner', () => {
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
