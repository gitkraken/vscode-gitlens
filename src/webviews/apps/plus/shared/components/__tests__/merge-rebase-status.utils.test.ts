import * as assert from 'assert';
import type {
	GitCherryPickStatus,
	GitMergeStatus,
	GitRebaseStatus,
	GitRevertStatus,
} from '@gitlens/git/models/pausedOperationStatus.js';
import {
	getPausedOperationVariant,
	pausedOperationVariantIcons,
} from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import {
	getPausedOperationAbortLabel,
	getPausedOperationBarActionLabel,
	getPausedOperationBarIconTooltip,
	getPausedOperationBarLabel,
	getPausedOperationBarRefsSummary,
	getPausedOperationSkipDetail,
	getPausedOperationSkipLabel,
	getPausedOperationSkipRef,
	getPausedOperationStepTooltipParts,
	isPausedOperationStepped,
} from '../merge-rebase-status.utils.js';

const repoPath = '/repo';
const incomingSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const stepSha = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';

function createMerge(): GitMergeStatus {
	return {
		type: 'merge',
		repoPath: repoPath,
		mergeBase: undefined,
		HEAD: createReference(incomingSha, repoPath, { refType: 'revision' }),
		current: createReference('main', repoPath, { refType: 'branch', name: 'main', remote: false }),
		incoming: createReference('feature', repoPath, { refType: 'branch', name: 'feature', remote: false }),
	};
}

function createRebase(options?: {
	current?: number;
	total?: number;
	message?: string;
	noCommit?: boolean;
}): GitRebaseStatus {
	return {
		type: 'rebase',
		repoPath: repoPath,
		mergeBase: undefined,
		HEAD: createReference(stepSha, repoPath, { refType: 'revision' }),
		onto: createReference(incomingSha, repoPath, { refType: 'revision' }),
		source: createReference(incomingSha, repoPath, { refType: 'revision' }),
		current: createReference('main', repoPath, { refType: 'branch', name: 'main', remote: false }),
		incoming: createReference('feature', repoPath, { refType: 'branch', name: 'feature', remote: false }),
		steps: {
			current: {
				number: options?.current ?? 3,
				commit: options?.noCommit
					? undefined
					: createReference(stepSha, repoPath, { refType: 'revision', message: options?.message }),
			},
			total: options?.total ?? 7,
		},
		hasStarted: true,
		isPaused: true,
		isInteractive: false,
	};
}

function createCherryPick(message?: string): GitCherryPickStatus {
	return {
		type: 'cherry-pick',
		repoPath: repoPath,
		mergeBase: undefined,
		HEAD: createReference(incomingSha, repoPath, { refType: 'revision', message: message }),
		current: createReference('main', repoPath, { refType: 'branch', name: 'main', remote: false }),
		incoming: createReference(incomingSha, repoPath, { refType: 'revision', message: message }),
	};
}

function createRevert(message?: string): GitRevertStatus {
	return {
		type: 'revert',
		repoPath: repoPath,
		mergeBase: undefined,
		HEAD: createReference(incomingSha, repoPath, { refType: 'revision', message: message }),
		current: createReference('main', repoPath, { refType: 'branch', name: 'main', remote: false }),
		incoming: createReference(incomingSha, repoPath, { refType: 'revision', message: message }),
	};
}

suite('getPausedOperationVariant', () => {
	test('conflicts win over a rebase that has not started', () => {
		assert.strictEqual(getPausedOperationVariant(createRebase({ current: 0, total: 0 }), true), 'conflicts');
	});

	test('a rebase with no steps yet is pending', () => {
		assert.strictEqual(getPausedOperationVariant(createRebase({ current: 0, total: 0 }), false), 'pending');
	});

	test('a started rebase without conflicts is ready', () => {
		assert.strictEqual(getPausedOperationVariant(createRebase(), false), 'ready');
	});

	test('non-rebase operations are never pending', () => {
		assert.strictEqual(getPausedOperationVariant(createMerge(), false), 'ready');
		assert.strictEqual(getPausedOperationVariant(createCherryPick(), false), 'ready');
		assert.strictEqual(getPausedOperationVariant(createRevert(), false), 'ready');
	});
});

suite('isPausedOperationStepped', () => {
	test('a started rebase is stepped whether or not it has conflicts', () => {
		assert.strictEqual(isPausedOperationStepped(createRebase(), 'ready'), true);
		assert.strictEqual(isPausedOperationStepped(createRebase(), 'conflicts'), true);
	});

	test('a pending rebase is not stepped', () => {
		assert.strictEqual(isPausedOperationStepped(createRebase({ current: 0, total: 0 }), 'pending'), false);
	});

	test('non-rebase operations are never stepped', () => {
		assert.strictEqual(isPausedOperationStepped(createMerge(), 'conflicts'), false);
		assert.strictEqual(isPausedOperationStepped(createCherryPick(), 'ready'), false);
	});
});

