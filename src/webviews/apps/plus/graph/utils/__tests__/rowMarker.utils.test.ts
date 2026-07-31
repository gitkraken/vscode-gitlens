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
		assert.strictEqual(rowMarkerRolesFor('aaa', tips), flagFor('head'));
		assert.strictEqual(rowMarkerRolesFor('bbb', tips), flagFor('upstream'));
		assert.strictEqual(rowMarkerRolesFor('ccc', tips), flagFor('target'));
	});

	test('shared sha (HEAD in sync with upstream) → combined mask', () => {
		const inSync: RowMarkerTips = { headSha: 'aaa', upstreamSha: 'aaa' };
		const roles = rowMarkerRolesFor('aaa', inSync);
		assert.strictEqual(roles, flagFor('head') | flagFor('upstream'));
	});
});

suite('scopeAnchorRoles', () => {
	test('not an anchor → 0', () => {
		assert.strictEqual(scopeAnchorRoles(false, false, false), 0);
		assert.strictEqual(scopeAnchorRoles(undefined, undefined, undefined), 0);
	});

	test('focal / fork map to their own roles', () => {
		assert.strictEqual(scopeAnchorRoles(true, false, false), flagFor('focal'));
		assert.strictEqual(scopeAnchorRoles(false, true, false), flagFor('base'));
	});

	test('scope target reuses the ROW-MARKER target flag (same commit, same color)', () => {
		assert.strictEqual(scopeAnchorRoles(false, false, true), flagFor('target'));
	});

	test('target that is also the fork point → target + base', () => {
		assert.strictEqual(scopeAnchorRoles(false, true, true), flagFor('target') | flagFor('base'));
	});

	test('the focal tip keeps its base role — a branch level with its target is all three at once', () => {
		// The regression this guards: a single dominant `anchorKind` used to swallow `base` whenever the
		// fork point landed on the focal tip, so the one row that IS the fork point never said so.
		assert.strictEqual(scopeAnchorRoles(true, true, true), flagFor('focal') | flagFor('base') | flagFor('target'));
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
		assert.strictEqual(primaryRowMarkerRole(flagFor('head') | flagFor('upstream') | flagFor('target')), 'head');
		assert.strictEqual(primaryRowMarkerRole(flagFor('upstream') | flagFor('target')), 'upstream');
		assert.strictEqual(primaryRowMarkerRole(flagFor('target')), 'target');
	});

	test('focus leads the merge target', () => {
		assert.strictEqual(primaryRowMarkerRole(flagFor('focal') | flagFor('target')), 'focal');
		assert.strictEqual(primaryRowMarkerRole(flagFor('target') | flagFor('base')), 'target');
	});

	test('empty mask → undefined', () => {
		assert.strictEqual(primaryRowMarkerRole(0), undefined);
	});
});

suite('rowMarkerRolesAriaLabel', () => {
	test('joins the played roles in spec order', () => {
		assert.strictEqual(rowMarkerRolesAriaLabel(flagFor('head') | flagFor('upstream')), 'HEAD, Upstream');
		assert.strictEqual(rowMarkerRolesAriaLabel(flagFor('target')), 'Target');
		assert.strictEqual(rowMarkerRolesAriaLabel(flagFor('focal') | flagFor('target')), 'Focus, Target');
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
