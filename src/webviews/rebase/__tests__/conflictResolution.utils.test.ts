import * as assert from 'assert';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { ConflictResolutionAction } from '@gitlens/git/utils/conflictResolution.utils.js';
import { classifyConflictAction } from '@gitlens/git/utils/conflictResolution.utils.js';

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

suite('rebase/conflictResolution.utils', () => {
	suite('classifyConflictAction', () => {
		for (const { status, resolution, expected } of cases) {
			test(`${status} + take-${resolution} → ${expected}`, () => {
				assert.strictEqual(classifyConflictAction(status, resolution), expected);
			});
		}
	});
});
