import * as assert from 'assert';
import type { RebaseTodoAction } from '@gitlens/git/models/rebase.js';
import { getActionablePauseAction } from '../rebase.parsing.utils.js';

suite('rebase.parsing.utils', () => {
	suite('getActionablePauseAction', () => {
		test('returns the action for edit/reword/break/exec', () => {
			assert.strictEqual(getActionablePauseAction('edit'), 'edit');
			assert.strictEqual(getActionablePauseAction('reword'), 'reword');
			assert.strictEqual(getActionablePauseAction('break'), 'break');
			assert.strictEqual(getActionablePauseAction('exec'), 'exec');
		});

		test('returns undefined for non-actionable actions', () => {
			const nonActionable: RebaseTodoAction[] = [
				'pick',
				'squash',
				'fixup',
				'drop',
				'noop',
				'label',
				'reset',
				'update-ref',
				'merge',
			];
			for (const action of nonActionable) {
				assert.strictEqual(
					getActionablePauseAction(action),
					undefined,
					`expected undefined for action ${action}`,
				);
			}
		});

		test('returns undefined for undefined input', () => {
			assert.strictEqual(getActionablePauseAction(undefined), undefined);
		});
	});
});
