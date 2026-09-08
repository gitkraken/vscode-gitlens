import * as assert from 'assert';
import * as l10n from '@vscode/l10n';
import { AuthenticationError, BranchError, TagError } from '@gitlens/git/errors.js';
import { getPresentableErrorMessage } from '../errors.js';

suite('getPresentableErrorMessage', () => {
	test('presents the translation while leaving `message` English', () => {
		const error = new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });
		Object.defineProperty(error, 'localizedMessage', { get: () => 'La branche main existe déjà' });
		const english = error.message;
		const serialized = String(error);

		const envelope = JSON.parse(JSON.stringify({ error: { message: getPresentableErrorMessage(error) } }));
		assert.deepStrictEqual(envelope, { error: { message: 'La branche main existe déjà' } });
		assert.strictEqual(english, "Unable to create branch 'main' because it already exists");
		assert.strictEqual(error.message, english);
		assert.strictEqual(String(error), serialized);
	});

	test('covers other GitCommandError subclasses without subclass-specific presentation guards', () => {
		l10n.config({
			contents: {
				"Unable to create tag '{0}' because it already exists":
					"Impossible de créer le tag '{0}' car il existe déjà",
			},
		});
		try {
			const error = new TagError({ action: 'create', tag: 'v1', reason: 'alreadyExists' });
			assert.strictEqual(getPresentableErrorMessage(error), error.localizedMessage);
			assert.notStrictEqual(getPresentableErrorMessage(error), error.message);
		} finally {
			l10n.config({ contents: {} });
		}
	});

	test('redacts authentication token details while keeping the safe message', () => {
		const error = new AuthenticationError(
			{
				providerId: 'github',
				cloud: true,
				type: 'pat',
				microHash: 'private-token-hash',
				scopes: ['private-scope'],
				expiresAt: new Date('2026-01-01T00:00:00Z'),
			},
			'Authentication required',
		);
		assert.ok(String(error).includes('private-token-hash'));
		assert.strictEqual(getPresentableErrorMessage(error), 'Authentication required');
		assert.strictEqual(error.message, 'Authentication required');
	});

	test('preserves generic error and non-error fallback behavior', () => {
		const error = new Error('ordinary failure');
		assert.strictEqual(getPresentableErrorMessage(error), 'ordinary failure');
		assert.strictEqual(String(error), 'Error: ordinary failure');
		for (const value of ['plain failure', 42, null, undefined]) {
			assert.strictEqual(getPresentableErrorMessage(value), String(value));
		}
	});
});
