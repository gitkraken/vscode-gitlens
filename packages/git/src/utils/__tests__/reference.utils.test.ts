import * as assert from 'assert';
import { createReference, getReferenceLabel } from '../reference.utils.js';

const sha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const repo = '/repo';

suite('getReferenceLabel', () => {
	suite('branch references', () => {
		const branch = createReference(sha, repo, { refType: 'branch', name: 'main', remote: false });

		test('default (expand + icon + label)', () => {
			const result = getReferenceLabel(branch);
			assert.strictEqual(result, 'branch $(git-branch)\u00a0main');
		});

		test('with options=false returns just the name', () => {
			const result = getReferenceLabel(branch, false);
			assert.strictEqual(result, 'main');
		});

		test('with expand: true, icon: false', () => {
			const result = getReferenceLabel(branch, { expand: true, icon: false });
			assert.strictEqual(result, 'branch main');
		});

		test('with icon: true, expand: false (label defaults to false)', () => {
			const result = getReferenceLabel(branch, { icon: true, expand: false });
			assert.strictEqual(result, '$(git-branch)\u00a0main');
		});

		test('with quoted: true', () => {
			const result = getReferenceLabel(branch, { quoted: true });
			assert.strictEqual(result, "branch $(git-branch)\u00a0'main'");
		});

		test('with capitalize: true and expand: true', () => {
			const result = getReferenceLabel(branch, { capitalize: true, expand: true, icon: false });
			assert.strictEqual(result, 'Branch main');
		});

		test('with label: false omits the branch prefix', () => {
			const result = getReferenceLabel(branch, { label: false, icon: false });
			assert.strictEqual(result, 'main');
		});

		test('remote branch formats as "remote: name"', () => {
			const remoteBranch = createReference(sha, repo, {
				refType: 'branch',
				name: 'origin/feature',
				remote: true,
			});
			const result = getReferenceLabel(remoteBranch, { icon: false });
			assert.strictEqual(result, 'remote branch origin: feature');
		});

		test('remote branch with capitalize and expand', () => {
			const remoteBranch = createReference(sha, repo, {
				refType: 'branch',
				name: 'origin/feature',
				remote: true,
			});
			const result = getReferenceLabel(remoteBranch, { capitalize: true, expand: true, icon: false });
			assert.strictEqual(result, 'Remote Branch origin: feature');
		});

		test('remote branch with quoted double-wraps due to pre-quote then reformat', () => {
			const remoteBranch = createReference(sha, repo, {
				refType: 'branch',
				name: 'origin/feature',
				remote: true,
			});
			const result = getReferenceLabel(remoteBranch, { quoted: true, icon: false });
			// The name is quoted before splitting, then re-quoted after reformatting
			assert.strictEqual(result, "remote branch ''origin: feature''");
		});
	});

	suite('tag references', () => {
		const tag = createReference(sha, repo, { refType: 'tag', name: 'v1.0.0' });

		test('default (expand + icon + label)', () => {
			const result = getReferenceLabel(tag);
			assert.strictEqual(result, 'tag $(tag)\u00a0v1.0.0');
		});

		test('with icon: false', () => {
			const result = getReferenceLabel(tag, { icon: false });
			assert.strictEqual(result, 'tag v1.0.0');
		});

		test('with label: false', () => {
			const result = getReferenceLabel(tag, { label: false, icon: false });
			assert.strictEqual(result, 'v1.0.0');
		});

		test('with quoted: true', () => {
			const result = getReferenceLabel(tag, { quoted: true, icon: false });
			assert.strictEqual(result, "tag 'v1.0.0'");
		});
	});

	suite('stash references', () => {
		const stash = createReference(sha, repo, {
			refType: 'stash',
			name: 'stash@{0}',
			number: '0',
			message: 'WIP on main',
		});

		test('default shows stash number with expand', () => {
			const result = getReferenceLabel(stash, { icon: false });
			assert.strictEqual(result, 'stash #0: WIP on main');
		});

		test('with icon shows archive icon and message', () => {
			const result = getReferenceLabel(stash);
			assert.strictEqual(result, 'stash $(archive)\u00a0#0: WIP on main');
		});

		test('without expand shows stash number (label defaults to false when expand is false)', () => {
			const result = getReferenceLabel(stash, { expand: false, icon: false });
			assert.strictEqual(result, '#0');
		});

		test('with options=false shows stash number (no label)', () => {
			const result = getReferenceLabel(stash, false);
			assert.strictEqual(result, '#0');
		});

		test('truncates long messages at 20 chars', () => {
			const longStash = createReference(sha, repo, {
				refType: 'stash',
				name: 'stash@{1}',
				number: '1',
				message: 'This is a really long stash message that exceeds twenty characters',
			});
			const result = getReferenceLabel(longStash, { icon: false });
			assert.strictEqual(result, 'stash #1: This is a really lon\u2026');
		});

		test('stash without number falls back to name', () => {
			const noNumStash = createReference(sha, repo, {
				refType: 'stash',
				name: 'stash@{0}',
				number: undefined,
				message: 'WIP',
			});
			const result = getReferenceLabel(noNumStash, { expand: true, icon: false });
			assert.strictEqual(result, 'stash WIP');
		});
	});

	suite('revision/commit references', () => {
		test('default shows shortened SHA with commit label', () => {
			const rev = createReference(sha, repo);
			const result = getReferenceLabel(rev, { icon: false });
			assert.strictEqual(result, 'commit a1b2c3d');
		});

		test('with message shows message in parentheses', () => {
			const rev = createReference(sha, repo, { refType: 'revision', message: 'Fix bug' });
			const result = getReferenceLabel(rev, { icon: false });
			assert.strictEqual(result, 'commit a1b2c3d (Fix bug)');
		});

		test('truncates long messages at 20 chars', () => {
			const rev = createReference(sha, repo, {
				refType: 'revision',
				message: 'This is a very long commit message that should be truncated',
			});
			const result = getReferenceLabel(rev, { icon: false });
			assert.strictEqual(result, 'commit a1b2c3d (This is a very long\u2026)');
		});

		test('without expand omits message and label (label defaults to false when expand is false)', () => {
			const rev = createReference(sha, repo, { refType: 'revision', message: 'Fix bug' });
			const result = getReferenceLabel(rev, { expand: false, icon: false });
			assert.strictEqual(result, 'a1b2c3d');
		});

		test('with icon shows git-commit icon', () => {
			const rev = createReference(sha, repo);
			const result = getReferenceLabel(rev);
			assert.strictEqual(result, 'commit $(git-commit)\u00a0a1b2c3d');
		});

		test('with options=false returns just the shortened SHA', () => {
			const rev = createReference(sha, repo);
			const result = getReferenceLabel(rev, false);
			assert.strictEqual(result, 'a1b2c3d');
		});
	});

	suite('revision with parent suffix (^)', () => {
		const parentSha = `${sha}^`;

		test('with expand and label shows "before commit" prefix', () => {
			const rev = createReference(parentSha, repo);
			const result = getReferenceLabel(rev, { expand: true, icon: false });
			assert.strictEqual(result, 'before commit a1b2c3d');
		});

		test('with quoted and parent suffix', () => {
			const rev = createReference(parentSha, repo);
			const result = getReferenceLabel(rev, { expand: true, icon: false, quoted: true });
			assert.strictEqual(result, "before commit 'a1b2c3d'");
		});

		test('without expand omits "before" prefix and label', () => {
			const rev = createReference(parentSha, repo);
			const result = getReferenceLabel(rev, { expand: false, icon: false });
			assert.strictEqual(result, 'a1b2c3d^');
		});

		test('without label keeps the ^ suffix (no stripping without label)', () => {
			const rev = createReference(parentSha, repo);
			const result = getReferenceLabel(rev, { expand: true, label: false, icon: false });
			assert.strictEqual(result, 'a1b2c3d^');
		});
	});

	suite('array of references', () => {
		test('multiple branches shows count and names', () => {
			const refs = [
				createReference(sha, repo, { refType: 'branch', name: 'main', remote: false }),
				createReference(sha, repo, { refType: 'branch', name: 'develop', remote: false }),
			];
			const result = getReferenceLabel(refs);
			assert.strictEqual(result, '2 branches (main, develop)');
		});

		test('multiple tags shows count and names', () => {
			const refs = [
				createReference(sha, repo, { refType: 'tag', name: 'v1.0' }),
				createReference(sha, repo, { refType: 'tag', name: 'v2.0' }),
			];
			const result = getReferenceLabel(refs);
			assert.strictEqual(result, '2 tags (v1.0, v2.0)');
		});

		test('multiple commits shows count and names', () => {
			const refs = [createReference(sha, repo), createReference(sha, repo)];
			const result = getReferenceLabel(refs);
			assert.strictEqual(result, '2 commits (a1b2c3d, a1b2c3d)');
		});

		test('multiple stashes shows "stashes"', () => {
			const refs = [
				createReference(sha, repo, { refType: 'stash', name: 'stash@{0}', number: '0' }),
				createReference(sha, repo, { refType: 'stash', name: 'stash@{1}', number: '1' }),
			];
			const result = getReferenceLabel(refs);
			assert.strictEqual(result, '2 stashes (stash@{0}, stash@{1})');
		});

		test('without expand omits names', () => {
			const refs = [
				createReference(sha, repo, { refType: 'branch', name: 'main', remote: false }),
				createReference(sha, repo, { refType: 'branch', name: 'develop', remote: false }),
			];
			const result = getReferenceLabel(refs, { expand: false });
			assert.strictEqual(result, '2 branches');
		});

		test('single-element array treated as single reference', () => {
			const refs = [createReference(sha, repo, { refType: 'branch', name: 'main', remote: false })];
			const result = getReferenceLabel(refs, { icon: false });
			assert.strictEqual(result, 'branch main');
		});
	});

	suite('undefined/null input', () => {
		test('undefined returns empty string', () => {
			const result = getReferenceLabel(undefined);
			assert.strictEqual(result, '');
		});
	});
});
