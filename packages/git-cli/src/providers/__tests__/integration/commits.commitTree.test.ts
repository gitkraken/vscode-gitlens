import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { addCommit, createBranch, createTestRepo, getHeadSha } from './helpers.js';

function treeOf(repoPath: string, rev: string): string {
	return execFileSync('git', ['rev-parse', `${rev}^{tree}`], { cwd: repoPath, encoding: 'utf-8' }).trim();
}

function catFile(repoPath: string, sha: string): string {
	return execFileSync('git', ['cat-file', '-p', sha], { cwd: repoPath, encoding: 'utf-8' });
}

suite('CommitsGitSubProvider.createCommitFromTree', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	test('creates a commit with two parents and an explicit author', async () => {
		const mainSha = getHeadSha(repo.path);

		createBranch(repo.path, 'feature', { checkout: true });
		addCommit(repo.path, 'feature.txt', 'feature content\n', 'Add feature');
		const featureSha = getHeadSha(repo.path);

		const sha = await repo.provider.commits.createCommitFromTree(repo.path, treeOf(repo.path, featureSha), {
			parents: [featureSha, mainSha],
			message: 'merge via commit-tree',
			author: { name: 'Custom Author', email: 'custom@example.test', date: '2024-05-01T00:00:00Z' },
		});

		const raw = catFile(repo.path, sha);
		assert.ok(raw.includes(`parent ${featureSha}`), `expected parent ${featureSha} in:\n${raw}`);
		assert.ok(raw.includes(`parent ${mainSha}`), `expected parent ${mainSha} in:\n${raw}`);
		assert.ok(
			raw.includes('author Custom Author <custom@example.test> 1714521600'),
			`expected author line in:\n${raw}`,
		);
		assert.ok(raw.trimEnd().endsWith('merge via commit-tree'), `expected message in:\n${raw}`);

		// Writes the commit object only — no ref points at it yet.
		const branches = execFileSync('git', ['branch', '--contains', sha], {
			cwd: repo.path,
			encoding: 'utf-8',
		}).trim();
		assert.strictEqual(branches, '', 'a commit-tree result must not be reachable from any branch yet');
	});

	test('with zero parents creates a root commit', async () => {
		const emptyTree = execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], {
			cwd: repo.path,
			input: '',
			encoding: 'utf-8',
		}).trim();

		const sha = await repo.provider.commits.createCommitFromTree(repo.path, emptyTree, {
			parents: [],
			message: 'root commit',
		});

		const raw = catFile(repo.path, sha);
		assert.ok(!raw.includes('parent '), `expected no parent line in:\n${raw}`);
	});

	test('a single-parent commit ends with the message plus a single trailing newline', async () => {
		const headSha = getHeadSha(repo.path);
		const tree = treeOf(repo.path, headSha);

		const sha = await repo.provider.commits.createCommitFromTree(repo.path, tree, {
			parents: [headSha],
			message: 'via commit-tree stdin',
		});

		const raw = catFile(repo.path, sha);
		assert.ok(raw.includes(`parent ${headSha}`), `expected parent ${headSha} in:\n${raw}`);
		// `-m` completes the line with a single newline; the stdin form must write the same object.
		assert.ok(raw.endsWith('via commit-tree stdin\n'), `expected a newline-terminated message in:\n${raw}`);
		assert.ok(!raw.endsWith('via commit-tree stdin\n\n'), 'expected exactly one trailing newline, not two');
	});
});
