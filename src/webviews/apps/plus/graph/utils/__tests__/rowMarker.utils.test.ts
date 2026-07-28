import * as assert from 'assert';
import { createWipRowId } from '../../../../../plus/graph/protocol.js';
import type { RowMarkerTips } from '../rowMarker.utils.js';
import {
	combineRowMarkerRoles,
	isPrimaryWipRow,
	primaryRowMarkerRole,
	rowMarkerRolesAriaLabel,
	rowMarkerRolesFor,
	rowMarkerRoleSpecs,
	rowMarkerRolesTooltip,
	scopeAnchorRoles,
	shortRefName,
} from '../rowMarker.utils.js';

const flagFor = (role: string): number => rowMarkerRoleSpecs.find(s => s.role === role)!.flag;

const tips: RowMarkerTips = { headSha: 'aaa', upstreamSha: 'bbb', targetSha: 'ccc', targetName: 'main' };

suite('rowMarkerRolesFor', () => {
	test('no tips → 0', () => {
		assert.strictEqual(rowMarkerRolesFor('aaa', undefined), 0);
	});

	test('non-tip sha → 0', () => {
		assert.strictEqual(rowMarkerRolesFor('zzz', tips), 0);
	});

	test('single roles resolve to their own flag', () => {
		const [head, upstream, target] = rowMarkerRoleSpecs;
		assert.strictEqual(rowMarkerRolesFor('aaa', tips), head.flag);
		assert.strictEqual(rowMarkerRolesFor('bbb', tips), upstream.flag);
		assert.strictEqual(rowMarkerRolesFor('ccc', tips), target.flag);
	});

	test('shared sha (HEAD in sync with upstream) → combined mask', () => {
		const inSync: RowMarkerTips = { headSha: 'aaa', upstreamSha: 'aaa' };
		const roles = rowMarkerRolesFor('aaa', inSync);
		const [head, upstream] = rowMarkerRoleSpecs;
		assert.strictEqual(roles, head.flag | upstream.flag);
	});
});

suite('scopeAnchorRoles', () => {
	test('not an anchor → 0', () => {
		assert.strictEqual(scopeAnchorRoles(false, 'target', false), 0);
		assert.strictEqual(scopeAnchorRoles(undefined, 'target', false), 0);
	});

	test('focal / fork map to their own roles', () => {
		assert.strictEqual(scopeAnchorRoles(true, 'focal', false), flagFor('focal'));
		assert.strictEqual(scopeAnchorRoles(true, 'fork', false), flagFor('base'));
	});

	test('scope target reuses the ROW-MARKER target flag (same commit, same color)', () => {
		assert.strictEqual(scopeAnchorRoles(true, 'target', false), flagFor('target'));
	});

	test('target that is also the fork point → target + base', () => {
		assert.strictEqual(scopeAnchorRoles(true, 'target', true), flagFor('target') | flagFor('base'));
	});

	test('anchor with no resolved kind → 0 (union guarantees this is unreachable)', () => {
		assert.strictEqual(scopeAnchorRoles(true, undefined, false), 0);
	});
});

suite('combineRowMarkerRoles', () => {
	test('unrelated roles union', () => {
		assert.strictEqual(
			combineRowMarkerRoles(flagFor('upstream'), flagFor('base')),
			flagFor('upstream') | flagFor('base'),
		);
	});

	test('scope target folds into the row-marker target — one segment, not two', () => {
		assert.strictEqual(combineRowMarkerRoles(flagFor('target'), flagFor('target')), flagFor('target'));
	});

	test('focal is suppressed by HEAD (scoping to the current branch marks the same row)', () => {
		assert.strictEqual(combineRowMarkerRoles(flagFor('head'), flagFor('focal')), flagFor('head'));
	});

	test('focal survives when the row is NOT HEAD (scoped to another branch)', () => {
		assert.strictEqual(combineRowMarkerRoles(0, flagFor('focal')), flagFor('focal'));
		assert.strictEqual(
			combineRowMarkerRoles(flagFor('upstream'), flagFor('focal')),
			flagFor('upstream') | flagFor('focal'),
		);
	});
});

