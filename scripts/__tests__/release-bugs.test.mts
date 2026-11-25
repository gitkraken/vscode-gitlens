import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GhIssue, IssueRow, TraceOutcome } from '../issues/release-bugs-core.mts';
import {
	bugTarget,
	containingAll,
	decide,
	earliestTag,
	fixCommitPattern,
	isSameChange,
	kindFromType,
	parseTags,
	reattribute,
	settleTraces,
	shippedIn,
} from '../issues/release-bugs-core.mts';

const tags = parseTags(
	[
		'v19.1.0 2026-09-01T14:08:46-04:00',
		'v18.0.0 2026-05-27T17:29:54-04:00',
		'v19.0.0 2026-08-12T17:50:45-04:00',
		'v18.0.1 2026-05-28T09:00:00-04:00',
		'v5.0.0 2017-09-12T19:06:15-04:00',
		'v19.2.0-pre 2026-09-20T10:00:00-04:00',
		'',
	].join('\n'),
);

function issue(overrides: Partial<GhIssue> = {}): GhIssue {
	return {
		number: 1,
		title: 'Title',
		html_url: 'https://github.com/gitkraken/vscode-gitlens/issues/1',
		user: { login: 'someone' },
		created_at: '2026-11-01T00:00:00Z',
		state: 'open',
		state_reason: null,
		closed_at: null,
		type: { name: 'Bug' },
		...overrides,
	};
}

function row(overrides: Partial<IssueRow> = {}): IssueRow {
	return {
		number: 1,
		title: 'Title',
		url: 'https://github.com/gitkraken/vscode-gitlens/issues/1',
		author: 'someone',
		isOrg: false,
		createdAt: '2026-11-01T00:00:00Z',
		state: 'closed',
		stateReason: 'completed',
		closedAt: '2026-11-05T00:00:00Z',
		issueType: 'Bug',
		kind: 'bug',
		kindSource: 'type',
		status: 'introduced',
		introducedIn: 'v18.0.0',
		fixedIn: null,
		introducingCommit: '0ebf629cf1',
		fixCommit: '9fe2d8718',
		traces: 2,
		refreshedAt: '2026-11-06T00:00:00Z',
		...overrides,
	};
}

const closed = { state: 'closed', state_reason: 'completed' } as const;

test('parseTags keeps stable tags only, sorted by date ascending', () => {
	assert.deepEqual(
		tags.map(t => t.tag),
		['v5.0.0', 'v18.0.0', 'v18.0.1', 'v19.0.0', 'v19.1.0'],
	);
	assert.deepEqual(tags[2], { tag: 'v18.0.1', date: '2026-05-28T09:00:00-04:00' });
});

test('kindFromType classifies by issue type and author', () => {
	assert.equal(kindFromType('Bug', false), 'bug');
	for (const type of ['Feature', 'Enhancement', 'Debt', 'Task', 'Exploration']) {
		assert.equal(kindFromType(type, false), 'not-bug', type);
	}
	assert.equal(kindFromType(null, false), 'needs-reading');
	assert.equal(kindFromType(null, true), 'unclassified');
});

test('decide treats a missing row as new', () => {
	assert.equal(decide(issue(), undefined), 'new');
});

test('decide keeps introduced, external and needs-review rows settled while the issue is unchanged', () => {
	for (const status of ['introduced', 'external', 'needs-review'] as const) {
		assert.equal(decide(issue(closed), row({ status: status })), 'settled', status);
	}
});

test('decide unsettles an issue that closed, reopened or was re-typed', () => {
	assert.equal(
		decide(issue(closed), row({ status: 'not-yet-fixed', state: 'open', stateReason: null })),
		'unsettled',
	);
	assert.equal(decide(issue({ state_reason: 'reopened' }), row()), 'unsettled');
	assert.equal(decide(issue(), row()), 'unsettled');
	assert.equal(decide(issue({ ...closed, type: { name: 'Feature' } }), row()), 'unsettled');
	assert.equal(decide(issue({ ...closed, type: null }), row()), 'unsettled');
	assert.equal(decide(issue({ ...closed, type: null }), row({ issueType: null })), 'settled');
});

test('decide unsettles a bug row that was never traced, but not an excluded one', () => {
	assert.equal(decide(issue(closed), row({ status: null })), 'unsettled');
	assert.equal(decide(issue({ ...closed, type: null }), row({ issueType: null, status: null })), 'unsettled');
	const duplicate = { state: 'closed', state_reason: 'duplicate' } as const;
	assert.equal(decide(issue(duplicate), row({ stateReason: 'duplicate', status: null })), 'settled');
	const notPlanned = { state: 'closed', state_reason: 'not_planned' } as const;
	assert.equal(decide(issue(notPlanned), row({ stateReason: 'not_planned', status: null })), 'settled');
	assert.equal(
		decide(
			issue({ ...closed, type: { name: 'Feature' } }),
			row({ issueType: 'Feature', kind: 'not-bug', status: null }),
		),
		'settled',
	);
});