suite('getPausedOperationBarLabel', () => {
	test('conflicts name the paused operation', () => {
		assert.strictEqual(getPausedOperationBarLabel(createMerge(), 'conflicts'), 'Merge paused');
		assert.strictEqual(getPausedOperationBarLabel(createRebase(), 'conflicts'), 'Rebase paused');
		assert.strictEqual(getPausedOperationBarLabel(createCherryPick(), 'conflicts'), 'Cherry-pick paused');
		assert.strictEqual(getPausedOperationBarLabel(createRevert(), 'conflicts'), 'Revert paused');
	});

	test('ready is verb-led', () => {
		assert.strictEqual(getPausedOperationBarLabel(createMerge(), 'ready'), 'Merging');
		assert.strictEqual(getPausedOperationBarLabel(createRebase(), 'ready'), 'Rebasing');
		assert.strictEqual(getPausedOperationBarLabel(createCherryPick(), 'ready'), 'Cherry picking');
		assert.strictEqual(getPausedOperationBarLabel(createRevert(), 'ready'), 'Reverting');
	});

	test('a pending rebase stands alone, since its refs can shed', () => {
		assert.strictEqual(
			getPausedOperationBarLabel(createRebase({ current: 0, total: 0 }), 'pending'),
			'Pending rebase',
		);
	});
});

suite('getPausedOperationBarActionLabel', () => {
	test('the conflict count rides on the button', () => {
		assert.strictEqual(getPausedOperationBarActionLabel(createMerge(), 'conflicts', 3), 'Resolve 3 Conflicts');
	});

	test('a single conflict is not pluralized', () => {
		assert.strictEqual(getPausedOperationBarActionLabel(createMerge(), 'conflicts', 1), 'Resolve 1 Conflict');
	});

	test('a host without a count still gets an actionable label', () => {
		assert.strictEqual(
			getPausedOperationBarActionLabel(createMerge(), 'conflicts', undefined),
			'Resolve Conflicts',
		);
	});

	test('continue names the operation', () => {
		assert.strictEqual(getPausedOperationBarActionLabel(createMerge(), 'ready', undefined), 'Continue Merge');
		assert.strictEqual(
			getPausedOperationBarActionLabel(createCherryPick(), 'ready', undefined),
			'Continue Cherry Pick',
		);
		assert.strictEqual(getPausedOperationBarActionLabel(createRevert(), 'ready', undefined), 'Continue Revert');
		assert.strictEqual(
			getPausedOperationBarActionLabel(createRebase({ current: 0, total: 0 }), 'pending', undefined),
			'Continue Rebase',
		);
	});
});

suite('pausedOperationVariantIcons', () => {
	test('each variant gets its own icon', () => {
		assert.strictEqual(pausedOperationVariantIcons.conflicts, 'warning');
		assert.strictEqual(pausedOperationVariantIcons.pending, 'circle-outline');
		assert.strictEqual(pausedOperationVariantIcons.ready, 'check');
	});
});

suite('getPausedOperationBarRefsSummary', () => {
	test('branch operands are named, in the operation’s own direction', () => {
		assert.strictEqual(getPausedOperationBarRefsSummary(createMerge()), 'Merging feature into main');
		assert.strictEqual(getPausedOperationBarRefsSummary(createRebase()), 'Rebasing feature onto main');
	});

	test('a revision operand is shortened', () => {
		assert.strictEqual(getPausedOperationBarRefsSummary(createCherryPick()), 'Cherry picking a1b2c3d into main');
		assert.strictEqual(getPausedOperationBarRefsSummary(createRevert()), 'Reverting a1b2c3d in main');
	});
});

