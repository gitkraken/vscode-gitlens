import assert from 'node:assert/strict';
import { createWipRowId, getWipRowWorktreePath, isWipRowId } from '../identity.js';

suite('graph row identity', () => {
	test('keeps the existing POSIX row-id format', () => {
		assert.equal(createWipRowId('/repo/worktree'), 'wip::/repo/worktree');
		assert.equal(createWipRowId('/repo/worktree/'), 'wip::/repo/worktree');
		assert.equal(createWipRowId('/'), 'wip::/');
	});

	test('normalizes native Windows spellings consistently across runtimes', () => {
		assert.equal(createWipRowId('C:\\repo\\worktree'), 'wip::c:/repo/worktree');
		assert.equal(createWipRowId('/C:/repo/worktree/'), 'wip::c:/repo/worktree');
		assert.equal(createWipRowId('C:\\'), 'wip::c:/');
		assert.equal(createWipRowId('C:/'), 'wip::c:/');
		assert.equal(createWipRowId('/C:/'), 'wip::c:/');
	});

	test('pins URI-shaped worktree ids (e.g. vscode-vfs) against drive-letter or separator mangling', () => {
		// A URI scheme's `x://` looks nothing like a Windows drive letter, but pin it explicitly:
		// the drive-letter regex matches a single letter directly before `:/`, and a naive tweak to
		// that pattern could start eating the first letter of a scheme like `vscode-vfs:`.
		assert.equal(createWipRowId('vscode-vfs://github/owner/repo'), 'wip::vscode-vfs://github/owner/repo');
		assert.equal(createWipRowId('vscode-vfs://github/owner/repo/'), 'wip::vscode-vfs://github/owner/repo');

		const id = createWipRowId('vscode-vfs://github/owner/repo');
		assert.equal(getWipRowWorktreePath(id), 'vscode-vfs://github/owner/repo');
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