test('decide never settles an unclassified community issue', () => {
	const untyped = issue({ ...closed, type: null });
	assert.equal(decide(untyped, row({ issueType: null, kind: 'unclassified', status: null })), 'unsettled');
	assert.equal(decide(untyped, row({ issueType: null, kind: 'unclassified', status: null, isOrg: true })), 'settled');
});

test('fixCommitPattern matches fixing keywords followed by the issue number', () => {
	const pattern = new RegExp(fixCommitPattern(6121), 'i');
	for (const message of [
		'fixes #6121',
		'Fixes #6121.',
		'closes #6121)',
		'Resolved #6121',
		'fix #6121',
		'Fixed #6121',
	]) {
		assert.ok(pattern.test(message), message);
	}
});

test('fixCommitPattern rejects longer numbers and non-fixing references', () => {
	const pattern = new RegExp(fixCommitPattern(6121), 'i');
	for (const message of ['fixes #61210', 'refs #6121', 'see #6121', 'fixes #612']) {
		assert.ok(!pattern.test(message), message);
	}
});

test('earliestTag picks the earliest stable tag by date across patch and minor tags', () => {
	assert.equal(earliestTag(['v19.1.0', 'v18.0.1', 'v19.0.0'], tags), 'v18.0.1');
	assert.equal(earliestTag(['v19.1.0', 'v18.0.1', 'v18.0.0'], tags), 'v18.0.0');
	assert.equal(earliestTag(['v19.1.0'], tags), 'v19.1.0');
});

test('earliestTag returns null when no stable tag contains the commit', () => {
	assert.equal(earliestTag([], tags), null);
	assert.equal(earliestTag(['v19.2.0-pre', 'not-a-tag'], tags), null);
});

test('bugTarget excludes non-bugs, duplicates and not-planned closures', () => {
	assert.equal(bugTarget(issue(closed), 'not-bug'), 'excluded');
	assert.equal(bugTarget(issue(closed), 'unclassified'), 'excluded');
	assert.equal(bugTarget(issue({ state: 'closed', state_reason: 'duplicate' }), 'bug'), 'excluded');
	assert.equal(bugTarget(issue({ state: 'closed', state_reason: 'not_planned' }), 'bug'), 'excluded');
});

test('bugTarget routes open bugs to open and completed bugs to closed-fixed', () => {
	assert.equal(bugTarget(issue(), 'bug'), 'open');
	assert.equal(bugTarget(issue(closed), 'bug'), 'closed-fixed');
});

test('isSameChange matches by patch-id or a shared non-CHANGELOG file', () => {
	const fix = { patchId: 'p1', files: ['CHANGELOG.md', 'src/a.ts'] };
	assert.ok(isSameChange(fix, { patchId: 'p1', files: ['src/b.ts'] }));
	assert.ok(isSameChange(fix, { patchId: 'p2', files: ['CHANGELOG.md', 'src/a.ts', 'src/c.ts'] }));
	assert.ok(!isSameChange(fix, { patchId: 'p2', files: ['CHANGELOG.md'] }));
	assert.ok(!isSameChange({ patchId: 'p3', files: ['CHANGELOG.md'] }, { patchId: 'p4', files: ['CHANGELOG.md'] }));
	assert.ok(!isSameChange({ patchId: undefined, files: [] }, { patchId: undefined, files: [] }));
});

function trace(overrides: Partial<TraceOutcome> = {}): TraceOutcome {
	return {
		classification: 'introduced',
		confidence: 'high',
		commit: 'aaaa',
		introducedIn: 'v18.0.0',
		shipped: 'v18.0.0',
		...overrides,
	};
}

test('containingAll keeps only tags that contain every fix commit', () => {
	assert.deepEqual(containingAll([['v19.0.0', 'v19.1.0'], ['v19.1.0']]), ['v19.1.0']);
	assert.deepEqual(containingAll([['v19.0.0'], []]), []);
	assert.deepEqual(containingAll([]), []);
});

test('shippedIn is the earliest tag with the defect when no tag has the fix', () => {
	assert.equal(shippedIn(['v19.1.0', 'v18.0.1', 'v19.0.0'], [], tags), 'v18.0.1');
	assert.equal(shippedIn([], [], tags), null);
});

test('shippedIn is null when the fix is in every tag with the defect', () => {
	assert.equal(shippedIn(['v19.0.0', 'v19.1.0'], ['v19.0.0', 'v19.1.0'], tags), null);
});

test('shippedIn keeps the introducing tag when the fix is cherry-picked to a later patch', () => {
	assert.equal(shippedIn(['v18.0.0', 'v18.0.1', 'v19.0.0', 'v19.1.0'], ['v18.0.1', 'v19.1.0'], tags), 'v18.0.0');
});

test('shippedIn picks an older patch line that got the defect without its fix', () => {
	assert.equal(shippedIn(['v18.0.1', 'v19.1.0'], ['v19.1.0'], tags), 'v18.0.1');
});