suite('rowMarkerRolesTooltip', () => {
	test('no roles → empty', () => {
		assert.strictEqual(rowMarkerRolesTooltip(0), '');
	});

	test('spells the role out (vs the pill’s terse label)', () => {
		assert.strictEqual(rowMarkerRolesTooltip(flagFor('base')), 'Fork Point (Base)');
		assert.strictEqual(rowMarkerRolesTooltip(flagFor('focal')), 'Focus Branch Tip');
	});

	test('names the merge target when known', () => {
		assert.strictEqual(rowMarkerRolesTooltip(flagFor('target'), 'main'), 'Merge Target (main)');
		assert.strictEqual(rowMarkerRolesTooltip(flagFor('target')), 'Merge Target');
	});

	test('merge-target name is shortened from a ref id', () => {
		assert.strictEqual(
			rowMarkerRolesTooltip(flagFor('target'), 'refs/remotes/origin/main'),
			'Merge Target (origin/main)',
		);
	});

	test('combined roles join in spec order', () => {
		assert.strictEqual(
			rowMarkerRolesTooltip(flagFor('target') | flagFor('base'), 'main'),
			'Merge Target (main) & Fork Point (Base)',
		);
	});
});

suite('primaryRowMarkerRole', () => {
	test('HEAD wins a combined mask (spec order)', () => {
		const [head, upstream, target] = rowMarkerRoleSpecs;
		assert.strictEqual(primaryRowMarkerRole(head.flag | upstream.flag | target.flag), 'head');
		assert.strictEqual(primaryRowMarkerRole(upstream.flag | target.flag), 'upstream');
		assert.strictEqual(primaryRowMarkerRole(target.flag), 'target');
	});

	test('empty mask → undefined', () => {
		assert.strictEqual(primaryRowMarkerRole(0), undefined);
	});
});

suite('rowMarkerRolesAriaLabel', () => {
	test('joins the played roles in spec order', () => {
		const [head, upstream, target] = rowMarkerRoleSpecs;
		assert.strictEqual(rowMarkerRolesAriaLabel(head.flag | upstream.flag), 'HEAD, Upstream');
		assert.strictEqual(rowMarkerRolesAriaLabel(target.flag), 'Target');
		assert.strictEqual(rowMarkerRolesAriaLabel(0), '');
	});
});

suite('shortRefName', () => {
	test('strips a branch-id repoPath prefix', () => {
		assert.strictEqual(shortRefName('/repo|heads/feature/x'), 'feature/x');
	});

	test('strips ref-namespace prefixes', () => {
		assert.strictEqual(shortRefName('refs/heads/main'), 'main');
		assert.strictEqual(shortRefName('remotes/origin/main'), 'origin/main');
		assert.strictEqual(shortRefName('/repo|refs/tags/v1.0'), 'v1.0');
	});

	test('bare names pass through', () => {
		assert.strictEqual(shortRefName('origin/main'), 'origin/main');
		assert.strictEqual(shortRefName('main'), 'main');
	});
});

suite('isPrimaryWipRow', () => {
	test("the selected repo's workdir row → true", () => {
		assert.strictEqual(isPrimaryWipRow('workdir', createWipRowId('/repo'), '/repo'), true);
	});

	test('a peer worktree WIP row → false', () => {
		assert.strictEqual(isPrimaryWipRow('workdir', createWipRowId('/repo.worktrees/a'), '/repo'), false);
	});

	test('non-workdir rows → false', () => {
		assert.strictEqual(isPrimaryWipRow('commit', 'aaa', '/repo'), false);
	});

	test('unresolved selected repo path → false', () => {
		assert.strictEqual(isPrimaryWipRow('workdir', createWipRowId('/repo'), undefined), false);
	});
});
