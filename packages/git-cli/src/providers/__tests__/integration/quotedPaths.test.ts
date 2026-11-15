import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo, revParse } from './helpers.js';

// Names a file system other than Windows' allows. Git writes the first group raw and C-quotes the second, and a path
// holding ` b/` is where the `diff --git a/<old> b/<new>` line can't be split
const plainNames = ['Plan b/notes.md', 'sp ace.txt', 'café 日本.txt'];
const quotedNames = [
	'q"uote.txt',
	'back\\slash.txt',
	'tab\there.txt',
	'new\nline.txt',
	'sp "ace".txt',
	'Plan b/q"uote b/x.txt',
];
const names = process.platform === 'win32' ? plainNames : [...plainNames, ...quotedNames];

function git(repo: TestRepo, ...args: string[]): string {
	return execFileSync('git', args, { cwd: repo.path, encoding: 'utf8', stdio: 'pipe' });
}

function write(repo: TestRepo, name: string, content: string | Buffer): void {
	const path = join(repo.path, name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function commitAll(repo: TestRepo, message: string): void {
	git(repo, 'add', '-A');
	git(repo, 'commit', '-m', message);
}

/** The `path` of each file `git diff --numstat -z` names, with its `originalPath` when it names a rename or copy */
function numstatPaths(repo: TestRepo, ...range: string[]): string[] {
	const fields = git(repo, 'diff', '--numstat', '-z', '-M', ...range).split('\0');
	const files: string[] = [];
	for (let i = 0; i < fields.length; i++) {
		const field = fields[i];
		if (!field) continue;

		const path = field.substring(field.indexOf('\t', field.indexOf('\t') + 1) + 1);
		if (path === '') {
			files.push(`${fields[i + 1]} -> ${fields[i + 2]}`);
			i += 2;
		} else {
			files.push(path);
		}
	}
	return files.sort();
}

suite('Paths git quotes or splits ambiguously', () => {
	suite('parsed diff', () => {
		let repo: TestRepo;
		let baseline: string;
		let changes: string;

		suiteSetup(() => {
			repo = createTestRepo();

			for (const name of names) {
				write(repo, name, 'one\ntwo\nthree\n');
			}
			write(repo, 'Plan a/moved from.md', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n');
			write(repo, 'del "me".txt', 'gone\n');
			write(repo, 'bin b/data.bin', Buffer.from([0, 1, 2, 3]));
			write(repo, 'mode b/run.sh', '#!/bin/sh\n');
			commitAll(repo, 'baseline');
			baseline = revParse(repo.path, 'HEAD');

			for (const name of names) {
				write(repo, name, 'one\ntwo\nthree\nfour\n');
			}
			git(repo, 'mv', 'Plan a/moved from.md', 'Plan b/moved to.md');
			write(repo, 'Plan b/moved to.md', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n');
			git(repo, 'rm', '-q', 'del "me".txt');
			write(repo, 'bin b/data.bin', Buffer.from([0, 1, 2, 3, 4]));
			git(repo, 'update-index', '--chmod=+x', 'mode b/run.sh');
			write(repo, 'added b/new "one".txt', 'new\n');
			commitAll(repo, 'changes');
			changes = revParse(repo.path, 'HEAD');
		});

		suiteTeardown(() => {
			repo.cleanup();
		});

		async function parsedPaths(to: string, from?: string): Promise<string[]> {
			const parsed = await repo.provider.diff.getParsedDiff?.(repo.path, to, from, {
				renames: true,
				errors: 'throw',
			});
			assert.ok(parsed, 'the diff should parse');
			return parsed.files.map(f => (f.originalPath != null ? `${f.originalPath} -> ${f.path}` : f.path)).sort();
		}

		test('names every file as `diff --numstat -z` does', async () => {
			const expected = numstatPaths(repo, baseline, changes);
			assert.ok(expected.length > names.length, 'the fixture changes more than the edited names');
			assert.ok(expected.includes('Plan a/moved from.md -> Plan b/moved to.md'), 'the fixture has a rename');

			assert.deepStrictEqual(await parsedPaths(changes, baseline), expected);
		});

		test('names a pure rename of a quoted path as `diff --numstat -z` does', async function () {
			if (process.platform === 'win32') return this.skip();

			mkdirSync(join(repo.path, 'q"uote b'));
			git(repo, 'mv', 'q"uote.txt', 'q"uote b/renamed\ttab.txt');
			commitAll(repo, 'pure rename');

			const expected = numstatPaths(repo, changes, 'HEAD');
			assert.deepStrictEqual(expected, ['q"uote.txt -> q"uote b/renamed\ttab.txt']);
			assert.deepStrictEqual(await parsedPaths('HEAD', changes), expected);
		});

		test('names the files of a working tree diff as `diff --numstat -z` does', async () => {
			for (const name of names) {
				write(repo, name, 'rewritten\n');
			}

			const expected = numstatPaths(repo);
			assert.ok(expected.includes('Plan b/notes.md'), 'the fixture changes a path holding " b/"');
			assert.deepStrictEqual(await parsedPaths(uncommitted), expected);
		});
	});

	suite('status', () => {
		const renamedFrom = process.platform === 'win32' ? 'ren ame from.txt' : 'ren "ame" from.txt';
		const renamedTo = process.platform === 'win32' ? 'ren ame to.txt' : 'ren\tame "to".txt';
		let repo: TestRepo;

		suiteSetup(() => {
			repo = createTestRepo();

			write(repo, renamedFrom, 'one\ntwo\nthree\nfour\nfive\nsix\n');
			for (const name of names) {
				write(repo, name, 'one\n');
			}
			commitAll(repo, 'baseline');

			for (const name of names) {
				write(repo, name, 'two\n');
			}
			git(repo, 'mv', renamedFrom, renamedTo);

			for (const name of names) {
				write(repo, `u-${name.replace(/\//g, ' ')}`, 'untracked\n');
			}
			write(repo, 'u-dir b/inner.txt', 'untracked\n');
			if (process.platform !== 'win32') {
				write(repo, 'u-d"ir\\x/inner.txt', 'untracked\n');
			}
		});

		suiteTeardown(() => {
			repo.cleanup();
		});

		async function readStatus(porcelainVersion: 1 | 2, untracked: 'no' | 'normal') {
			const supports = repo.provider.git.supports.bind(repo.provider.git);
			repo.provider.git.supports = feature =>
				feature === 'git:status:porcelain-v2' ? porcelainVersion === 2 : supports(feature);

			try {
				const status = await repo.provider.status.getStatus(repo.path, { untracked: untracked, force: true });
				assert.ok(status, 'the status should be read');
				return status;
			} finally {
				repo.provider.git.supports = supports;
			}
		}

		async function assertUntrackedNames(porcelainVersion: 1 | 2) {
			const status = await readStatus(porcelainVersion, 'normal');

			const onDisk = readdirSync(repo.path, { withFileTypes: true })
				.filter(e => e.name.startsWith('u-'))
				.map(e => (e.isDirectory() ? `${e.name}/` : e.name))
				.sort();
			assert.ok(onDisk.length > names.length, 'the fixture has an untracked directory too');

			const untracked = status.files
				.filter(f => f.status === '?')
				.map(f => f.path)
				.sort();
			assert.deepStrictEqual(untracked, onDisk);
		}

		async function assertTrackedNames(porcelainVersion: 1 | 2) {
			const status = await readStatus(porcelainVersion, 'no');

			assert.deepStrictEqual(
				status.files
					.filter(f => f.originalPath == null)
					.map(f => f.path)
					.sort(),
				[...names].sort(),
			);

			const renamed = status.files.find(f => f.originalPath != null);
			assert.ok(renamed, 'the rename should be read');
			assert.strictEqual(renamed.originalPath, renamedFrom);
			assert.strictEqual(renamed.path, renamedTo);
		}

		test('names untracked files as they are on disk (porcelain v2)', () => assertUntrackedNames(2));

		test('names untracked files as they are on disk (porcelain v1)', () => assertUntrackedNames(1));

		test('names modified files and a staged rename as git does (porcelain v2)', () => assertTrackedNames(2));

		test('names modified files and a staged rename as git does (porcelain v1)', () => assertTrackedNames(1));
	});

	suite('commit file lists and blame', () => {
		const longContent = (seed: string) => Array.from({ length: 12 }, (_, i) => `${seed} line ${i}\n`).join('');
		const renames: [string, string][] = [
			['quoted "src".txt', 'plain dst.txt'],
			['plain src.txt', 'quoted "dst".txt'],
			['qd "a".txt', 'qd\t"b".txt'],
		];
		// Whitespace at an end of a name git quotes is inside the quotes, so it is part of the name
		const edgeNames = ['\tlead.txt', 'q"trail '];
		const edgeRename: [string, string] = ['\tren from.txt', 'q"ren to '];
		let repo: TestRepo;
		let baseline: string;
		let changes: string;

		suiteSetup(function () {
			// The names hold characters Windows can't
			if (process.platform === 'win32') return this.skip();

			repo = createTestRepo();
			for (const name of names) {
				write(repo, name, 'one\ntwo\nthree\n');
			}
			for (const [from] of renames) {
				write(repo, from, longContent(from));
			}
			for (const name of edgeNames) {
				write(repo, name, 'one\ntwo\nthree\n');
			}
			write(repo, edgeRename[0], longContent(edgeRename[0]));
			write(repo, 'del "me".txt', 'gone\n');
			commitAll(repo, 'baseline');
			baseline = revParse(repo.path, 'HEAD');

			for (const name of names) {
				write(repo, name, 'one\ntwo\nthree\nfour\n');
			}
			for (const [from, to] of renames) {
				git(repo, 'mv', from, to);
			}
			for (const name of edgeNames) {
				write(repo, name, 'one\ntwo\nthree\nfour\n');
			}
			git(repo, 'mv', ...edgeRename);
			git(repo, 'rm', '-q', 'del "me".txt');
			write(repo, 'added "n".txt', 'new\n');
			commitAll(repo, 'changes');
			changes = revParse(repo.path, 'HEAD');
		});

		suiteTeardown(() => {
			repo?.cleanup();
		});

		test("names a commit's files as `diff --numstat -z` does", async () => {
			const commit = await repo.provider.commits.getCommit(repo.path, changes);
			const files = commit?.fileset?.files;
			assert.ok(files, "the commit's files should be read");

			const expected = numstatPaths(repo, baseline, changes);
			assert.ok(expected.includes('quoted "src".txt -> plain dst.txt'), 'the fixture renames a quoted path');
			assert.ok(expected.includes('\tren from.txt -> q"ren to '), 'the fixture renames whitespace-edged names');
			assert.deepStrictEqual(
				files.map(f => (f.originalPath != null ? `${f.originalPath} -> ${f.path}` : f.path)).sort(),
				expected,
			);
		});

		test('names the files of a one-commit log as `diff --numstat -z` does', async () => {
			const log = await repo.provider.commits.getLog(repo.path, changes, { limit: 1, includeFiles: true });
			const files = log?.commits.get(changes)?.fileset?.files;
			assert.ok(files, "the commit's files should be read");

			assert.deepStrictEqual(
				files.map(f => (f.originalPath != null ? `${f.originalPath} -> ${f.path}` : f.path)).sort(),
				numstatPaths(repo, baseline, changes),
			);
		});

		test('names a blamed file as it is on disk', async () => {
			// The blame provider reads a `\` in the path it is given as a separator, as on Windows
			for (const name of names.filter(n => !n.includes('\\'))) {
				const blame = await repo.provider.blame.getBlame(repo.path, name);
				assert.ok(blame, `blame of ${JSON.stringify(name)} should be read`);

				const paths = Array.from(blame.commits.values(), c => c.file?.path);
				assert.ok(paths.length > 0);
				assert.ok(
					paths.every(path => path === name),
					`${JSON.stringify(name)} was blamed as ${JSON.stringify(paths)}`,
				);
			}
		});

		test('names the file a blamed line came from before a rename', async () => {
			for (const [from, to] of renames) {
				const blame = await repo.provider.blame.getBlame(repo.path, to);
				assert.ok(blame, `blame of ${JSON.stringify(to)} should be read`);

				const file = blame.commits.get(baseline)?.file;
				assert.strictEqual(file?.path, from);
			}
		});
	});

	suite('tree', () => {
		let repo: TestRepo;

		suiteSetup(() => {
			repo = createTestRepo();
			for (const name of names) {
				write(repo, name, 'one\n');
			}
			commitAll(repo, 'baseline');
		});

		suiteTeardown(() => {
			repo.cleanup();
		});

		test('names each entry as `ls-tree -z` does', async () => {
			const entries = await repo.provider.revision.getTreeForRevision(repo.path, 'HEAD');

			const blobs = entries
				.filter(e => e.type === 'blob')
				.map(e => e.path)
				.sort();
			assert.deepStrictEqual(blobs, [...names, 'README.md'].sort());
		});

		test('names a single entry as it is', async () => {
			for (const name of names) {
				const entry = await repo.provider.revision.getTreeEntryForRevision(repo.path, name, 'HEAD');
				assert.strictEqual(entry?.path, name);
			}
		});
	});
});