test('shippedIn counts a tag as fixed only when it has every fix commit', () => {
	const fixed = containingAll([['v19.0.0', 'v19.1.0'], ['v19.1.0']]);
	assert.equal(shippedIn(['v19.0.0', 'v19.1.0'], fixed, tags), 'v19.0.0');
});

test('reattribute leaves a provisional never-shipped row alone while nothing is tagged', () => {
	assert.equal(reattribute(row({ status: 'never-shipped', introducedIn: null }), [], [], tags), undefined);
});

test('reattribute promotes never-shipped to introduced when the fix lands in a later tag', () => {
	const updated = reattribute(
		row({ status: 'never-shipped', introducedIn: null }),
		['v19.0.0', 'v19.1.0'],
		['v19.1.0'],
		tags,
	);
	assert.equal(updated?.status, 'introduced');
	assert.equal(updated?.introducedIn, 'v19.0.0');
	assert.equal(updated?.fixedIn, 'v19.1.0');
});

test('reattribute keeps never-shipped and records fixedIn when intro and fix share a tag', () => {
	const updated = reattribute(row({ status: 'never-shipped', introducedIn: null }), ['v19.1.0'], ['v19.1.0'], tags);
	assert.equal(updated?.status, 'never-shipped');
	assert.equal(updated?.introducedIn, null);
	assert.equal(updated?.fixedIn, 'v19.1.0');
});

test('reattribute promotes to introduced when tagged and the fix is not yet in a stable tag', () => {
	const updated = reattribute(row({ status: 'never-shipped', introducedIn: null }), ['v19.1.0'], [], tags);
	assert.equal(updated?.status, 'introduced');
	assert.equal(updated?.introducedIn, 'v19.1.0');
	assert.equal(updated?.fixedIn, null);
});

test('settleTraces settles two agreeing introduced traces', () => {
	assert.deepEqual(settleTraces([trace(), trace({ commit: 'bbbb', confidence: 'medium' })]), {
		outcome: 'settled',
		status: 'introduced',
		introducedIn: 'v18.0.0',
		introducingCommit: 'aaaa',
	});
});

test('settleTraces settles agreeing introduced traces that never shipped as never-shipped', () => {
	assert.deepEqual(settleTraces([trace({ shipped: null }), trace({ shipped: null })]), {
		outcome: 'settled',
		status: 'never-shipped',
		introducedIn: null,
		introducingCommit: 'aaaa',
	});
});

test('settleTraces settles agreeing external and not-a-gitlens-bug traces without a release', () => {
	for (const classification of ['external', 'not-a-gitlens-bug'] as const) {
		const none = { classification: classification, commit: null, introducedIn: null, shipped: null };
		assert.deepEqual(settleTraces([trace(none), trace(none)]), {
			outcome: 'settled',
			status: classification,
			introducedIn: null,
			introducingCommit: null,
		});
	}
});

test('settleTraces asks for a tie-break when two traces disagree', () => {
	assert.deepEqual(settleTraces([trace(), trace({ shipped: 'v19.0.0', introducedIn: 'v19.0.0' })]), {
		outcome: 'tie-break',
	});
	assert.deepEqual(settleTraces([trace(), trace({ introducedIn: 'v5.0.0' })]), { outcome: 'tie-break' });
	assert.deepEqual(
		settleTraces([trace(), trace({ classification: 'external', commit: null, introducedIn: null, shipped: null })]),
		{ outcome: 'tie-break' },
	);
});

test('settleTraces settles a 2-of-3 majority and sends a three-way split to review', () => {
	const other = trace({ commit: 'cccc', introducedIn: 'v19.0.0', shipped: 'v19.0.0' });
	assert.deepEqual(settleTraces([trace(), other, trace({ commit: 'bbbb' })]), {
		outcome: 'settled',
		status: 'introduced',
		introducedIn: 'v18.0.0',
		introducingCommit: 'aaaa',
	});
	const external = trace({ classification: 'external', commit: null, introducedIn: null, shipped: null });
	assert.deepEqual(settleTraces([trace(), other, external]), { outcome: 'needs-review' });
});

test('settleTraces sends a low-confidence winning side to review, but not a low-confidence loser', () => {
	assert.deepEqual(settleTraces([trace(), trace({ confidence: 'low' })]), { outcome: 'needs-review' });
	const loser = trace({ confidence: 'low', introducedIn: 'v19.0.0', shipped: 'v19.0.0' });
	assert.equal(settleTraces([trace(), loser, trace()]).outcome, 'settled');
});

test('settleTraces sends introduced traces without a resolvable commit to review', () => {
	const unresolved = trace({ commit: null, introducedIn: null, shipped: null });
	assert.deepEqual(settleTraces([unresolved, unresolved]), { outcome: 'needs-review' });
});

test('settleTraces rejects fewer than 2 or more than 3 traces', () => {
	assert.throws(() => settleTraces([trace()]));
	assert.throws(() => settleTraces([trace(), trace(), trace(), trace()]));
});
