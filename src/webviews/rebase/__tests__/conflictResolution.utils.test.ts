import * as assert from 'assert';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { ConflictKind, ConflictResolutionAction } from '@gitlens/git/utils/conflictResolution.utils.js';
import { classifyConflictAction, classifyConflictKind } from '@gitlens/git/utils/conflictResolution.utils.js';

const cases: {
	status: GitFileConflictStatus;
	resolution: 'current' | 'incoming';
	expected: ConflictResolutionAction;
}[] = [
	{ status: 'UU', resolution: 'current', expected: 'take-ours' },
	{ status: 'UU', resolution: 'incoming', expected: 'take-theirs' },
	{ status: 'AA', resolution: 'current', expected: 'take-ours' },
	{ status: 'AA', resolution: 'incoming', expected: 'take-theirs' },
	{ status: 'DD', resolution: 'current', expected: 'delete' },
	{ status: 'DD', resolution: 'incoming', expected: 'delete' },
	{ status: 'UD', resolution: 'current', expected: 'take-ours' },
	{ status: 'UD', resolution: 'incoming', expected: 'delete' },
	{ status: 'DU', resolution: 'current', expected: 'delete' },
	{ status: 'DU', resolution: 'incoming', expected: 'take-theirs' },
	{ status: 'AU', resolution: 'current', expected: 'take-ours' },
	{ status: 'AU', resolution: 'incoming', expected: 'unsupported' },
	{ status: 'UA', resolution: 'current', expected: 'unsupported' },
	{ status: 'UA', resolution: 'incoming', expected: 'take-theirs' },
];

const kindCases: {
	name: string;
	status: GitFileConflictStatus;
	modes?: { base?: string; current?: string; incoming?: string };
	oids?: { base?: string; current?: string; incoming?: string };
	hints?: { binary?: boolean; rename?: 'rename-rename' | 'rename-delete' | 'rename-modify' };
	expected: ConflictKind;
}[] = [
	// rename hint wins over everything, including delete statuses
	{ name: 'rename-rename hint on UU', status: 'UU', hints: { rename: 'rename-rename' }, expected: 'rename-rename' },
	{ name: 'rename-delete hint on DD', status: 'DD', hints: { rename: 'rename-delete' }, expected: 'rename-delete' },
	{ name: 'rename-modify hint on UU', status: 'UU', hints: { rename: 'rename-modify' }, expected: 'rename-modify' },
	// delete statuses short-circuit before mode/binary checks
	{ name: 'DD', status: 'DD', expected: 'both-deleted' },
	{ name: 'UD', status: 'UD', expected: 'delete-modify' },
	{ name: 'DU', status: 'DU', expected: 'delete-modify' },
	// mode-derived kinds (submodule wins over symlink wins over binary)
	{ name: 'submodule', status: 'UU', modes: { current: '160000', incoming: '100644' }, expected: 'submodule' },
	{ name: 'symlink', status: 'UU', modes: { current: '120000', incoming: '120000' }, expected: 'symlink' },
	{
		name: 'submodule beats binary hint',
		status: 'UU',
		modes: { current: '160000' },
		hints: { binary: true },
		expected: 'submodule',
	},
	{
		name: 'binary hint',
		status: 'UU',
		modes: { current: '100644', incoming: '100644' },
		hints: { binary: true },
		expected: 'binary',
	},
	// mode-only: identical content (oid), differing mode
	{
		name: 'mode-only (exec bit)',
		status: 'UU',
		modes: { current: '100644', incoming: '100755' },
		oids: { current: 'abc', incoming: 'abc' },
		expected: 'mode-only',
	},
	{
		name: 'differing mode but differing oid is not mode-only',
		status: 'UU',
		modes: { current: '100644', incoming: '100755' },
		oids: { current: 'abc', incoming: 'def' },
		expected: 'text',
	},
	// add/add family
	{ name: 'AA', status: 'AA', expected: 'add-add' },
	{ name: 'AU', status: 'AU', expected: 'add-add' },
	{ name: 'UA', status: 'UA', expected: 'add-add' },
	// default
	{ name: 'UU with no extra info', status: 'UU', expected: 'text' },
];

suite('rebase/conflictResolution.utils', () => {
	suite('classifyConflictAction', () => {
		for (const { status, resolution, expected } of cases) {
			test(`${status} + take-${resolution} → ${expected}`, () => {
				assert.strictEqual(classifyConflictAction(status, resolution), expected);
			});
		}
	});

	suite('classifyConflictKind', () => {
		for (const { name, status, modes, oids, hints, expected } of kindCases) {
			test(`${name} → ${expected}`, () => {
				assert.strictEqual(classifyConflictKind(status, modes, oids, hints), expected);
			});
		}
	});
});
