import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { addCommit, createStash, createTag, createTestRepo, getHeadSha } from './helpers.js';

suite('Embedded ASCII separators in free text (#5659)', () => {
	const subject = 'Add file \x1E with a record sep';
	const message = `${subject}\n\nbody \x1D with a field sep \x1E\x1D`;
	const author = { name: 'Ev\x1Eil \x1DName', email: 'evil@example.com' };

	let repo: TestRepo;
	let evilSha: string;
	let afterSha: string;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file.txt', 'one', message, { author: author });
		evilSha = getHeadSha(repo.path);
		createTag(repo.path, 'v1', 'Tag \x1E subject \x1D here');
		addCommit(repo.path, 'file.txt', 'two', 'After');
		afterSha = getHeadSha(repo.path);
		createStash(repo.path, 'wip \x1E with \x1D seps');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('git keeps the separator bytes in the commit (fixture sanity)', () => {
		const raw = execFileSync('git', ['log', '-1', '--format=%B', evilSha], { cwd: repo.path, encoding: 'utf8' });
		assert.ok(raw.includes('\x1E') && raw.includes('\x1D'), 'fixture must contain the raw separators');
	});

	test('getCommit (single-commit parse) returns the full message and author', async () => {
		const commit = await repo.provider.commits.getCommit(repo.path, evilSha);
		assert.ok(commit, 'Should find the commit');
		assert.strictEqual(commit.sha, evilSha);
		assert.strictEqual(commit.message, message);
		assert.strictEqual(commit.author.name, author.name);
	});

	test('getLog includes every commit with intact fields', async () => {
		const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: 0 });
		assert.ok(log, 'Log should not be undefined');
		const commit = log.commits.get(evilSha);
		assert.ok(commit, 'Commit with embedded separators must not be dropped');
		assert.strictEqual(commit.message, message);
		assert.strictEqual(commit.author.name, author.name);
		assert.ok(log.commits.has(afterSha));
	});

	test('getLogForPath (file history) includes the commit with intact fields', async () => {
		const log = await repo.provider.commits.getLogForPath(repo.path, 'file.txt', undefined, { limit: 0 });
		assert.ok(log, 'Log should not be undefined');
		assert.deepStrictEqual([...log.commits.keys()], [afterSha, evilSha]);
		assert.strictEqual(log.commits.get(evilSha)?.message, message);
	});

	test('getCommitForFile (limit:1 file lookup) returns the commit with intact fields', async () => {
		const commit = await repo.provider.commits.getCommitForFile(repo.path, 'file.txt', evilSha);
		assert.ok(commit, 'Should find the commit');
		assert.strictEqual(commit.sha, evilSha);
		assert.strictEqual(commit.message, message);
	});

	test('getGraph includes the commit row with intact fields', async () => {
		const graph = await repo.provider.graph.getGraph(repo.path, undefined, {});
		const row = graph.rows.find(r => r.sha === evilSha);
		assert.ok(row, 'Graph row with embedded separators must not be dropped');
		assert.ok(row.message.includes(subject), `Unexpected row message: ${JSON.stringify(row.message)}`);
		assert.strictEqual(row.author, author.name);
	});

	test('getTags returns the annotated tag with its subject intact', async () => {
		const result = await repo.provider.tags.getTags(repo.path);
		const tag = result.values.find(t => t.name === 'v1');
		assert.ok(tag, 'Tag must be parsed');
		assert.strictEqual(tag.sha, evilSha);
		assert.strictEqual(tag.message, 'Tag \x1E subject \x1D here');
	});

	test('getStash returns the stash with its message intact', async () => {
		const stash = await repo.provider.stash?.getStash(repo.path, { includeFiles: true });
		assert.ok(stash, 'Stash list should not be undefined');
		assert.strictEqual(stash.stashes.size, 1);
		const [entry] = stash.stashes.values();
		assert.ok(entry.message?.includes('wip \x1E with \x1D seps'), `Unexpected: ${JSON.stringify(entry.message)}`);
		assert.ok(entry.fileset?.files?.length, 'Stash files must be parsed');
	});
});
