import assert from 'node:assert/strict';
import { createWipRowId, getWipRowWorktreePath, isWipRowId } from '../identity.js';

suite('graph row identity', () => {
	test('keeps the existing POSIX row-id format', () => {
		assert.equal(createWipRowId('/repo/worktree'), 'wip::/repo/worktree');
		assert.equal(createWipRowId('/repo/worktree/'), 'wip::/repo/worktree');
	});

	test('normalizes native Windows spellings consistently across runtimes', () => {
		assert.equal(createWipRowId('C:\\repo\\worktree'), 'wip::c:/repo/worktree');
		assert.equal(createWipRowId('/C:/repo/worktree/'), 'wip::c:/repo/worktree');
		assert.equal(createWipRowId('C:\\'), 'wip::c:/');
		assert.equal(createWipRowId('C:/'), 'wip::c:/');
		assert.equal(createWipRowId('/C:/'), 'wip::c:/');
	});

	test('recognizes and decodes only canonical WIP row ids', () => {
		const id = createWipRowId('/repo/worktree');
		assert.equal(isWipRowId(id), true);
		assert.equal(getWipRowWorktreePath(id), '/repo/worktree');
		assert.equal(isWipRowId('abc123'), false);
		assert.equal(isWipRowId(undefined), false);
		assert.equal(getWipRowWorktreePath('abc123'), undefined);
	});
});
