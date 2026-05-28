import * as assert from 'assert';
import { CommitError, SigningError } from '@gitlens/git/errors.js';
import { buildCommitOutputPreview, classifyCommitFailure, getCommitFailureOutput } from '../commitFailure.js';

/** Builds an Error carrying git-style stderr/stdout, mimicking the wrapped `original` GitError. */
function gitError(output: { stderr?: string; stdout?: string }): Error {
	return Object.assign(new Error(output.stderr ?? output.stdout ?? 'git error'), output);
}

suite('commitFailure', () => {
	suite('classifyCommitFailure', () => {
		test('classifies signing failures', () => {
			const ex = new SigningError({ reason: 'passphraseFailed' }, gitError({ stderr: 'gpg failed to sign' }));
			const result = classifyCommitFailure(ex);
			assert.strictEqual(result.reason, 'signingFailed');
			assert.strictEqual(result.summary, 'Unable to commit: signing failed');
			assert.strictEqual(result.output, 'gpg failed to sign');
		});

		test('classifies nothing-to-commit and still surfaces the raw git output', () => {
			const ex = new CommitError({ reason: 'nothingToCommit' }, gitError({ stdout: 'nothing to commit' }));
			const result = classifyCommitFailure(ex);
			assert.strictEqual(result.reason, 'nothingToCommit');
			assert.strictEqual(result.summary, 'Unable to commit: no staged changes');
			assert.strictEqual(result.output, 'nothing to commit');
		});

		test('classifies merge conflicts', () => {
			const ex = new CommitError({ reason: 'conflicts' }, gitError({ stderr: 'unmerged files' }));
			assert.strictEqual(classifyCommitFailure(ex).reason, 'conflicts');
		});

		test('classifies missing git identity', () => {
			const ex = new CommitError(
				{ reason: 'noUserNameConfigured' },
				gitError({ stderr: 'Please tell me who you are' }),
			);
			assert.strictEqual(classifyCommitFailure(ex).reason, 'identityMissing');
		});

		test('treats an unrecognized failure with output as a hook rejection', () => {
			const ex = new CommitError({ reason: undefined }, gitError({ stderr: 'eslint: 12 problems\nexit 1' }));
			const result = classifyCommitFailure(ex);
			assert.strictEqual(result.reason, 'hookRejected');
			assert.strictEqual(result.summary, 'Unable to commit: blocked by a Git hook');
			assert.strictEqual(result.output, 'eslint: 12 problems\nexit 1');
		});

		test('treats a bare custom hook (no markers) as a hook rejection via its output', () => {
			const ex = new CommitError({ reason: undefined }, gitError({ stdout: 'lint failed' }));
			assert.strictEqual(classifyCommitFailure(ex).reason, 'hookRejected');
		});

		test('falls back to unknown when there is no output', () => {
			const result = classifyCommitFailure(new Error('boom'));
			assert.strictEqual(result.reason, 'unknown');
			assert.strictEqual(result.summary, 'Unable to commit: boom');
			assert.strictEqual(result.output, undefined);
		});
	});

	suite('getCommitFailureOutput', () => {
		test('prefers stderr over stdout', () => {
			const ex = new CommitError({ reason: undefined }, gitError({ stderr: 'err', stdout: 'out' }));
			assert.strictEqual(getCommitFailureOutput(ex), 'err');
		});

		test('falls back to stdout and trims', () => {
			const ex = new CommitError({ reason: undefined }, gitError({ stdout: '  out  ' }));
			assert.strictEqual(getCommitFailureOutput(ex), 'out');
		});

		test('returns undefined when no output is present', () => {
			assert.strictEqual(getCommitFailureOutput(new Error('no output fields')), undefined);
		});
	});

	suite('buildCommitOutputPreview', () => {
		test('returns short output unchanged', () => {
			assert.strictEqual(buildCommitOutputPreview('one\ntwo'), 'one\ntwo');
		});

		test('truncates beyond 10 lines and reports the remainder', () => {
			const output = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n');
			const preview = buildCommitOutputPreview(output);
			assert.ok(preview.startsWith('line 1\n'));
			assert.ok(preview.includes('line 10'));
			assert.ok(!preview.includes('line 11'));
			assert.ok(preview.endsWith('… (5 more lines)'));
		});

		test('uses singular wording for a single remaining line', () => {
			const output = Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join('\n');
			assert.ok(buildCommitOutputPreview(output).endsWith('… (1 more line)'));
		});
	});
});
