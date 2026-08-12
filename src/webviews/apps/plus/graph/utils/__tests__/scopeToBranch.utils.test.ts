import * as assert from 'assert';
import type { State } from '../../../../../plus/graph/protocol.js';
import { resolveScopeToBranchTarget, shouldDrainParkedScopeToBranch } from '../scopeToBranch.utils.js';

function branch(detached: boolean): NonNullable<State['branch']> {
	const name = detached ? '(abc1234…)' : 'main';
	return {
		refType: 'branch',
		name: name,
		ref: name,
		remote: false,
		repoPath: '/r',
		detached: detached,
	};
}

suite('graph scope-to-branch park/drain rules', () => {
	test('parks while the branch is unknown, detached, or the repo path is unresolved', () => {
		assert.strictEqual(resolveScopeToBranchTarget(undefined, '/r'), undefined);
		assert.strictEqual(resolveScopeToBranchTarget(branch(true), '/r'), undefined);
		assert.strictEqual(resolveScopeToBranchTarget(branch(false), undefined), undefined);
	});

	test('resolves once the branch is attached and the repo path is known', () => {
		assert.deepStrictEqual(resolveScopeToBranchTarget(branch(false), '/r'), {
			branch: branch(false),
			repoPath: '/r',
		});
	});

	test('drains only an armed park whose request would now resolve', () => {
		assert.strictEqual(shouldDrainParkedScopeToBranch(true, branch(false), '/r'), true);
		assert.strictEqual(shouldDrainParkedScopeToBranch(true, branch(true), '/r'), false);
		assert.strictEqual(shouldDrainParkedScopeToBranch(true, undefined, '/r'), false);
		assert.strictEqual(shouldDrainParkedScopeToBranch(true, branch(false), undefined), false);
		assert.strictEqual(shouldDrainParkedScopeToBranch(false, branch(false), '/r'), false);
	});
});