suite('getPausedOperationBarIconTooltip', () => {
	test('conflicts restate the count in plain words, led by the operands', () => {
		assert.strictEqual(
			getPausedOperationBarIconTooltip(createMerge(), 'conflicts', 2),
			'Merging feature into main. 2 conflicting files must be resolved before the merge can continue',
		);
		assert.strictEqual(
			getPausedOperationBarIconTooltip(createRebase(), 'conflicts', 1),
			'Rebasing feature onto main. 1 conflicting file must be resolved before the rebase can continue',
		);
	});

	test('a countless host drops the number, not the sentence', () => {
		assert.strictEqual(
			getPausedOperationBarIconTooltip(createCherryPick(), 'conflicts', undefined),
			'Cherry picking a1b2c3d into main. Conflicting files must be resolved before the cherry-pick can continue',
		);
	});

	test('ready spells out that nothing is blocking', () => {
		assert.strictEqual(
			getPausedOperationBarIconTooltip(createMerge(), 'ready', undefined),
			'Merging feature into main. No unresolved conflicts — ready to continue',
		);
	});

	test('pending names its operands too, since its refs shed like every other variant', () => {
		assert.strictEqual(
			getPausedOperationBarIconTooltip(createRebase({ current: 0, total: 0 }), 'pending', undefined),
			'Rebasing feature onto main. The rebase hasn’t reached its first step',
		);
	});
});

suite('getPausedOperationAbortLabel', () => {
	test('abort names the operation', () => {
		assert.strictEqual(getPausedOperationAbortLabel(createMerge()), 'Abort Merge');
		assert.strictEqual(getPausedOperationAbortLabel(createCherryPick()), 'Abort Cherry Pick');
	});
});

suite('getPausedOperationSkipRef', () => {
	test('a merge has nothing to skip', () => {
		assert.strictEqual(getPausedOperationSkipRef(createMerge()), undefined);
	});

	test('a rebase skips its current step', () => {
		assert.strictEqual(getPausedOperationSkipRef(createRebase())?.ref, stepSha);
	});

	test('a cherry-pick/revert skips the commit it is applying', () => {
		assert.strictEqual(getPausedOperationSkipRef(createCherryPick())?.ref, incomingSha);
		assert.strictEqual(getPausedOperationSkipRef(createRevert())?.ref, incomingSha);
	});
});

suite('getPausedOperationSkipLabel', () => {
	test('a rebase skips its paused commit; a cherry-pick/revert skips the commit', () => {
		assert.strictEqual(getPausedOperationSkipLabel(createRebase()), 'Skip Paused Commit');
		assert.strictEqual(getPausedOperationSkipLabel(createCherryPick()), 'Skip Commit');
		assert.strictEqual(getPausedOperationSkipLabel(createRevert()), 'Skip Commit');
	});

	test('without a commit at all it falls back to plain Skip', () => {
		assert.strictEqual(getPausedOperationSkipLabel(createRebase({ noCommit: true })), 'Skip');
		assert.strictEqual(getPausedOperationSkipLabel(createMerge()), 'Skip');
	});
});

suite('getPausedOperationSkipDetail', () => {
	test('names the victim', () => {
		assert.strictEqual(
			getPausedOperationSkipDetail(createCherryPick('Fix parser edge case')),
			'a1b2c3d "Fix parser edge case"',
		);
	});

	test('only the subject line is used', () => {
		assert.strictEqual(
			getPausedOperationSkipDetail(createRevert('Add telemetry\n\nWith a long body that is not a subject')),
			'a1b2c3d "Add telemetry"',
		);
	});

	test('a long subject is elided', () => {
		const subject = 'A'.repeat(80);
		assert.strictEqual(getPausedOperationSkipDetail(createCherryPick(subject)), `a1b2c3d "${'A'.repeat(49)}…"`);
	});

	test('without a subject it falls back to the sha', () => {
		assert.strictEqual(getPausedOperationSkipDetail(createCherryPick()), 'a1b2c3d');
	});

	test('without a commit there is no detail', () => {
		assert.strictEqual(getPausedOperationSkipDetail(createRebase({ noCommit: true })), undefined);
		assert.strictEqual(getPausedOperationSkipDetail(createMerge()), undefined);
	});
});

suite('getPausedOperationStepTooltipParts', () => {
	test('states where the rebase is paused and the commit subject', () => {
		assert.deepStrictEqual(getPausedOperationStepTooltipParts(createRebase({ message: 'Fix parser edge case' })), {
			detail: 'Rebase paused at 0f1e2d3 (step 3 of 7)',
			subject: '"Fix parser edge case"',
		});
	});

	test('without a subject only the detail remains', () => {
		assert.deepStrictEqual(getPausedOperationStepTooltipParts(createRebase()), {
			detail: 'Rebase paused at 0f1e2d3 (step 3 of 7)',
			subject: undefined,
		});
	});

	test('without a commit the position still reads', () => {
		assert.deepStrictEqual(getPausedOperationStepTooltipParts(createRebase({ noCommit: true })), {
			detail: 'Rebase paused (step 3 of 7)',
			subject: undefined,
		});
	});
});
