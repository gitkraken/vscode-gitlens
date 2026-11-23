import * as assert from 'assert';
import { wipRowBranchTitle, wipRowState } from '../wip.js';

suite('wipRowBranchTitle', () => {
	const sha = '0123456789abcdef0123456789abcdef01234567';

	test('is the branch name for a worktree on a branch', () => {
		assert.strictEqual(
			wipRowBranchTitle({ isPrimary: false, branchName: 'feature/x', worktreeName: 'wt', tipSha: sha }, 7),
			'feature/x',
		);
	});

	test('is the folder name plus the short tip sha for a detached worktree', () => {
		assert.strictEqual(
			wipRowBranchTitle(
				{ isPrimary: false, detached: true, branchName: '(0123456...)', worktreeName: 'wt', tipSha: sha },
				7,
			),
			'wt (0123456)',
		);
	});

	test('falls back to whatever identity a detached row carries', () => {
		assert.strictEqual(
			wipRowBranchTitle({ isPrimary: true, detached: true, branchName: '(0123456...)', tipSha: sha }, 7),
			'(0123456...)',
		);
		assert.strictEqual(wipRowBranchTitle({ isPrimary: false, detached: true, worktreeName: 'wt' }, 7), 'wt');
		assert.strictEqual(wipRowBranchTitle({ isPrimary: true, detached: true, tipSha: sha }, 10), '0123456789');
	});

	test('is undefined with no identity, so the row keeps its label', () => {
		assert.strictEqual(wipRowBranchTitle(undefined, 7), undefined);
		assert.strictEqual(wipRowBranchTitle({ isPrimary: true }, 7), undefined);
		assert.strictEqual(wipRowBranchTitle({ isPrimary: true, detached: true, branchName: '' }, 7), undefined);
	});
});

suite('wipRowState', () => {
	test('is clean only for a measured-clean row the clean check is drawn for', () => {
		assert.strictEqual(wipRowState('clean', undefined, undefined), 'clean');
		assert.strictEqual(wipRowState('clean', undefined, false), 'clean');
	});

	test('is undefined while unmeasured, so the row carries no state', () => {
		assert.strictEqual(wipRowState(undefined, undefined, undefined), undefined);
	});

	test('is dirty for measured changes, stale or not', () => {
		assert.strictEqual(wipRowState('dirty', undefined, undefined), 'dirty');
		assert.strictEqual(wipRowState('dirty-stale', undefined, undefined), 'dirty');
	});

	test('is dirty when a paused operation or conflicts replace the clean check, measured or not', () => {
		assert.strictEqual(wipRowState('clean', { type: 'rebase' }, undefined), 'dirty');
		assert.strictEqual(wipRowState('clean', undefined, true), 'dirty');
		assert.strictEqual(wipRowState(undefined, undefined, true), 'dirty');
	});
});
